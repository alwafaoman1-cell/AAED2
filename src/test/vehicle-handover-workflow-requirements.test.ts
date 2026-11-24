// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/cloudSettings", () => ({ readCloudSetting: (_key: string, fallback: unknown) => fallback, subscribeCloudSetting: () => () => {}, writeCloudSetting: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: vi.fn() }));
import { buildDeliveryReceiptData } from "@/lib/vehicleDeliveryReceipt";
import { getVehicleDeliveryReceiptHtml } from "@/lib/pdfGenerator";
import type { WorkOrder } from "@/lib/workOrdersStore";

const order = { id: "WO-TEST", customer: "Legacy owner", plate: "QA 1", vehicleType: "Test vehicle", partsNeeded: [] } as unknown as WorkOrder;
function recipientText(receiverName?: string) {
  const data = buildDeliveryReceiptData(order, { receiverName });
  const element = document.createElement("div");
  element.innerHTML = getVehicleDeliveryReceiptHtml(data);
  return Array.from(element.querySelectorAll(".info-row")).find(row => row.textContent?.includes("اسم المستلم"))?.textContent || "";
}

beforeEach(() => vi.clearAllMocks());
describe("documented handover exceptions", () => {
  it("retains the legacy undefined fallback but never fills an explicitly blank actual recipient from the owner", () => {
    expect(recipientText(undefined)).toContain("Legacy owner");
    expect(recipientText("")).not.toContain("Legacy owner");
    expect(recipientText("")).toContain("—");
  });
  it("prints only a saved exception marker and leaves missing signatures and paper confirmation unfilled", () => {
    const data = buildDeliveryReceiptData(order, { receiverName: "", workflowRequirementOverrideId: "saved-proof", signatureDataUrl: null, paperSignatureConfirmed: false });
    expect(data.signatureDataUrl).toBeUndefined();
    expect(data.paperSignatureConfirmed).toBe(false);
    expect(data.receiverName).toBe("");
    const html = getVehicleDeliveryReceiptHtml(data);
    expect(html).toContain("Documented workflow exception");
    expect(html).not.toContain("data:image/png;base64");
    expect(getVehicleDeliveryReceiptHtml(buildDeliveryReceiptData(order, {}))).not.toContain("Documented workflow exception");
  });
});
