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
