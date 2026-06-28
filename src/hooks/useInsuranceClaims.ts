import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { postInsuranceClaimApproval, removeInsuranceClaimJournal } from "@/lib/insuranceAccounting";
import { isUuid } from "@/lib/uuid";

export interface ClaimNeededPart {
  name: string;
  quantity: number;
  notes?: string;
}

export interface ClaimDocument {
  url: string;
  name: string;
  type: string; // "police_report" | "claim_form" | "quote" | "other"
}

export interface InsuranceClaim {
  id: string;
  tenant_id: string;
  job_order_id: string | null;
  customer_id: string;
  vehicle_id: string | null;
  claim_number: string;
  insurance_company: string;
  insurance_company_id: string | null;
  estimated_amount: number;
  approved_amount: number;
  status: "pending" | "approved" | "rejected" | "paid" | "cancelled";
  notes: string | null;
  rejection_reason: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  // extended fields (kept in DB; UI focuses on inspection/photos/cost only)
  incident_date: string | null;
  incident_location: string | null;
  incident_description: string | null;
  policy_number: string | null;
  policy_expiry_date: string | null;
  adjuster_name: string | null;
  adjuster_phone: string | null;
  deductible_amount: number;
  estimated_cost: number;
  estimation_type: string;
  vehicle_owner_name: string | null;
  vehicle_owner_phone: string | null;
  inspection_id: string | null;
  damage_photos: string[];
  documents: ClaimDocument[];
  needed_parts: ClaimNeededPart[];
  // workflow date tracking
  estimate_date: string | null;
  workshop_arrival_date: string | null;
  work_started_at: string | null;
  work_completed_at: string | null;
  delivered_at: string | null;
  // joined
  customer?: { name: string; phone: string | null };
  vehicle?: {
    brand: string;
    model: string;
    plate_number: string;
    plate_letters?: string | null;
    plate_country?: string | null;
    year: number | null;
    vin_number?: string | null;
    vehicle_cover_image_url?: string | null;
    vehicle_thumbnail_url?: string | null;
  };
  job_order?: { order_number: string; status: string };
}

export type ClaimInsert = {
  tenant_id: string;
  job_order_id?: string | null;
  customer_id: string;
  vehicle_id: string | null;
  claim_number: string;
  insurance_company: string;
  insurance_company_id?: string | null;
  estimated_amount: number;
  approved_amount?: number;
  status?: "pending" | "approved" | "rejected" | "paid" | "cancelled";
  notes?: string;
  incident_date?: string | null;
  incident_location?: string | null;
  incident_description?: string | null;
  policy_number?: string | null;
  policy_expiry_date?: string | null;
  adjuster_name?: string | null;
  adjuster_phone?: string | null;
  deductible_amount?: number;
  estimated_cost?: number;
  vehicle_owner_name?: string | null;
  vehicle_owner_phone?: string | null;
  inspection_id?: string | null;
  damage_photos?: string[];
  documents?: ClaimDocument[];
  needed_parts?: ClaimNeededPart[];
  // vehicle inline data (saved with claim even without vehicle_id)
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_plate?: string | null;
  vehicle_year?: number | null;
  vehicle_color?: string | null;
  // estimation type
  estimation_type?: "lump_sum" | "upl";
  upl_items?: { description: string; quantity: number; unit_price: number }[];
  // workflow date tracking
  estimate_date?: string | null;
  workshop_arrival_date?: string | null;
  work_started_at?: string | null;
  work_completed_at?: string | null;
};

