import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { postInsurancePayment, removeInsurancePaymentJournal } from "@/lib/insuranceAccounting";
import { queryKeys } from "@/lib/queryKeys";

export type PaymentMethod = "bank_transfer" | "cheque" | "offset" | "cash";
export type PaymentStatus = "pending" | "cleared" | "bounced";

export interface ClaimPayment {
  id: string;
  tenant_id: string;
  claim_id: string;
  insurance_company_id: string | null;
  payment_number: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
  reference_number: string | null;
  bank_name: string | null;
  cheque_due_date: string | null;
  offset_against_invoice_id: string | null;
  status: PaymentStatus;
  notes: string | null;
  settlement_discount_amount?: number;
  settlement_discount_reason?: string | null;
  settlement_approved_by?: string | null;
  edit_version: number;
  created_at: string;
  updated_at: string;
  // joined
  claim?: {
    claim_number: string;
    insurance_company: string;
    estimated_amount: number;
    approved_amount: number;
  };
}

export interface ClaimPaymentInsert {
  tenant_id: string;
  claim_id: string;
  insurance_company_id?: string | null;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
  reference_number?: string | null;
  bank_name?: string | null;
  cheque_due_date?: string | null;
  offset_against_invoice_id?: string | null;
  status?: PaymentStatus;
  notes?: string | null;
  settlement_discount_amount?: number;
  settlement_discount_reason?: string | null;
}

function throwClaimPaymentError(error: any): never {
  const message = String(error?.message || "");
  if (message.includes("INSURANCE_INVOICE_ALREADY_SETTLED")) throw new Error("الفاتورة مسددة بالكامل بالفعل");
  if (message.includes("PAYMENT_EXCEEDS_REMAINING")) throw new Error("مجموع الدفعة والخصم يتجاوز الرصيد المتبقي");
  if (message.includes("SETTLEMENT_DISCOUNT_MUST_CLOSE_INVOICE")) throw new Error("خصم التسوية يجب أن يغلق كامل الرصيد المتبقي");
  if (message.includes("SETTLEMENT_DISCOUNT_APPROVAL_REQUIRED")) throw new Error("خصم التسوية يحتاج اعتماد مدير");
  if (message.includes("SETTLEMENT_DISCOUNT_REASON_REQUIRED")) throw new Error("سبب خصم التسوية إلزامي");
  if (message.includes("PAYMENT_EDIT_MANAGER_REQUIRED")) throw new Error("تعديل الدفعة متاح للمدير فقط");
  if (message.includes("PAYMENT_EDIT_REASON_REQUIRED")) throw new Error("سبب تعديل الدفعة إلزامي");
  if (message.includes("PAYMENT_CHANGED_BY_ANOTHER_USER")) throw new Error("تم تعديل هذه الدفعة من مستخدم آخر. أغلق النافذة وحدّث الصفحة ثم راجع القيم الجديدة");
  if (message.includes("INSURANCE_PAYMENT_NOT_FOUND")) throw new Error("الدفعة غير موجودة أو لم تعد متاحة");
  if (message.includes("PAYMENT_EXCEEDS_INVOICE_TOTAL")) throw new Error("القيمة المعدلة تتجاوز إجمالي الفاتورة بعد احتساب الدفعات الأخرى");
  if (message.includes("SETTLEMENT_DISCOUNT_REQUIRES_CLEARED_NON_CHEQUE")) throw new Error("خصم التسوية يتطلب دفعة محصلة وليست شيكًا");
  throw error;
}

/** كل دفعات المؤسسة */
export function useClaimPayments() {
  return useQuery({
    queryKey: queryKeys.claimPayments.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_payments" as any)
        .select(`*, claim:insurance_claims(claim_number, insurance_company, estimated_amount, approved_amount)`)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as unknown as ClaimPayment[];
    },
  });
}

/** دفعات مطالبة معينة */
export function usePaymentsByClaim(claimId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.claimPayments.byClaim(claimId),
    enabled: !!claimId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_payments" as any)
        .select("*")
        .eq("claim_id", claimId!)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as unknown as ClaimPayment[];
    },
  });
}

/** دفعات شركة تأمين معينة */
export function usePaymentsByCompany(companyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.claimPayments.byCompany(companyId),
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_payments" as any)
        .select(`*, claim:insurance_claims(claim_number, insurance_company, estimated_amount, approved_amount)`)
        .eq("insurance_company_id", companyId!)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as unknown as ClaimPayment[];
    },
  });
}

