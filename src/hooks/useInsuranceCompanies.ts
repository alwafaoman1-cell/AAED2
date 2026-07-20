import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";

export interface InsuranceCompany {
  id: string;
  tenant_id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  default_deductible_percent: number;
  payment_terms_days: number;
  notes: string | null;
  is_active: boolean;
  commercial_registration: string | null;
  tax_number: string | null;
  po_box: string | null;
  branch_city: string | null;
  bank_name: string | null;
  iban: string | null;
  bank_account_name: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export type InsuranceCompanyInsert = Omit<
  InsuranceCompany,
  "id" | "created_at" | "updated_at"
> & { id?: string };

export function useInsuranceCompanies() {
  return useQuery({
    queryKey: queryKeys.insuranceCompanies.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies" as any)
        .select("*")
        .order("name");
      if (error) throw error;
      return data as unknown as InsuranceCompany[];
    },
  });
}

export function useInsuranceCompany(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.insuranceCompanies.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies" as any)
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as InsuranceCompany;
    },
  });
}

export function useCreateInsuranceCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (company: Partial<InsuranceCompanyInsert>) => {
      const { data, error } = await supabase
        .from("insurance_companies" as any)
        .insert(company as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as InsuranceCompany;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.insuranceCompanies.all });
      toast.success("تمت إضافة شركة التأمين");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateInsuranceCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<InsuranceCompanyInsert> }) => {
      const { error } = await supabase
        .from("insurance_companies" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.insuranceCompanies.all });
      toast.success("تم حفظ التعديلات");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteInsuranceCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("insurance_companies" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.insuranceCompanies.all });
      toast.success("تم حذف الشركة");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/** بحث أو إنشاء شركة بالاسم — تستعمل من حقل autocomplete */
export async function findOrCreateInsuranceCompany(
  name: string,
  tenantId: string,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data: existing } = await supabase
    .from("insurance_companies" as any)
    .select("id, name")
    .eq("tenant_id", tenantId)
    .ilike("name", trimmed)
    .maybeSingle();

  if (existing) return (existing as any).id;

  const { data, error } = await supabase
    .from("insurance_companies" as any)
    .insert({ name: trimmed, tenant_id: tenantId } as any)
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id;
}
