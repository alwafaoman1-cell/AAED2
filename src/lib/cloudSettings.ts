import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { notifyListeners } from "@/lib/notifyListeners";

const memoryCache = new Map<string, unknown>();
const memoryCacheMeta = new Map<string, number>();
const memoryCacheVersions = new Map<string, number>();
const pendingReads = new Map<string, Promise<void>>();
const readInvalidations = new Map<string, number>();
// Absence is cacheable only after a successful read, never as a caller's default.
const MISSING_SETTING = Symbol("missingCloudSetting");
const CACHE_TTL_MS = 30_000;
let activeTenantId: string | null = null;
let settingsGeneration = 0;
const scopeListeners = new Set<() => void>();

type SettingListener = (value: unknown) => void;
const settingListeners = new Map<string, Set<SettingListener>>();
let tenantSettingsChannel: ReturnType<typeof supabase.channel> | null = null;
let tenantSettingsChannelVersion = 0;

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
  readInvalidations.clear();
  if (tenantSettingsChannel) {
    const channel = tenantSettingsChannel;
    tenantSettingsChannel = null;
    void supabase.removeChannel(channel);
  }
  activeTenantId = nextTenantId;
  scopeListeners.forEach((listener) => listener());
  ensureTenantSettingsChannel();
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

function cachedValue<T>(cacheKey: string, fallback: T): T {
  const value = memoryCache.get(cacheKey);
  return memoryCache.has(cacheKey) && value !== MISSING_SETTING ? value as T : fallback;
}

function isResolvedReadScopeCurrent(tenantId: string | null, startedTenant: string | null, generation: number): boolean {
  // Concurrent cold reads may share the first tenant adoption, but a delayed
  // tenant lookup must never restore a scope invalidated by logout/switching.
  return generation === settingsGeneration || (
    startedTenant === null && tenantId !== null && activeTenantId === tenantId && settingsGeneration === generation + 1
  );
}

/** Read a tenant setting from Supabase. Falls back only to in-memory session cache. */
export async function readCloudSetting<T>(key: string, fallback: T): Promise<T> {
  if (isAuthPage()) return cachedValue(scopedKey(key), fallback);
  const startedTenant = activeTenantId;
  const startedGeneration = settingsGeneration;
  let tenantId: string | null;
  try {
    tenantId = await getCurrentTenantId();
  } catch {
    return startedGeneration === settingsGeneration ? cachedValue(scopedKey(key, startedTenant), fallback) : fallback;
  }
  if (!isResolvedReadScopeCurrent(tenantId, startedTenant, startedGeneration)) return fallback;
  ensureTenantScope(tenantId);
  if (!tenantId) return fallback;
  const generation = settingsGeneration;
  const cacheKey = scopedKey(key, tenantId);
  const isCurrent = () => generation === settingsGeneration && activeTenantId === tenantId;

  const cachedAt = memoryCacheMeta.get(cacheKey) ?? 0;
  if (memoryCache.has(cacheKey) && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedValue(cacheKey, fallback);
  }

  const pending = pendingReads.get(cacheKey);
  if (pending) {
    try {
      await pending;
    } catch {
      // A failed read does not confirm absence or refresh the cached timestamp.
    }
    return isCurrent() ? cachedValue(cacheKey, fallback) : fallback;
  }

  const invalidation = readInvalidations.get(cacheKey) ?? 0;
  readInvalidations.set(cacheKey, invalidation);
  const readPromise = (async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (!isCurrent() || invalidation !== readInvalidations.get(cacheKey)) return;
    if (sessionError) throw sessionError;
    if (!sessionData.session) return;
    const cachedVersion = memoryCacheVersions.get(cacheKey);
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("value,version")
      .eq("tenant_id", tenantId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!isCurrent() || invalidation !== readInvalidations.get(cacheKey)) return;
    const version = Number(data?.version || 0);
    if (data && version < (memoryCacheVersions.get(cacheKey) ?? 0)) return;
    // An absent snapshot has no row version: do not let it erase a confirmed
    // write or Realtime insert that completed while this request was in flight.
    if (!data && cachedVersion !== memoryCacheVersions.get(cacheKey)) return;
    memoryCache.set(cacheKey, data ? data.value : MISSING_SETTING);
    memoryCacheMeta.set(cacheKey, Date.now());
    memoryCacheVersions.set(cacheKey, version);
  })();

  pendingReads.set(cacheKey, readPromise);
  try {
    await readPromise;
  } catch {
    // Keep a previous confirmed value available, but leave failures retryable.
  } finally {
    if (pendingReads.get(cacheKey) === readPromise) pendingReads.delete(cacheKey);
  }
  return isCurrent() ? cachedValue(cacheKey, fallback) : fallback;
}

