import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isGeneratedColumnWriteError, sanitizeInvoiceGeneratedWritePayload } from "@/lib/supabasePayload";
import { queryKeys } from "@/lib/queryKeys";

export interface InsuranceInvoice {
  id: string;
  tenant_id: string;
  claim_id: string;
  invoice_number: string;
  insurance_company_id: string | null;
  insurance_company_name: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  subtotal: number;
  vat: number;
  total: number;
  paid_amount: number;
  status: "issued" | "partial" | "paid" | "overdue" | "cancelled";
  pdf_url: string | null;
  invoice_date: string | null;
  issued_at: string;
  last_payment_date: string | null;
  due_date: string | null;
  notes: string | null;
  lpo_number: string | null;
  items: Array<{ description: string; quantity: number; unit_price: number }>;
  created_at: string;
  updated_at: string;
}

export interface InsuranceInvoiceInsert {
  tenant_id: string;
  claim_id: string;
  insurance_company_id?: string | null;
  insurance_company_name: string;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_plate?: string | null;
  subtotal: number;
  vat: number;
  total: number;
  paid_amount?: number;
  status?: "issued" | "partial" | "paid" | "overdue" | "cancelled";
  pdf_url?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
  lpo_number?: string | null;
  items?: Array<{ description: string; quantity: number; unit_price: number }>;
  /** مفتاح إيدمبوتنسي لمنع تكرار الفاتورة عند إعادة الإرسال */
  idempotency_key?: string | null;
}


export function useInsuranceInvoices() {
  const qc = useQueryClient();

  // Realtime sync — unique channel name per hook instance to avoid
  // "cannot add postgres_changes after subscribe" when the hook mounts in multiple components.
  useEffect(() => {
    const channel = supabase
      .channel(`insurance_invoices_rt_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "insurance_invoices" },
        () => qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return useQuery({
    queryKey: queryKeys.insuranceInvoices.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_invoices" as any)
        .select("*")
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as InsuranceInvoice[];
    },
  });
}

export function useCreateInsuranceInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inv: InsuranceInvoiceInsert) => {
      // 1) إذا أُرسل idempotency_key وكان هناك فاتورة بنفس المفتاح، أرجِعها (طلب مكرر)
      if (inv.idempotency_key) {
        const { data: dup } = await supabase
          .from("insurance_invoices" as any)
          .select("*")
          .eq("tenant_id", inv.tenant_id)
          .eq("idempotency_key", inv.idempotency_key)
          .maybeSingle();
        if (dup) return dup as unknown as InsuranceInvoice;
      }

      // 2) منع تكرار فاتورة نشطة لنفس المطالبة (Single Source of Truth)
      if (inv.claim_id) {
        const { data: existing } = await supabase
          .from("insurance_invoices" as any)
          .select("id,invoice_number,status")
          .eq("claim_id", inv.claim_id)
          .neq("status", "cancelled")
          .maybeSingle();
        if (existing) {
          throw new Error(
            `يوجد فاتورة نشطة لهذه المطالبة بالفعل (#${(existing as any).invoice_number}). ألغِها أولاً قبل إصدار فاتورة جديدة.`
          );
        }
      }

      // 3) توليد idempotency_key افتراضي إذا لم يُمرَّر (يقفل التكرار حتى بدون مفتاح يدوي)
      const idem =
        inv.idempotency_key ??
        `claim:${inv.claim_id}:total:${Number(inv.total).toFixed(2)}`;

      const issuedAt = (inv as any).issued_at || new Date().toISOString();
      const payload = {
        ...inv,
        invoice_date: inv.invoice_date || String(issuedAt).slice(0, 10),
        idempotency_key: idem,
        invoice_number: "",
      };
      let { data, error } = await supabase
        .from("insurance_invoices" as any)
        .insert(payload as any)
        .select()
        .single();
      if (error && isGeneratedColumnWriteError(error)) {
        ({ data, error } = await supabase
          .from("insurance_invoices" as any)
          .insert(sanitizeInvoiceGeneratedWritePayload(payload) as any)
          .select()
          .single());
      }
      if (error) {
        // 23505 = unique_violation → أعد الفاتورة الموجودة بدل الفشل
        if ((error as any).code === "23505") {
          const { data: existing } = await supabase
            .from("insurance_invoices" as any)
            .select("*")
            .eq("tenant_id", inv.tenant_id)
            .or(`idempotency_key.eq.${idem},claim_id.eq.${inv.claim_id}`)
            .neq("status", "cancelled")
            .maybeSingle();
          if (existing) return existing as unknown as InsuranceInvoice;
        }
        throw error;
      }
      return data as unknown as InsuranceInvoice;
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
      toast.success("تم إصدار الفاتورة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateInsuranceInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<InsuranceInvoiceInsert> }) => {
      const payload = updates as any;
      let { error } = await supabase
        .from("insurance_invoices" as any)
        .update(payload)
        .eq("id", id);
      if (error && isGeneratedColumnWriteError(error)) {
        ({ error } = await supabase
          .from("insurance_invoices" as any)
          .update(sanitizeInvoiceGeneratedWritePayload(payload) as any)
          .eq("id", id));
      }
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      toast.success("تم تحديث الفاتورة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteInsuranceInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("insurance_invoices" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      toast.success("تم حذف الفاتورة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
