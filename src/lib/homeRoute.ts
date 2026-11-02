import type { AppRole } from "@/contexts/AuthContext";

/** Landing route after authentication and when opening the site root. */
export function homeForRole(role?: AppRole | null): string {
  if (role === "supervisor") return "/supervisor";
  if (role === "technician") return "/technician";
  if (role === "accountant") return "/accountant";
  return "/vehicle-entry";
}
