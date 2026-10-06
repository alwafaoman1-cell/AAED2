import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

const memoryCache = new Map<string, unknown>();
const memoryCacheMeta = new Map<string, number>();
const memoryCacheVersions = new Map<string, number>();
const pendingReads = new Map<string, Promise<unknown>>();
const CACHE_TTL_MS = 30_000;
let allSettingsLoadedAt = 0;
let pendingAllSettings: Promise<void> | null = null;
let activeTenantId: string | null = null;
let settingsGeneration = 0;
const scopeListeners = new Set<() => void>();

type SettingListener = (value: unknown) => void;
const settingListeners = new Map<string, Set<SettingListener>>();
let tenantSettingsChannel: ReturnType<typeof supabase.channel> | null = null;

function isAuthPage(): boolean {
  return typeof window !== "undefined" && /^\/(auth|reset-password)(\/|$)/.test(window.location.pathname);
}

function scopedKey(key: string, tenantId = activeTenantId): string {
  return tenantId ? `${tenantId}:${key}` : key;
}

function ensureTenantScope(tenantId: string | null | undefined, force = false) {
  const nextTenantId = tenantId || null;
  if (activeTenantId === nextTenantId && !force) return;
  settingsGeneration += 1;
  memoryCache.clear();
  memoryCacheMeta.clear();
  memoryCacheVersions.clear();
  pendingReads.clear();
  allSettingsLoadedAt = 0;
  pendingAllSettings = null;
  activeTenantId = nextTenantId;
  scopeListeners.forEach((listener) => listener());
}

/** Stores use this to discard snapshots belonging to a prior login/tenant. */
export function subscribeCloudSettingsScopeChange(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => scopeListeners.delete(listener);
}

export function getCloudSettingsScopeVersion(): number {
  return settingsGeneration;
}

export function clearCloudSettingsCache(): void {
  ensureTenantScope(null, true);
}

export function setCloudSettingsTenantScope(tenantId: string): void {
  ensureTenantScope(tenantId);
}

export interface CloudSettingRecord<T = unknown> {
  key: string;
  value: T;
  version: number;
  updated_at: string;
}

async function loadAllCloudSettings(): Promise<void> {
  if (isAuthPage()) return;
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  ensureTenantScope(tenantId);
  if (Date.now() - allSettingsLoadedAt < CACHE_TTL_MS) return;
  if (pendingAllSettings) return pendingAllSettings;

  const generation = settingsGeneration;
  const request = (async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session || generation !== settingsGeneration || activeTenantId !== tenantId) return;
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("tenant_id,key,value,version")
      .eq("tenant_id", tenantId);
    if (error) throw error;
    if (generation !== settingsGeneration || activeTenantId !== tenantId) return;
    const now = Date.now();
    (data || []).forEach((row) => {
      if (!row?.key) return;
      if ((row as any).tenant_id && (row as any).tenant_id !== tenantId) return;
      const cacheKey = scopedKey(row.key, tenantId);
      const version = Number(row.version || 0);
      if (version < (memoryCacheVersions.get(cacheKey) ?? 0)) return;
      memoryCache.set(cacheKey, row.value);
      memoryCacheMeta.set(cacheKey, now);
      memoryCacheVersions.set(cacheKey, version);
    });
    allSettingsLoadedAt = now;
  })();
  pendingAllSettings = request;

  try {
    await request;
  } finally {
    if (pendingAllSettings === request) pendingAllSettings = null;
  }
}

