import { supabase } from "@/integrations/supabase/client";
import type { AccountingAccountMapping, AccountingMappingKey } from "./accountingTypes";
import { requireTenantId, unwrapAccountingResult } from "./accountingServiceSupport";

export async function listAccountingMappings(tenantId: string): Promise<AccountingAccountMapping[]> {
  const result = await supabase.from("accounting_account_mappings" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).order("priority", { ascending: true });
  return unwrapAccountingResult<AccountingAccountMapping[]>(result, "ACCOUNTING_MAPPINGS_LOAD_FAILED") ?? [];
}

export async function createAccountingMapping(input: {
  tenantId: string; mappingKey: AccountingMappingKey; accountId: string;
  businessType?: string | null; departmentId?: string | null; costCenterId?: string | null;
  effectiveFrom?: string | null; effectiveTo?: string | null; priority?: number;
}): Promise<AccountingAccountMapping> {
  const result = await supabase.from("accounting_account_mappings" as never).insert({
    tenant_id: requireTenantId(input.tenantId), mapping_key: input.mappingKey,
    account_id: input.accountId, business_type: input.businessType ?? null,
    department_id: input.departmentId ?? null, cost_center_id: input.costCenterId ?? null,
    effective_from: input.effectiveFrom ?? null, effective_to: input.effectiveTo ?? null,
    priority: input.priority ?? 100, status: "active",
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingAccountMapping>(result, "ACCOUNTING_MAPPING_CREATE_FAILED");
}
