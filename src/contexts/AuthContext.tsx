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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    const p = (data as UserProfile) || null;
    setProfile(p);
    setPermissionsRole((p?.role as any) ?? null);
    // Pull company/template settings from the cloud so they survive cache clears.
    import("@/lib/pdfGenerator").then((m) => m.loadTemplateSettingsFromCloud()).catch(() => {});
  }


  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user.id), 0);
      } else {
        setProfile(null);
        setPermissionsRole(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) loadProfile(sess.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setPermissionsRole(null);
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id);
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
