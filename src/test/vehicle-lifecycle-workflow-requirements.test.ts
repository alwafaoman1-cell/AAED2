import { describe, expect, it } from "vitest";
import { getVehicleVisitNextBlocker } from "@/lib/vehicleVisitLifecycle";

const allowed = () => true;
const denied = () => false;
const entry = {
  insurance_claim_id: "claim", vehicle_location: "مع العميل",
  claim: { id: "claim", status: "pending", vehicle_presence_status: "with_customer" },
  work_order: { id: "order", status: "received", work_order_type: "insurance", vehicle_presence_status: "with_customer" },
};

describe("vehicle lifecycle requirement policy", () => {
  it("keeps strict prerequisites by default and relaxes them only with an explicit off policy", () => {
    expect(getVehicleVisitNextBlocker("approved", entry, allowed, false)).toBe("claimApprovalRequired");
    expect(getVehicleVisitNextBlocker("approved", entry, allowed, false, false)).toBeNull();
    expect(getVehicleVisitNextBlocker("in_progress", entry, allowed, false, true)).toBe("claimApprovalRequired");
    expect(getVehicleVisitNextBlocker("in_progress", entry, allowed, false, false)).toBeNull();
    expect(getVehicleVisitNextBlocker("ready", entry, allowed, false)).toBe("finishWorkFirst");
    expect(getVehicleVisitNextBlocker("ready", entry, allowed, false, false)).toBeNull();
  });
  it("keeps role checks and real linked work orders required in exception mode", () => {
    expect(getVehicleVisitNextBlocker("approved", entry, denied, false, false)).toBe("approvalPermissionRequired");
    expect(getVehicleVisitNextBlocker("in_progress", entry, denied, false, false)).toBe("workPermissionRequired");
    expect(getVehicleVisitNextBlocker("ready", entry, denied, false, false)).toBe("completionPermissionRequired");
    expect(getVehicleVisitNextBlocker("in_progress", { ...entry, work_order: null }, allowed, false, false)).toBe("workOrderRequired");
    expect(getVehicleVisitNextBlocker("ready", { ...entry, work_order: null }, allowed, false, false)).toBe("finishWorkFirst");
  });
  it("still routes final delivery through a saved finalized handover instead of fabricating it", () => {
    expect(getVehicleVisitNextBlocker("delivered", entry, allowed, false, false)).toBe("signedHandoverRequired");
    const delivered = { ...entry, work_order: { ...entry.work_order, status: "delivered", vehicle_delivered_at: "2026-11-23T08:00:00Z" } };
    expect(getVehicleVisitNextBlocker("delivered", delivered, allowed, false, false)).toBe("signedHandoverRequired");
    expect(getVehicleVisitNextBlocker("delivered", delivered, allowed, true, false)).toBeNull();
  });
});
