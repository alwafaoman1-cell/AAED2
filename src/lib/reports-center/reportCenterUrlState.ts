import { format, startOfMonth } from "date-fns";
import type { ReportBusinessType, ReportCategory, ReportCenterFilters } from "./reportTypes";

const iso = (date: Date) => format(date, "yyyy-MM-dd");

export const REPORT_CENTER_DEFAULTS = {
  businessType: "all" as ReportBusinessType,
  category: "overview" as ReportCategory,
  from: iso(startOfMonth(new Date())),
  to: iso(new Date()),
  page: 1,
  pageSize: 25,
  sort: "date",
  direction: "desc" as const,
};

function positiveInteger(value: string | null, fallback: number, maximum = 500): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function oneOf<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

export function parseReportCenterFilters(params: URLSearchParams, tenantId = ""): ReportCenterFilters {
  return {
    tenantId,
    reportKey: params.get("report") || "",
    businessType: oneOf(params.get("businessType"), ["all", "insurance", "cash"] as const, REPORT_CENTER_DEFAULTS.businessType),
    from: params.get("from") || REPORT_CENTER_DEFAULTS.from,
    to: params.get("to") || REPORT_CENTER_DEFAULTS.to,
    search: params.get("q") || "",
    category: oneOf(
      params.get("category"),
      ["all", "overview", "insurance", "cash", "combined", "operations", "invoices", "expenses", "profitability", "performance", "saved"] as const,
      REPORT_CENTER_DEFAULTS.category,
    ),
    insuranceCompanyId: params.get("insuranceCompany") || "",
    customerId: params.get("customer") || "",
    vehicleId: params.get("vehicle") || "",
    plate: params.get("plate") || "",
    vin: params.get("vin") || "",
    claimNumber: params.get("claim") || "",
    workOrderNumber: params.get("workOrder") || "",
    invoiceNumber: params.get("invoice") || "",
    claimStatus: params.get("claimStatus") || "",
    workOrderStatus: params.get("workOrderStatus") || "",
    vehicleStatus: params.get("vehicleStatus") || "",
    invoiceStatus: params.get("invoiceStatus") || "",
    collectionStatus: params.get("collectionStatus") || "",
    employeeId: params.get("employee") || "",
    surveyorId: params.get("surveyor") || "",
    insuranceEmployeeId: params.get("insuranceEmployee") || "",
    supplierId: params.get("supplier") || "",
    expenseCategory: params.get("expenseCategory") || "",
    paymentMethod: params.get("paymentMethod") || "",
    workshopLocation: params.get("workshopLocation") || "",
    department: params.get("department") || "",
    page: positiveInteger(params.get("page"), REPORT_CENTER_DEFAULTS.page, 100_000),
    pageSize: positiveInteger(params.get("pageSize"), REPORT_CENTER_DEFAULTS.pageSize, 100),
    sort: params.get("sort") || REPORT_CENTER_DEFAULTS.sort,
    direction: oneOf(params.get("direction"), ["asc", "desc"] as const, REPORT_CENTER_DEFAULTS.direction),
    groupBy: params.get("groupBy") || "",
  };
}

export function setReportCenterParam(
  current: URLSearchParams,
  key: string,
  value: string | number | null | undefined,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (value === null || value === undefined || value === "") next.delete(key);
  else next.set(key, String(value));
  if (!["page", "pageSize"].includes(key)) next.delete("page");
  return next;
}

export function activeReportFilterEntries(params: URLSearchParams): Array<[string, string]> {
  const hidden = new Set(["category", "report", "page", "pageSize", "sort", "direction"]);
  return Array.from(params.entries()).filter(([key, value]) => value && !hidden.has(key));
}

export function appendReportFilters(route: string, params: URLSearchParams): string {
  const url = new URL(route, "https://reports.local");
  for (const [key, value] of params.entries()) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}