/** Bypass the short-lived cache after a rejected optimistic write. */
export async function readCloudSettingFresh<T>(key: string, fallback: T, options: { requireConfirmed?: boolean } = {}): Promise<T> {
  const startedTenant = activeTenantId;
  const startedGeneration = settingsGeneration;
  const tenantId = await getCurrentTenantId();
  if (!isResolvedReadScopeCurrent(tenantId, startedTenant, startedGeneration)) {
    if (options.requireConfirmed) throw new Error("CLOUD_SETTING_SESSION_CHANGED_DURING_READ");
    return fallback;
  }
  if (!tenantId) {
    ensureTenantScope(null);
    if (options.requireConfirmed) throw new Error("CLOUD_SETTING_TENANT_REQUIRED");
    return fallback;
  }
  ensureTenantScope(tenantId);
  const generation = settingsGeneration;
  const cacheKey = scopedKey(key, tenantId);
  const invalidation = readInvalidations.get(cacheKey) ?? 0;
  readInvalidations.set(cacheKey, invalidation);
  const { data, error } = await supabase.from("tenant_settings")
    .select("value,version")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  if (generation !== settingsGeneration || activeTenantId !== tenantId) {
    if (options.requireConfirmed) throw new Error("CLOUD_SETTING_SESSION_CHANGED_DURING_READ");
    return fallback;
  }
  if (invalidation !== readInvalidations.get(cacheKey)) {
    if (options.requireConfirmed) throw new Error("CLOUD_SETTING_STALE_READ");
    return cachedValue(cacheKey, fallback);
  }
  const version = Number(data?.version || 0);
  if (version < (memoryCacheVersions.get(cacheKey) ?? 0)) {
    if (options.requireConfirmed) throw new Error("CLOUD_SETTING_STALE_READ");
    return cachedValue(cacheKey, fallback) ?? fallback;
  }
  const value = (data?.value ?? fallback) as T;
  memoryCache.set(cacheKey, data ? data.value : MISSING_SETTING);
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

/**
 * Confirm a mutation of an object-valued setting against its latest database
 * version. A whole-object upsert would lose another user's concurrent edits.
 * The mutation must be pure because a version conflict may replay it.
 */
export async function mutateCloudObjectSetting<T extends object>(
  key: string,
  fallback: T,
  mutate: (current: T) => T,
  expectedScopeVersion: number,
): Promise<T> {
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
    if (current && (typeof current.value !== "object" || current.value === null || Array.isArray(current.value))) {
      throw new Error("STORE_INVALID_CLOUD_VALUE");
    }
    const next = mutate({ ...fallback, ...(current?.value as T | undefined) });
    if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("STORE_INVALID_MUTATION");

    let saved: { version: number } | null = null;
    if (!current) {
      const { data, error } = await supabase.from("tenant_settings")
        .insert({ tenant_id: tenantId, key, value: next as never, updated_by: userId })
        .select("version")
        .maybeSingle();
      assertScope();
      if (error?.code === "23505") continue;
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabase.from("tenant_settings")
        .update({ value: next as never, updated_by: userId })
        .eq("tenant_id", tenantId)
        .eq("key", key)
        .eq("version", current.version)
        .select("version")
        .maybeSingle();
      assertScope();
      if (error) throw error;
      if (!data) continue;
      saved = data;
    }
    if (!saved) throw new Error("STORE_SAVE_NOT_CONFIRMED");
    const cacheKey = scopedKey(key, tenantId);
    if ((memoryCacheVersions.get(cacheKey) ?? 0) > Number(saved.version || 0)) {
      return memoryCache.get(cacheKey) as T;
    }
    memoryCache.set(cacheKey, next);
    memoryCacheMeta.set(cacheKey, Date.now());
    memoryCacheVersions.set(cacheKey, Number(saved.version || 0));
    return next;
  }
  throw new Error("STORE_CONCURRENT_UPDATE_RETRY_EXHAUSTED");
}

