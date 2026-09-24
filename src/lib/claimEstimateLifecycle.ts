import { supabase } from "@/integrations/supabase/client";

export type ClaimEstimateDocumentStatus =
  | "not_created"
  | "draft"
  | "ready"
  | "sent"
  | "modified_after_send";

export interface ClaimEstimateLifecycle {
  status: ClaimEstimateDocumentStatus;
  revision: number;
  sentRevision: number | null;
  estimateNumber: string | null;
  storagePath: string | null;
  generatedAt: string | null;
  sentAt: string | null;
  modifiedAt: string | null;
}

export const CLAIM_ESTIMATE_STATUS_META: Record<
  ClaimEstimateDocumentStatus,
  { ar: string; en: string; className: string }
> = {
  not_created: {
    ar: "غير مُنشأ",
    en: "Not created",
    className: "border-slate-300 bg-slate-50 text-slate-600",
  },
  draft: {
    ar: "مسودة",
    en: "Draft",
    className: "border-blue-300 bg-blue-50 text-blue-700",
  },
  ready: {
    ar: "جاهز للإرسال",
    en: "Ready to send",
    className: "border-cyan-300 bg-cyan-50 text-cyan-700",
  },
  sent: {
    ar: "تم الإرسال",
    en: "Sent",
    className: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  modified_after_send: {
    ar: "تم التعديل بعد الإرسال",
    en: "Modified after sending",
    className: "border-amber-300 bg-amber-50 text-amber-800",
  },
};

export function readClaimEstimateLifecycle(claim: any): ClaimEstimateLifecycle {
  const rawStatus = String(claim?.claim_estimate_document_status || "not_created");
  const status = rawStatus in CLAIM_ESTIMATE_STATUS_META
    ? rawStatus as ClaimEstimateDocumentStatus
    : "not_created";
  return {
    status,
    revision: Math.max(0, Number(claim?.claim_estimate_revision || 0)),
    sentRevision: claim?.claim_estimate_sent_revision == null
      ? null
      : Number(claim.claim_estimate_sent_revision),
    estimateNumber: claim?.claim_estimate_number || null,
    storagePath: claim?.claim_estimate_storage_path || null,
    generatedAt: claim?.claim_estimate_generated_at || null,
    sentAt: claim?.claim_estimate_sent_at || null,
    modifiedAt: claim?.claim_estimate_modified_at || null,
  };
}

export async function hashClaimEstimateContent(content: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(content);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function recordClaimEstimateDocument(input: {
  claimId: string;
  htmlContent: string;
  storagePath: string;
  estimateNumber?: string | null;
}) {
  const contentHash = await hashClaimEstimateContent(input.htmlContent);
  const { data, error } = await (supabase.rpc as any)("record_claim_estimate_document", {
    p_claim_id: input.claimId,
    p_content_hash: contentHash,
    p_storage_path: input.storagePath,
    p_estimate_number: input.estimateNumber || null,
  });
  if (error) throw error;
  return data as {
    status: ClaimEstimateDocumentStatus;
    revision: number;
    sent_revision?: number | null;
    changed: boolean;
    storage_path: string;
  };
}

export async function markClaimEstimateSent(claimId: string) {
  const { data, error } = await (supabase.rpc as any)("mark_claim_estimate_sent", {
    p_claim_id: claimId,
  });
  if (error) throw error;
  return data as { status: "sent"; revision: number; sent_revision: number; sent_at: string };
}
