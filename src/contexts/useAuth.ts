import { useContext } from "react";
import { AuthContext } from "@/contexts/authContextState";

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be inside <AuthProvider>");
  return context;
}
