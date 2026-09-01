import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

export type MonthlyBusinessType = "cash" | "insurance";

export interface MonthlyVehicleProfitabilityFilters {
  from: string;
  to: string;
  businessType: MonthlyBusinessType;
  search: string;
  page: number;
  pageSize: number;
}

export type MonthlyVehicleProfitabilityRow = Record<string, unknown>;

export interface MonthlyVehicleProfitabilityResult {
  rows: MonthlyVehicleProfitabilityRow[];
  aggregates: {
    invoiced_ex_vat: number;
    labor_revenue: number;
    parts_revenue: number;
    vat: number;
    invoiced_total: number;
    collected: number;
    outstanding: number;
    parts_cost: number;
    labor_cost: number;
    operating_cost: number;
    external_direct_cost: number;
    direct_cost: number;
    gross_profit: number;
    vehicles: number;
  };
  overheads: {
    salaries: number;
    fixed: number;
    operating: number;
    unlinked_parts: number;
    other: number;
    total: number;
  };
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
  basis: string;
  generatedAt: string;
}

export const monthlyVehicleProfitabilityKeys = queryKeys.monthlyVehicleProfitability;

export async function fetchMonthlyVehicleProfitability(
  filters: MonthlyVehicleProfitabilityFilters,
  signal?: AbortSignal,
): Promise<MonthlyVehicleProfitabilityResult> {
  const result = await supabase.rpc("monthly_vehicle_profitability_v2_rpc" as never, {
    p_from: filters.from,
    p_to: filters.to,
    p_business_type: filters.businessType,
    p_search: filters.search || null,
    p_page: filters.page,
    p_page_size: filters.pageSize,
  } as never).abortSignal(signal ?? new AbortController().signal);
  if (result.error) throw result.error;
  return result.data as unknown as MonthlyVehicleProfitabilityResult;
}

export async function fetchAllMonthlyVehicleProfitabilityRows(
  filters: MonthlyVehicleProfitabilityFilters,
): Promise<MonthlyVehicleProfitabilityRow[]> {
  const rows: MonthlyVehicleProfitabilityRow[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const result = await fetchMonthlyVehicleProfitability({ ...filters, page, pageSize: 500 });
    rows.push(...result.rows);
    if (page >= result.pagination.totalPages) break;
  }
  return rows;
}
