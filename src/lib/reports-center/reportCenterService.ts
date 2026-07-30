import { supabase } from "@/integrations/supabase/client";
import { getCurrentRole } from "@/lib/permissions";
import { canOpenReport, canUseReportPermission } from "./reportPermissions";
import type {
  ReportCenterFilters,
  ReportCenterSummary,
  ReportCenterSummaryResult,
  ReportDataResult,
  ReportRow,
} from "./reportTypes";

const EMPTY_SUMMARY: ReportCenterSummary = {
  claimsCount: 0,
  workOrdersCount: 0,
  vehiclesInWorkshop: 0,
  deliveredVehicles: 0,
  estimateTotal: 0,
  approvedTotal: 0,
  invoiceSubtotal: 0,
  vat: 0,
  invoiceTotal: 0,
  paid: 0,
  outstanding: 0,
  expenses: 0,
  partsCost: 0,
  laborCost: 0,
  transportCost: 0,
  grossProfit: 0,
  grossMargin: 0,
  averageWorkshopDays: 0,
  overdueInvoices: 0,
  claimsAwaitingCollection: 0,
  completedWithoutInvoice: 0,
};

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeSummary(input: unknown): ReportCenterSummary {
  const row = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    claimsCount: numberValue(row, "claims_count"),
    workOrdersCount: numberValue(row, "work_orders_count"),
    vehiclesInWorkshop: numberValue(row, "vehicles_in_workshop"),
    deliveredVehicles: numberValue(row, "delivered_vehicles"),
    estimateTotal: numberValue(row, "estimate_total"),
    approvedTotal: numberValue(row, "approved_total"),
    invoiceSubtotal: numberValue(row, "invoice_subtotal"),
    vat: numberValue(row, "vat"),
    invoiceTotal: numberValue(row, "invoice_total"),
    paid: numberValue(row, "paid"),
    outstanding: numberValue(row, "outstanding"),
    expenses: numberValue(row, "expenses"),
    partsCost: numberValue(row, "parts_cost"),
    laborCost: numberValue(row, "labor_cost"),
    transportCost: numberValue(row, "transport_cost"),
    grossProfit: numberValue(row, "gross_profit"),
    grossMargin: numberValue(row, "gross_margin"),
    averageWorkshopDays: numberValue(row, "average_workshop_days"),
    overdueInvoices: numberValue(row, "overdue_invoices"),
    claimsAwaitingCollection: numberValue(row, "claims_awaiting_collection"),
    completedWithoutInvoice: numberValue(row, "completed_without_invoice"),
  };
}

export async function fetchReportCenterSummary(
  filters: ReportCenterFilters,
  signal?: AbortSignal,
): Promise<ReportCenterSummaryResult> {
  if (!canUseReportPermission(getCurrentRole() as any, "reports.accounting")) {
    throw new Error("reports_permission_denied");
  }
  if (!filters.tenantId) {
    return { available: false, summary: null, generatedAt: null, reason: "tenant_not_loaded" };
  }

  const query = (supabase as any)
    .rpc("reports_center_secure_summary_rpc", {
      p_tenant_id: filters.tenantId,
      p_from_date: filters.from || null,
      p_to_date: filters.to || null,
      p_business_type: filters.businessType,
      p_insurance_company_id: filters.insuranceCompanyId || null,
    });
  if (signal && typeof query.abortSignal === "function") query.abortSignal(signal);
  const { data, error } = await query;

  if (error) {
    const missingRpc =
      error.code === "PGRST202" ||
      /reports_center_(secure_)?summary_rpc/i.test(error.message || "");
    if (missingRpc) {
      return {
        available: false,
        summary: null,
        generatedAt: null,
        reason: "summary_rpc_not_activated",
      };
    }
    throw error;
  }

  return {
    available: true,
    summary: { ...EMPTY_SUMMARY, ...normalizeSummary(data) },
    generatedAt: new Date().toISOString(),
  };
}

const RPC_BY_REPORT_KEY: Record<string, string> = {
  "claims-register": "reports_claims_register_rpc",
  "insurance-company-statement": "reports_insurance_company_statement_rpc",
  "cash-invoices": "reports_invoices_rpc",
  "all-company-invoices": "reports_invoices_rpc",
  "work-orders": "reports_work_orders_rpc",
  "vehicles-in-workshop": "reports_vehicles_in_workshop_rpc",
  "completed-without-invoice": "reports_completed_without_invoice_rpc",
  "delivered-awaiting-collection": "reports_delivered_awaiting_collection_rpc",
  payments: "reports_payments_rpc",
  expenses: "reports_expenses_rpc",
  aging: "reports_aging_rpc",
  "gross-profitability": "reports_profitability_rpc",
  "workshop-duration": "reports_work_orders_rpc",
};

