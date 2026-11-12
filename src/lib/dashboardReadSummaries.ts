import { supabase } from "@/integrations/supabase/client";

export interface ExpenseDashboardSummary {
  total: number; count: number;
  monthly: { month: string; expenses: number }[];
  categories: { account: string | null; total: number; count: number }[];
}
export interface InsuranceHubSummary {
  stats: Record<string, number>;
  topCompanies: { name: string; count: number; amount: number }[];
  monthlyTrend: { name: string; claims: number; amount: number }[];
  agingBuckets: { name: string; value: number }[];
  recentClaims: { id: string; claim_number: string; status: string; insurance_company: string; vehicle_make: string | null; vehicle_model: string | null; vehicle_plate: string | null; estimated_amount: number }[];
  criticalAlerts: { id: string; type: string; severity: string; days: number; label: string; detail: string; href: string | null; amount: number | null }[];
  alertCount: number;
}
export async function fetchExpenseDashboardSummary(tenantId: string): Promise<ExpenseDashboardSummary> {
  const { data, error } = await supabase.rpc("accounting_expense_summary_rpc" as never, { p_tenant_id: tenantId } as never);
  if (error) throw error;
  const value = data as unknown as ExpenseDashboardSummary;
  if (!value || !Number.isFinite(value.total) || !Number.isFinite(value.count) ||
    !Array.isArray(value.monthly) || !value.monthly.every(row => typeof row.month === "string" && Number.isFinite(row.expenses)) ||
    !Array.isArray(value.categories) || !value.categories.every(row => (row.account === null || typeof row.account === "string") && Number.isFinite(row.total) && Number.isFinite(row.count))) throw new Error("EXPENSE_SUMMARY_INVALID_RESPONSE");
  return value;
}
export async function fetchInsuranceHubSummary(tenantId: string): Promise<InsuranceHubSummary> {
  const { data, error } = await supabase.rpc("insurance_hub_summary_rpc" as never, {
    p_tenant_id: tenantId, p_now: new Date().toISOString(), p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Muscat",
  } as never);
  if (error) throw error;
  const value = data as unknown as InsuranceHubSummary;
  const stats = ["total", "pending", "approved", "paid", "rejected", "estimatedTotal", "approvedTotal", "paidTotal", "invoicedTotal", "outstanding", "approvalRate", "inWorkshop", "withCustomer", "deliveredCount", "completedPendingCollection", "overdueClaims"];
  if (!value?.stats || !stats.every(key => Number.isFinite(value.stats[key])) || !Number.isFinite(value.alertCount) ||
    ![value.topCompanies,value.monthlyTrend,value.agingBuckets,value.recentClaims,value.criticalAlerts].every(Array.isArray) ||
    !value.topCompanies.every(row => Number.isFinite(row.count) && Number.isFinite(row.amount)) ||
    !value.monthlyTrend.every(row => Number.isFinite(row.claims) && Number.isFinite(row.amount)) ||
    !value.agingBuckets.every(row => Number.isFinite(row.value))) throw new Error("INSURANCE_SUMMARY_INVALID_RESPONSE");
  return value;
}
