import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ensureCustomerPortalToken, readCustomerPortalToken } from "@/lib/customerPortalTokens";

/** Two customer-link panels observe one confirmed, tenant-scoped cloud read. */
export function useWorkOrderPortalToken(jobOrderId: string) {
  const {profile}=useAuth();const tenantId=profile?.tenant_id;const client=useQueryClient();
  const queryKey=["customer_portal_tokens",tenantId,jobOrderId];
  const query=useQuery({queryKey,enabled:!!tenantId&&!!jobOrderId,queryFn:()=>readCustomerPortalToken(jobOrderId,tenantId!),staleTime:15_000,refetchOnWindowFocus:false,retry:false});
  const create=useMutation({
    mutationFn:async()=>{if(!tenantId)throw new Error("TENANT_NOT_FOUND");const row=await ensureCustomerPortalToken(jobOrderId);if(!row?.token)throw new Error("CUSTOMER_PORTAL_TOKEN_NOT_CONFIRMED");return row;},
    onMutate:()=>client.cancelQueries({queryKey,exact:true}),
    onSuccess:row=>client.setQueryData(queryKey,row),
  });
  return { ...query, ensure:create.mutateAsync, creating:create.isPending };
}
