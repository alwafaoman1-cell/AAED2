// Cloud-first settings helper. Reads/writes settings to `tenant_settings`
// table on Supabase, with localStorage as offline fallback only (not source
// of truth). Use this for any company-wide setting that must persist across
// devices and never get lost.

import { supabase } from "@/integrations/supabase/client";

const LS_PREFIX = "cloud_setting_cache:";

export interface CloudSettingRecord<T = unknown> {
  key: string;
  value: T;
  version: number;
  updated_at: string;
}

/** Read a setting (cloud first, falls back to local cache for offline). */
export async function readCloudSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(data.value)); } catch {}
      return data.value as T;
    }
  } catch {
    // network / not signed in — try local cache
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (raw) return JSON.parse(raw) as T;
    } catch {}
  }
  return fallback;
}

/** Write a setting upserted by key. Bumps version automatically via trigger. */
export async function writeCloudSetting<T>(key: string, value: T): Promise<void> {
  // Need tenant_id for new rows
  const { data: userRow } = await supabase.auth.getUser();
  const userId = userRow.user?.id;
  if (!userId) throw new Error("not_authenticated");

  // get tenant_id from profile (no RPC dependency)
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  const tenantId = profile?.tenant_id;
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
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch {}
}

/** Subscribe to live changes for a setting key. Returns unsubscribe fn. */
export function subscribeCloudSetting<T>(
  key: string,
  cb: (value: T) => void,
): () => void {
  const channel = supabase
    .channel(`tenant_setting:${key}:${Math.random().toString(36).slice(2, 7)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tenant_settings", filter: `key=eq.${key}` },
      (payload) => {
        const row = (payload.new ?? payload.old) as { value?: T } | null;
        if (row?.value !== undefined) {
          try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(row.value)); } catch {}
          cb(row.value as T);
        }
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** List every known cloud-setting cache key currently in localStorage (for the cache audit page). */
export function listCachedCloudKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length));
  }
  return out;
}
