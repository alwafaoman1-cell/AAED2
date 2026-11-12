import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), tenant: vi.fn(), scopeListeners: new Set<() => void>(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));
vi.mock("@/lib/cloudSettings", () => ({
  subscribeCloudSettingsScopeChange: (listener: () => void) => { mocks.scopeListeners.add(listener); return () => mocks.scopeListeners.delete(listener); },
  readCloudSetting: vi.fn().mockResolvedValue({}),
  subscribeCloudSetting: vi.fn(() => () => undefined),
  writeCloudSetting: vi.fn().mockResolvedValue(undefined),
}));

type Result = { data: unknown; error?: unknown; count?: number | null };
function query(result: Result | Promise<Result>) {
  const q: any = { then: (ok: (value: Result) => unknown, fail: (error: unknown) => unknown) => Promise.resolve(result).then(ok, fail) };
  for (const method of ["select", "eq", "in", "order", "range", "limit", "maybeSingle", "single", "update", "upsert", "delete"]) q[method] = vi.fn(() => q);
  return q;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const orderId = "11111111-1111-4111-8111-111111111111";
const otherOrderId = "22222222-2222-4222-8222-222222222222";
const row = (id = "report-row", code = "DR-00007") => ({
  id, tenant_id: "tenant-a", inspection_code: code, job_order_id: orderId,
  job_order: { order_number: "WO-7" }, customer_name: "Customer", vehicle_summary: "Toyota",
  inspection_date: "2026-11-06", photo_count: 3, inspection_kind: "insurance", status: "pending",
  plate_number: "AB 123", details: { vehicleEntryId: "entry-7", claimId: "claim-7", futureField: { preserve: true },
    insuranceInspectionReport: { reportNo: code, annotatedImages: ["data:image/png;base64,photo"], sections: [{ titleEn: "Body", titleAr: "الهيكل", items: [{ key: "panel", en: "Body panel", ar: "قطعة هيكل", repair: true, replace: true, comment: "Preserve item marks" }] }] } },
  ai_analysis: { summary: "Preserve analysis" },
});
let api: typeof import("@/lib/inspectionsStore");
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.scopeListeners.clear();
  mocks.tenant.mockResolvedValue("tenant-a");
  mocks.from.mockReset();
  api = await import("@/lib/inspectionsStore");
});

