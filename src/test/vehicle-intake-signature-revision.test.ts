import { describe, expect, it } from "vitest";
import { currentVehicleEntrySignatures } from "@/lib/vehicleEntryService";
const old = { id: "old", signature_role: "delivered_by", intake_revision: null, signature_data_url: "original-ink" };
describe("intake signature revision boundaries", () => {
  it("retains a pre-cutover signature on its original legacy form", () => {
    expect(currentVehicleEntrySignatures({ custody_receipt_required: false, intake_revision: 1, vehicle_entry_signatures: [old] })).toEqual([old]);
  });
  it("never carries old ink into a new revision", () => {
    const fresh = { id: "fresh", signature_role: "delivered_by", intake_revision: 2, signature_data_url: "fresh-ink" };
    expect(currentVehicleEntrySignatures({ custody_receipt_required: false, intake_revision: 2, vehicle_entry_signatures: [old, fresh] })).toEqual([fresh]);
  });
  it("does not treat an unversioned signature as authorization for a new visit", () => {
    expect(currentVehicleEntrySignatures({ custody_receipt_required: true, intake_revision: 1, vehicle_entry_signatures: [old] })).toEqual([]);
  });
});