async function fetchClaimMeta(claimId: string) {
  const { data } = await supabase
    .from("insurance_claims" as any)
    .select("claim_number, insurance_company")
    .eq("id", claimId)
    .maybeSingle();
  return {
    claim_number: (data as any)?.claim_number ?? "—",
    insurance_company: (data as any)?.insurance_company ?? "شركة التأمين",
  };
}

export function useCreateClaimPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payment: ClaimPaymentInsert) => {
      const { data, error } = await (supabase.rpc as any)("create_insurance_payment_with_settlement", {
        p_claim_id: payment.claim_id,
        p_amount: payment.amount,
        p_payment_method: payment.payment_method,
        p_payment_date: payment.payment_date,
        p_invoice_id: payment.offset_against_invoice_id || null,
        p_insurance_company_id: payment.insurance_company_id || null,
        p_reference_number: payment.reference_number || null,
        p_bank_name: payment.bank_name || null,
        p_cheque_due_date: payment.cheque_due_date || null,
        p_status: payment.status || "cleared",
        p_notes: payment.notes || null,
        p_settlement_discount_amount: payment.settlement_discount_amount || 0,
        p_settlement_discount_reason: payment.settlement_discount_reason || null,
        p_payment_id: crypto.randomUUID(),
      });
      if (error) throwClaimPaymentError(error);
      const created = (Array.isArray(data) ? data[0] : data) as unknown as ClaimPayment;
      // قيد محاسبي تلقائي
      try {
        const meta = await fetchClaimMeta(created.claim_id);
        postInsurancePayment({
          paymentId: created.id,
          paymentNumber: created.payment_number,
          claimNumber: meta.claim_number,
          date: created.payment_date,
          amount: Number(created.amount),
          settlementDiscount: Number(created.settlement_discount_amount || 0),
          settlementReason: created.settlement_discount_reason,
          method: created.payment_method,
          status: created.status,
          companyName: meta.insurance_company,
          reference: created.reference_number,
        });
      } catch (e) { console.warn("journal post failed", e); }
      return created;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.byClaim(vars.claim_id) });
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.byCompany() });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimActiveInvoice() });
      qc.invalidateQueries({ queryKey: queryKeys.unifiedRevenueInsuranceInvoices });
      qc.invalidateQueries({ queryKey: queryKeys.monthlyVehicleProfitability.all });
      toast.success("تم تسجيل الدفعة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateClaimPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      payment,
      updates,
      editReason,
    }: {
      payment: ClaimPayment;
      updates: Partial<ClaimPaymentInsert>;
      editReason: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)("update_insurance_payment_by_manager", {
        p_payment_id: payment.id,
        p_expected_updated_at: payment.updated_at,
        p_expected_edit_version: payment.edit_version,
        p_amount: updates.amount ?? payment.amount,
        p_payment_method: updates.payment_method ?? payment.payment_method,
        p_payment_date: updates.payment_date ?? payment.payment_date,
        p_reference_number: updates.reference_number ?? payment.reference_number,
        p_bank_name: updates.bank_name ?? payment.bank_name,
        p_cheque_due_date: updates.cheque_due_date ?? payment.cheque_due_date,
        p_status: updates.status ?? payment.status,
        p_notes: updates.notes ?? payment.notes,
        p_settlement_discount_amount: updates.settlement_discount_amount ?? payment.settlement_discount_amount ?? 0,
        p_settlement_discount_reason: updates.settlement_discount_reason ?? payment.settlement_discount_reason,
        p_edit_reason: editReason,
      });
      if (error) throwClaimPaymentError(error);
      const updated = (Array.isArray(data) ? data[0] : data) as unknown as ClaimPayment;
      try {
        const meta = await fetchClaimMeta(updated.claim_id);
        postInsurancePayment({
          paymentId: updated.id,
          paymentNumber: updated.payment_number,
          claimNumber: meta.claim_number,
          date: updated.payment_date,
          amount: Number(updated.amount),
          settlementDiscount: Number(updated.settlement_discount_amount || 0),
          settlementReason: updated.settlement_discount_reason,
          method: updated.payment_method,
          status: updated.status,
          companyName: meta.insurance_company,
          reference: updated.reference_number,
        });
      } catch (e) { console.warn("journal post failed", e); }
      return updated;
    },
    onSuccess: (payment) => {
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.byClaim(payment.claim_id) });
      if (payment.insurance_company_id) {
        qc.invalidateQueries({ queryKey: queryKeys.claimPayments.byCompany(payment.insurance_company_id) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimActiveInvoice() });
      qc.invalidateQueries({ queryKey: queryKeys.unifiedRevenueInsuranceInvoices });
      qc.invalidateQueries({ queryKey: queryKeys.monthlyVehicleProfitability.all });
      qc.invalidateQueries({ queryKey: queryKeys.reportCenter.all });
      qc.invalidateQueries({ queryKey: queryKeys.reports.all });
      toast.success("تم حفظ التعديلات");
    },
    onError: (e: any) => toast.error(e?.message || "تعذر تعديل الدفعة"),
  });
}

