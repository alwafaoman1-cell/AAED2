import { supabase } from "@/integrations/supabase/client";
import { requireTenantId, unwrapAccountingResult } from "./accountingServiceSupport";
import type {
  AccountingCashBankAccount, AccountingOpeningBalanceBatch,
  AccountingPaymentMethodMapping, AccountingSetupReadiness,
} from "./accountingTypes";

export async function hasAccountingPermission(permission: string): Promise<boolean> {
  const result = await supabase.rpc("accounting_has_permission" as never, { p_permission: permission } as never);
  return Boolean(unwrapAccountingResult<boolean>(result, "ACCOUNTING_PERMISSION_CHECK_FAILED"));
}

export async function getAccountingSetupReadiness(): Promise<AccountingSetupReadiness> {
  const result = await supabase.rpc("accounting_setup_readiness" as never);
  return unwrapAccountingResult<AccountingSetupReadiness>(result, "ACCOUNTING_READINESS_FAILED");
}

export async function listCashBankAccounts(tenantId: string): Promise<AccountingCashBankAccount[]> {
  const result = await supabase.from("accounting_cash_bank_accounts" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).order("account_kind").order("name_en");
  return unwrapAccountingResult<AccountingCashBankAccount[]>(result, "ACCOUNTING_CASH_BANK_LOAD_FAILED") ?? [];
}

export async function saveCashBankAccount(input: {
  tenantId: string; id?: string; nameAr: string; nameEn: string; kind: "cash" | "bank";
  accountingAccountId: string; bankName?: string; referenceSuffix?: string; isDefault?: boolean;
}): Promise<AccountingCashBankAccount> {
  const payload = { tenant_id: requireTenantId(input.tenantId), name_ar: input.nameAr.trim(),
    name_en: input.nameEn.trim(), account_kind: input.kind, accounting_account_id: input.accountingAccountId,
    bank_name: input.bankName?.trim() || null, reference_suffix: input.referenceSuffix?.trim() || null,
    currency: "OMR", is_default: Boolean(input.isDefault), is_active: true };
  const query = input.id
    ? supabase.from("accounting_cash_bank_accounts" as never).update(payload as never).eq("tenant_id", input.tenantId).eq("id", input.id)
    : supabase.from("accounting_cash_bank_accounts" as never).insert(payload as never);
  return unwrapAccountingResult<AccountingCashBankAccount>(await query.select("*").single(), "ACCOUNTING_CASH_BANK_SAVE_FAILED");
}

export async function listPaymentMethodMappings(tenantId: string): Promise<AccountingPaymentMethodMapping[]> {
  const result = await supabase.from("accounting_payment_method_mappings" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).order("payment_method");
  return unwrapAccountingResult<AccountingPaymentMethodMapping[]>(result, "ACCOUNTING_PAYMENT_MAPPING_LOAD_FAILED") ?? [];
}

export async function savePaymentMethodMapping(input: { tenantId: string; paymentMethod: string; cashBankAccountId: string }) {
  const result = await supabase.from("accounting_payment_method_mappings" as never).upsert({
    tenant_id: requireTenantId(input.tenantId), payment_method: input.paymentMethod.trim(),
    cash_bank_account_id: input.cashBankAccountId, is_active: true,
  } as never, { onConflict: "tenant_id,payment_method" } as never).select("*").single();
  return unwrapAccountingResult<AccountingPaymentMethodMapping>(result, "ACCOUNTING_PAYMENT_MAPPING_SAVE_FAILED");
}

export async function listOpeningBalanceBatches(tenantId: string): Promise<AccountingOpeningBalanceBatch[]> {
  const result = await supabase.from("accounting_opening_balance_batches" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).order("created_at", { ascending: false });
  return unwrapAccountingResult<AccountingOpeningBalanceBatch[]>(result, "ACCOUNTING_OPENING_BATCH_LOAD_FAILED") ?? [];
}

export async function createOpeningBalanceBatch(input: { tenantId: string; fiscalYearId: string; batchNumber: string; description?: string }) {
  const result = await supabase.from("accounting_opening_balance_batches" as never).insert({
    tenant_id: requireTenantId(input.tenantId), fiscal_year_id: input.fiscalYearId,
    batch_number: input.batchNumber.trim(), description: input.description?.trim() || null, status: "draft",
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingOpeningBalanceBatch>(result, "ACCOUNTING_OPENING_BATCH_CREATE_FAILED");
}

export async function approveOpeningBalanceBatch(batchId: string) {
  const result = await supabase.rpc("accounting_approve_opening_balance_batch" as never, { p_batch_id: batchId } as never);
  return unwrapAccountingResult<AccountingOpeningBalanceBatch>(result, "ACCOUNTING_OPENING_BATCH_APPROVE_FAILED");
}
