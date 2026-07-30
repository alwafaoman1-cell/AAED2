import { supabase } from "@/integrations/supabase/client";

export interface ReportSavedView {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  report_key: string;
  filters: Record<string, string>;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchReportSavedViews(tenantId: string): Promise<ReportSavedView[]> {
  const { data, error } = await (supabase as any)
    .from("report_saved_views")
    .select("id,tenant_id,user_id,name,report_key,filters,is_shared,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data || []) as ReportSavedView[];
}

export async function createReportSavedView(input: {
  tenantId: string;
  userId: string;
  name: string;
  reportKey: string;
  filters: Record<string, string>;
}): Promise<ReportSavedView> {
  const name = input.name.trim();
  if (!name) throw new Error("report_saved_view_name_required");

  const { data, error } = await (supabase as any)
    .from("report_saved_views")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      name,
      report_key: input.reportKey,
      filters: input.filters,
      is_shared: false,
    })
    .select("id,tenant_id,user_id,name,report_key,filters,is_shared,created_at,updated_at")
    .single();

  if (error) throw error;
  return data as ReportSavedView;
}

export async function deleteReportSavedView(id: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("report_saved_views")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
