import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setCachedTenantId } from "@/lib/cloud/createCloudStore";
import { setCurrentRole as setPermissionsRole } from "@/lib/permissions";

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

interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (...roles: AppRole[]) => boolean;
}

const AuthContext = createContext<AuthCtx | undefined>(undefined);

const AUTH_BOOT_TIMEOUT_MS = 8_000;
const PROFILE_TIMEOUT_MS = 35_000;
const PROFILE_QUERY_TIMEOUT_MS = 20_000;
const PROFILE_STORAGE_PREFIX = "alwafa.auth.profile.";
const PROFILE_STORAGE_TTL_MS = 12 * 60 * 60_000;
const profileCache = new Map<string, UserProfile | null>();
const inFlightProfileRequests = new Map<string, Promise<UserProfile | null>>();

type StoredUserProfile = {
  cached_at: number;
  profile: UserProfile;
};

function profileStorageKey(uid: string) {
  return `${PROFILE_STORAGE_PREFIX}${uid}`;
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

function clearStoredProfiles() {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(PROFILE_STORAGE_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage cleanup failures.
  }
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUserIdRef = useRef<string | null>(null);
  const profileRef = useRef<UserProfile | null>(null);

  async function fetchProfile(uid: string): Promise<UserProfile | null> {
    if (profileCache.has(uid)) return profileCache.get(uid) ?? null;
    const stored = readStoredProfile(uid);
    if (stored) {
      profileCache.set(uid, stored);
      setCachedTenantId(stored.tenant_id);
      return stored;
    }
    const inFlight = inFlightProfileRequests.get(uid);
    if (inFlight) return inFlight;

    const request = (async (): Promise<UserProfile | null> => {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle(),
        PROFILE_QUERY_TIMEOUT_MS,
        "profile query timeout",
      );
      if (!error) return (data as UserProfile) || null;
      console.warn("[auth] profile SDK query failed", error);
    } catch (error) {
      console.warn("[auth] profile SDK query delayed or failed", error);
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!accessToken || !supabaseUrl || !anonKey) return null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROFILE_QUERY_TIMEOUT_MS);
      const response = await fetch(
        `${supabaseUrl}/rest/v1/profiles?select=*&user_id=eq.${encodeURIComponent(uid)}&limit=1`,
        {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        },
      ).finally(() => clearTimeout(timer));
      if (!response.ok) {
        console.warn("[auth] profile REST query failed", response.status);
        return null;
      }
      const rows = await response.json();
      return (Array.isArray(rows) ? rows[0] : null) as UserProfile | null;
    } catch (error) {
      console.warn("[auth] profile REST query delayed or failed", error);
      return null;
    }
    })();

    inFlightProfileRequests.set(uid, request);
    try {
      const result = await request;
      if (result) {
        profileCache.set(uid, result);
        writeStoredProfile(uid, result);
        setCachedTenantId(result.tenant_id);
      } else {
        profileCache.delete(uid);
        writeStoredProfile(uid, null);
      }
      return result;
    } finally {
      inFlightProfileRequests.delete(uid);
    }
  }

  function applyProfile(p: UserProfile | null) {
    profileRef.current = p;
    setProfile(p);
    if (p?.tenant_id) setCachedTenantId(p.tenant_id);
    setPermissionsRole((p?.role as any) ?? null);
    // Pull company/template settings from the cloud so they survive cache clears.
    import("@/lib/pdfGenerator").then((m) => m.loadTemplateSettingsFromCloud()).catch(() => {});
  }

  function loadProfileWithLateApply(uid: string, activeRef: () => boolean) {
    const profilePromise = (async () => {
      const first = await fetchProfile(uid);
      if (first) return first;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      if (!activeRef()) return null;
      return fetchProfile(uid);
    })();
    profilePromise
      .then((p) => {
        if (activeRef()) applyProfile(p);
      })
      .catch((error) => {
        console.warn("[auth] profile load failed", error);
        if (activeRef()) applyProfile(null);
      });
    return withTimeout(profilePromise, PROFILE_TIMEOUT_MS, "profile load timeout");
  }


  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      const nextUser = sess?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const sameUser = !!nextUserId && currentUserIdRef.current === nextUserId;

      setSession(sess);
      setUser(nextUser);
      currentUserIdRef.current = nextUserId;

      // Supabase can emit TOKEN_REFRESHED / SIGNED_IN again when a hidden tab
      // becomes active. The previous implementation set loading=true for every
      // auth event, which caused ProtectedRoute to unmount the current page and
      // discard unsaved form state. If the same user is already loaded, keep the
      // page mounted and only refresh the session object.
      if (sameUser && profileRef.current) {
        setLoading(false);
        return;
      }

      if (nextUser) {
        setLoading(true);
        setTimeout(() => {
          void loadProfileWithLateApply(nextUser.id, () => active)
            .catch((error) => {
              console.warn("[auth] profile load delayed or failed", error);
            })
            .finally(() => {
              if (active) setLoading(false);
            });
        }, 0);
      } else {
        currentUserIdRef.current = null;
        applyProfile(null);
        setLoading(false);
      }
    });

    void withTimeout(supabase.auth.getSession(), AUTH_BOOT_TIMEOUT_MS, "auth session timeout")
      .then(async ({ data: { session: sess } }) => {
        if (!active) return;
        setSession(sess);
        setUser(sess?.user ?? null);
        currentUserIdRef.current = sess?.user?.id ?? null;
        if (sess?.user) {
          try {
            await loadProfileWithLateApply(sess.user.id, () => active);
          } catch (error) {
            console.warn("[auth] initial profile load delayed or failed", error);
          }
        } else {
          applyProfile(null);
        }
      })
      .catch((error) => {
        console.error("[auth] initial session load failed", error);
        if (!active) return;
        setSession(null);
        setUser(null);
        applyProfile(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    profileCache.clear();
    inFlightProfileRequests.clear();
    clearStoredProfiles();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }

  async function signOut() {
    await supabase.auth.signOut();
    profileCache.clear();
    inFlightProfileRequests.clear();
    clearStoredProfiles();
    setCachedTenantId(null);
    applyProfile(null);
  }

  async function refreshProfile() {
    if (user) {
      profileCache.delete(user.id);
      writeStoredProfile(user.id, null);
      applyProfile(await withTimeout(fetchProfile(user.id), PROFILE_TIMEOUT_MS, "profile refresh timeout"));
    }
  }

  function hasRole(...roles: AppRole[]) {
    if (!profile) return false;
    return roles.includes(profile.role);
  }

  // Memoise the context value so unrelated re-renders (e.g. theme toggle, route
  // change) don't cascade through every consumer of useAuth().
  const value = useMemo<AuthCtx>(
    () => ({ session, user, profile, loading, signIn, signOut, refreshProfile, hasRole }),
    [session, user, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}


export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside <AuthProvider>");
  return ctx;
}
