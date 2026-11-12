import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser }, rpc: mocks.rpc } }));
import { saveVehicleDeliveryReceiptDraft, finalizeVehicleDeliveryReceipt } from "@/lib/vehicleDeliveryReceipt";

const id = "00000000-0000-4000-8000-000000000001";
function query(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), update: vi.fn(), maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result) };
  for (const key of ["select", "eq", "limit", "update"] as const) q[key].mockReturnValue(q);
  return q;
}
function setup(message: string) {
  const order = query({ data: { id, tenant_id: "tenant", vehicle_id: "vehicle", customer_id: "customer", vehicle_entry_id: "entry", deleted_at: null }, error: null });
  const handover = query({ data: null, error: { code: "23514", message } });
  mocks.from.mockImplementation(table => table === "job_orders" ? order : handover);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
  return { order, handover };
}
beforeEach(() => vi.resetAllMocks());
describe("handover visit-link errors at the save boundary", () => {
  it.each(["ar", "en"])("keeps ambiguous-link failures explicit and localized without a metadata fallback in %s", async language => {
    await i18n.changeLanguage(language);
    const { order, handover } = setup("VEHICLE_HANDOVER_VISIT_AMBIGUOUS");
    await expect(saveVehicleDeliveryReceiptDraft({ id }, { recordId: "draft", receiverName: "TEST" }))
      .rejects.toThrow(language === "ar" ? "توجد أكثر من زيارة" : "More than one visit");
    expect(handover.update).toHaveBeenCalledTimes(1);
    expect(order.update).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("surfaces a changed link rejected during finalization rather than announcing success", async () => {
    await i18n.changeLanguage("en");
    const { handover } = setup("");
    handover.single.mockResolvedValue({ data: { id: "draft", status: "draft", snapshot_json: {} }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "VEHICLE_HANDOVER_VISIT_CONFLICT" } });
    await expect(finalizeVehicleDeliveryReceipt({ id }, { recordId: "draft", receiverName: "TEST" })).rejects.toThrow("do not match");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
