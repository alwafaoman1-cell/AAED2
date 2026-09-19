import { supabase } from "@/integrations/supabase/client";
import type { WorkOrder } from "@/lib/workOrdersStore";

export type DashboardPeriod = "today" | "week" | "month" | "all";

export interface DashboardOperationalData {
  stats: {
    inWorkshop: number;
    underInspection: number;
    waitingInsurance: number;
    underRepair: number;
    readyDelivery: number;
    openOrders: number;
    closedToday: number;
    totalOrders: number;
    completedOrders: number;
    activeCustomers: number;
    averageDays: number;
  };
  recentOrders: WorkOrder[];
  overdueOrders: Array<{ id: string; customer: string; entryDate: string }>;
  recentCustomers: Array<{ id: string; name: string; phone: string; createdAt: string }>;
  serviceDistribution: Array<{ name: string; value: number }>;
  filterOptions: { technicians: string[]; services: string[] };
}
const number = (value: unknown) => Number(value || 0);

export async function fetchDashboardOperationalData(input: {
  tenantId: string;
  period: DashboardPeriod;
  technician: string;
  service: string;
}): Promise<DashboardOperationalData> {
  const { data, error } = await (supabase.rpc as any)("dashboard_operational_summary_rpc", {
    p_tenant_id: input.tenantId,
    p_period: input.period,
    p_technician: input.technician,
    p_service: input.service,
  });
  if (error) throw error;
  const payload = data && typeof data === "object" ? data as Record<string, any> : {};
  const stats = payload.stats || {};
  const options = payload.filterOptions || {};
  return {
    stats: {
      inWorkshop: number(stats.in_workshop),
      underInspection: number(stats.under_inspection),
      waitingInsurance: number(stats.waiting_insurance),
      underRepair: number(stats.under_repair),
      readyDelivery: number(stats.ready_delivery),
      openOrders: number(stats.open_orders),
      closedToday: number(stats.closed_today),
      totalOrders: number(stats.total_orders),
      completedOrders: number(stats.completed_orders),
      activeCustomers: number(stats.active_customers),
      averageDays: number(stats.average_days),
    },
    recentOrders: Array.isArray(payload.recentOrders) ? payload.recentOrders : [],
    overdueOrders: Array.isArray(payload.overdueOrders) ? payload.overdueOrders : [],
    recentCustomers: Array.isArray(payload.recentCustomers) ? payload.recentCustomers : [],
    serviceDistribution: Array.isArray(payload.serviceDistribution)
      ? payload.serviceDistribution.map((item: any) => ({ name: String(item.name || ""), value: number(item.value) }))
      : [],
    filterOptions: {
      technicians: Array.isArray(options.technicians) ? options.technicians.filter(Boolean) : [],
      services: Array.isArray(options.services) ? options.services.filter(Boolean) : [],
    },
  };
}

export interface DashboardSearchResult {
  kind: "work_order" | "customer" | "vehicle" | "claim";
  label: string;
  sub: string;
  to: string;
}

export async function searchDashboardOperationalData(tenantId: string, search: string): Promise<DashboardSearchResult[]> {
  const query = search.trim();
  if (query.length < 2) return [];
  const { data, error } = await (supabase.rpc as any)("dashboard_global_search_rpc", {
    p_tenant_id: tenantId,
    p_search: query,
    p_limit: 20,
  });
  if (error) throw error;
  return Array.isArray(data) ? data as DashboardSearchResult[] : [];
}
