import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import {
  deleteClaimMedia,
  getClaimMedia,
  updateClaimMedia,
  uploadClaimMedia,
  type ClaimMediaRecord,
  type UploadClaimMediaInput,
} from "@/lib/insurance/claimMediaService";

export function useClaimMedia(claimId?: string | null) {
  return useQuery({
    queryKey: queryKeys.claimMedia.list(claimId),
    enabled: !!claimId,
    queryFn: () => getClaimMedia(claimId),
  });
}

export function useUploadClaimMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadClaimMediaInput) => uploadClaimMedia(input),
    onSuccess: (created) => {
      qc.setQueryData<ClaimMediaRecord[] | undefined>(queryKeys.claimMedia.list(created.claim_id), (current) => {
        const list = current || [];
        if (list.some((item) => item.id === created.id)) {
          return list.map((item) => (item.id === created.id ? created : item));
        }
        return [created, ...list];
      });
      qc.setQueryData(queryKeys.claimMedia.detail(created.id), created);
      qc.invalidateQueries({ queryKey: queryKeys.claimDocuments(created.claim_id) });
      toast.success("File saved");
    },
    onError: (error: any) => toast.error(error?.message || "Could not save file"),
  });
}

export function useUpdateClaimMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; claimId: string; updates: Parameters<typeof updateClaimMedia>[1] }) =>
      updateClaimMedia(id, updates),
    onSuccess: (updated, vars) => {
      qc.setQueryData(queryKeys.claimMedia.detail(updated.id), updated);
      qc.setQueryData<ClaimMediaRecord[] | undefined>(queryKeys.claimMedia.list(vars.claimId), (current) =>
        current?.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
      qc.invalidateQueries({ queryKey: queryKeys.claimDocuments(vars.claimId) });
    },
  });
}

export function useDeleteClaimMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; claimId: string }) => deleteClaimMedia(id),
    onSuccess: (_deleted, vars) => {
      qc.setQueryData<ClaimMediaRecord[] | undefined>(queryKeys.claimMedia.list(vars.claimId), (current) =>
        current?.filter((item) => item.id !== vars.id)
      );
      qc.invalidateQueries({ queryKey: queryKeys.claimDocuments(vars.claimId) });
      toast.success("File removed from archive");
    },
    onError: (error: any) => toast.error(error?.message || "Could not remove file"),
  });
}
