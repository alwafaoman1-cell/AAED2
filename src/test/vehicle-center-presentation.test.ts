import { describe, expect, it } from "vitest";
import { CENTER_LOCATION_TABS, CENTER_RECORD_TABS, CENTER_WORK_STAGES, getVehicleCenterPrimaryAction as action } from "@/lib/vehicleCenterPresentation";
const role = (role: string) => (...roles: string[]) => roles.includes(role);
const manager = role("manager");
const row = (stage: string, extra = {}) => ({ _visitStage: stage, vehicle_location: "داخل الورشة", _hasFinalHandover: false,
  insurance_claim_id: "claim-1", claim: { status: "approved" }, work_order: { status: "received", vehicle_presence_status: "in_workshop" }, ...extra });

describe("vehicle center presentation (read-only affordances)", () => {
  it("separates custody tabs, terminal records and the four work stages", () => {
    expect(CENTER_LOCATION_TABS).toEqual(["in_workshop", "with_customer", "awaiting_arrival"]);
    expect(CENTER_RECORD_TABS).toEqual(["delivered", "cancelled"]);
    expect(CENTER_WORK_STAGES).toEqual(["arrived", "approved", "in_progress", "ready"]);
  });
  it("opens a start-work confirmation only for an eligible approved row", () => {
    expect(action(row("approved"), "in_workshop", manager)).toEqual({ label: "startWork", request: { intent: "next", expectedStage: "approved" } });
  });
  it("does not invent an approval for pending insurance or turn cash into insurance", () => {
    expect(action(row("arrived", { claim: { status: "pending" } }), "in_workshop", manager).request?.intent).toBe("approval");
    expect(action(row("arrived", { claim: null, insurance_claim_id: null, service_type: "cash" }), "in_workshop", manager).request?.intent).toBe("next");
  });
  it("offers the existing handover flow rather than claiming readiness means delivery", () => {
    expect(action(row("ready", { work_order: { status: "completed" } }), "in_workshop", manager)).toEqual({ label: "deliverVehicle", request: { intent: "next", expectedStage: "ready" } });
    expect(action(row("in_progress"), "in_workshop", manager).label).toBe("reviewRepair");
  });
  it.each(["delivered", "cancelled", "needs_review"] as const)("offers no mutation shortcut in %s", tab => {
    expect(action(row(tab, { _canRegisterEntry: true }), tab, manager).request).toBeUndefined();
  });
  it("offers arrival only for the existing permitted arrival affordance", () => {
    expect(action(row("approved", { _canRegisterEntry: true }), "with_customer", manager).request?.intent).toBe("arrival");
    expect(action(row("approved", { _canRegisterEntry: false }), "with_customer", manager).request).toBeUndefined();
    expect(action(row("approved", { _canRegisterEntry: true }), "with_customer", role("technician")).request).toBeUndefined();
  });
  it("does not expose forbidden work/approval/completion shortcuts", () => {
    expect(action(row("approved"), "in_workshop", role("insurance")).request).toBeUndefined();
    expect(action(row("arrived"), "in_workshop", role("technician")).request).toBeUndefined();
    expect(action(row("ready"), "in_workshop", role("technician")).request).toBeUndefined();
    expect(action(row("approved", { _reviewReason: "custody_conflict" }), "in_workshop", manager).request).toBeUndefined();
  });
});
