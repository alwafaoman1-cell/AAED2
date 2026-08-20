import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("vehicle delivery receipt persistence contract", () => {
  it("stores the draft in Supabase job-order metadata and preserves unrelated metadata", () => {
    const service = read("src/lib/vehicleDeliveryReceipt.ts");
    expect(service).toContain('DELIVERY_RECEIPT_METADATA_KEY = "vehicle_delivery_receipt"');
    expect(service).toContain("...metadata");
    expect(service).toContain("saveVehicleDeliveryReceiptDraft");
    expect(service).not.toContain("localStorage");
  });

  it("reloads the saved draft whenever the receipt dialog opens", () => {
    const dialog = read("src/components/workorders/VehicleDeliveryReceiptDialog.tsx");
    expect(dialog).toContain("loadVehicleDeliveryReceiptDraft");
    expect(dialog).toContain("saveVehicleDeliveryReceiptDraft");
    expect(dialog).toContain("حفظ الإقرار");
    expect(dialog).toContain("if (!(await handleSave(false))) return");
  });
});