export function useInsuranceClaims() {
  return useQuery({
    queryKey: ["insurance_claims"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claims" as any)
        .select(`
          *,
          customer:customers(name, phone),
          vehicle:vehicles(brand, model, plate_number, plate_letters, plate_country, year, vin_number, vehicle_cover_image_url, vehicle_thumbnail_url),
          job_order:job_orders(order_number, status)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as InsuranceClaim[];
    },
  });
}

export function useCreateClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (claim: ClaimInsert) => {
      if (!claim.tenant_id || !isUuid(claim.tenant_id)) {
        throw new Error("Tenant was not loaded. Please refresh and try again.");
      }
      if (!claim.customer_id || !isUuid(claim.customer_id) || /^(CUST|TEMP)-/i.test(String(claim.customer_id))) {
        throw new Error("لا يمكن حفظ المطالبة بدون customer_id صالح");
      }
      if (!claim.vehicle_id || !isUuid(claim.vehicle_id) || /^(VEH|TEMP)-/i.test(String(claim.vehicle_id))) {
        throw new Error("لا يمكن حفظ المطالبة بدون vehicle_id صالح");
      }
      const [{ data: existingCustomer, error: customerError }, { data: existingVehicle, error: vehicleError }] = await Promise.all([
        supabase
          .from("customers")
          .select("id")
          .eq("tenant_id", claim.tenant_id)
          .eq("id", claim.customer_id)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("vehicles")
          .select("id,customer_id")
          .eq("tenant_id", claim.tenant_id)
          .eq("id", claim.vehicle_id)
          .is("deleted_at", null)
          .maybeSingle(),
      ]);
      if (customerError) throw customerError;
      if (vehicleError) throw vehicleError;
      if (!(existingCustomer as any)?.id) throw new Error("لا يمكن حفظ المطالبة: العميل غير موجود في Supabase");
      if (!(existingVehicle as any)?.id) throw new Error("لا يمكن حفظ المطالبة: المركبة غير موجودة في Supabase");
      if ((existingVehicle as any).customer_id && (existingVehicle as any).customer_id !== claim.customer_id) {
        throw new Error("لا يمكن حفظ المطالبة: المركبة مرتبطة بعميل آخر");
      }
      const claimNumber = claim.claim_number.trim();
      const { data: existing, error: existingError } = await supabase
        .from("insurance_claims" as any)
        .select("id,claim_number")
        .eq("tenant_id", claim.tenant_id)
        .ilike("claim_number", claimNumber)
        .limit(1)
        .maybeSingle();
      if (existingError) throw existingError;
      if ((existing as any)?.id) {
        const err = new Error("claim_number_exists");
        (err as any).existingClaimId = (existing as any).id;
        throw err;
      }
      const { data, error } = await supabase
        .from("insurance_claims" as any)
        .insert({ ...(claim as any), claim_number: claimNumber })
        .select("id")
        .single();
      if (error) throw error;
      const { data: verified, error: verifyError } = await supabase
        .from("insurance_claims" as any)
        .select("*")
        .eq("tenant_id", claim.tenant_id)
        .eq("id", (data as any).id)
        .maybeSingle();
      if (verifyError) throw verifyError;
      if (!(verified as any)?.id) throw new Error("تم الحفظ لكن تعذر قراءة المطالبة للتأكيد");
      return verified;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["job_orders"] });
      toast.success("تم إنشاء المطالبة بنجاح");
    },
    onError: (e: any) => toast.error(e?.message === "claim_number_exists" ? "رقم المطالبة موجود مسبقًا داخل نفس الورشة" : e.message),
  });
}

export function useClaim(id: string | undefined) {
  return useQuery({
    queryKey: ["insurance_claims", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claims" as any)
        .select(`
          *,
          customer:customers(name, phone),
          vehicle:vehicles(brand, model, plate_number, plate_letters, plate_country, year, vin_number, vehicle_cover_image_url, vehicle_thumbnail_url),
          job_order:job_orders(order_number, status)
        `)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as InsuranceClaim;
    },
  });
}

export function useUpdateClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ClaimInsert> }) => {
      const { error } = await supabase
        .from("insurance_claims" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims", vars.id] });
      toast.success("تم حفظ التعديلات");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateClaimStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      approved_amount,
      rejection_reason,
    }: {
      id: string;
      status: "pending" | "approved" | "rejected" | "paid" | "cancelled";
      approved_amount?: number;
      rejection_reason?: string;
    }) => {
      const updates: any = { status };
      if (status === "approved") {
        updates.approved_at = new Date().toISOString();
        if (approved_amount !== undefined) updates.approved_amount = approved_amount;
      }
      if (status === "paid") updates.paid_at = new Date().toISOString();
      if ((status === "rejected" || status === "cancelled") && rejection_reason) {
        updates.rejection_reason = rejection_reason;
      }

      const { error } = await supabase
        .from("insurance_claims" as any)
        .update(updates)
        .eq("id", id);
      if (error) throw error;

      // قيد محاسبي عند الاعتماد
      if (status === "approved") {
        const { data: claim } = await supabase
          .from("insurance_claims" as any)
          .select("claim_number, insurance_company, approved_amount, estimated_amount, approved_at, created_at")
          .eq("id", id)
          .maybeSingle();
        const c = claim as any;
        if (c) {
          const amt = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
          postInsuranceClaimApproval({
            claimId: id,
            claimNumber: c.claim_number,
            date: c.approved_at ?? c.created_at ?? new Date().toISOString(),
            amount: amt,
            companyName: c.insurance_company ?? "شركة تأمين",
          });
        }
      }
      if (status === "rejected" || status === "cancelled") removeInsuranceClaimJournal(id);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims", vars.id] });
      toast.success("تم تحديث حالة المطالبة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // 1) fetch claim meta for linked work orders / claim_number
      const { data: claim } = await supabase
        .from("insurance_claims" as any)
        .select("id, claim_number, auto_job_order_id, job_order_id")
        .eq("id", id)
        .maybeSingle();
      const c: any = claim;

      // 2) delete dependent rows (best-effort, warn on failure)
      const safeDel = async (table: string, col: string, val: string) => {
        try {
          const { error } = await supabase.from(table as any).delete().eq(col, val);
          if (error) console.warn(`[cascade] ${table}.${col}=${val}`, error.message);
        } catch (e: any) {
          console.warn(`[cascade] ${table}`, e?.message);
        }
      };

      await safeDel("insurance_invoices", "claim_id", id);
      await safeDel("claim_payments", "claim_id", id);
      // independent estimates link via converted_claim_id
      await safeDel("insurance_estimates", "converted_claim_id", id);

      // 3) delete linked job_orders (cloud)
      const joIds = [c?.auto_job_order_id, c?.job_order_id].filter(Boolean) as string[];
      for (const joId of joIds) {
        try {
          const { error } = await supabase.from("job_orders").delete().eq("id", joId);
          if (error) console.warn("[cascade] job_orders", error.message);
        } catch (e: any) { console.warn("[cascade] job_orders", e?.message); }
      }

      // 4) delete local work orders (localStorage store) sharing claim_number
      if (c?.claim_number) {
        try {
          const { getWorkOrders, deleteWorkOrder } = await import("@/lib/workOrdersStore");
          const cn = String(c.claim_number).trim();
          getWorkOrders()
            .filter((o) => (o.claimNumber || "").trim() === cn)
            .forEach((o) => deleteWorkOrder(o.id));
        } catch (e: any) { console.warn("[cascade] local wo", e?.message); }
      }

      // 5) remove journal entry
      try {
        const { removeInsuranceClaimJournal } = await import("@/lib/insuranceAccounting");
        removeInsuranceClaimJournal(id);
      } catch (e: any) { console.warn("[cascade] journal", e?.message); }

      // 6) finally delete the claim itself
      const { error } = await supabase
        .from("insurance_claims" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["insurance_invoices"] });
      qc.invalidateQueries({ queryKey: ["insurance_estimates"] });
      qc.invalidateQueries({ queryKey: ["claim_payments"] });
      qc.invalidateQueries({ queryKey: ["job_orders"] });
      toast.success("تم حذف المطالبة وكل المرتبطات");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// Helper hooks for dropdowns
export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useVehiclesByCustomer(customerId: string | null) {
  type CustomerVehicleRow = {
    id: string;
    brand: string | null;
    model: string | null;
    plate_number: string | null;
    year: number | null;
    vin_number?: string | null;
    vehicle_cover_image_url?: string | null;
    vehicle_thumbnail_url?: string | null;
  };
  return useQuery<CustomerVehicleRow[]>({
    queryKey: ["vehicles", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles" as any)
        .select("id, brand, model, plate_number, year, vin_number, vehicle_cover_image_url, vehicle_thumbnail_url")
        .eq("customer_id", customerId!);
      if (error) throw error;
      return ((data || []) as unknown) as CustomerVehicleRow[];
    },
  });
}

export function useJobOrders() {
  return useQuery({
    queryKey: ["job_orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select("id, order_number, customer_id, vehicle_id, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