/** Read a tenant setting from Supabase. Falls back only to in-memory session cache. */
export async function readCloudSetting<T>(key: string, fallback: T): Promise<T> {
  const tenantId = isAuthPage() ? activeTenantId : await getCurrentTenantId();
  if (tenantId) ensureTenantScope(tenantId);
  const generation = settingsGeneration;
  const cacheKey = scopedKey(key, tenantId);
  if (isAuthPage()) return memoryCache.has(cacheKey) ? (memoryCache.get(cacheKey) as T) : fallback;
  if (!tenantId) return fallback;

  const cachedAt = memoryCacheMeta.get(cacheKey) ?? 0;
  if (memoryCache.has(cacheKey) && Date.now() - cachedAt < CACHE_TTL_MS) {
    return memoryCache.get(cacheKey) as T;
  }

  const pending = pendingReads.get(cacheKey);
  if (pending) {
    try {
      const value = await pending;
      return generation === settingsGeneration ? value as T : fallback;
    } catch {
      return generation === settingsGeneration && memoryCache.has(cacheKey) ? (memoryCache.get(cacheKey) as T) : fallback;
    }
  }

  const readPromise = (async () => {
    try {
      await loadAllCloudSettings();
      if (generation !== settingsGeneration) return fallback;
      if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
    } catch {
      if (generation !== settingsGeneration) return fallback;
      const { data: sessionData } = await supabase.auth.getSession();
      if (generation !== settingsGeneration) return fallback;
      if (!sessionData.session) {
        if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
        return fallback;
      }
      const { data, error } = await supabase
        .from("tenant_settings")
        .select("value,version")
        .eq("key", key)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      if (generation !== settingsGeneration) return fallback;
      if (data) {
        const version = Number(data.version || 0);
        if (version >= (memoryCacheVersions.get(cacheKey) ?? 0)) {
          memoryCache.set(cacheKey, data.value);
          memoryCacheMeta.set(cacheKey, Date.now());
          memoryCacheVersions.set(cacheKey, version);
          return data.value;
        }
        return memoryCache.get(cacheKey);
      }
    }
    return fallback;
  })();

  pendingReads.set(cacheKey, readPromise);
  try {
    const value = await readPromise;
    return generation === settingsGeneration ? value as T : fallback;
  } catch {
    if (generation === settingsGeneration && memoryCache.has(cacheKey)) return memoryCache.get(cacheKey) as T;
    return fallback;
  } finally {
    if (pendingReads.get(cacheKey) === readPromise) pendingReads.delete(cacheKey);
  }
}

/** Bypass the short-lived cache after a rejected optimistic write. */
export async function readCloudSettingFresh<T>(key: string, fallback: T): Promise<T> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return fallback;
  ensureTenantScope(tenantId);
  const generation = settingsGeneration;
  const { data, error } = await supabase.from("tenant_settings")
    .select("value,version")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  if (generation !== settingsGeneration || activeTenantId !== tenantId) return fallback;
  const cacheKey = scopedKey(key, tenantId);
  const version = Number(data?.version || 0);
  if (version < (memoryCacheVersions.get(cacheKey) ?? 0)) {
    return (memoryCache.get(cacheKey) ?? fallback) as T;
  }
  const value = (data?.value ?? fallback) as T;
  memoryCache.set(cacheKey, value);
  memoryCacheMeta.set(cacheKey, Date.now());
  memoryCacheVersions.set(cacheKey, version);
  return value;
}

/** Write a tenant setting to Supabase. No secret or operational setting is cached locally. */
export async function writeCloudSetting<T>(key: string, value: T): Promise<void> {
  const { data: userRow } = await supabase.auth.getUser();
  const userId = userRow.user?.id;
  if (!userId) throw new Error("not_authenticated");

  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("no_tenant");
  ensureTenantScope(tenantId);
  const generation = settingsGeneration;

  const { data, error } = await supabase
    .from("tenant_settings")
    .upsert({
      tenant_id: tenantId,
      key,
      value: value as never,
      updated_by: userId,
    }, { onConflict: "tenant_id,key" })
    .select("version")
    .single();
  if (error) throw error;
  if (!data) throw new Error("SETTING_SAVE_NOT_CONFIRMED");
  if (generation !== settingsGeneration || activeTenantId !== tenantId) return;
  const cacheKey = scopedKey(key, tenantId);
  memoryCache.set(cacheKey, value);
  memoryCacheMeta.set(cacheKey, Date.now());
  memoryCacheVersions.set(cacheKey, Number(data.version || 0));
}

export type CloudArrayMutation<T extends { id: string }> =
  | { type: "add" | "restore"; item: T }
  | { type: "update"; id: string; patch: Partial<T> }
  | { type: "remove"; id: string };

/**
 * Compare-and-swap one legacy array item. The tenant_settings version trigger
 * serializes concurrent writers without replacing a colleague's entire list.
 */
