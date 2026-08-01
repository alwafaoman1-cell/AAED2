import { supabase } from "@/integrations/supabase/client";
import type { AccountingPostingRule } from "./accountingTypes";
import { requireTenantId, unwrapAccountingResult } from "./accountingServiceSupport";

export async function listAccountingPostingRules(tenantId: string): Promise<AccountingPostingRule[]> {
  const result = await supabase.from("accounting_posting_rules" as never).select("*")
    .eq("tenant_id", requireTenantId(tenantId)).order("priority", { ascending: true });
  return unwrapAccountingResult<AccountingPostingRule[]>(result, "ACCOUNTING_POSTING_RULES_LOAD_FAILED") ?? [];
}

export async function createInactiveAccountingPostingRule(input: {
  tenantId: string; ruleKey: string; sourceType: string; eventType: string;
  debitMappingKey: string; creditMappingKey: string; priority?: number;
  configuration?: Record<string, unknown>;
}): Promise<AccountingPostingRule> {
  const result = await supabase.from("accounting_posting_rules" as never).insert({
    tenant_id: requireTenantId(input.tenantId), rule_key: input.ruleKey.trim(), source_type: input.sourceType,
    event_type: input.eventType, debit_mapping_key: input.debitMappingKey,
    credit_mapping_key: input.creditMappingKey, is_active: false, priority: input.priority ?? 100,
    configuration: input.configuration ?? {},
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingPostingRule>(result, "ACCOUNTING_POSTING_RULE_CREATE_FAILED");
}

export async function updateAccountingPostingRule(input: {
  tenantId: string;
  ruleId: string;
  isActive: boolean;
  priority?: number;
  configuration?: Record<string, unknown>;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): Promise<AccountingPostingRule> {
  const result = await supabase.from("accounting_posting_rules" as never).update({
    is_active: input.isActive,
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.configuration === undefined ? {} : { configuration: input.configuration }),
    ...(input.effectiveFrom === undefined ? {} : { effective_from: input.effectiveFrom }),
    ...(input.effectiveTo === undefined ? {} : { effective_to: input.effectiveTo }),
    updated_at: new Date().toISOString(),
  } as never)
    .eq("tenant_id", requireTenantId(input.tenantId))
    .eq("id", input.ruleId)
    .select("*")
    .single();
  return unwrapAccountingResult<AccountingPostingRule>(result, "ACCOUNTING_POSTING_RULE_UPDATE_FAILED");
}
