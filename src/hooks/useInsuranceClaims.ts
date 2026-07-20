import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { postInsuranceClaimApproval, removeInsuranceClaimJournal } from "@/lib/insuranceAccounting";
import { sanitizeClaimWritePayload } from "@/lib/supabasePayload";
import { queryKeys } from "@/lib/queryKeys";
import { prepareClaimPayload } from "@/lib/insurance/claimPayloadService";

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
  insurance_employee_id: string | null;
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
  insurance_employee_id?: string | null;
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
  estimation_type?: "auto" | "lump_sum" | "upl";
  upl_items?: { description: string; quantity: number; unit_price: number }[];
  // workflow date tracking
  estimate_date?: string | null;
  workshop_arrival_date?: string | null;
  work_started_at?: string | null;
  work_completed_at?: string | null;
};

export function useInsuranceClaims() {
  return useQuery({
    queryKey: queryKeys.insuranceClaims.all,
    queryFn: async () => {
      let { data, error } = await supabase
        .from("insurance_claims" as any)
        .select(`
          *,
          customer:customers(name, phone),
          vehicle:vehicles(brand, model, plate_number, plate_letters, plate_country, year, vin_number, vehicle_cover_image_url, vehicle_thumbnail_url),
          job_order:job_orders!insurance_claims_job_order_id_fkey(order_number, status)
        `)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error && /deleted_at|archived_at|column/i.test(String((error as any).message || ""))) {
        ({ data, error } = await supabase
          .from("insurance_claims" as any)
          .select(`
            *,
            customer:customers(name, phone),
            vehicle:vehicles(brand, model, plate_number, plate_letters, plate_country, year, vin_number, vehicle_cover_image_url, vehicle_thumbnail_url),
            job_order:job_orders!insurance_claims_job_order_id_fkey(order_number, status)
          `)
          .order("created_at", { ascending: false }));
      }
      if (error) throw error;
      return data as unknown as InsuranceClaim[];
    },
  });
}

export function useCreateClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (claimInput: ClaimInsert) => {
      const payload = await prepareClaimPayload(claimInput as any);
      const { data, error } = await supabase
        .from("insurance_claims" as any)
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;

      const { data: verified, error: verifyError } = await supabase
        .from("insurance_claims" as any)
        .select("*")
        .eq("tenant_id", claimInput.tenant_id)
        .eq("id", (data as any).id)
        .maybeSingle();
      if (verifyError) throw verifyError;
      if (!(verified as any)?.id) throw new Error("Claim was saved but could not be read back for verification");
      return verified as unknown as InsuranceClaim;
    },
    onSuccess: (created) => {
      qc.setQueryData(queryKeys.insuranceClaims.detail(created?.id), created);
      qc.setQueryData<InsuranceClaim[] | undefined>(queryKeys.insuranceClaims.all, (current) => {
        if (!created?.id) return current;
        const list = current || [];
        if (list.some((item: any) => item.id === created.id)) {
          return list.map((item: any) => item.id === created.id ? created : item);
        }
        return [created, ...list];
      });
      qc.invalidateQueries({ queryKey: queryKeys.customers.all });
      qc.invalidateQueries({ queryKey: queryKeys.vehicles.all });
      qc.invalidateQueries({ queryKey: queryKeys.jobOrders.all });
      toast.success("تم إنشاء المطالبة بنجاح");
    },
    onError: (e: any) => toast.error(e?.message === "claim_number_exists" ? (e?.existingClaimInactive ? "Claim number exists in an archived/deleted record. Open or restore the existing record, or use a different number." : "Claim number already exists. Open the existing record.") : e.message),
  });
}
export function useClaim(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.insuranceClaims.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claims" as any)
        .select(`
          *,
          customer:customers(name, phone),
          vehicle:vehicles(brand, model, plate_number, plate_letters, plate_country, year, vin_number, vehicle_cover_image_url, vehicle_thumbnail_url),
          job_order:job_orders!insurance_claims_job_order_id_fkey(order_number, status)
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
      const payload = sanitizeClaimWritePayload(updates as any);
      const { data, error } = await supabase
        .from("insurance_claims" as any)
        .update(payload)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      if (!(data as any)?.id) throw new Error("Claim update could not be verified");
      return data as unknown as InsuranceClaim;
    },
    onSuccess: (_d, vars) => {
      qc.setQueryData(queryKeys.insuranceClaims.detail(vars.id), _d);
      qc.setQueryData<InsuranceClaim[] | undefined>(queryKeys.insuranceClaims.all, (current) =>
        current?.map((claim) => claim.id === vars.id ? ({ ...claim, ...(_d as any) } as InsuranceClaim) : claim)
      );
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
      let { data: current, error: currentError } = await supabase
        .from("insurance_claims" as any)
        .select("id,tenant_id,status,approved_amount,rejection_reason,archived_at")
        .eq("id", id)
        .maybeSingle();
      if (currentError && /archived_at|column/i.test(String((currentError as any).message || ""))) {
        ({ data: current, error: currentError } = await supabase
          .from("insurance_claims" as any)
          .select("id,tenant_id,status,approved_amount,rejection_reason")
          .eq("id", id)
          .maybeSingle());
      }
      if (currentError) throw currentError;
      if (!(current as any)?.id) throw new Error("Claim was not found in Supabase");
      if ((current as any).archived_at) throw new Error("Cannot update an archived claim");
      if ((current as any).status === status) return current;

      const updates: any = { status };
      if (status === "approved") {
        updates.approved_at = new Date().toISOString();
        if (approved_amount !== undefined) updates.approved_amount = approved_amount;
      }
      if (status === "paid") updates.paid_at = new Date().toISOString();
      if ((status === "rejected" || status === "cancelled") && rejection_reason) {
        updates.rejection_reason = rejection_reason;
      }

      const { data: updated, error } = await supabase
        .from("insurance_claims" as any)
        .update(updates)
        .eq("id", id)
        .select("id,tenant_id,status,approved_amount,approved_at,rejection_reason,paid_at")
        .single();
      if (error) throw error;
      if (!(updated as any)?.id || (updated as any).status !== status) throw new Error("Claim status update could not be verified");
      await supabase.from("claim_audit_logs").insert({
        tenant_id: (updated as any).tenant_id || (current as any).tenant_id,
        claim_id: id,
        action: status === "approved" ? "claim_approved" : "claim_status_changed",
        category: "workflow",
        details: {
          from: (current as any).status,
          to: status,
          approved_amount: (updated as any).approved_amount ?? null,
          rejection_reason: rejection_reason ?? null,
        },
      });

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
      return updated;
    },
    onSuccess: (_data, vars) => {
      qc.setQueryData(queryKeys.insuranceClaims.detail(vars.id), (current: any) => ({ ...(current || {}), ...(_data as any) }));
      qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
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
      qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all });
      qc.invalidateQueries({ queryKey: queryKeys.insuranceEstimates.all });
      qc.invalidateQueries({ queryKey: queryKeys.claimPayments.all });
      qc.invalidateQueries({ queryKey: queryKeys.jobOrders.all });
      toast.success("تم حذف المطالبة وكل المرتبطات");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// Helper hooks for dropdowns
export function useCustomers() {
  return useQuery({
    queryKey: queryKeys.customers.all,
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
    queryKey: queryKeys.vehicles.byCustomer(customerId),
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
    queryKey: queryKeys.jobOrders.all,
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

