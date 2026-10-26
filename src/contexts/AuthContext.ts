// Stable import path for existing callers; only AuthProvider.tsx exports a component.
export { AuthProvider } from "@/contexts/AuthProvider";
export { useAuth } from "@/contexts/useAuth";
export type { AppRole, UserProfile } from "@/lib/authProfileCache";
