import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { toast } from "sonner";

export interface InsuranceEmployee {
  id: string;
  tenant_id: string;
  insurance_company_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type InsuranceEmployeeInput = {
  insurance_company_id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
  notes?: string | null;
};

export function useInsuranceEmployees(companyId?: string | null, includeInactive = false) {
  return useQuery({
    queryKey: ["insurance_company_employees", companyId || "all", includeInactive],
    enabled: companyId !== undefined,
    queryFn: async () => {
      let query = (supabase.from("insurance_company_employees" as any) as any)
        .select("*")
        .order("name");
      if (companyId) query = query.eq("insurance_company_id", companyId);
      if (!includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as InsuranceEmployee[];
    },
  });
}

export function useInsuranceEmployeesByIds(ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  return useQuery({
    queryKey: ["insurance_company_employees_by_ids", unique.join(",")],
    enabled: unique.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("insurance_company_employees" as any) as any)
        .select("*")
        .in("id", unique);
      if (error) throw error;
      return (data || []) as InsuranceEmployee[];
    },
  });
}

export function useCreateInsuranceEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InsuranceEmployeeInput) => {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("تعذّر تحديد المؤسسة");
      const { data, error } = await (supabase.from("insurance_company_employees" as any) as any)
        .insert({
          tenant_id: tenantId,
          insurance_company_id: input.insurance_company_id,
          name: input.name.trim(),
          title: input.title?.trim() || null,
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          is_active: input.is_active ?? true,
          notes: input.notes?.trim() || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as InsuranceEmployee;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["insurance_company_employees"] });
      qc.invalidateQueries({ queryKey: ["insurance_company_employees", row.insurance_company_id] });
      toast.success("تمت إضافة موظف التأمين");
    },
    onError: (e: any) => toast.error(e?.message || "تعذر حفظ موظف التأمين"),
  });
}

export function useUpdateInsuranceEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<InsuranceEmployeeInput> }) => {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.title !== undefined) payload.title = updates.title?.trim() || null;
      if (updates.email !== undefined) payload.email = updates.email?.trim() || null;
      if (updates.phone !== undefined) payload.phone = updates.phone?.trim() || null;
      if (updates.notes !== undefined) payload.notes = updates.notes?.trim() || null;
      if (updates.is_active !== undefined) payload.is_active = updates.is_active;
      const { data, error } = await (supabase.from("insurance_company_employees" as any) as any)
        .update(payload)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data as InsuranceEmployee;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["insurance_company_employees"] });
      qc.invalidateQueries({ queryKey: ["insurance_company_employees", row.insurance_company_id] });
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      toast.success("تم تحديث موظف التأمين");
    },
    onError: (e: any) => toast.error(e?.message || "تعذر تحديث موظف التأمين"),
  });
}
