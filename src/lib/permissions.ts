// Server-backed role check.
// Roles are sourced from the authenticated profile (Supabase) and cached in a
// module-level variable. The AuthContext keeps it fresh via setCurrentRole on
// session changes. localStorage is no longer trusted as the source of truth.
//
// Higher-level module/action checks live in `@/lib/rbac` and use the same role.
// The helpers below delegate to that matrix so a single source of truth wins.

import { supabase } from "@/integrations/supabase/client";
import { can as rbacCan, type RbacRole } from "@/lib/rbac";

export type Role = "admin" | "manager" | "supervisor" | "technician" | "insurance" | "customer";


let currentRole: Role | null = null;

/** Called by AuthContext whenever the profile is loaded/refreshed. */
export function setCurrentRole(role: Role | null) {
  currentRole = role;
}

export function getCurrentRole(): Role {
  // Default to least-privileged role if unknown so the UI hides admin-only actions.
  return currentRole ?? "technician";
}

/** Best-effort hydrate from the active session (used on first load before AuthContext mounts). */
export async function hydrateRoleFromSession(): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (profile?.role) currentRole = profile.role as Role;
  } catch {
    /* ignore */
  }
}

export function isAdminOrManager(): boolean {
  const r = getCurrentRole();
  return r === "admin" || r === "manager";
}

export function canDelete(): boolean {
  return isAdminOrManager();
}

export function canEdit(): boolean {
  return isAdminOrManager();
}

export function canAccessTrash(): boolean {
  return getCurrentRole() === "admin";
}

export function canManageFinance(): boolean {
  return isAdminOrManager();
}

export function canViewAuditLog(): boolean {
  return isAdminOrManager();
}

// -----------------------------------------------------------------
// Module-aware helpers (RBAC matrix). Use these for fine-grained checks.
// -----------------------------------------------------------------

function roleForRbac(): RbacRole {
  const r = getCurrentRole();
  // customer role isn't in the RBAC matrix; treat as least-privileged.
  return (r === "customer" ? "technician" : r) as RbacRole;
}

export function canRecordInsurancePayment(): boolean {
  return rbacCan(roleForRbac(), "Insurance Payments", "Record payment");
}

export function canDeleteInsuranceClaim(): boolean {
  return rbacCan(roleForRbac(), "Insurance/Claims", "Delete");
}

export function canEditAccountingEntry(): boolean {
  return rbacCan(roleForRbac(), "Accounting", "Edit/Reverse entry");
}