export async function mutateCloudArraySetting<T extends { id: string }>(
  key: string,
  mutation: CloudArrayMutation<T>,
  expectedScopeVersion: number,
): Promise<T[]> {
  const assertScope = () => {
    if (settingsGeneration !== expectedScopeVersion) throw new Error("SESSION_CHANGED_BEFORE_SAVE");
  };
  assertScope();
  const { data: userRow, error: userError } = await supabase.auth.getUser();
  assertScope();
  const userId = userRow.user?.id;
  if (userError || !userId) throw new Error("not_authenticated");
  const tenantId = await getCurrentTenantId();
  assertScope();
  if (!tenantId) throw new Error("no_tenant");
  ensureTenantScope(tenantId);
  // Resolving the first tenant changes the cache scope. It is safe to proceed
  // only when the caller started under that same tenant scope.
  assertScope();

  for (let attempt = 0; attempt < 6; attempt++) {
    assertScope();
    const { data: current, error: readError } = await supabase
      .from("tenant_settings")
      .select("value,version")
      .eq("tenant_id", tenantId)
      .eq("key", key)
      .maybeSingle();
    assertScope();
    if (readError) throw readError;
    const rows = Array.isArray(current?.value) ? current.value as T[] : [];
    let next: T[];
    if (mutation.type === "add" || mutation.type === "restore") {
      if (rows.some((row) => row.id === mutation.item.id)) {
        if (mutation.type === "restore") return rows;
        throw new Error("DUPLICATE_STORE_ITEM");
      }
      next = [mutation.item, ...rows];
    } else if (mutation.type === "update") {
      if (!rows.some((row) => row.id === mutation.id)) throw new Error("STORE_ITEM_NOT_FOUND");
      next = rows.map((row) => row.id === mutation.id ? { ...row, ...mutation.patch } : row);
    } else if (mutation.type === "remove") {
      if (!rows.some((row) => row.id === mutation.id)) return rows;
      next = rows.filter((row) => row.id !== mutation.id);
    } else {
      throw new Error("INVALID_STORE_MUTATION");
    }

    let savedVersion = 0;
    if (!current) {
      const { data: inserted, error } = await supabase.from("tenant_settings")
        .insert({ tenant_id: tenantId, key, value: next as never, updated_by: userId })
        .select("value,version")
        .maybeSingle();
      assertScope();
      if (error?.code === "23505") continue;
      if (error) throw error;
      if (!inserted) throw new Error("STORE_SAVE_NOT_CONFIRMED");
      savedVersion = Number(inserted.version || 0);
    } else {
      const { data: updated, error } = await supabase.from("tenant_settings")
        .update({ value: next as never, updated_by: userId })
        .eq("tenant_id", tenantId)
        .eq("key", key)
        .eq("version", current.version)
        .select("value,version")
        .maybeSingle();
      assertScope();
      if (error) throw error;
      if (!updated) continue;
      savedVersion = Number(updated.version || 0);
    }

    const cacheKey = scopedKey(key, tenantId);
    memoryCache.set(cacheKey, next);
    memoryCacheMeta.set(cacheKey, Date.now());
    memoryCacheVersions.set(cacheKey, savedVersion);
    return next;
  }
  throw new Error("STORE_CONCURRENT_UPDATE_RETRY_EXHAUSTED");
}

/** Subscribe to live tenant setting changes. */
export function subscribeCloudSetting<T>(
  key: string,
  cb: (value: T) => void,
): () => void {
  if (isAuthPage()) return () => {};

  if (!tenantSettingsChannel) {
    tenantSettingsChannel = supabase
      .channel("tenant_settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tenant_settings" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { tenant_id?: string; key?: string; value?: unknown; version?: number } | null;
          if (!activeTenantId || row?.tenant_id !== activeTenantId) return;
          if (row?.key && row.value !== undefined) {
            const cacheKey = scopedKey(row.key, row.tenant_id || activeTenantId);
            const version = Number(row.version || 0);
            if (version < (memoryCacheVersions.get(cacheKey) ?? 0)) return;
            memoryCache.set(cacheKey, row.value);
            memoryCacheMeta.set(cacheKey, Date.now());
            memoryCacheVersions.set(cacheKey, version);
            const listeners = settingListeners.get(row.key);
            listeners?.forEach((listener) => {
              try { listener(row.value); } catch {}
            });
          }
        },
      )
      .subscribe();
  }

  let listeners = settingListeners.get(key);
  if (!listeners) {
    listeners = new Set<SettingListener>();
    settingListeners.set(key, listeners);
  }
  const listener: SettingListener = (value) => cb(value as T);
  listeners.add(listener);
  return () => {
    const current = settingListeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      settingListeners.delete(key);
    }
    if (settingListeners.size === 0 && tenantSettingsChannel) {
      const channel = tenantSettingsChannel;
      tenantSettingsChannel = null;
      void supabase.removeChannel(channel);
    }
  };
}

/** Current in-memory setting keys, useful for diagnostics only. */
export function listCachedCloudKeys(): string[] {
  return Array.from(memoryCache.keys());
}
