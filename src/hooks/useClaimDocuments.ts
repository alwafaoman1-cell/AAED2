// قائمة المستندات المولّدة لمطالبة معينة (مأخوذة من claim_audit_logs حيث action='document_generated')
import { useQuery } from "@tanstack/react-query";
import type { ClaimDocCategory } from "@/lib/uploadHtmlAsPdf";
import { queryKeys } from "@/lib/queryKeys";
import { getClaimMedia } from "@/lib/insurance/claimMediaService";

export interface ClaimGeneratedDoc {
  id: string;
  category: ClaimDocCategory;
  file_path: string;
  url: string;
  file_name: string;
  created_at: string;
}

export function useClaimDocuments(claimId?: string) {
  return useQuery<ClaimGeneratedDoc[]>({
    queryKey: queryKeys.claimDocuments(claimId),
    enabled: !!claimId,
    queryFn: async () => {
      const rows = await getClaimMedia(claimId);
      return rows.filter((row) => row.media_type === "document").map((row) => ({
        id: row.id,
        category: (row.category || "claim_summary") as ClaimDocCategory,
        file_path: row.storage_path || "",
        url: row.url || row.public_url || "",
        file_name: row.file_name || row.storage_path?.split("/").pop() || "document.html",
        created_at: row.uploaded_at,
      }));
    },
  });
}
