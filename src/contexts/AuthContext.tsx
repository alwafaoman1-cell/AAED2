import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
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
const PROFILE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(uid: string): Promise<UserProfile | null> {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    return (data as UserProfile) || null;
  }

  function applyProfile(p: UserProfile | null) {
    setProfile(p);
    setPermissionsRole((p?.role as any) ?? null);
    // Pull company/template settings from the cloud so they survive cache clears.
    import("@/lib/pdfGenerator").then((m) => m.loadTemplateSettingsFromCloud()).catch(() => {});
  }


  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => {
          void withTimeout(fetchProfile(sess.user.id), PROFILE_TIMEOUT_MS, "profile load timeout")
            .then((p) => {
              if (active) applyProfile(p);
            })
            .catch((error) => {
              console.warn("[auth] profile load delayed or failed", error);
              if (active) applyProfile(null);
            });
        }, 0);
      } else {
        applyProfile(null);
      }
    });

    void withTimeout(supabase.auth.getSession(), AUTH_BOOT_TIMEOUT_MS, "auth session timeout")
      .then(({ data: { session: sess } }) => {
        if (!active) return;
        setSession(sess);
        setUser(sess?.user ?? null);
        if (sess?.user) {
          void withTimeout(fetchProfile(sess.user.id), PROFILE_TIMEOUT_MS, "profile load timeout")
            .then((p) => {
              if (active) applyProfile(p);
            })
            .catch((error) => {
              console.warn("[auth] initial profile load delayed or failed", error);
              if (active) applyProfile(null);
            });
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }

  async function signOut() {
    await supabase.auth.signOut();
    applyProfile(null);
  }

  async function refreshProfile() {
    if (user) applyProfile(await withTimeout(fetchProfile(user.id), PROFILE_TIMEOUT_MS, "profile refresh timeout"));
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