function invalidateSettingRead(cacheKey: string): void {
  readInvalidations.set(cacheKey, (readInvalidations.get(cacheKey) ?? 0) + 1);
  memoryCache.delete(cacheKey);
  memoryCacheMeta.delete(cacheKey);
  memoryCacheVersions.delete(cacheKey);
  pendingReads.delete(cacheKey);
}

function ensureTenantSettingsChannel(): void {
  if (!tenantSettingsChannel && activeTenantId && settingListeners.size > 0 && !isAuthPage()) {
    const tenantId = activeTenantId;
    const generation = settingsGeneration;
    const channelVersion = ++tenantSettingsChannelVersion;
    tenantSettingsChannel = supabase
      // The SDK reuses a channel with the same topic until async removal ends.
      .channel(`tenant_settings:${tenantId}:${generation}:${channelVersion}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tenant_settings" },
        (payload) => {
          if (!tenantSettingsChannel || channelVersion !== tenantSettingsChannelVersion || generation !== settingsGeneration || activeTenantId !== tenantId) return;
          const deleted = payload.eventType === "DELETE";
          const row = (deleted ? payload.old : payload.new) as { tenant_id?: string; key?: string; value?: unknown; version?: number } | null;
          if (deleted) {
            if (row?.tenant_id && row.tenant_id !== tenantId) return;
            if (row?.tenant_id && row.key) {
              const cacheKey = scopedKey(row.key, tenantId);
              if (row.version !== undefined && Number(row.version) < (memoryCacheVersions.get(cacheKey) ?? 0)) return;
              invalidateSettingRead(cacheKey);
            } else {
              // Under RLS a DELETE can contain only its primary key. Treat it
              // as invalidation, never as an empty value for every subscriber.
              new Set([...memoryCache.keys(), ...readInvalidations.keys(), ...pendingReads.keys()])
                .forEach(invalidateSettingRead);
            }
            return;
          }
          if (row?.tenant_id !== tenantId) return;
          if (row?.key && row.value !== undefined) {
            const cacheKey = scopedKey(row.key, tenantId);
            if (!memoryCache.has(cacheKey) && !readInvalidations.has(cacheKey) && !settingListeners.has(row.key)) return;
            const version = Number(row.version || 0);
            if (version < (memoryCacheVersions.get(cacheKey) ?? 0)) return;
            memoryCache.set(cacheKey, row.value);
            memoryCacheMeta.set(cacheKey, Date.now());
            memoryCacheVersions.set(cacheKey, version);
            const listeners = settingListeners.get(row.key);
            if (listeners) notifyListeners(listeners, "cloudSettings", row.value);
          }
        },
      )
      .subscribe();
  }
}

/** Subscribe to live tenant setting changes. */
export function subscribeCloudSetting<T>(
  key: string,
  cb: (value: T) => void,
): () => void {
  if (isAuthPage()) return () => {};

  let listeners = settingListeners.get(key);
  if (!listeners) {
    listeners = new Set<SettingListener>();
    settingListeners.set(key, listeners);
  }
  const listener: SettingListener = (value) => cb(value as T);
  listeners.add(listener);
  ensureTenantSettingsChannel();
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
