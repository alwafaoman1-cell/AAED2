import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

// Shared by the canonical management screens and the read-only legacy adapter.
// Never hydrate voucher data or create a second category source.
export const EXPENSE_CATEGORY_COLUMNS = "id,tenant_id,code,name,name_ar,name_en,parent_id,level,category_type,expense_scope,department_code,accounting_mapping_key,cost_center_id,is_system,is_active,sort_order,description,description_ar,description_en,color,active,created_at";
let client: QueryClient | null = null;
export const expenseCategoryRowsKey = (tenantId: string) => queryKeys.expenseManagement.categories({ tenantId, source: "canonical" });
export function setExpenseCategoryQueryClient(value: QueryClient) { client = value; }

export async function readExpenseCategoryRows(tenantId: string): Promise<Record<string, unknown>[]> {
  if (!tenantId) throw new Error("tenant_not_found");
  const queryFn = async () => {
    const { data, error } = await supabase.from("expense_categories")
      .select(EXPENSE_CATEGORY_COLUMNS).eq("tenant_id", tenantId)
      .order("level").order("sort_order").order("name_en");
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("EXPENSE_CATEGORIES_INVALID_RESPONSE");
    return data as unknown as Record<string, unknown>[];
  };
  return client ? client.fetchQuery({ queryKey: expenseCategoryRowsKey(tenantId), queryFn, staleTime: 30_000 }) : queryFn();
}

export async function invalidateExpenseCategoryRows(tenantId: string) {
  await client?.invalidateQueries({ queryKey: expenseCategoryRowsKey(tenantId), refetchType: "none" });
}
