import { supabase } from "@/integrations/supabase/client";
import type { AccountingOpeningBalance } from "./accountingTypes";
import { requireTenantId, unwrapAccountingResult } from "./accountingServiceSupport";

export async function listAccountingOpeningBalances(tenantId: string, fiscalYearId: string): Promise<AccountingOpeningBalance[]> {
  const result = await supabase.from("accounting_opening_balances" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).eq("fiscal_year_id", fiscalYearId);
  return unwrapAccountingResult<AccountingOpeningBalance[]>(result, "ACCOUNTING_OPENING_BALANCES_LOAD_FAILED") ?? [];
}
export async function createAccountingOpeningBalance(input: {
  tenantId: string; fiscalYearId: string; accountId: string; costCenterId?: string | null;
  debit: string; credit: string; source?: string | null; batchId?: string | null; lineDescription?: string | null;
}): Promise<AccountingOpeningBalance> {
  const result = await supabase.from("accounting_opening_balances" as never).insert({
    tenant_id: requireTenantId(input.tenantId), fiscal_year_id: input.fiscalYearId,
    account_id: input.accountId, cost_center_id: input.costCenterId ?? null,
    debit: input.debit, credit: input.credit, status: "draft", source: input.source ?? null,
    batch_id: input.batchId ?? null, line_description: input.lineDescription?.trim() || null,
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingOpeningBalance>(result, "ACCOUNTING_OPENING_BALANCE_CREATE_FAILED");
}
