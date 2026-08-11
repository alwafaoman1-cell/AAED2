import { describe, expect, it } from "vitest";
import { buildReopenDeliveredVehiclePatch } from "@/lib/claimDelivery";

describe("claim delivery cancellation", () => {
  it("requires a reason", () => {
    expect(() =>
      buildReopenDeliveredVehiclePatch({
        reason: "   ",
        changedAt: "2026-07-27T10:00:00.000Z",
      }),
    ).toThrow("سبب إلغاء التسليم مطلوب");
  });

  it("returns the vehicle to the workshop without deleting prior evidence", () => {
    expect(
      buildReopenDeliveredVehiclePatch({
        reason: "عادت لمعالجة ملاحظة",
        changedAt: "2026-07-27T10:00:00.000Z",
        changedBy: "user-1",
      }),
    ).toEqual({
      vehicle_delivered_at: null,
      operational_status: "completed",
      vehicle_presence_status: "in_workshop",
      repair_stage: "ready",
      vehicle_location_note: "إلغاء التسليم: عادت لمعالجة ملاحظة",
      vehicle_location_updated_at: "2026-07-27T10:00:00.000Z",
      vehicle_location_updated_by: "user-1",
    });
  });
});
