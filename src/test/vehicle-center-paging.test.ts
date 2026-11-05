import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  getVehicleCenterTab, listAllMatchingVehicleCenter, listVehicleVisitCenterPage,
  projectClaimWithoutEntry, resolveVehicleVisit, VEHICLE_CENTER_TABS, VISIT_STAGES,
} from "@/lib/vehicleVisitLifecycle";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), tenant: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));

const base = { id: "entry-1", tenant_id: "tenant-1", vehicle_id: "vehicle-1", status: "Received",
  arrival_date: "2026-11-01", arrival_time: "08:00", vehicle_location: "داخل الورشة" };
function raw(entry: any = base, temporary = false, workflow: any = null, final = false) {
  const visit = entry._claimOnly ? projectClaimWithoutEntry(entry.claim, entry.work_order || null)
    : resolveVehicleVisit(entry, workflow, final, temporary);
  return { ...visit, entry, hasSignedTemporaryRelease: temporary };
}
function response(items: any[], total = items.length, page = 1, scopeToken = "a".repeat(32)) {
  return { items, total, page, pageSize: 30, scopeToken,
    tabs: Object.fromEntries(VEHICLE_CENTER_TABS.map((key) => [key, items.length > 0 && items.every((v) => getVehicleCenterTab(v) === key)
      ? total : items.filter((v) => getVehicleCenterTab(v) === key).length])),
    stages: Object.fromEntries(VISIT_STAGES.map((key) => [key, items.filter((v) => v.operationalStage === key).length])),
    entryCount: total, claimOnlyCount: 0, technicians: [] };
}
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.tenant.mockReset().mockResolvedValue("tenant-1");
});

describe("canonical center custody classification", () => {
  it("keeps new inspection arrivals inside until an actual signed temporary release", () => {
    const inspected = { ...base, vehicle_condition: { visit_purpose: "inspection" } };
    expect(getVehicleCenterTab(raw(inspected))).toBe("in_workshop");
    expect(getVehicleCenterTab(raw({ ...inspected, vehicle_location: "مع العميل" }))).toBe("needs_review");
    expect(getVehicleCenterTab(raw({ ...inspected, vehicle_location: "مع العميل" }, true))).toBe("with_customer");
  });
  it.each(["delivered", "cancelled"])("keeps %s operational markers terminal despite a review reason", (terminal) => {
    const visit = { ...raw(), operationalStage: terminal as "delivered" | "cancelled", reviewReason: "custody_conflict" };
    expect(getVehicleCenterTab(visit)).toBe(terminal);
  });
  it("places no-signed-handover history held by the client in Delivered, not With customer", () => {
    const entry = { ...base, vehicle_location: "داخل الورشة", insurance_claim_id: "claim-1",
      claim: { id: "claim-1", tenant_id: "tenant-1", vehicle_id: base.vehicle_id,
        status: "approved", delivered_at: "2026-11-02T08:00:00Z", vehicle_presence_status: "with_customer" } };
    const visit = raw(entry);
    expect(visit.reviewReason).toBe("delivery_without_signed_handover");
    expect(visit.operationalStage).toBe("delivered");
    expect(getVehicleCenterTab(visit)).toBe("delivered");
    // A pre-arrival historical delivery is not evidence of this visit leaving.
    expect(getVehicleCenterTab(raw({ ...entry, vehicle_location: "مع العميل",
      claim: { ...entry.claim, delivered_at: "2026-10-20T08:00:00Z" } }))).toBe("needs_review");
  });
  it("keeps uncertain delivery where sources still say inside under Review", () => {
    const visit = raw({ ...base, insurance_claim_id: "claim-1", claim: { id: "claim-1", vehicle_id: base.vehicle_id,
      status: "approved", delivered_at: "2026-11-02T08:00:00Z", vehicle_presence_status: "in_workshop" } });
    expect(getVehicleCenterTab(visit)).toBe("needs_review");
  });
  it.each(["pending", "approved", "cancelled"])("never fabricates a physical visit from a %s claim-only card", (status) => {
    const visit = projectClaimWithoutEntry({ id: "claim-1", vehicle_id: "vehicle-1", status,
      vehicle_presence_status: "with_customer", created_at: "2026-11-01T08:00:00Z" }, null);
    expect(getVehicleCenterTab(visit)).toBe("needs_review");
  });
});

