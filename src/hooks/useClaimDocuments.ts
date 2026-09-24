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
      const documents = rows.filter((row) => row.media_type === "document").map((row) => ({
        id: row.id,
        category: (row.category || "claim_summary") as ClaimDocCategory,
        file_path: row.storage_path || "",
        url: row.url || row.public_url || "",
        file_name: row.file_name || row.storage_path?.split("/").pop() || "document.html",
        created_at: row.uploaded_at,
      }));

      // Historical estimate objects are preserved for audit, but the normal
      // claim UI exposes only the newest/canonical estimate to avoid duplicate
      // attachments and accidental re-sending of an obsolete revision.
      let estimateSeen = false;
      return documents
        .sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""))
        .filter((document) => {
          if (document.category !== "claim_estimate") return true;
          if (estimateSeen) return false;
          estimateSeen = true;
          return true;
        });
    },
  });
}