describe("root inspection summary/detail loading", () => {
  it("loads a work-order detail card from a tenant/FK-scoped summary, not the full inspection archive", async () => {
    const q = query({ data: [row()], count: 1 });
    mocks.from.mockReturnValue(q);
    const [summary] = await api.fetchInspectionSummariesForOrder("tenant-a", orderId);
    expect(q.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(q.eq).toHaveBeenCalledWith("job_order_id", orderId);
    expect(q.select.mock.calls[0][0]).not.toMatch(/\*|details|ai_analysis|photos/);
    expect(summary).not.toHaveProperty("details");
    const source = readFileSync(resolve(process.cwd(), "src/pages/WorkOrderDetail.tsx"), "utf8");
    expect(source).not.toContain("inspectionsStore.getAll()");
    expect(source).toContain("fetchInspectionSummariesForOrder(profile!.tenant_id, inspectionOrderId!)");
    expect(source).toContain('queryKey: ["inspections", "work_order_summary"');
    expect(source).toContain("inspectionsQuery.isError ?");
    expect(source).toContain("!inspectionsQuery.isSuccess ?");
  });
  it("loads projected summaries on getAll/subscribe, never details or photos, and strips heavy fields from snapshots", async () => {
    // Even if a transport/mock supplies excess fields, list consumers cannot see them.
    const q = query({ data: [row()], count: 1 });
    mocks.from.mockReturnValue(q);
    api.inspectionsStore.getAll();
    const unsubscribe = api.inspectionsStore.subscribe(() => undefined);
    await api.inspectionsStore.refresh();
    const [summary] = api.inspectionsStore.getAll();
    expect(summary).toMatchObject({ id: "DR-00007", workOrder: "WO-7", photos: 3 });
    expect(summary).not.toHaveProperty("details");
    expect(summary).not.toHaveProperty("aiAnalysis");
    expect(mocks.from).toHaveBeenCalledTimes(1);
    const columns = q.select.mock.calls[0][0];
    for (const forbidden of ["*", "details", "ai_analysis", "photos"]) expect(columns).not.toContain(forbidden);
    expect(q.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(q.select.mock.calls[0][1]).toEqual({ count: "exact" });
    expect(q.maybeSingle).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not cap inspection summaries at 500", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => row(`row-${i}`, `DR-${String(i + 1).padStart(5, "0")}`));
    const pages = [0, 200, 400].map((offset) => query({ data: rows.slice(offset, offset + 200), count: rows.length }));
    pages.forEach((page) => mocks.from.mockReturnValueOnce(page));
    await api.inspectionsStore.refresh();
    expect(api.inspectionsStore.getAll()).toHaveLength(501);
    expect(pages[2].range).toHaveBeenCalledWith(400, 599);
  });

  it("counts only the current tenant's visible order IDs, across server-capped pages, with no detail request", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ id: `row-${i}`, job_order_id: orderId }));
    const pages = Array.from({ length: 6 }, (_, i) => query({ data: rows.slice(i * 100, i * 100 + 100), count: rows.length }));
    pages.forEach((page) => mocks.from.mockReturnValueOnce(page));
    const result = await api.fetchInspectionCountsForOrders("tenant-a", [{ id: "WO-7", cloudId: orderId }, { id: "WO-8", cloudId: otherOrderId }]);
    expect(result).toEqual({ "WO-7": 501, "WO-8": 0 });
    pages.forEach((page) => {
      expect(page.select).toHaveBeenCalledWith("id,job_order_id", { count: "exact" });
      expect(page.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
      expect(page.in).toHaveBeenCalledWith("job_order_id", [orderId, otherOrderId]);
    });
    expect(pages[5].range).toHaveBeenCalledWith(500, 699);
  });

  it("bounds count filters to 50 orders per query", async () => {
    const orders = Array.from({ length: 51 }, (_, i) => ({ id: `WO-${i}`, cloudId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}` }));
    const first = query({ data: [], count: 0 });
    const second = query({ data: [], count: 0 });
    mocks.from.mockReturnValueOnce(first).mockReturnValueOnce(second);
    expect(Object.keys(await api.fetchInspectionCountsForOrders("tenant-a", orders))).toHaveLength(51);
    expect(first.in.mock.calls[0][1]).toHaveLength(50);
    expect(second.in.mock.calls[0][1]).toEqual([orders[50].cloudId]);
  });

  it.each([
    { data: null, count: null, error: new Error("offline") },
    { data: [], count: null },
    { data: [], count: 501 },
    { data: [{ id: "r", job_order_id: otherOrderId }], count: 1 },
  ])("rejects failed, unverified or incomplete counts instead of returning zero: %j", async (response) => {
    mocks.from.mockReturnValue(query(response));
    await expect(api.fetchInspectionCountsForOrders("tenant-a", [{ id: "WO-7", cloudId: orderId }])).rejects.toBeTruthy();
  });

  it("rejects a failed later page, count drift and repeated capped pages instead of publishing a partial total", async () => {
    for (const second of [
      { data: null, error: new Error("page 2 offline"), count: null },
      { data: [{ id: "b", job_order_id: orderId }], count: 3 },
      { data: [{ id: "a", job_order_id: orderId }], count: 2 },
    ]) {
      mocks.from.mockReturnValueOnce(query({ data: [{ id: "a", job_order_id: orderId }], count: 2 }))
        .mockReturnValueOnce(query(second));
      await expect(api.fetchInspectionCountsForOrders("tenant-a", [{ id: "WO-7", cloudId: orderId }])).rejects.toBeTruthy();
    }
  });

  it("rejects missing/mismatched tenants and unknown order identities without making an unscoped request", async () => {
    await expect(api.fetchInspectionCountsForOrders("tenant-b", [{ id: "WO-7", cloudId: orderId }])).rejects.toThrow("TENANT_UNAVAILABLE");
    await expect(api.fetchInspectionCountsForOrders("tenant-a", [{ id: "WO-7" }])).rejects.toThrow("ID_UNAVAILABLE");
    mocks.tenant.mockResolvedValue(null);
    await expect(api.inspectionsStore.loadById("DR-00007")).rejects.toThrow("TENANT_UNAVAILABLE");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps read errors distinct from an authoritative empty list and retains a prior summary on refresh failure", async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, count: null, error: new Error("offline") }));
    await expect(api.inspectionsStore.refresh()).rejects.toThrow("offline");
    expect(api.inspectionsStore.getLoadState()).toMatchObject({ ready: false, loading: false, error: "offline" });
    mocks.from.mockReturnValueOnce(query({ data: [row()], count: 1 }));
    await api.inspectionsStore.refresh();
    mocks.from.mockReturnValueOnce(query({ data: null, count: null, error: new Error("later offline") }));
    await expect(api.inspectionsStore.refresh()).rejects.toThrow("later offline");
    expect(api.inspectionsStore.getAll()).toHaveLength(1);
    expect(api.inspectionsStore.getLoadState().error).toBe("later offline");
  });

  it("loads an explicit report without starting a summary query; subsequent summary refresh preserves its full detail cache", async () => {
    expect(api.inspectionsStore.getById("DR-00007")).toBeUndefined();
    const unsubscribe = api.inspectionsStore.subscribe(() => undefined, { loadSummaries: false });
    expect(mocks.from).not.toHaveBeenCalled();
    const detail = query({ data: row() });
    mocks.from.mockReturnValueOnce(detail);
    expect((await api.inspectionsStore.loadById("DR-00007"))?.details).toEqual(row().details);
    expect(detail.eq).toHaveBeenCalledWith("inspection_code", "DR-00007");
    expect(detail.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    const summary = query({ data: [row()], count: 1 });
    mocks.from.mockReturnValueOnce(summary);
    await api.inspectionsStore.refresh();
    expect(api.inspectionsStore.getById("DR-00007")?.details).toEqual(row().details);
    expect(api.inspectionsStore.getById("DR-00007")?.aiAnalysis).toEqual(row().ai_analysis);
    expect(api.inspectionsStore.getAll()[0]).not.toHaveProperty("details");
    expect(mocks.from).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("hydrates before summary edits and preserves report images, unknown detail keys, AI analysis, links and DR number", async () => {
    const detail = query({ data: row() });
    const write = query({ data: { ...row(), status: "complete" } });
    mocks.from.mockReturnValueOnce(detail).mockReturnValueOnce(write);
    const saved = await api.inspectionsStore.updateConfirmed("DR-00007", { status: "complete" });
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "complete", job_order_id: orderId,
      details: row().details, ai_analysis: row().ai_analysis,
    }));
    expect(write.update.mock.calls[0][0]).not.toHaveProperty("inspection_code");
    expect(write.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(write.eq).toHaveBeenCalledWith("id", "report-row");
    expect(write.upsert).not.toHaveBeenCalled();
    expect(saved.id).toBe("DR-00007");
    expect(saved.details).toEqual(row().details);
  });

  it("can explicitly open by cloud UUID without losing the existing DR identity or starting a list query", async () => {
    mocks.from.mockReturnValueOnce(query({ data: null })).mockReturnValueOnce(query({ data: row(orderId) }));
    expect((await api.inspectionsStore.loadById(orderId))?.id).toBe("DR-00007");
    expect(api.inspectionsStore.getById(orderId)?.details).toEqual(row().details);
    expect(api.inspectionsStore.getById("DR-00007")?.cloudId).toBe(orderId);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("hydrates a cold summary selection so the synchronous insurance report consumer receives full marks and images", async () => {
    const summary = query({ data: [row()], count: 1 });
    const full = query({ data: row() });
    mocks.from.mockReturnValueOnce(summary).mockReturnValueOnce(full);
    await api.inspectionsStore.refresh();
    const { insuranceInspectionStore } = await import("@/lib/insuranceInspectionStore");
    expect(api.inspectionsStore.getAll()[0]).not.toHaveProperty("details");
    expect(insuranceInspectionStore.get("DR-00007")).toBeUndefined();
    const selected = await api.inspectionsStore.loadById("DR-00007");
    expect(selected?.details?.insuranceInspectionReport).toEqual(row().details.insuranceInspectionReport);
    expect(insuranceInspectionStore.get("DR-00007")).toEqual(row().details.insuranceInspectionReport);
    expect(insuranceInspectionStore.get("DR-00007")?.sections[0].items[0]).toMatchObject({ repair: true, replace: true, comment: "Preserve item marks" });
    expect(insuranceInspectionStore.get("DR-00007")?.annotatedImages).toEqual(["data:image/png;base64,photo"]);
    expect(selected?.details?.vehicleEntryId).toBe("entry-7");
    expect(selected?.details?.claimId).toBe("claim-7");
    expect(full.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(full.eq).toHaveBeenCalledWith("inspection_code", "DR-00007");
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("does not update after a failed detail hydration or detach an unresolved linked order", async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, error: new Error("detail offline") }));
    await expect(api.inspectionsStore.updateConfirmed("DR-00007", { status: "complete" })).rejects.toThrow("detail offline");
    expect(mocks.from).toHaveBeenCalledTimes(1);
    mocks.from.mockReturnValueOnce(query({ data: row() })).mockReturnValueOnce(query({ data: null }));
    await expect(api.inspectionsStore.updateConfirmed("DR-00007", { workOrder: "WO-unknown" })).rejects.toThrow("WORK_ORDER_NOT_FOUND");
    expect(mocks.from).toHaveBeenCalledTimes(3);
  });

  it("resolves a deliberately changed linked order with tenant scoping, without changing the DR code", async () => {
    const job = query({ data: { id: otherOrderId } });
    const write = query({ data: { ...row(), job_order_id: otherOrderId, job_order: { order_number: "WO-8" } } });
    mocks.from.mockReturnValueOnce(query({ data: row() })).mockReturnValueOnce(job).mockReturnValueOnce(write);
    expect((await api.inspectionsStore.updateConfirmed("DR-00007", { workOrder: "WO-8" })).workOrder).toBe("WO-8");
    expect(job.eq).toHaveBeenCalledWith("order_number", "WO-8");
    expect(job.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(write.update.mock.calls[0][0].job_order_id).toBe(otherOrderId);
    expect(write.update.mock.calls[0][0]).not.toHaveProperty("inspection_code");
  });

  it("keeps a linked order FK even when its joined label is not returned", async () => {
    const linked = { ...row(), job_order: null };
    const write = query({ data: linked });
    mocks.from.mockReturnValueOnce(query({ data: linked })).mockReturnValueOnce(write);
    await api.inspectionsStore.updateConfirmed("DR-00007", { status: "complete" });
    expect(write.update.mock.calls[0][0].job_order_id).toBe(orderId);
    expect(mocks.from).not.toHaveBeenCalledWith("job_orders");
  });

  it("maps realtime summaries without retaining details or losing an unchanged work-order link", async () => {
    mocks.from.mockReturnValueOnce(query({ data: [row()], count: 1 }));
    await api.inspectionsStore.refresh();
    const { job_order: _join, ...changed } = row();
    api.applyInspectionRealtimeChange({ eventType: "UPDATE", new: { ...changed, status: "complete" }, old: { job_order_id: orderId, tenant_id: "tenant-a" } });
    expect(api.inspectionsStore.getAll()[0]).toMatchObject({ workOrder: "WO-7", status: "complete" });
    expect(api.inspectionsStore.getAll()[0]).not.toHaveProperty("details");
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns full trash/restore data only after a tenant-scoped confirmed delete, never the summary", async () => {
    const remove = query({ data: [{ id: "report-row" }] });
    mocks.from.mockReturnValueOnce(query({ data: row() })).mockReturnValueOnce(remove);
    const removed = await api.inspectionsStore.remove("DR-00007");
    expect(removed.details).toEqual(row().details);
    expect(removed.aiAnalysis).toEqual(row().ai_analysis);
    expect(removed.workOrder).toBe("WO-7");
    expect(remove.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(remove.eq).toHaveBeenCalledWith("id", "report-row");
    expect(remove.select).toHaveBeenCalledWith("id");
    expect(api.inspectionsStore.getById("DR-00007")).toBeUndefined();
  });

  it("does not remove local data on delete denial/zero affected rows", async () => {
    mocks.from.mockReturnValueOnce(query({ data: row() })).mockReturnValueOnce(query({ data: [] }));
    await expect(api.inspectionsStore.remove("DR-00007")).rejects.toThrow("DELETE_NOT_CONFIRMED");
    expect(api.inspectionsStore.getById("DR-00007")?.details).toEqual(row().details);
  });

  it("preserves full add/restore payloads and their linked order without list hydration", async () => {
    const write = query({ data: row() });
    mocks.from.mockReturnValueOnce(write);
    api.inspectionsStore.restore({
      id: "DR-00007", workOrder: "WO-7", jobOrderId: orderId, customer: "Customer", vehicle: "Toyota",
      date: "2026-11-06", damageType: "Body", photos: 3, status: "pending", kind: "insurance",
      details: row().details, aiAnalysis: row().ai_analysis,
    });
    await vi.waitFor(() => expect(write.upsert).toHaveBeenCalled());
    expect(write.upsert).toHaveBeenCalledWith(expect.objectContaining({
      inspection_code: "DR-00007", tenant_id: "tenant-a", job_order_id: orderId,
      details: row().details, ai_analysis: row().ai_analysis,
    }), { onConflict: "tenant_id,inspection_code" });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("does not republish a stale in-flight detail response after realtime invalidation", async () => {
    const pending = deferred<Result>();
    mocks.from.mockReturnValueOnce(query(pending.promise));
    const request = api.inspectionsStore.loadById("DR-00007");
    await vi.waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(1));
    api.applyInspectionRealtimeChange({ eventType: "UPDATE", new: { ...row(), status: "complete" }, old: { tenant_id: "tenant-a", job_order_id: orderId } });
    const rejection = expect(request).rejects.toThrow("CHANGED_DURING_LOAD");
    pending.resolve({ data: row() });
    await rejection;
    expect(api.inspectionsStore.getById("DR-00007")?.details).toBeUndefined();
  });

  it("ignores late detail, summary and count responses after a tenant switch", async () => {
    const detail = deferred<Result>();
    const summary = deferred<Result>();
    const counts = deferred<Result>();
    mocks.from.mockReturnValueOnce(query(detail.promise)).mockReturnValueOnce(query(summary.promise)).mockReturnValueOnce(query(counts.promise));
    const a = api.inspectionsStore.loadById("DR-00007");
    const b = api.inspectionsStore.refresh();
    const c = api.fetchInspectionCountsForOrders("tenant-a", [{ id: "WO-7", cloudId: orderId }]);
    await vi.waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(3));
    mocks.scopeListeners.forEach((listener) => listener());
    mocks.tenant.mockResolvedValue("tenant-b");
    const completed = Promise.allSettled([a, b, c]);
    detail.resolve({ data: row() }); summary.resolve({ data: [row()], count: 1 }); counts.resolve({ data: [], count: 0 });
    expect((await completed).map((result) => result.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(api.inspectionsStore.getById("DR-00007")).toBeUndefined();
    expect(api.inspectionsStore.getLoadState().ready).toBe(false);
  });
});

describe("inspection page loading boundaries", () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
  it("does not bootstrap the inspection list from WorkOrders just for badges", () => {
    const source = read("src/pages/WorkOrders.tsx");
    expect(source).not.toContain("inspectionsStore.getAll()");
    expect(source).not.toContain("inspectionsStore.subscribe");
    expect(source).toContain("fetchInspectionCountsForOrders(profile!.tenant_id, paginatedOrders)");
    expect(source).toContain("Count unavailable");
    expect(source).not.toContain("inspectionsByOrder[order.id] || 0");
  });
  it("keeps summary rows out of edit/trash payloads and does not claim a failed list is empty", () => {
    const source = read("src/pages/Inspection.tsx");
    expect(source).toContain("await inspectionsStore.loadById(ins.id)");
    expect(source).toContain("await inspectionsStore.updateConfirmed(editing.id");
    expect(source).toContain("await inspectionsStore.remove(deleting.id)");
    expect(source).toContain("listReady && filtered.length === 0");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain("bulk.selectedItems.forEach");
  });
  it("opens/reloads reports by exact ID without depending on a 500-row list", () => {
    const source = read("src/pages/InspectionReportPage.tsx");
    expect(source).toContain("await inspectionsStore.loadById(id)");
    expect(source).toContain("loadSummaries: false");
    expect(source).not.toContain("inspectionsStore.getAll()");
    expect(source).not.toContain('toast.success("تم تحديث البيانات")');
  });
  it("routes report preview and general PDF HTML through the central sanitizer and sandbox", () => {
    const source = read("src/pages/InspectionReportPage.tsx");
    expect(source).toContain('import { PDF_HTML_SANDBOX, sanitizePdfHtml } from "@/lib/safeHtml"');
    expect(source).toContain('html ? sanitizePdfHtml(html) : ""');
    expect(source).toContain("srcDoc={safeHtml}");
    expect(source).toContain("sandbox={PDF_HTML_SANDBOX}");
    expect(source).toContain("htmlContent: safeHtml");
    expect(source).not.toContain("srcDoc={html}");
    expect(source).not.toMatch(/htmlContent:\s*html\b/);
    expect(source).not.toContain("allow-scripts");
  });
});
