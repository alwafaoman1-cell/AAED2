import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { hasAccountingPermission } from "@/lib/accounting/accountingAdministrationService";
import { isAccountingSetupFeatureEnabled } from "@/lib/accounting/accountingSetupAvailability";

export default function AccountingSetupRouteGuard({ children, permission = "accounting.view_journal" }: {
  children: ReactNode; permission?: string;
}) {
  const { profile } = useAuth();
  const enabled = isAccountingSetupFeatureEnabled();
  const roleAllowed = profile?.role === "admin" || profile?.role === "accountant";
  const permissionQuery = useQuery({
    queryKey: ["accounting-setup-permission", profile?.id, permission],
    queryFn: () => hasAccountingPermission(permission),
    enabled: enabled && roleAllowed && Boolean(profile?.tenant_id),
    staleTime: 60_000,
  });

  if (!enabled) return <Navigate to="/accounting" replace />;
  if (!roleAllowed) return <Navigate to="/" replace />;
  if (permissionQuery.isLoading) return <div className="p-8 text-center">Checking accounting permission…</div>;
  if (permissionQuery.isError || !permissionQuery.data) return <Navigate to="/accounting" replace />;
  return <>{children}</>;
}
