// قائمة المستندات المولّدة لمطالبة معينة (مأخوذة من claim_audit_logs حيث action='document_generated')
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClaimDocCategory } from "@/lib/uploadHtmlAsPdf";
import { refreshSignedUrls } from "@/lib/refreshSignedUrls";
import { queryKeys } from "@/lib/queryKeys";

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
      const { data, error } = await supabase
        .from("claim_audit_logs")
        .select("id, category, file_path, details, created_at")
        .eq("claim_id", claimId!)
        .eq("action", "document_generated")
        .order("created_at", { ascending: false });

      if (error) throw error;
      const rows = data || [];
      const fresh = await refreshSignedUrls(
        "insurance-docs",
        rows.map((r: any) => r.file_path).filter(Boolean),
      );
      return rows.map((r: any) => ({
        id: r.id,
        category: (r.category || "claim_summary") as ClaimDocCategory,
        file_path: r.file_path || "",
        url: fresh.get(r.file_path) || r.details?.url || "",
        file_name: r.details?.file_name || r.file_path?.split("/").pop() || "document.html",
        created_at: r.created_at,
      }));
    },
  });
}
