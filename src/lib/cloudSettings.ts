import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

const memoryCache = new Map<string, unknown>();

function isAuthPage(): boolean {
  return typeof window !== "undefined" && /^\/(auth|reset-password)(\/|$)/.test(window.location.pathname);
}

export interface CloudSettingRecord<T = unknown> {
  key: string;
  value: T;
  version: number;
  updated_at: string;
}

/** Read a tenant setting from Supabase. Falls back only to in-memory session cache. */
export async function readCloudSetting<T>(key: string, fallback: T): Promise<T> {
  if (isAuthPage()) return memoryCache.has(key) ? (memoryCache.get(key) as T) : fallback;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return memoryCache.has(key) ? (memoryCache.get(key) as T) : fallback;
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      memoryCache.set(key, data.value);
      return data.value as T;
    }
  } catch {
    if (memoryCache.has(key)) return memoryCache.get(key) as T;
  }
  return fallback;
}

/** Write a tenant setting to Supabase. No secret or operational setting is cached locally. */
export async function writeCloudSetting<T>(key: string, value: T): Promise<void> {
  const { data: userRow } = await supabase.auth.getUser();
  const userId = userRow.user?.id;
  if (!userId) throw new Error("not_authenticated");

  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("no_tenant");

  const { error } = await supabase
    .from("tenant_settings")
    .upsert({
      tenant_id: tenantId,
      key,
      value: value as never,
      updated_by: userId,
    }, { onConflict: "tenant_id,key" });
  if (error) throw error;
  memoryCache.set(key, value);
}

/** Subscribe to live tenant setting changes. */
export function subscribeCloudSetting<T>(
  key: string,
  cb: (value: T) => void,
): () => void {
  if (isAuthPage()) return () => {};
  const channel = supabase
    .channel(`tenant_setting:${key}:${Math.random().toString(36).slice(2, 7)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tenant_settings", filter: `key=eq.${key}` },
      (payload) => {
        const row = (payload.new ?? payload.old) as { value?: T } | null;
        if (row?.value !== undefined) {
          memoryCache.set(key, row.value);
          cb(row.value as T);
        }
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** Current in-memory setting keys, useful for diagnostics only. */
export function listCachedCloudKeys(): string[] {
  return Array.from(memoryCache.keys());
}
