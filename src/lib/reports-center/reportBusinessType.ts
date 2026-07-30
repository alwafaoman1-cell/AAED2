import type { ReportBusinessType } from "./reportTypes";

export type ClassifiedReportBusinessType = Exclude<ReportBusinessType, "all"> | "unknown";

export interface ReportBusinessTypeInput {
  claimId?: string | null;
  linkedClaimId?: string | null;
  recordKind:
    | "claim"
    | "insurance_invoice"
    | "customer_invoice"
    | "work_order"
    | "payment"
    | "expense"
    | "other";
  workOrderType?: string | null;
  hasCustomerInvoice?: boolean;
}
/**
 * Structural report classification only.
 *
 * Names, descriptions and manually-entered labels are deliberately ignored.
 * Unknown records remain visible to data-quality checks and are never silently
 * counted as cash business.
 */
export function classifyReportBusinessType(
  input: ReportBusinessTypeInput,
): ClassifiedReportBusinessType {
  if (input.claimId || input.linkedClaimId) return "insurance";
  if (input.recordKind === "claim" || input.recordKind === "insurance_invoice") {
    return "insurance";
  }
  if (input.recordKind === "customer_invoice" && input.hasCustomerInvoice) {
    return "cash";
  }
  if (input.recordKind === "work_order") {
    return "cash";
  }
  if (input.recordKind === "payment") {
    return input.hasCustomerInvoice ? "cash" : "unknown";
  }
  if (input.recordKind === "expense") {
    const type = String(input.workOrderType || "").toLowerCase();
    if (type === "general_customer" || type === "cash") return "cash";
  }
  return "unknown";
}
