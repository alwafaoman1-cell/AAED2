import type {ReactNode} from "react";
import {Navigate} from "react-router-dom";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "@/contexts/AuthContext";
import {hasAccountingPermission} from "@/lib/accounting/accountingAdministrationService";
import {isAccountingReportsFeatureEnabled} from "@/lib/accounting/accountingReportsAvailability";

export default function AccountingReportsRouteGuard({children,permission="accounting_reports.view"}:{children:ReactNode;permission?:string}){
  const {profile}=useAuth(); const enabled=isAccountingReportsFeatureEnabled();
  const roleAllowed=profile?.role==="admin"||profile?.role==="accountant";
  const query=useQuery({queryKey:["accounting-report-permission",profile?.id,permission],queryFn:()=>hasAccountingPermission(permission),enabled:enabled&&roleAllowed&&Boolean(profile?.tenant_id),staleTime:60_000,refetchOnWindowFocus:false});
  if(!enabled) return <Navigate to="/accounting" replace/>;
  if(!roleAllowed) return <Navigate to="/" replace/>;
  if(query.isLoading) return <div className="p-8 text-center">Checking report permission…</div>;
  if(query.isError||!query.data) return <Navigate to="/accounting" replace/>;
  return <>{children}</>;
}
