import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { readWorkflowRequirementPolicy, WORKFLOW_REQUIREMENT_QUERY_KEY } from "@/lib/workflowRequirements";

type Subscription = { count: number; channel: ReturnType<typeof supabase.channel> };
const subscriptions = new WeakMap<QueryClient, Map<string, Subscription>>();
let subscriptionId = 0;
function observePolicy(client: QueryClient, tenantId: string, userId: string, queryKey: readonly unknown[]) {
  let scopes = subscriptions.get(client);
  if (!scopes) { scopes = new Map(); subscriptions.set(client, scopes); }
  const scope = `${tenantId}:${userId}`;
  let subscription = scopes.get(scope);
  if (!subscription) {
    const channel = supabase.channel(`workflow-requirements:${scope}:${++subscriptionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workflow_requirement_settings", filter: `tenant_id=eq.${tenantId}` }, () => {
        void client.invalidateQueries({ queryKey, exact: true });
      }).subscribe();
    subscription = { count: 0, channel };
    scopes.set(scope, subscription);
  }
  subscription.count += 1;
  return () => {
    subscription!.count -= 1;
    if (subscription!.count === 0) {
      scopes!.delete(scope);
      void supabase.removeChannel(subscription!.channel);
    }
  };
}

/** Relaxation is visible only after a current user's tenant-scoped cloud read. */
export function useWorkflowRequirements() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || null;
  const userId = profile?.user_id || null;
  const client = useQueryClient();
  const queryKey = useMemo(() => [WORKFLOW_REQUIREMENT_QUERY_KEY, tenantId, userId], [tenantId, userId]);
  const query = useQuery({
    queryKey,
    enabled: !!tenantId && !!userId,
    queryFn: () => readWorkflowRequirementPolicy(tenantId!),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!tenantId || !userId) return;
    return observePolicy(client, tenantId, userId, queryKey);
  }, [client, queryKey, tenantId, userId]);
  const loading = !!tenantId && !!userId && (query.isPending || query.isFetching);
  const policy = !loading && !query.error && query.data?.tenant_id === tenantId && userId ? query.data : null;
  return {
    requirementsEnabled: policy?.requirements_enabled !== false,
    loading,
    error: query.error,
    policy,
    refresh: async () => { if (tenantId && userId) await query.refetch({ throwOnError: true }); },
  };
}
