import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setCachedTenantId } from "@/lib/cloud/createCloudStore";
import { setCurrentRole as setPermissionsRole } from "@/lib/permissions";
import {
  clearAllAuthProfileCache,
  clearCachedAuthProfile,
  getCachedAuthProfile,
  type AppRole,
  type UserProfile,
} from "@/lib/authProfileCache";

export type { AppRole, UserProfile } from "@/lib/authProfileCache";

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
const PROFILE_TIMEOUT_MS = 12_000;

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
  const sessionGenerationRef = useRef(0);

  async function fetchProfile(uid: string): Promise<UserProfile | null> {
    return getCachedAuthProfile(uid);
  }

  function applyProfile(p: UserProfile | null) {
    profileRef.current = p;
    setProfile(p);
    if (p?.tenant_id) setCachedTenantId(p.tenant_id);
    setPermissionsRole((p?.role as any) ?? null);
    // Pull company/template settings from the cloud so they survive cache clears.
    import("@/lib/pdfGenerator").then((m) => m.loadTemplateSettingsFromCloud()).catch(() => {});
  }

  function isCurrentAuthRequest(uid: string, generation: number, activeRef: () => boolean) {
    return activeRef() && currentUserIdRef.current === uid && sessionGenerationRef.current === generation;
  }

  function loadProfileWithLateApply(
    uid: string,
    generation: number,
    activeRef: () => boolean,
    options: { forceRefresh?: boolean } = {},
  ) {
    const profilePromise = (async () => {
      const first = options.forceRefresh ? await getCachedAuthProfile(uid, { forceRefresh: true }) : await fetchProfile(uid);
      if (first) return first;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      if (!isCurrentAuthRequest(uid, generation, activeRef)) return null;
      return getCachedAuthProfile(uid, { forceRefresh: true });
    })();
    profilePromise
      .then((p) => {
        if (isCurrentAuthRequest(uid, generation, activeRef)) applyProfile(p);
      })
      .catch((error) => {
        console.warn("[auth] profile load failed", error);
        if (isCurrentAuthRequest(uid, generation, activeRef)) applyProfile(null);
      });
    return withTimeout(profilePromise, PROFILE_TIMEOUT_MS, "profile load timeout");
  }


  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      const nextUser = sess?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const previousUserId = currentUserIdRef.current;
      const sameUser = !!nextUserId && currentUserIdRef.current === nextUserId;
      const shouldRefreshProfile = _event === "SIGNED_IN" || _event === "USER_UPDATED";
      const generation = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = generation;

      setSession(sess);
      setUser(nextUser);
      currentUserIdRef.current = nextUserId;
      if (previousUserId && previousUserId !== nextUserId) {
        clearCachedAuthProfile(previousUserId);
        applyProfile(null);
        setCachedTenantId(null);
      }

      // Supabase can emit TOKEN_REFRESHED / SIGNED_IN again when a hidden tab
      // becomes active. The previous implementation set loading=true for every
      // auth event, which caused ProtectedRoute to unmount the current page and
      // discard unsaved form state. If the same user is already loaded, keep the
      // page mounted and only refresh the session object.
      if (sameUser && profileRef.current && !shouldRefreshProfile) {
        setLoading(false);
        return;
      }

      if (nextUser) {
        if (shouldRefreshProfile) clearCachedAuthProfile(nextUser.id);
        setLoading(true);
        setTimeout(() => {
          void loadProfileWithLateApply(nextUser.id, generation, () => active, { forceRefresh: shouldRefreshProfile })
            .catch((error) => {
              console.warn("[auth] profile load delayed or failed", error);
            })
            .finally(() => {
              if (isCurrentAuthRequest(nextUser.id, generation, () => active)) setLoading(false);
            });
        }, 0);
      } else {
        sessionGenerationRef.current += 1;
        currentUserIdRef.current = null;
        clearAllAuthProfileCache();
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
          const generation = sessionGenerationRef.current + 1;
          sessionGenerationRef.current = generation;
          try {
            await loadProfileWithLateApply(sess.user.id, generation, () => active);
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
      sessionGenerationRef.current += 1;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    sessionGenerationRef.current += 1;
    clearAllAuthProfileCache();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }

  async function signOut() {
    sessionGenerationRef.current += 1;
    await supabase.auth.signOut();
    clearAllAuthProfileCache();
    setCachedTenantId(null);
    applyProfile(null);
  }

  async function refreshProfile() {
    if (user) {
      const generation = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = generation;
      clearCachedAuthProfile(user.id);
      const nextProfile = await withTimeout(
        getCachedAuthProfile(user.id, { forceRefresh: true }),
        PROFILE_TIMEOUT_MS,
        "profile refresh timeout",
      );
      if (currentUserIdRef.current === user.id && sessionGenerationRef.current === generation) applyProfile(nextProfile);
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
