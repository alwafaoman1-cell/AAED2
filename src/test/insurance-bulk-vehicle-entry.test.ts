import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: null as any,
  activeVisit: null as any,
  linked: null as any,
  existing: null as any,
  ensure: vi.fn(),
  upsert: vi.fn(),
  filters: [] as Array<[string, unknown]>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let updating = false;
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return query; },
        is: () => query,
        in: () => query,
        limit: () => query,
        update: () => { updating = true; return query; },
        maybeSingle: async () => ({
          data: table === "vehicle_entries" ? mocks.activeVisit : updating ? mocks.linked : mocks.claim,
          error: null,
        }),
      };
      return query;
    },
  },
}));
vi.mock("@/lib/vehicleEntryService", () => ({
  ensureVehicleEntryForClaim: mocks.ensure,
  getVehicleEntryByClaimId: vi.fn(() => Promise.resolve(mocks.existing)),
}));
vi.mock("@/lib/claimWorkOrderUnified", () => ({ upsertUnifiedOperationalState: mocks.upsert }));

import { bulkVehicleEntryIneligibility, registerSelectedClaimVehicleEntries } from "@/lib/insuranceBulkVehicleEntry";

const baseClaim = {
  id: "claim-1", tenant_id: "tenant-1", claim_number: "C/1", status: "pending",
  customer_id: "customer-1", vehicle_id: "vehicle-1", vehicle_entry_id: null,
  insurance_company: "Insurer", insurance_company_id: null, job_order_id: null,
  delivered_at: null, vehicle_delivered_at: null, deleted_at: null,
  customer: { name: "Owner", phone: "91234567" },
  vehicle: { brand: "Toyota", model: "Corolla", plate_number: "12345", plate_letters: "AA", plate_country: "OM", year: 2022, color: "white", vin_number: null },
};

describe("bulk claim vehicle check-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filters = [];
    mocks.claim = { ...baseClaim };
    mocks.activeVisit = null;
    mocks.existing = null;
    mocks.linked = { id: "claim-1", vehicle_entry_id: "entry-1", workshop_arrival_date: "2026-11-03", vehicle_presence_status: "in_workshop" };
    mocks.ensure.mockResolvedValue({ created: true, entry: { id: "entry-1", entry_number: "ENT-2026-0001", arrival_date: "2026-11-03", arrival_time: "10:00" } });
    mocks.upsert.mockResolvedValue({ id: "operations-1" });
  });

  it("creates one draft receipt, links the claim, and syncs operational presence", async () => {
    const report = await registerSelectedClaimVehicleEntries(
      [{ id: "claim-1", claim_number: "C/1" }, { id: "claim-1", claim_number: "C/1" }],
      "tenant-1", "user-1", "Receiver",
    );
    expect(report.created).toEqual([{ claimNumber: "C/1", entryNumber: "ENT-2026-0001" }]);
    expect(report.errors).toEqual([]);
    expect(mocks.ensure).toHaveBeenCalledTimes(1);
    expect(mocks.ensure.mock.calls[0][0]).toMatchObject({ claimId: "claim-1", status: "Draft", vehicleId: "vehicle-1" });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", claimId: "claim-1",
      patch: expect.objectContaining({ vehicle_presence_status: "in_workshop" }),
    }));
    expect(mocks.filters).toContainEqual(["tenant_id", "tenant-1"]);
  });

  it.each([
    [{ status: "cancelled" }, "closed"],
    [{ status: "paid" }, "closed"],
    [{ delivered_at: "2026-11-01" }, "delivered"],
    [{ vehicle_id: null }, "missingLink"],
    [{ vehicle_entry_id: "entry-1" }, "linked"],
  ])("rejects an ineligible claim (%s)", (patch, reason) => {
    expect(bulkVehicleEntryIneligibility({ ...baseClaim, ...patch } as any)).toBe(reason);
  });

  it("skips an already active physical visit for the same car", async () => {
    mocks.activeVisit = { id: "entry-2", entry_number: "ENT-2026-0002", insurance_claim_id: "claim-2" };
    const report = await registerSelectedClaimVehicleEntries([{ id: "claim-1", claim_number: "C/1" }], "tenant-1", "user-1", "Receiver");
    expect(report.skipped).toHaveLength(1);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("never reports success if the claim link cannot be confirmed after receipt creation", async () => {
    mocks.linked = null;
    const report = await registerSelectedClaimVehicleEntries([{ id: "claim-1", claim_number: "C/1" }], "tenant-1", "user-1", "Receiver");
    expect(report.created).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].reason).toContain("ENT-2026-0001");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
