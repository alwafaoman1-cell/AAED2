export interface VehicleEntryClaimIdentity {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  insurance_claim_id?: string | null;
  converted_claim_id?: string | null;
  insurance_snapshot?: { claim_number?: string | null } | null;
}

export interface LinkedClaimIdentity {
  id: string;
  tenant_id: string;
  claim_number: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  vehicle_entry_id: string | null;
  deleted_at: string | null;
}

export function assertVehicleEntryClaimLink(entry: VehicleEntryClaimIdentity, claim: LinkedClaimIdentity): void {
  if (entry.insurance_claim_id && entry.converted_claim_id && entry.insurance_claim_id !== entry.converted_claim_id) {
    throw new Error("نموذج الدخول مرتبط بمطالبتين مختلفتين. راجع الربط قبل المتابعة.");
  }
  if (claim.deleted_at || claim.tenant_id !== entry.tenant_id) {
    throw new Error("المطالبة المرتبطة غير متاحة لهذه الورشة. لم يتم تغيير أي بيانات.");
  }
  if (!entry.vehicle_id || !claim.vehicle_id || claim.vehicle_id !== entry.vehicle_id) {
    throw new Error("رقم المطالبة مرتبط بمركبة أخرى. صحّح رقم المطالبة في نموذج الدخول قبل إنشاء مطالبة جديدة.");
  }
  if (!entry.customer_id || !claim.customer_id || claim.customer_id !== entry.customer_id) {
    throw new Error("رقم المطالبة مرتبط بعميل آخر. راجع بيانات العميل ورقم المطالبة قبل المتابعة.");
  }
  if (claim.vehicle_entry_id && claim.vehicle_entry_id !== entry.id) {
    throw new Error("رقم المطالبة مرتبط بنموذج دخول آخر. لم يتم ربط أو إنشاء مطالبة جديدة.");
  }
  const enteredNumber = String(entry.insurance_snapshot?.claim_number || "").trim();
  if (enteredNumber && enteredNumber !== String(claim.claim_number || "").trim()) {
    throw new Error("رقم المطالبة في نموذج الدخول لا يطابق المطالبة المرتبطة. راجع الرقم قبل المتابعة.");
  }
}