function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelRow(input: unknown): ReportRow {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const row = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      camelKey(key),
      value,
    ]),
  );
  const reference = row.reference;
  const secondary = row.secondaryReference;
  return {
    ...row,
    claimNumber: row.claimNumber ?? secondary ?? reference,
    workOrderNumber: row.workOrderNumber ?? reference,
    invoiceNumber: row.invoiceNumber ?? reference,
    insuranceCompany: row.insuranceCompany ?? row.partyName,
    vehicle: row.vehicle ?? row.vehicleName,
  };
}

function detailFilters(filters: ReportCenterFilters) {
  return {
    insuranceCompanyId: filters.insuranceCompanyId || null,
    customerId: filters.customerId || null,
    vehicleId: filters.vehicleId || null,
    plate: filters.plate || null,
    vin: filters.vin || null,
    claimNumber: filters.claimNumber || null,
    workOrderNumber: filters.workOrderNumber || null,
    invoiceNumber: filters.invoiceNumber || null,
    status:
      filters.claimStatus ||
      filters.workOrderStatus ||
      filters.invoiceStatus ||
      filters.collectionStatus ||
      null,
    employeeId: filters.employeeId || null,
    supplierId: filters.supplierId || null,
    expenseCategory: filters.expenseCategory || null,
    paymentMethod: filters.paymentMethod || null,
    workshopLocation: filters.workshopLocation || null,
  };
}

function reportBusinessType(reportKey: string, requested: ReportCenterFilters["businessType"]) {
  if (reportKey === "claims-register" || reportKey === "insurance-company-statement") {
    return "insurance";
  }
  if (reportKey === "cash-invoices") return "cash";
  return requested;
}

function unavailableReport(reason: string): ReportDataResult {
  return {
    available: false,
    rows: [],
    pagination: { page: 1, pageSize: 25, totalRows: 0, totalPages: 0 },
    aggregates: {},
    dataQuality: { unknownBusinessType: 0 },
    generatedAt: null,
    reason,
  };
}

export async function fetchReportData(
  reportKey: string,
  filters: ReportCenterFilters,
  signal?: AbortSignal,
): Promise<ReportDataResult> {
  if (!canOpenReport(getCurrentRole() as any, reportKey)) {
    throw new Error("reports_permission_denied");
  }
  const rpc = RPC_BY_REPORT_KEY[reportKey];
  if (!filters.tenantId) return unavailableReport("tenant_not_loaded");
  if (!rpc) return unavailableReport("report_rpc_not_defined");

  const query = (supabase as any).rpc(rpc, {
    p_tenant_id: filters.tenantId,
    p_from_date: filters.from || null,
    p_to_date: filters.to || null,
    p_business_type: reportBusinessType(reportKey, filters.businessType),
    p_filters: detailFilters(filters),
    p_search: filters.search || "",
    p_sort: filters.sort || "report_date",
    p_direction: filters.direction,
    p_page: filters.page,
    p_page_size: filters.pageSize,
  });
  if (signal && typeof query.abortSignal === "function") query.abortSignal(signal);
  const { data, error } = await query;

  if (error) {
    const missingRpc =
      error.code === "PGRST202" ||
      /reports_.*_rpc|schema cache|could not find the function/i.test(error.message || "");
    if (missingRpc) return unavailableReport("detail_rpc_not_activated");
    throw error;
  }

  const payload = (data && typeof data === "object" ? data : {}) as Record<string, any>;
  const pagination = payload.pagination || {};
  const quality = payload.dataQuality || payload.data_quality || {};
  return {
    available: true,
    rows: Array.isArray(payload.rows) ? payload.rows.map(camelRow) : [],
    pagination: {
      page: Number(pagination.page || filters.page),
      pageSize: Number(pagination.pageSize || pagination.page_size || filters.pageSize),
      totalRows: Number(pagination.totalRows || pagination.total_rows || 0),
      totalPages: Number(pagination.totalPages || pagination.total_pages || 0),
    },
    aggregates: camelRow(payload.aggregates) as Record<string, number>,
    dataQuality: {
      unknownBusinessType: Number(
        quality.unknownBusinessType || quality.unknown_business_type || 0,
      ),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function fetchAllReportRows(
  reportKey: string,
  filters: ReportCenterFilters,
  signal?: AbortSignal,
): Promise<ReportDataResult> {
  if (!canOpenReport(getCurrentRole() as any, reportKey)) {
    throw new Error("reports_permission_denied");
  }
  const first = await fetchReportData(
    reportKey,
    { ...filters, page: 1, pageSize: 100 },
    signal,
  );
  if (!first.available || first.pagination.totalPages <= 1) return first;

  const rows = [...first.rows];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    if (signal?.aborted) throw new DOMException("Report export cancelled", "AbortError");
    const next = await fetchReportData(
      reportKey,
      { ...filters, page, pageSize: 100 },
      signal,
    );
    if (!next.available) return next;
    rows.push(...next.rows);
  }
  return {
    ...first,
    rows,
    pagination: {
      ...first.pagination,
      page: 1,
      pageSize: rows.length,
    },
  };
}
