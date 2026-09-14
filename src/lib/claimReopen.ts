export type ReopenClaimTargetStatus = "pending" | "approved";

export interface ReopenCancelledClaimInput {
  reason: string;
  targetStatus: ReopenClaimTargetStatus;
  changedAt?: string;
}
/**
 * Builds the minimal lifecycle patch needed to reopen a cancelled claim.
 * Cancellation documents and related financial/operational records are
 * intentionally left untouched as immutable history.
 */
export function buildReopenCancelledClaimPatch(input: ReopenCancelledClaimInput) {
  const reason = String(input.reason || "").trim();
  if (!reason) throw new Error("سبب إعادة المطالبة مطلوب");
  if (input.targetStatus !== "pending" && input.targetStatus !== "approved") {
    throw new Error("حالة إعادة المطالبة غير صالحة");
  }

  const changedAt = input.changedAt || new Date().toISOString();
  return {
    status: input.targetStatus,
    rejection_reason: null,
    paid_at: null,
    approved_at: input.targetStatus === "approved" ? changedAt : null,
    updated_at: changedAt,
  } as const;
}
