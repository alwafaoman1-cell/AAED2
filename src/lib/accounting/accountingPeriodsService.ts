import { supabase } from "@/integrations/supabase/client";
import type { AccountingCostCenter, AccountingFiscalYear, AccountingPeriod } from "./accountingTypes";
import { requireTenantId, unwrapAccountingResult } from "./accountingServiceSupport";

export async function listAccountingFiscalYears(tenantId: string): Promise<AccountingFiscalYear[]> {
  const result = await supabase.from("accounting_fiscal_years" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).order("start_date", { ascending: false });
  return unwrapAccountingResult<AccountingFiscalYear[]>(result, "ACCOUNTING_FISCAL_YEARS_LOAD_FAILED") ?? [];
}

export async function createAccountingFiscalYear(input: {
  tenantId: string; name: string; startDate: string; endDate: string;
}): Promise<AccountingFiscalYear> {
  const result = await supabase.from("accounting_fiscal_years" as never).insert({
    tenant_id: requireTenantId(input.tenantId), name: input.name.trim(),
    start_date: input.startDate, end_date: input.endDate, status: "open",
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingFiscalYear>(result, "ACCOUNTING_FISCAL_YEAR_CREATE_FAILED");
}

export async function getAccountingFiscalYear(tenantId: string, id: string): Promise<AccountingFiscalYear> {
  const result = await supabase.from("accounting_fiscal_years" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).eq("id", id).single();
  return unwrapAccountingResult<AccountingFiscalYear>(result, "ACCOUNTING_FISCAL_YEAR_LOAD_FAILED");
}

export async function listAccountingPeriods(tenantId: string, fiscalYearId?: string): Promise<AccountingPeriod[]> {
  let query = supabase.from("accounting_periods" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId));
  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId);
  const result = await query.order("start_date", { ascending: true });
  return unwrapAccountingResult<AccountingPeriod[]>(result, "ACCOUNTING_PERIODS_LOAD_FAILED") ?? [];
}

export async function createAccountingPeriod(input: {
  tenantId: string; fiscalYearId: string; name: string; sequence: number; startDate: string; endDate: string;
}): Promise<AccountingPeriod> {
  const result = await supabase.from("accounting_periods" as never).insert({
    tenant_id: requireTenantId(input.tenantId), fiscal_year_id: input.fiscalYearId,
    name: input.name.trim(), sequence: input.sequence, start_date: input.startDate,
    end_date: input.endDate, status: "open",
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingPeriod>(result, "ACCOUNTING_PERIOD_CREATE_FAILED");
}

export async function getAccountingPeriod(tenantId: string, id: string): Promise<AccountingPeriod> {
  const result = await supabase.from("accounting_periods" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).eq("id", id).single();
  return unwrapAccountingResult<AccountingPeriod>(result, "ACCOUNTING_PERIOD_LOAD_FAILED");
}

export async function setAccountingPeriodStatus(periodId: string, status: "open" | "closed" | "locked", reason?: string): Promise<AccountingPeriod> {
  const result = await supabase.rpc("set_accounting_period_status" as never, {
    p_period_id: periodId, p_status: status, p_reason: reason?.trim() || null,
  } as never);
  return unwrapAccountingResult<AccountingPeriod>(result, "ACCOUNTING_PERIOD_STATUS_FAILED");
}

export async function setAccountingFiscalYearStatus(fiscalYearId: string, status: "open" | "closed" | "locked", reason?: string): Promise<AccountingFiscalYear> {
  const result = await supabase.rpc("set_accounting_fiscal_year_status" as never, {
    p_fiscal_year_id: fiscalYearId, p_status: status, p_reason: reason?.trim() || null,
  } as never);
  return unwrapAccountingResult<AccountingFiscalYear>(result, "ACCOUNTING_FISCAL_YEAR_STATUS_FAILED");
}

export async function listAccountingCostCenters(tenantId: string): Promise<AccountingCostCenter[]> {
  const result = await supabase.from("accounting_cost_centers" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).order("code", { ascending: true });
  return unwrapAccountingResult<AccountingCostCenter[]>(result, "ACCOUNTING_COST_CENTERS_LOAD_FAILED") ?? [];
}

export async function createAccountingCostCenter(input: {
  tenantId: string; code: string; nameAr: string; nameEn: string; parentId?: string | null;
  effectiveFrom?: string | null; effectiveTo?: string | null;
}): Promise<AccountingCostCenter> {
  const result = await supabase.from("accounting_cost_centers" as never).insert({
    tenant_id: requireTenantId(input.tenantId), code: input.code.trim(), name_ar: input.nameAr.trim(),
    name_en: input.nameEn.trim(), parent_id: input.parentId ?? null, is_active: true, is_system: false,
    effective_from: input.effectiveFrom ?? null, effective_to: input.effectiveTo ?? null,
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingCostCenter>(result, "ACCOUNTING_COST_CENTER_CREATE_FAILED");
}

export async function getAccountingCostCenter(tenantId: string, id: string): Promise<AccountingCostCenter> {
  const result = await supabase.from("accounting_cost_centers" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).eq("id", id).single();
  return unwrapAccountingResult<AccountingCostCenter>(result, "ACCOUNTING_COST_CENTER_LOAD_FAILED");
}

export async function updateAccountingCostCenter(input: {
  tenantId: string; id: string; code: string; nameAr: string; nameEn: string; parentId?: string | null;
  effectiveFrom?: string | null; effectiveTo?: string | null; isActive?: boolean;
}): Promise<AccountingCostCenter> {
  const result = await supabase.from("accounting_cost_centers" as never).update({
    code: input.code.trim(), name_ar: input.nameAr.trim(), name_en: input.nameEn.trim(),
    parent_id: input.parentId ?? null, effective_from: input.effectiveFrom ?? null,
    effective_to: input.effectiveTo ?? null, is_active: input.isActive ?? true,
  } as never).eq("tenant_id", requireTenantId(input.tenantId)).eq("id", input.id).select("*").single();
  return unwrapAccountingResult<AccountingCostCenter>(result, "ACCOUNTING_COST_CENTER_UPDATE_FAILED");
}
