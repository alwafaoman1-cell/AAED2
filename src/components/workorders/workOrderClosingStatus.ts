import { normalizeWorkOrderStatus } from "@/lib/workOrdersStore";

export const CLOSING_STATUSES = ["جاهز للتسليم", "تم التسليم", "مغلق", "Ready", "Completed", "Delivered", "Closed"];

export function isClosingStatus(status?: string) {
  const normalized = normalizeWorkOrderStatus(status).toLowerCase();
  return CLOSING_STATUSES
    .some((item) => normalized.includes(item.toLowerCase()));
}
