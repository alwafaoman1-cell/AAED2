// مستندات المطالبة، المرفوعة والمولّدة، من مصدر vehicle_media الموحد.
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { getClaimMedia, type ClaimMediaRecord } from "@/lib/insurance/claimMediaService";

export interface ClaimGeneratedDoc {
  id: string;
  category: string;
  file_path: string;
  storage_bucket: string;
  url: string;
  file_name: string;
  mime_type: string | null;
  source: string | null;
  created_at: string;
}

export function useClaimDocuments(claimId?: string) {
  return useQuery<ClaimMediaRecord[], Error, ClaimGeneratedDoc[]>({
    // The claim detail also reads these rows. Share its in-flight request and cache.
    queryKey: queryKeys.claimMedia.list(claimId),
    enabled: !!claimId,
    queryFn: () => getClaimMedia(claimId),
    select: (rows) => {
      const documents = rows.filter((row) => row.media_type === "document").map((row) => ({
        id: row.id,
        category: row.category || "other",
        file_path: row.storage_path || "",
        storage_bucket: row.storage_bucket || "insurance-docs",
        url: row.url || row.public_url || "",
        file_name: row.file_name || row.storage_path?.split("/").pop() || "document.html",
        mime_type: row.mime_type,
        source: (row as ClaimMediaRecord & { source?: string | null }).source || null,
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
