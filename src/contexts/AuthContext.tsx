import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setCachedTenantId } from "@/lib/cloud/createCloudStore";
import { clearCloudSettingsCache, setCloudSettingsTenantScope } from "@/lib/cloudSettings";
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
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUserIdRef = useRef<string | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  const sessionGenerationRef = useRef(0);

  function applyProfile(p: UserProfile | null) {
    profileRef.current = p;
    setProfile(p);
    if (p?.tenant_id) {
      setCachedTenantId(p.tenant_id);
      setCloudSettingsTenantScope(p.tenant_id);
    }
    setPermissionsRole((p?.role as any) ?? null);
    // Do not start company-settings reads on logout or before tenant resolution.
    if (p?.tenant_id) {
      import("@/lib/pdfGenerator").then((m) => m.loadTemplateSettingsFromCloud()).catch(() => {});
    }
  }

  function isCurrentAuthRequest(uid: string, generation: number, activeRef: () => boolean) {
    return activeRef() && currentUserIdRef.current === uid && sessionGenerationRef.current === generation;
  }

  function loadProfileWithLateApply(
    uid: string,
    generation: number,
    activeRef: () => boolean,
    options: { forceRefresh?: boolean; session?: Session | null } = {},
  ) {
    const profilePromise = (async () => {
      const first = await getCachedAuthProfile(uid, options);
      if (first) return first;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      if (!isCurrentAuthRequest(uid, generation, activeRef)) return null;
      return getCachedAuthProfile(uid, { forceRefresh: true, session: options.session });
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
    let initialSessionReceived = false;

    const handleAuthState = (_event: string, sess: Session | null) => {
      if (_event === "INITIAL_SESSION" && initialSessionReceived) return;
      initialSessionReceived = true;
      const nextUser = sess?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const previousUserId = currentUserIdRef.current;
      const sameUser = !!nextUserId && currentUserIdRef.current === nextUserId;
      const shouldRefreshProfile = _event === "USER_UPDATED" || (_event === "SIGNED_IN" && !sameUser);
      const generation = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = generation;

      setSession(sess);
      setUser(nextUser);
      currentUserIdRef.current = nextUserId;
      if (previousUserId && previousUserId !== nextUserId) {
        // Tenant-scoped query results must not survive a logout or user switch.
        queryClient.clear();
        clearCachedAuthProfile(previousUserId);
        clearCloudSettingsCache();
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
        setLoading(true);
        setTimeout(() => {
          void loadProfileWithLateApply(nextUser.id, generation, () => active, { forceRefresh: shouldRefreshProfile, session: sess })
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
        clearCloudSettingsCache();
        applyProfile(null);
        setCachedTenantId(null);
        setLoading(false);
      }
    };

    // Supabase emits INITIAL_SESSION after registration. A parallel getSession
    // caused a second profile load and could race a later SIGNED_OUT event.
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => handleAuthState(event, sess));
    const bootFallback = setTimeout(() => {
      if (!active || initialSessionReceived) return;
      void withTimeout(supabase.auth.getSession(), AUTH_BOOT_TIMEOUT_MS, "auth session timeout")
        .then(({ data }) => {
          if (active && !initialSessionReceived) handleAuthState("INITIAL_SESSION", data.session);
        })
        .catch((error) => {
          console.warn("[auth] initial session delayed", error);
          if (active && !initialSessionReceived) setLoading(false);
        });
    }, AUTH_BOOT_TIMEOUT_MS);

    return () => {
      active = false;
      clearTimeout(bootFallback);
      sessionGenerationRef.current += 1;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  async function signIn(email: string, password: string) {
    sessionGenerationRef.current += 1;
    clearAllAuthProfileCache();
    clearCloudSettingsCache();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }

  async function signOut() {
    sessionGenerationRef.current += 1;
    await supabase.auth.signOut();
    clearAllAuthProfileCache();
    clearCloudSettingsCache();
    setCachedTenantId(null);
    applyProfile(null);
  }

  async function refreshProfile() {
    if (user) {
      const generation = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = generation;
      const nextProfile = await withTimeout(
        getCachedAuthProfile(user.id, { forceRefresh: true, session }),
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
