import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

const memoryCache = new Map<string, unknown>();
const memoryCacheMeta = new Map<string, number>();
const pendingReads = new Map<string, Promise<unknown>>();
const CACHE_TTL_MS = 30_000;

type SettingListener = (value: unknown) => void;
const subscriptions = new Map<string, {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<SettingListener>;
}>();

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

  const cachedAt = memoryCacheMeta.get(key) ?? 0;
  if (memoryCache.has(key) && Date.now() - cachedAt < CACHE_TTL_MS) {
    return memoryCache.get(key) as T;
  }

  const pending = pendingReads.get(key);
  if (pending) {
    try {
      return (await pending) as T;
    } catch {
      return memoryCache.has(key) ? (memoryCache.get(key) as T) : fallback;
    }
  }

  const readPromise = (async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      if (memoryCache.has(key)) return memoryCache.get(key);
      return fallback;
    }
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      memoryCache.set(key, data.value);
      memoryCacheMeta.set(key, Date.now());
      return data.value;
    }
    return fallback;
  })();

  pendingReads.set(key, readPromise);
  try {
    return (await readPromise) as T;
  } catch {
    if (memoryCache.has(key)) return memoryCache.get(key) as T;
    return fallback;
  } finally {
    pendingReads.delete(key);
  }
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
  memoryCacheMeta.set(key, Date.now());
}

/** Subscribe to live tenant setting changes. */
export function subscribeCloudSetting<T>(
  key: string,
  cb: (value: T) => void,
): () => void {
  if (isAuthPage()) return () => {};
  let entry = subscriptions.get(key);
  if (!entry) {
    const listeners = new Set<SettingListener>();
    const channel = supabase
      .channel(`tenant_setting:${key}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tenant_settings", filter: `key=eq.${key}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { value?: unknown } | null;
          if (row?.value !== undefined) {
            memoryCache.set(key, row.value);
            memoryCacheMeta.set(key, Date.now());
            listeners.forEach((listener) => {
              try { listener(row.value); } catch {}
            });
          }
        },
      )
      .subscribe();
    entry = { channel, listeners };
    subscriptions.set(key, entry);
  }

  const listener: SettingListener = (value) => cb(value as T);
  entry.listeners.add(listener);
  return () => {
    const current = subscriptions.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      subscriptions.delete(key);
      void supabase.removeChannel(current.channel);
    }
  };
}

/** Current in-memory setting keys, useful for diagnostics only. */
export function listCachedCloudKeys(): string[] {
  return Array.from(memoryCache.keys());
}
