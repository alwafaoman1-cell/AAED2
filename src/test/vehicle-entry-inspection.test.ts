import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, tenant, entry } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), tenant: vi.fn(), entry: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: tenant }));
vi.mock("@/lib/vehicleEntryService", () => ({ getVehicleEntry: entry, getVehicleEntryPresence: (e: any) => e?.vehicle_location === "داخل الورشة" ? "in_workshop" : "with_customer" }));
import { canInspectVehicleEntry, loadVehicleEntryInspection } from "@/lib/vehicleEntryInspection";
import { saveInsuranceDamageReport } from "@/lib/insuranceDamageReportService";
import type { InsuranceInspectionData } from "@/lib/insuranceInspectionPdf";

const visit = { id: "entry", tenant_id: "tenant", status: "Issued", vehicle_id: "vehicle", insurance_claim_id: "claim", vehicle_location: "داخل الورشة", entry_number: "ENT-1", vehicle: { plate_number: "123", plate_letters: "AB", brand: "Toyota", model: "Corolla" } };
const report = { reportNo: "DR-00001", sections: [] } as unknown as InsuranceInspectionData;
function query(data: unknown, error: unknown = null) {
  const q: any = { then: (resolve: (r: unknown) => unknown) => Promise.resolve(resolve({ data, error })) };
  for (const method of ["select", "eq", "is", "limit", "single"]) q[method] = vi.fn(() => q);
  return q;
}
beforeEach(() => { vi.clearAllMocks(); tenant.mockResolvedValue("tenant"); entry.mockResolvedValue(visit); });
describe("entry-scoped insurance inspection", () => {
  it("offers inspection only after actual entry, never on claim-only, cash, draft, cancelled or customer-held cards", () => {
    expect(canInspectVehicleEntry(visit)).toBe(true);
    for (const patch of [{ _claimOnly: true }, { status: "Draft" }, { status: "Cancelled" }, { deleted_at: "today" }, { insurance_claim_id: null }, { vehicle_location: "مع العميل" }, { converted_claim_id: "different" }]) {
      expect(canInspectVehicleEntry({ ...visit, ...patch })).toBe(false);
    }
  });
  it("loads exact visit and claim and reopens the existing report without plate-based search", async () => {
    const claims = query({ id: "claim", vehicle_id: "vehicle", claim_number: "CL-1", inspection_id: "inspection", status: "pending", insurance_company: "Insurer" });
    const reports = query([{ id: "inspection", inspection_code: "DR-00003", details: { claimId: "claim", insuranceInspectionReport: report } }]);
    from.mockReturnValueOnce(claims).mockReturnValueOnce(reports);
    const result = await loadVehicleEntryInspection("entry");
    expect(result.claimId).toBe("claim"); expect(result.existingCode).toBe("DR-00003");
    expect(result.meta.regNo).toBe("AB 123"); expect(result.meta.gatePass).toBe("ENT-1");
    expect(reports.eq).toHaveBeenCalledWith("details->>vehicleEntryId", "entry");
  });
  it("does not adopt another vehicle's claim or silently replace a historical report", async () => {
    from.mockReturnValueOnce(query({ id: "claim", vehicle_id: "wrong", status: "pending" }));
    await expect(loadVehicleEntryInspection("entry")).rejects.toThrow("INSPECTION_LINK_CONFLICT");
    from.mockReturnValueOnce(query({ id: "claim", vehicle_id: "vehicle", inspection_id: "historical" }))
      .mockReturnValueOnce(query([]));
    await expect(loadVehicleEntryInspection("entry")).rejects.toThrow("INSPECTION_LINK_CONFLICT");
  });
  it("does not turn a failed cloud read into an empty/new inspection", async () => {
    from.mockReturnValueOnce(query(null, new Error("offline")));
    await expect(loadVehicleEntryInspection("entry")).rejects.toThrow("offline");
  });
  it("confirms the atomic entry/claim save response, not just a DR string", async () => {
    rpc.mockResolvedValueOnce({ data: { code: "DR-00005", entryId: "entry", claimId: "claim", report: { ...report, reportNo: "DR-00005" } }, error: null });
    const saved = await saveInsuranceDamageReport({ requestId: "request", vehicleEntryId: "entry", claimId: "claim", report });
    expect(saved.id).toBe("DR-00005");
    expect(rpc).toHaveBeenCalledWith("save_vehicle_entry_damage_inspection", expect.objectContaining({ p_entry_id: "entry", p_request_id: "request" }));
    rpc.mockResolvedValueOnce({ data: { code: "DR-00005", entryId: "other", claimId: "claim", report }, error: null });
    await expect(saveInsuranceDamageReport({ requestId: "request", vehicleEntryId: "entry", claimId: "claim", report })).rejects.toThrow("INSPECTION_SAVE_NOT_CONFIRMED");
  });
});
