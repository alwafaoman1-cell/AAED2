import type { Session, User } from "@supabase/supabase-js";
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
const INTERNAL_ROLES: readonly string[] = ["admin", "manager", "supervisor", "technician", "insurance", "accountant"];

const profileCache = new Map<string, UserProfile | null>();
const inFlightProfileRequests = new Map<string, Promise<UserProfile | null>>();
const profileRequestGenerations = new Map<string, number>();
let globalProfileCacheGeneration = 0;

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

function clearLegacyStoredProfile(uid: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(profileStorageKey(uid));
  } catch {
    // An old browser cache must never authorize a tenant or a role.
  }
}

function profileFromPartial(row: any, uid: string, user?: User | null): UserProfile | null {
  // Only a confirmed database row can establish authority. Auth user_metadata
  // is user-editable; it is suitable for display defaults, never tenant/role.
  if (!row || row.user_id !== uid || row.account_status !== "active" || row.disabled_at != null) return null;
  const tenantId = typeof row.tenant_id === "string" ? row.tenant_id.trim() : "";
  const role = typeof row.role === "string" ? row.role.trim() : "";
  if (!tenantId || !INTERNAL_ROLES.includes(role)) return null;
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
    role: role as AppRole,
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

async function fetchProfileFromSupabase(uid: string, session: Session | null): Promise<UserProfile | null> {
  // AuthContext already received this session from the SDK. Calling getSession
  // again here used to duplicate bootstrap work before every profile read.
  const sessionData = session ? { session } : await withTimeout(
    supabase.auth.getSession(), 8_000, "auth session query timeout",
  ).then(({ data }) => data);
  const { data: verified, error: verificationError } = await withTimeout(
    supabase.auth.getUser(), 8_000, "auth user verification timeout",
  );
  if (verificationError) throw verificationError;
  const verifiedUser = verified.user ?? null;
  if (!verifiedUser || verifiedUser.id !== uid) {
    // A profile reader must not log the user out: a slow/failed verification
    // is not proof of an invalid session. Auth state changes own sign-out.
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
    // Missing, inactive or invalid cloud identity is authoritative, not a
    // transient transport error. Do not retry it through a different path.
    return profileFromPartial((sdkResult as any).data, uid, sessionUser);
  }

  // Single explicit fallback when the Supabase SDK profile read fails.
  // This avoids the previous parallel SDK/REST/RPC/user_roles
  // request fan-out while preserving a recovery path for transient SDK issues.
  const restProfile = await fetchProfileViaRest(uid, sessionUser, accessToken);
  if (restProfile) return restProfile;

  return null;
}

export async function getCachedAuthProfile(uid: string, options: { forceRefresh?: boolean; session?: Session | null } = {}): Promise<UserProfile | null> {
  if (options.forceRefresh) clearCachedAuthProfile(uid);
  if (!options.forceRefresh && profileCache.has(uid)) return profileCache.get(uid) ?? null;

  // Keep in-memory request de-duplication, but revalidate cloud authority after
  // every page reload. A twelve-hour sessionStorage snapshot is not authority.
  clearLegacyStoredProfile(uid);

  const inFlight = inFlightProfileRequests.get(uid);
  if (inFlight) return inFlight;

  const requestGeneration = (profileRequestGenerations.get(uid) || 0) + 1;
  const requestGlobalGeneration = globalProfileCacheGeneration;
  profileRequestGenerations.set(uid, requestGeneration);
  const request = fetchProfileFromSupabase(uid, options.session ?? null);
  inFlightProfileRequests.set(uid, request);
  try {
    const result = await request;
    const isStillCurrent =
      profileRequestGenerations.get(uid) === requestGeneration &&
      globalProfileCacheGeneration === requestGlobalGeneration;
    if (!isStillCurrent) return result;
    if (result) {
      profileCache.set(uid, result);
    } else {
      profileCache.delete(uid);
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
  clearLegacyStoredProfile(uid);
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
