import { supabase } from "@/integrations/supabase/client";
import type { AccountingAccount, AccountingAccountType, AccountingNormalBalance } from "./accountingTypes";
import { requireTenantId, unwrapAccountingResult } from "./accountingServiceSupport";

export interface CreateAccountingAccountInput {
  tenantId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  parentId?: string | null;
  accountType: AccountingAccountType;
  normalBalance: AccountingNormalBalance;
  isPostable?: boolean;
  isSystem?: boolean;
  requiresCostCenter?: boolean;
  requiresReconciliation?: boolean;
  notes?: string | null;
}
export async function listAccountingAccounts(tenantId: string): Promise<AccountingAccount[]> {
  const tenant = requireTenantId(tenantId);
  const result = await supabase
    .from("accounting_accounts" as never)
    .select("*")
    .eq("tenant_id", tenant)
    .order("code", { ascending: true });
  return unwrapAccountingResult<AccountingAccount[]>(result, "ACCOUNTING_ACCOUNTS_LOAD_FAILED") ?? [];
}

export async function createAccountingAccount(input: CreateAccountingAccountInput): Promise<AccountingAccount> {
  const payload = {
    tenant_id: requireTenantId(input.tenantId),
    code: input.code.trim(),
    name_ar: input.nameAr.trim(),
    name_en: input.nameEn.trim(),
    parent_id: input.parentId ?? null,
    account_type: input.accountType,
    normal_balance: input.normalBalance,
    is_postable: input.isPostable ?? true,
    is_system: input.isSystem ?? false,
    requires_cost_center: input.requiresCostCenter ?? false,
    requires_reconciliation: input.requiresReconciliation ?? false,
    notes: input.notes?.trim() || null,
  };
  const result = await supabase.from("accounting_accounts" as never).insert(payload as never).select("*").single();
  return unwrapAccountingResult<AccountingAccount>(result, "ACCOUNTING_ACCOUNT_CREATE_FAILED");
}

export async function getAccountingAccount(tenantId: string, accountId: string): Promise<AccountingAccount> {
  const result = await supabase.from("accounting_accounts" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).eq("id", accountId).single();
  return unwrapAccountingResult<AccountingAccount>(result, "ACCOUNTING_ACCOUNT_LOAD_FAILED");
}

export async function updateAccountingAccount(input: CreateAccountingAccountInput & { accountId: string }): Promise<AccountingAccount> {
  const result = await supabase.from("accounting_accounts" as never).update({
    code: input.code.trim(), name_ar: input.nameAr.trim(), name_en: input.nameEn.trim(),
    parent_id: input.parentId ?? null, account_type: input.accountType, normal_balance: input.normalBalance,
    is_postable: input.isPostable ?? true, requires_cost_center: input.requiresCostCenter ?? false,
    requires_reconciliation: input.requiresReconciliation ?? false, notes: input.notes?.trim() || null,
  } as never).eq("tenant_id", requireTenantId(input.tenantId)).eq("id", input.accountId).select("*").single();
  return unwrapAccountingResult<AccountingAccount>(result, "ACCOUNTING_ACCOUNT_UPDATE_FAILED");
}

export async function setAccountingAccountActive(tenantId: string, accountId: string, isActive: boolean): Promise<AccountingAccount> {
  const result = await supabase
    .from("accounting_accounts" as never)
    .update({ is_active: isActive, deactivated_at: isActive ? null : new Date().toISOString() } as never)
    .eq("tenant_id", requireTenantId(tenantId))
    .eq("id", accountId)
    .select("*")
    .single();
  return unwrapAccountingResult<AccountingAccount>(result, "ACCOUNTING_ACCOUNT_UPDATE_FAILED");
}
