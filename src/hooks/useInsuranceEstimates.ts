import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface UplItem {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface IndependentEstimate {
  id: string;
  tenant_id: string;
  estimate_number: string;
  claim_number: string | null;
  status: "draft" | "sent" | "approved" | "converted" | "cancelled";
  customer_name: string | null;
  customer_phone: string | null;
  insurance_company: string | null;
  insurance_company_id: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  incident_date: string | null;
  incident_description: string | null;
  estimation_type: "lump_sum" | "upl";
  lump_sum_amount: number;
  upl_items: UplItem[];
  deductible_amount: number;
  damage_photos: string[];
  notes: string | null;
  terms_text: string | null;
  converted_claim_id: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useInsuranceEstimates() {
  return useQuery({
    queryKey: ["insurance_estimates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_estimates" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as IndependentEstimate[];
    },
  });
}

export function useCreateInsuranceEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<IndependentEstimate>) => {
      const { data: tenant } = await supabase.rpc("get_user_tenant_id");
      const { data, error } = await supabase
        .from("insurance_estimates" as any)
        .insert({ ...payload, tenant_id: tenant } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as IndependentEstimate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insurance_estimates"] });
      toast.success("تم حفظ التقدير");
    },
    onError: (e: any) => toast.error(e.message || "فشل الحفظ"),
  });
}

export function useUpdateInsuranceEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<IndependentEstimate> }) => {
      const { error } = await supabase
        .from("insurance_estimates" as any)
        .update(patch as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insurance_estimates"] }),
  });
}

export function useDeleteInsuranceEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("insurance_estimates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insurance_estimates"] });
      toast.success("تم الحذف");
    },
  });
}

/** Convert an independent estimate into a real insurance claim */
export function useConvertEstimateToClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (est: IndependentEstimate) => {
      const { data: tenant } = await supabase.rpc("get_user_tenant_id");
      if (!tenant) throw new Error("تعذّر التعرف على المستأجر");

      // Find or create customer
      let customerId: string | null = null;
      if (est.customer_phone || est.customer_name) {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("tenant_id", tenant as string)
          .or(
            est.customer_phone
              ? `phone.eq.${est.customer_phone}`
              : `name.eq.${est.customer_name}`,
          )
          .maybeSingle();
        if (existing) customerId = existing.id;
        else {
          const { data: nc, error: ce } = await supabase
            .from("customers")
            .insert({
              tenant_id: tenant as string,
              name: est.customer_name || "عميل تقدير",
              phone: est.customer_phone,
            })
            .select("id")
            .single();
          if (ce) throw ce;
          customerId = nc.id;
        }
      }
      if (!customerId) throw new Error("الرجاء إدخال بيانات العميل قبل التحويل");

      const subtotal =
        est.estimation_type === "upl"
          ? (est.upl_items || []).reduce(
              (s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0),
              0,
            )
          : Number(est.lump_sum_amount || 0);

      const claimNumber = `CL-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

      const { data: claim, error: claimErr } = await supabase
        .from("insurance_claims")
        .insert({
          tenant_id: tenant as string,
          customer_id: customerId,
          claim_number: claimNumber,
          insurance_company: est.insurance_company || "—",
          insurance_company_id: est.insurance_company_id,
          estimated_amount: subtotal,
          status: "pending",
          estimation_type: est.estimation_type,
          upl_items: est.upl_items as any,
          deductible_amount: est.deductible_amount || 0,
          damage_photos: est.damage_photos || [],
          incident_date: est.incident_date,
          incident_description: est.incident_description,
          vehicle_make: est.vehicle_make,
          vehicle_model: est.vehicle_model,
          vehicle_plate: est.vehicle_plate,
          vehicle_year: est.vehicle_year,
          vehicle_color: est.vehicle_color,
          notes: `محوّلة من تقدير مستقل ${est.estimate_number}${est.notes ? "\n" + est.notes : ""}`,
        })
        .select()
        .single();
      if (claimErr) throw claimErr;

      // Mark estimate as converted
      await supabase
        .from("insurance_estimates" as any)
        .update({
          status: "converted",
          converted_claim_id: claim.id,
          converted_at: new Date().toISOString(),
        } as any)
        .eq("id", est.id);

      return claim;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insurance_estimates"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      toast.success("تم تحويل التقدير إلى مطالبة");
    },
    onError: (e: any) => toast.error(e.message || "فشل التحويل"),
  });
}
