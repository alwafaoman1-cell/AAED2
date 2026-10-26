import { createContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole, UserProfile } from "@/lib/authProfileCache";

export interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (...roles: AppRole[]) => boolean;
}

export const AuthContext = createContext<AuthCtx | undefined>(undefined);