describe("bounded cloud paging contract", () => {
  it("sends every filter with a tenant-scoped bounded request, without an all-history fallback", async () => {
    mocks.rpc.mockResolvedValue({ data: response([raw()]), error: null });
    const filters = { search: "AB 123", from: "2026-11-01", to: "2026-11-04", status: "Received",
      technician: "Ali", minDays: 2, stage: "arrived" as const, location: "in_workshop" as const };
    await listVehicleVisitCenterPage({ tab: "in_workshop", filters });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("vehicle_visit_center_page_v1", {
      p_tenant_id: "tenant-1", p_tab: "in_workshop", p_page: 1, p_page_size: 30, p_filters: filters,
    });
  });
  it("clamps page size and preserves accurate server totals larger than the loaded page", async () => {
    const result = { ...response([raw()], 613), pageSize: 100 };
    result.tabs.in_workshop = 613;
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    expect((await listVehicleVisitCenterPage({ tab: "in_workshop", pageSize: 900 })).total).toBe(613);
    expect(mocks.rpc.mock.calls[0][1].p_page_size).toBe(100);
  });
  it.each(["entry", "workflow", "claim", "work_order", "vehicle", "customer"])("rejects a wrong-tenant %s payload", async (field) => {
    const row = raw();
    if (field === "entry") row.entry = { ...base, tenant_id: "other" };
    else if (field === "workflow") row.workflow = { tenant_id: "other" } as any;
    else row.entry = { ...base, [field]: { tenant_id: "other" } };
    mocks.rpc.mockResolvedValue({ data: response([row]), error: null });
    await expect(listVehicleVisitCenterPage({ tab: "in_workshop" })).rejects.toThrow("VEHICLE_CENTER_TENANT_MISMATCH");
  });
  it("rejects server/frontend projection drift rather than misplacing a vehicle", async () => {
    mocks.rpc.mockResolvedValue({ data: response([{ ...raw(), operationalStage: "ready" }]), error: null });
    await expect(listVehicleVisitCenterPage({ tab: "in_workshop" })).rejects.toThrow("VEHICLE_CENTER_PROJECTION_MISMATCH");
  });
  it("does not turn an unavailable read API into an unbounded scan", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("RPC_NOT_INSTALLED") });
    await expect(listVehicleVisitCenterPage({ tab: "in_workshop" })).rejects.toThrow("RPC_NOT_INSTALLED");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not query at all without a tenant", async () => {
    mocks.tenant.mockResolvedValue(null);
    await expect(listVehicleVisitCenterPage({ tab: "in_workshop" })).rejects.toThrow("TENANT_NOT_FOUND");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("exports all matching pages, carrying the same tab/filter scope", async () => {
    const first = Array.from({ length: 100 }, (_, i) => raw({ ...base, id: `entry-${i}` }));
    mocks.rpc.mockResolvedValueOnce({ data: { ...response(first, 101), pageSize: 100 }, error: null })
      .mockResolvedValueOnce({ data: { ...response([raw({ ...base, id: "older" })], 101, 2), pageSize: 100 }, error: null });
    const result = await listAllMatchingVehicleCenter({ tab: "in_workshop", filters: { stage: "arrived", from: "2026-11-01" } });
    expect(result).toHaveLength(101);
    expect(result[result.length - 1]?.entry.id).toBe("older");
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_page: 2, p_page_size: 100,
      p_tab: "in_workshop", p_filters: { stage: "arrived", from: "2026-11-01" } });
  });
  it("refuses a partial export when content changes even if the total stays equal", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...response([raw()], 2), pageSize: 100 }, error: null })
      .mockResolvedValueOnce({ data: { ...response([raw({ ...base, id: "older" })], 2, 2, "b".repeat(32)), pageSize: 100 }, error: null });
    await expect(listAllMatchingVehicleCenter({ tab: "in_workshop" })).rejects.toThrow("VEHICLE_CENTER_EXPORT_CHANGED");
  });
  it("rejects oversized exports instead of silently truncating them", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...response([raw()], 10_001), pageSize: 100 }, error: null });
    await expect(listAllMatchingVehicleCenter({ tab: "in_workshop" })).rejects.toThrow("VEHICLE_VISIT_RESULT_LIMIT");
  });
});

describe("read-only Development projection migration", () => {
  const sql = readFileSync("supabase/migrations/20261104142019_vehicle_center_bounded_read_projection.sql", "utf8");
  it("retains canonical evidence and forbids workflow/history backfill", () => {
    expect(sql).toContain("public.vehicle_visit_evidence_stage(e.id)");
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|alter table)\b/i);
    expect(sql).toContain("p_tenant_id is distinct from public.get_user_tenant_id()");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("'admin','manager','supervisor','technician','insurance'");
    expect(sql).toContain("p.account_status='active'");
    expect(sql).toContain("p.tenant_id=p_tenant_id");
  });
  it("bounds only selected tab details, aggregates before paging and hides helper endpoints", () => {
    expect(sql).toContain("r->>'centerTab'=p_tab");
    expect(sql).toContain("limit p_page_size offset ((p_page::bigint-1)*p_page_size)");
    expect(sql).toContain("p_page_size>100");
    expect(sql).toContain("from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.vehicle_visit_center_page_v1");
    expect(sql).not.toContain("grant execute on function public.vehicle_visit_center_rows_v1");
    expect(sql).toContain("'scopeToken'");
    const endpoint = sql.slice(sql.indexOf("create function public.vehicle_visit_center_page_v1"));
    expect(endpoint).toContain("security invoker");
    expect(endpoint).not.toContain("public.vehicle_visit_evidence_stage(e.id)");
    expect(sql).toContain("public.vehicle_visit_center_evidence_v1(p_tenant_id,entry,workflow,final_handover,temporary_release)");
    expect(sql).not.toContain("signature_data_url");
  });
});
