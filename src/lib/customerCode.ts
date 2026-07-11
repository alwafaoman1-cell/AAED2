import { isUuid } from "@/lib/uuid";

const CUSTOMER_CODE_RE = /^CUST-\d{4}-\d{4,}$/i;

export function isCustomerCode(value: unknown): boolean {
  return typeof value === "string" && CUSTOMER_CODE_RE.test(value.trim());
}

export function formatCustomerCode(value: unknown): string {
  if (isCustomerCode(value)) return String(value).trim().toUpperCase();
  return "CUST-PENDING";
}

export function displayCustomerCode(customer: { customerCode?: string | null; customer_code?: string | null; id?: string | null } | null | undefined): string {
  const code = customer?.customerCode || customer?.customer_code;
  if (isCustomerCode(code)) return formatCustomerCode(code);
  // Never expose the internal UUID. Until the customer_code migration/backfill is applied,
  // show a safe placeholder instead of leaking database identifiers.
  if (isUuid(customer?.id || "")) return "CUST-PENDING";
  return formatCustomerCode(customer?.id || code || "");
}

