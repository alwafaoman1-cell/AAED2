import type { AccountingSourceType } from "./accountingTypes";

export interface AccountingSourceSnapshot {
  id?: string | null;
  tenant_id?: string | null;
  status?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  archived_at?: string | null;
  archived?: boolean | null;
  is_deleted?: boolean | null;
}

const INELIGIBLE_STATUSES = new Set(["cancelled", "canceled", "void", "deleted", "failed", "bounced", "reversed", "archived"]);

export function isActiveAccountingRecord(record: AccountingSourceSnapshot | null | undefined, tenantId: string): boolean {
  if (!record || record.tenant_id !== tenantId) return false;
  if (record.deleted_at || record.deleted_by || record.archived_at || record.archived || record.is_deleted) return false;
  return !INELIGIBLE_STATUSES.has((record.status ?? "").trim().toLowerCase());
}

export function isAccountingSourceEligible(input: {
  tenantId: string;
  sourceType: AccountingSourceType;
  source: AccountingSourceSnapshot | null | undefined;
  parentWorkOrder?: AccountingSourceSnapshot | null;
  parentClaim?: AccountingSourceSnapshot | null;
  parentInvoice?: AccountingSourceSnapshot | null;
}): boolean {
  if (input.sourceType === "manual_journal") return true;
  if (!isActiveAccountingRecord(input.source, input.tenantId)) return false;
  if (input.parentWorkOrder && !isActiveAccountingRecord(input.parentWorkOrder, input.tenantId)) return false;
  if (input.parentClaim && !isActiveAccountingRecord(input.parentClaim, input.tenantId)) return false;
  if (input.parentInvoice && !isActiveAccountingRecord(input.parentInvoice, input.tenantId)) return false;
  return true;
}

export const accountingRecordEligibility = {
  isActive: isActiveAccountingRecord,
  isEligible: isAccountingSourceEligible,
} as const;
