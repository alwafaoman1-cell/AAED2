import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }));
import { combineDeliveryDateTime, getDeliveredDateInputValue, getDeliveredTimeInputValue, saveVehicleDeliveryReceiptDraft } from "@/lib/vehicleDeliveryReceipt";
const id = "00000000-0000-4000-8000-000000000001";
function query(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), update: vi.fn(), maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result) };
  for (const key of ["select", "eq", "limit", "update"] as const) q[key].mockReturnValue(q);
  return q;
}
let handover: ReturnType<typeof query>;
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T08:45:12Z"));
  await i18n.changeLanguage("en");
  const order = query({ data: { id, tenant_id: "tenant", vehicle_id: "vehicle", customer_id: "customer", deleted_at: null }, error: null });
  handover = query({ data: { id: "draft", status: "draft", snapshot_json: {} }, error: null });
  mocks.from.mockImplementation(table => table === "job_orders" ? order : handover);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("vehicle handover actual delivery time", () => {
  it("saves the current instant for today's legacy date-only caller, rather than noon before an afternoon arrival", async () => {
    await saveVehicleDeliveryReceiptDraft({ id }, { recordId: "draft", date: "2026-11-12", receiverName: "TEST" });
    const payload = handover.update.mock.calls[0][0];
    expect(new Date(payload.delivered_at).toISOString()).toBe("2026-11-12T08:45:12.000Z");
    expect(new Date(payload.delivered_at).getTime()).toBeGreaterThan(new Date("2026-11-12T08:05:00Z").getTime());
  });
  it("preserves the explicitly saved delivery timestamp on subsequent draft saves", async () => {
    await saveVehicleDeliveryReceiptDraft({ id }, { recordId: "draft", date: "2026-11-11", deliveredAt: "2026-11-11T16:12:43+04:00" });
    expect(handover.update.mock.calls[0][0].delivered_at).toBe("2026-11-11T16:12:43+04:00");
  });
  it("requires an explicit time for a historical date instead of fabricating noon", async () => {
    await expect(saveVehicleDeliveryReceiptDraft({ id }, { recordId: "draft", date: "2026-11-11" })).rejects.toThrow("valid delivery date and time");
    expect(handover.update).not.toHaveBeenCalled();
    expect(getDeliveredTimeInputValue("2026-11-11")).toBe("");
  });
  it("shows a saved instant in Oman time, including a UTC-to-local date rollover", () => {
    expect(getDeliveredDateInputValue("2026-11-12T21:30:27Z")).toBe("2026-11-13");
    expect(getDeliveredTimeInputValue("2026-11-12T21:30:27Z")).toBe("01:30:27");
    expect(new Date(combineDeliveryDateTime("2026-11-13", "01:30:27")).toISOString()).toBe("2026-11-12T21:30:27.000Z");
  });
  it("rejects empty, invalid or rolled-over date/time inputs", () => {
    for (const [date, time] of [["2026-11-12", ""], ["2026-11-12", "25:00"], ["2026-02-31", "10:00"]]) {
      expect(() => combineDeliveryDateTime(date, time)).toThrow("valid delivery date and time");
    }
  });
});