/** تحصيل شيك قائم دون إنشاء دفعة ثانية. */
export function useClearClaimCheque() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, clearedDate }: { id: string; clearedDate: string }) => {
      const { data: currentData, error: currentError } = await supabase
        .from("claim_payments" as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (currentError) throw currentError;

      const current = currentData as unknown as ClaimPayment | null;
      if (!current) throw new Error("سند الشيك غير موجود أو لم يعد متاحًا");
      if (current.payment_method !== "cheque") throw new Error("هذه الدفعة ليست شيكًا");
      if (current.status === "bounced") throw new Error("الشيك مرتجع ولا يمكن تحصيله قبل تصحيح حالته");
      if (current.status === "cleared") return current;
      if (current.reference_number?.startsWith("LEGACY-PAID:")) {
        throw new Error("هذا سجل تسوية قديم وليس شيكًا فعليًا قابلًا للتحصيل");
      }

      const { data, error } = await supabase
        .from("claim_payments" as any)
        .update({ status: "cleared", payment_date: clearedDate } as any)
        .eq("id", id)
        .eq("payment_method", "cheque")
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("تغيرت حالة الشيك في جلسة أخرى؛ حدّث الصفحة وتحقق من السند");

      const cleared = data as unknown as ClaimPayment;
      try {
        const meta = await fetchClaimMeta(cleared.claim_id);
        postInsurancePayment({
          paymentId: cleared.id,
          paymentNumber: cleared.payment_number,
          claimNumber: meta.claim_number,
          date: cleared.payment_date,
          amount: Number(cleared.amount),
          settlementDiscount: Number(cleared.settlement_discount_amount || 0),
          settlementReason: cleared.settlement_discount_reason,
          method: cleared.payment_method,
          status: cleared.status,
          companyName: meta.insurance_company,
          reference: cleared.reference_number,
        });
      } catch (e) { console.warn("journal post failed", e); }
      return cleared;
    },
    onSuccess: (payment) => {
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.byClaim(payment.claim_id) });
      if (payment.insurance_company_id) {
        qc.invalidateQueries({ queryKey: queryKeys.claimPayments.byCompany(payment.insurance_company_id) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimActiveInvoice() });
      qc.invalidateQueries({ queryKey: queryKeys.unifiedRevenueInsuranceInvoices });
      qc.invalidateQueries({ queryKey: queryKeys.monthlyVehicleProfitability.all });
      qc.invalidateQueries({ queryKey: queryKeys.reportCenter.all });
      qc.invalidateQueries({ queryKey: queryKeys.reports.all });
      toast.success("تم تحصيل الشيك وتحديث الفاتورة");
    },
    onError: (e: any) => toast.error(e?.message || "تعذر تحصيل الشيك"),
  });
}

export function useDeleteClaimPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("claim_payments" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
      removeInsurancePaymentJournal(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimActiveInvoice() });
      qc.invalidateQueries({ queryKey: queryKeys.unifiedRevenueInsuranceInvoices });
      qc.invalidateQueries({ queryKey: queryKeys.monthlyVehicleProfitability.all });
      toast.success("تم حذف الدفعة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// Helpers / labels
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "تحويل بنكي",
  cheque: "شيك",
  offset: "تسوية مقاصة",
  cash: "نقدي",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "معلق",
  cleared: "محصل",
  bounced: "مرتجع",
};
