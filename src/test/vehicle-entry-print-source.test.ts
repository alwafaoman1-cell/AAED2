import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), document: vi.fn() }));
vi.mock("@/lib/vehicleIntakeReceipt", () => ({
  getIntakeReceiptContext: mocks.context,
  getIntakeReceiptDocument: mocks.document,
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
import { getVehicleEntryPrintSource } from "@/lib/vehicleEntryPrintSource";

const signature = { signature_role: "delivered_by", intake_revision: 2 };
const live = { id: "entry-1", entry_number: "ENT-1", intake_revision: 2, delivered_by: { full_name: "Changed live name", id_number: "LIVE-ID" }, vehicle_entry_signatures: [signature] };
const frozen = { id: "entry-1", entry_number: "ENT-1", intake_revision: 2, delivered_by: { full_name: "Signed person", id_number: "SIGNED-ID" }, vehicle_entry_signatures: [{ ...signature, signature_data_url: "original-ink" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ receipts: [{ id: "old-receipt", revision: 1 }, { id: "current-receipt", revision: 2 }] });
  mocks.document.mockResolvedValue({ entry: frozen, revision: 2 });
});

describe("shared vehicle entry print source", () => {
  it("returns the complete frozen entry and original signature rather than merging live identity into it", async () => {
    const original = JSON.stringify(live);
    const source = await getVehicleEntryPrintSource(live);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("entry-1");
    expect(mocks.document).toHaveBeenCalledExactlyOnceWith("current-receipt");
    expect(source).toBe(frozen);
    expect(source.delivered_by).toEqual({ full_name: "Signed person", id_number: "SIGNED-ID" });
    expect(JSON.stringify(live)).toBe(original);
  });

  it.each([
    { ...live, vehicle_entry_signatures: [] },
    { ...live, vehicle_entry_signatures: [{ signature_role: "receiver", intake_revision: 2 }] },
    { ...live, vehicle_entry_signatures: [{ ...signature, intake_revision: 1 }] },
    { ...live, custody_receipt_required: false, intake_revision: 1, vehicle_entry_signatures: [{ ...signature, intake_revision: null }] },
  ])("preserves unsigned and historical legacy detail-page behavior", async (entry) => {
    expect(await getVehicleEntryPrintSource(entry)).toBe(entry);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.document).not.toHaveBeenCalled();
  });

  it("refuses a signed current revision with no corresponding frozen receipt", async () => {
    mocks.context.mockResolvedValue({ receipts: [{ id: "old-receipt", revision: 1 }] });
    await expect(getVehicleEntryPrintSource(live)).rejects.toThrow("vehicleEntry.pdfSourceMissing");
    expect(mocks.document).not.toHaveBeenCalled();
  });

  it.each(["context", "document"] as const)("propagates %s lookup failure without returning mutable live data", async (operation) => {
    mocks[operation].mockRejectedValueOnce(new Error("Frozen source unavailable"));
    await expect(getVehicleEntryPrintSource(live)).rejects.toThrow("Frozen source unavailable");
  });

  it.each([
    { entry: { ...frozen, id: "other-entry" }, revision: 2 },
    { entry: frozen, revision: 1 },
    { entry: null, revision: 2 },
  ])("refuses a frozen document that does not identify the requested visit and revision", async (document) => {
    mocks.document.mockResolvedValueOnce(document);
    await expect(getVehicleEntryPrintSource(live)).rejects.toThrow("vehicleEntry.pdfSourceMissing");
  });
});
