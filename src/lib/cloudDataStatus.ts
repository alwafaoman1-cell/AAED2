import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

/** Technical table counts only; several legacy stores now use tenant_settings instead. */
export const CLOUD_TABLES = [
  { table: "customers", labelKey: "cloudDataStatus.customers" },
  { table: "vehicles", labelKey: "cloudDataStatus.vehicles" },
  { table: "suppliers", labelKey: "cloudDataStatus.suppliers" },
  { table: "job_orders", labelKey: "cloudDataStatus.workOrders" },
  { table: "inventory", labelKey: "cloudDataStatus.inventory" },
  { table: "expenses", labelKey: "cloudDataStatus.expenses" },
  { table: "journal_entries", labelKey: "cloudDataStatus.journal" },
  { table: "sales_documents", labelKey: "cloudDataStatus.salesDocuments" },
] as const;

export interface CloudTableCount {
  table: (typeof CLOUD_TABLES)[number]["table"];
  labelKey: (typeof CLOUD_TABLES)[number]["labelKey"];
  count: number | null;
  error: string | null;
}

/** Read-only and explicitly tenant-scoped. Never treats a failed count as zero. */
export async function readCloudTableCounts(): Promise<CloudTableCount[]> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("Current workshop could not be identified");

  return Promise.all(CLOUD_TABLES.map(async ({ table, labelKey }) => {
    try {
      const { count, error } = await supabase
        .from(table as any)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      return {
        table,
        labelKey,
        count: error ? null : count,
        error: error?.message ?? (count === null ? "Count unavailable" : null),
      };
    } catch (error) {
      return {
        table,
        labelKey,
        count: null,
        error: error instanceof Error ? error.message : "Count unavailable",
      };
    }
  }));
}
