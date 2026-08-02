import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/queryKeys";
import { fetchWorkOrderFinancials } from "@/lib/workOrderFinancials";
import type { WorkOrder } from "@/lib/workOrdersStore";

export function useWorkOrderFinancials(order?: WorkOrder | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || null;
  const identity = order?.cloudId || order?.id || null;
  return useQuery({
    queryKey: queryKeys.workOrderFinancials.detail(tenantId, identity, order?.claimId),
    enabled: !!tenantId && !!identity,
    queryFn: () => fetchWorkOrderFinancials(tenantId!, order!),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}
