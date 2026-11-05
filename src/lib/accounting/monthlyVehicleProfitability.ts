import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { subtractMoney } from "@/lib/money";

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
    recognized_revenue_ex_vat: number;
    invoiced_ex_vat: number;
    labor_revenue: number;
    parts_revenue: number;
    parts_profit: number;
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

function withPartsProfit(row: MonthlyVehicleProfitabilityRow): MonthlyVehicleProfitabilityRow {
  return {
    ...row,
    parts_profit: subtractMoney(row.parts_revenue, row.parts_cost),
  };
}

export async function fetchMonthlyVehicleProfitability(
  filters: MonthlyVehicleProfitabilityFilters,
  signal?: AbortSignal,
): Promise<MonthlyVehicleProfitabilityResult> {
  const result = await supabase.rpc("monthly_vehicle_profitability_v3_rpc" as never, {
    p_from: filters.from,
    p_to: filters.to,
    p_business_type: filters.businessType,
    p_search: filters.search || null,
    p_page: filters.page,
    p_page_size: filters.pageSize,
  } as never).abortSignal(signal ?? new AbortController().signal);
  if (result.error) throw result.error;
  const data = result.data as unknown as MonthlyVehicleProfitabilityResult;
  if (!data || !Array.isArray(data.rows) || !data.pagination
    || !Number.isSafeInteger(data.pagination.totalRows) || data.pagination.totalRows < 0
    || !Number.isSafeInteger(data.pagination.totalPages) || data.pagination.totalPages < 0
    || (data.pagination.totalRows > 0 && data.pagination.totalPages === 0)) {
    throw new Error("MONTHLY_REPORT_INVALID_RESPONSE");
  }
  return {
    ...data,
    rows: (data.rows || []).map(withPartsProfit),
    aggregates: {
      ...data.aggregates,
      parts_profit: subtractMoney(data.aggregates?.parts_revenue, data.aggregates?.parts_cost),
    },
  };
}

export async function fetchAllMonthlyVehicleProfitabilityRows(
  filters: MonthlyVehicleProfitabilityFilters,
): Promise<MonthlyVehicleProfitabilityRow[]> {
  const rows: MonthlyVehicleProfitabilityRow[] = [];
  let expected: MonthlyVehicleProfitabilityResult | undefined;
  const operationIds = new Set<string>();
  for (let page = 1; page <= 200; page += 1) {
    const result = await fetchMonthlyVehicleProfitability({ ...filters, page, pageSize: 500 });
    if (result.pagination.totalPages > 200) throw new Error("MONTHLY_REPORT_EXPORT_LIMIT_EXCEEDED");
    expected ??= result;
    if (result.pagination.totalRows !== expected.pagination.totalRows || result.pagination.totalPages !== expected.pagination.totalPages
      || JSON.stringify(Object.entries(result.aggregates).sort()) !== JSON.stringify(Object.entries(expected.aggregates).sort())) {
      throw new Error("MONTHLY_REPORT_SET_CHANGED_DURING_EXPORT");
    }
    for (const row of result.rows) {
      const operationId = String(row.operation_id || "");
      if (operationId && operationIds.has(operationId)) throw new Error("MONTHLY_REPORT_DUPLICATE_EXPORT_ROW");
      if (operationId) operationIds.add(operationId);
    }
    rows.push(...result.rows);
    if (page >= result.pagination.totalPages) break;
  }
  if (!expected || rows.length !== expected.pagination.totalRows) throw new Error("MONTHLY_REPORT_EXPORT_INCOMPLETE");
  return rows;
}
