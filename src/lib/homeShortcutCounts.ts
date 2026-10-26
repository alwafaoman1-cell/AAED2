import { supabase } from "@/integrations/supabase/client";

export const HOME_SHORTCUT_COUNT_KEYS = [
  "openWorkOrders", "todayWorkOrders", "vehicles", "pendingClaims",
  "lowStock", "unpaidInvoices", "pendingInspections",
] as const;

export type HomeShortcutCountKey = typeof HOME_SHORTCUT_COUNT_KEYS[number];
export type HomeShortcutCounts = Record<HomeShortcutCountKey, number>;

export async function fetchHomeShortcutCounts(tenantId: string): Promise<HomeShortcutCounts> {
  const { data, error } = await (supabase.rpc as any)("home_shortcut_counts_rpc", {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("HOME_SHORTCUT_COUNTS_UNAVAILABLE");

  const result = {} as HomeShortcutCounts;
  for (const key of HOME_SHORTCUT_COUNT_KEYS) {
    const rawCount = data[key];
    const count = Number(rawCount);
    if (rawCount === null || rawCount === undefined || typeof rawCount === "boolean"
      || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("HOME_SHORTCUT_COUNTS_UNAVAILABLE");
    }
    result[key] = count;
  }
  return result;
}
