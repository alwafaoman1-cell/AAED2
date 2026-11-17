import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export interface ReviewVisitContext {
  review_findings?: string | null;
  source_entry_id: string; source_entry_number: string;
  source_handover_id: string; source_handover_number: string;
  source_claim_id: string | null; source_claim_number: string | null;
  source_work_order_id: string | null; source_work_order_number: string | null;
}
export function isVehicleReviewVisit(entry: any): boolean {
  return Boolean(entry?.vehicle_condition?.review_return?.source_handover_id);
}
export async function getReviewVisitContext(entryId: string): Promise<ReviewVisitContext | null> {
  const { data, error } = await supabase.rpc("vehicle_review_visit_context" as any, { p_entry_id: entryId } as any);
  if (error) throw error;
  return data as unknown as ReviewVisitContext | null;
}
/** Quick visit details omit attachments, so confirm the exact current revision separately. */
export async function getReviewVisitIntakeSignatureState(entryId: string): Promise<{ revision: number; signed: boolean } | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;
  const entry = await supabase.from("vehicle_entries" as any).select("intake_revision")
    .eq("tenant_id", tenantId).eq("id", entryId).is("deleted_at", null).maybeSingle();
  if (entry.error) throw entry.error;
  const revision = (entry.data as any)?.intake_revision;
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  const signature = await supabase.from("vehicle_entry_signatures" as any).select("id")
    .eq("tenant_id", tenantId).eq("vehicle_entry_id", entryId)
    .eq("signature_role", "delivered_by").eq("intake_revision", revision).limit(1).maybeSingle();
  if (signature.error) throw signature.error;
  return { revision, signed: Boolean((signature.data as any)?.id) };
}
export async function deliverReviewVisit(input: { entryId: string; requestId: string; receiptId: string; recipient: string; signature: string; notes: string; occurredAt?: string }) {
  if (input.occurredAt !== undefined && (!Number.isFinite(Date.parse(input.occurredAt)) || Date.parse(input.occurredAt) > Date.now() + 300_000)) {
    throw new Error("REVIEW_RETURN_TIME_INVALID");
  }
  const { data, error } = await supabase.rpc("deliver_vehicle_review_visit" as any, {
    p_entry_id: input.entryId, p_request_id: input.requestId, p_receipt_id: input.receiptId,
    p_recipient: input.recipient.trim(), p_signature: input.signature, p_notes: input.notes.trim(),
    ...(input.occurredAt !== undefined ? { p_occurred_at: input.occurredAt } : {}),
  } as any);
  if (error) throw error;
  const row = data as unknown as { id: string; vehicle_entry_id: string; status: string; delivered_at?: string };
  if (!row?.id || row.vehicle_entry_id !== input.entryId || row.status !== "finalized") throw new Error("REVIEW_RETURN_SAVE_NOT_CONFIRMED");
  if (input.occurredAt !== undefined && (!row.delivered_at || Date.parse(row.delivered_at) !== Date.parse(input.occurredAt))) throw new Error("REVIEW_RETURN_SAVE_NOT_CONFIRMED");
  return row;
}
