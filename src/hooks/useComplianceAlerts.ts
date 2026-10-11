import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  complianceCutoff, fetchCompanyComplianceAlerts, fetchHrComplianceEntries,
  todayLocal, type ComplianceAlert,
} from "@/lib/compliance/complianceService";

export function useComplianceAlerts(tenantId?: string | null, enabled = true) {
  const today = todayLocal();
  const company = useQuery({
    queryKey: queryKeys.compliance.companyAlerts(tenantId),
    queryFn: () => fetchCompanyComplianceAlerts(tenantId!, todayLocal()),
    enabled: enabled && !!tenantId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const hr = useQuery({
    queryKey: queryKeys.compliance.hrEntries(tenantId),
    queryFn: () => fetchHrComplianceEntries(tenantId!),
    enabled: enabled && !!tenantId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const hrUpcoming = (hr.data || []).filter((item) => item.expiresOn <= complianceCutoff(today));
  const alerts: ComplianceAlert[] = [...(company.data?.rows || []), ...hrUpcoming]
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  return {
    alerts,
    total: (company.data?.total || 0) + hrUpcoming.length,
    isLoading: company.isLoading || hr.isLoading,
    isError: company.isError || hr.isError,
  };
}
