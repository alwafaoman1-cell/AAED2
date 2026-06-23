export const WORK_ORDER_TYPES = ["general_customer", "insurance"] as const;

export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export interface WorkOrderTypeSource {
  workOrderType?: WorkOrderType | null;
  claimId?: string | null;
  claimNumber?: string | null;
  insurance?: string | null;
}

export function resolveWorkOrderType(order: WorkOrderTypeSource): WorkOrderType {
  if (order.claimId) return "insurance";
  if (order.workOrderType === "insurance" || order.workOrderType === "general_customer") {
    return order.workOrderType;
  }
  if (
    (order.claimNumber && order.claimNumber.trim() && order.claimNumber.trim() !== "-") ||
    (order.insurance && order.insurance.trim() && order.insurance.trim() !== "-")
  ) {
    return "insurance";
  }
  return "general_customer";
}

export function isInsuranceWorkOrder(order: WorkOrderTypeSource): boolean {
  return resolveWorkOrderType(order) === "insurance";
}

export function workOrderTypeLabel(type: WorkOrderType, compact = false): string {
  if (type === "insurance") return compact ? "🛡 Insurance" : "🛡 INSURANCE";
  return compact ? "🚗 General" : "🚗 GENERAL / CASH";
}
