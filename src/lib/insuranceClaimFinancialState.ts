export interface InsuranceClaimFinancialStateLike {
  status?: string | null;
  deleted_at?: string | null;
  delivered_at?: string | null;
  vehicle_delivered_at?: string | null;
  work_completed_at?: string | null;
  work_started_at?: string | null;
  repair_stage?: string | null;
  job_order?: { status?: string | null } | null;
}

export function isInsuranceClaimFinanciallyVoided(claim: InsuranceClaimFinancialStateLike): boolean {
  return Boolean(claim.deleted_at)
    || claim.status === "cancelled"
    || claim.status === "rejected";
}

export function isInsuranceClaimReceivableEligible(
  claim: InsuranceClaimFinancialStateLike,
  hasActiveInvoice: boolean,
): boolean {
  if (isInsuranceClaimFinanciallyVoided(claim)) return false;
  return hasActiveInvoice || claim.status === "approved" || claim.status === "paid";
}

export function getInsuranceClaimOperationalStatus(claim: InsuranceClaimFinancialStateLike): string {
  if (claim.status === "cancelled" || claim.deleted_at) return "ملغاة";
  if (claim.status === "rejected") return "مرفوضة";
  if (claim.status === "paid") return "مدفوعة";

  const workOrderStatus = claim.job_order?.status;
  if (claim.delivered_at || claim.vehicle_delivered_at || workOrderStatus === "delivered") return "تم التسليم";
  if (
    claim.work_completed_at
    || claim.repair_stage === "ready"
    || claim.repair_stage === "quality_check"
    || workOrderStatus === "completed"
  ) return "مكتملة";
  if (
    claim.work_started_at
    || claim.repair_stage === "repairing"
    || claim.repair_stage === "in_progress"
    || workOrderStatus === "in_progress"
  ) return "تحت الإصلاح";
  if (claim.status === "approved") return "معتمدة";
  if (claim.status === "pending") return "بانتظار الاعتماد";
  return String(claim.status || "—");
}
