import { getVehicleVisitNextBlocker, type VehicleCenterTab, type VisitStage } from "@/lib/vehicleVisitLifecycle";

export const CENTER_LOCATION_TABS: VehicleCenterTab[] = ["in_workshop", "with_customer", "awaiting_arrival"];
export const CENTER_RECORD_TABS: VehicleCenterTab[] = ["delivered", "cancelled"];
export const CENTER_WORK_STAGES = ["arrived", "approved", "in_progress", "ready"] as const;
export type VehicleCenterActionRequest = { intent: "next" | "approval" | "arrival"; expectedStage: VisitStage };
const nextStage: Partial<Record<VisitStage, "approved" | "in_progress" | "ready" | "delivered">> = {
  arrived: "approved", approved: "in_progress", in_progress: "ready", ready: "delivered",
};

/** A list affordance, never permission to write. The existing detail controller
 * re-reads the visit and checks its source guards before opening a confirmation. */
export function getVehicleCenterPrimaryAction(row: any, tab: VehicleCenterTab, hasRole: (...roles: string[]) => boolean): {
  label: string; request?: VehicleCenterActionRequest;
} {
  const stage: VisitStage = row._visitStage;
  if (row._reviewReason || tab === "needs_review") return { label: "reviewRecord" };
  if (["delivered", "cancelled"].includes(tab) || row._claimOnly) return { label: "viewRecord" };
  if (tab !== "in_workshop") return row._canRegisterEntry && hasRole("admin", "manager", "insurance", "supervisor")
    ? { label: "registerArrival", request: { intent: "arrival", expectedStage: stage } } : { label: "viewRecord" };
  const next = nextStage[stage];
  if (!next) return { label: "viewRecord" };
  const blocker = getVehicleVisitNextBlocker(next, row, hasRole, Boolean(row._hasFinalHandover));
  if (["approvalPermissionRequired", "workPermissionRequired", "completionPermissionRequired"].includes(blocker || "")) return { label: "viewRecord" };
  const claim = row.claim || row.converted_claim;
  if (blocker === "claimApprovalRequired" && claim?.status === "pending" && hasRole("admin", "manager")) {
    return { label: "approveClaim", request: { intent: "approval", expectedStage: stage } };
  }
  const label = !blocker ? { approved: "approveVisit", in_progress: "startWork", ready: "markReady", delivered: "deliverVehicle" }[next]
    : blocker === "signedHandoverRequired" ? "deliverVehicle"
    : ["finishWorkFirst", "workOrderStatusInvalid", "deliveryWorkOrderConflict"].includes(blocker) ? "reviewRepair" : "requirements";
  return { label, request: { intent: "next", expectedStage: stage } };
}
