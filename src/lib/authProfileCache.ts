import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "manager" | "supervisor" | "technician" | "insurance" | "accountant";

export interface UserProfile {
  id: string;
  user_id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  role: AppRole;
}

const PROFILE_QUERY_TIMEOUT_MS = 7_000;
const PROFILE_STORAGE_PREFIX = "alwafa.auth.profile.";
const PROFILE_STORAGE_TTL_MS = 12 * 60 * 60_000;

const profileCache = new Map<string, UserProfile | null>();
const inFlightProfileRequests = new Map<string, Promise<UserProfile | null>>();
const profileRequestGenerations = new Map<string, number>();
let globalProfileCacheGeneration = 0;

type StoredUserProfile = {
  cached_at: number;
  profile: UserProfile;
};

function profileStorageKey(uid: string) {
  return `${PROFILE_STORAGE_PREFIX}${uid}`;
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function readStoredProfile(uid: string): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(profileStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUserProfile>;
    const storedProfile = parsed.profile;
    if (!storedProfile || storedProfile.user_id !== uid || !storedProfile.tenant_id) {
      window.sessionStorage.removeItem(profileStorageKey(uid));
      return null;
    }
    if (!parsed.cached_at || Date.now() - parsed.cached_at > PROFILE_STORAGE_TTL_MS) {
      window.sessionStorage.removeItem(profileStorageKey(uid));
      return null;
    }
    return storedProfile;
  } catch {
    return null;
  }
}

function writeStoredProfile(uid: string, profile: UserProfile | null) {
  if (typeof window === "undefined") return;
  try {
    if (!profile) {
      window.sessionStorage.removeItem(profileStorageKey(uid));
      return;
    }
    window.sessionStorage.setItem(
      profileStorageKey(uid),
      JSON.stringify({ cached_at: Date.now(), profile } satisfies StoredUserProfile),
    );
  } catch {
    // Storage cache is best-effort only; Supabase remains the source of truth.
  }
}

function profileFromPartial(row: any, uid: string, user?: User | null): UserProfile | null {
  const tenantId = String(row?.tenant_id || user?.user_metadata?.tenant_id || "").trim();
  const role = String(row?.role || user?.user_metadata?.role || "admin").trim() as AppRole;
  if (!tenantId) return null;
  return {
    id: String(row?.id || uid),
    user_id: String(row?.user_id || uid),
    tenant_id: tenantId,
    full_name: String(
      row?.full_name ||
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email?.split("@")[0] ||
      "User",
    ),
    phone: row?.phone ?? user?.user_metadata?.phone ?? null,
    avatar_url: row?.avatar_url ?? user?.user_metadata?.avatar_url ?? null,
    role,
  };
}

async function fetchProfileViaRest(uid: string, user: User | null, accessToken?: string | null) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!accessToken || !supabaseUrl || !anonKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROFILE_QUERY_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=*&user_id=eq.${encodeURIComponent(uid)}&limit=1`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const rows = await response.json();
    return profileFromPartial(Array.isArray(rows) ? rows[0] : null, uid, user);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProfileFromSupabase(uid: string): Promise<UserProfile | null> {
  const sessionData = await withTimeout(supabase.auth.getSession(), 3_000, "auth session query timeout")
    .then(({ data }) => data)
    .catch(() => null);
  const verifiedUser = await withTimeout(supabase.auth.getUser(), 5_000, "auth user verification timeout")
    .then(({ data }) => data.user ?? null)
    .catch(() => null);
  if (!verifiedUser || verifiedUser.id !== uid) {
    console.warn("[auth] persisted session is not valid; clearing local session");
    await (supabase.auth.signOut as any)({ scope: "local" }).catch(() => {});
    return null;
  }

  const sessionUser = verifiedUser ?? sessionData?.session?.user ?? null;
  const accessToken = sessionData?.session?.access_token;

  const sdkResult = await withTimeout(
    supabase
      .from("profiles")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle(),
    PROFILE_QUERY_TIMEOUT_MS,
    "profile query timeout",
  ).catch((error) => ({ data: null, error }));

  if (!(sdkResult as any)?.error) {
    const profile = profileFromPartial((sdkResult as any).data, uid, sessionUser);
    if (profile) return profile;
  }

  // Single explicit fallback when the Supabase SDK profile read fails or returns
  // no usable tenant. This avoids the previous parallel SDK/REST/RPC/user_roles
  // request fan-out while preserving a recovery path for transient SDK issues.
  const restProfile = await fetchProfileViaRest(uid, sessionUser, accessToken);
  if (restProfile) return restProfile;

  return profileFromPartial(null, uid, sessionUser);
}

export async function getCachedAuthProfile(uid: string, options: { forceRefresh?: boolean } = {}): Promise<UserProfile | null> {
  if (options.forceRefresh) clearCachedAuthProfile(uid);
  if (!options.forceRefresh && profileCache.has(uid)) return profileCache.get(uid) ?? null;

  const stored = options.forceRefresh ? null : readStoredProfile(uid);
  if (stored) {
    profileCache.set(uid, stored);
    return stored;
  }

  const inFlight = inFlightProfileRequests.get(uid);
  if (inFlight) return inFlight;

  const requestGeneration = (profileRequestGenerations.get(uid) || 0) + 1;
  const requestGlobalGeneration = globalProfileCacheGeneration;
  profileRequestGenerations.set(uid, requestGeneration);
  const request = fetchProfileFromSupabase(uid);
  inFlightProfileRequests.set(uid, request);
  try {
    const result = await request;
    const isStillCurrent =
      profileRequestGenerations.get(uid) === requestGeneration &&
      globalProfileCacheGeneration === requestGlobalGeneration;
    if (!isStillCurrent) return result;
    if (result) {
      profileCache.set(uid, result);
      writeStoredProfile(uid, result);
    } else {
      profileCache.delete(uid);
      writeStoredProfile(uid, null);
    }
    return result;
  } finally {
    if (profileRequestGenerations.get(uid) === requestGeneration) {
      inFlightProfileRequests.delete(uid);
    }
  }
}

export function clearCachedAuthProfile(uid: string) {
  profileRequestGenerations.set(uid, (profileRequestGenerations.get(uid) || 0) + 1);
  profileCache.delete(uid);
  inFlightProfileRequests.delete(uid);
  writeStoredProfile(uid, null);
}

export function clearAllAuthProfileCache() {
  globalProfileCacheGeneration += 1;
  profileCache.clear();
  inFlightProfileRequests.clear();
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(PROFILE_STORAGE_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function __authProfileCacheSizeForTests() {
  return {
    cache: profileCache.size,
    inFlight: inFlightProfileRequests.size,
  };
}
