import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { postInsurancePayment, removeInsurancePaymentJournal } from "@/lib/insuranceAccounting";

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
}

/** كل دفعات المؤسسة */
export function useClaimPayments() {
  return useQuery({
    queryKey: ["claim_payments"],
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
    queryKey: ["claim_payments", "by_claim", claimId],
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
    queryKey: ["claim_payments", "by_company", companyId],
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
      const { data, error } = await supabase
        .from("claim_payments" as any)
        .insert(payment as any)
        .select()
        .single();
      if (error) throw error;
      const created = data as unknown as ClaimPayment;
      // قيد محاسبي تلقائي
      try {
        const meta = await fetchClaimMeta(created.claim_id);
        postInsurancePayment({
          paymentId: created.id,
          paymentNumber: created.payment_number,
          claimNumber: meta.claim_number,
          date: created.payment_date,
          amount: Number(created.amount),
          method: created.payment_method,
          status: created.status,
          companyName: meta.insurance_company,
          reference: created.reference_number,
        });
      } catch (e) { console.warn("journal post failed", e); }
      return created;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["claim_payments"] });
      qc.invalidateQueries({ queryKey: ["claim_payments", "by_claim", vars.claim_id] });
      qc.invalidateQueries({ queryKey: ["claim_payments", "by_company"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["insurance_invoices"] });
      qc.invalidateQueries({ queryKey: ["claim_active_invoice"] });
      qc.invalidateQueries({ queryKey: ["unified_revenue_ins_invoices"] });
      toast.success("تم تسجيل الدفعة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateClaimPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ClaimPaymentInsert> }) => {
      const { error } = await supabase
        .from("claim_payments" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
      // إعادة ترحيل القيد المحاسبي
      const { data } = await supabase
        .from("claim_payments" as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      const p = data as unknown as ClaimPayment | null;
      if (p) {
        try {
          const meta = await fetchClaimMeta(p.claim_id);
          postInsurancePayment({
            paymentId: p.id,
            paymentNumber: p.payment_number,
            claimNumber: meta.claim_number,
            date: p.payment_date,
            amount: Number(p.amount),
            method: p.payment_method,
            status: p.status,
            companyName: meta.insurance_company,
            reference: p.reference_number,
          });
        } catch (e) { console.warn("journal post failed", e); }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claim_payments"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["insurance_invoices"] });
      qc.invalidateQueries({ queryKey: ["claim_active_invoice"] });
      qc.invalidateQueries({ queryKey: ["unified_revenue_ins_invoices"] });
      toast.success("تم حفظ التعديلات");
    },
    onError: (e: any) => toast.error(e.message),
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
      qc.invalidateQueries({ queryKey: ["claim_payments"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["insurance_invoices"] });
      qc.invalidateQueries({ queryKey: ["claim_active_invoice"] });
      qc.invalidateQueries({ queryKey: ["unified_revenue_ins_invoices"] });
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
