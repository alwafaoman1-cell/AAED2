import type { AppRole } from "@/contexts/AuthContext";
import { can } from "@/lib/rbac";

export type ReportPermission =
  | "reports.view"
  | "reports.insurance"
  | "reports.cash"
  | "reports.accounting"
  | "reports.profitability"
  | "reports.expenses"
  | "reports.operations"
  | "reports.export_excel"
  | "reports.export_pdf"
  | "reports.print"
  | "reports.saved_views"
  | "reports.admin";

const ACTION_BY_PERMISSION: Record<ReportPermission, string> = {
  "reports.view": "View Center",
  "reports.insurance": "Insurance Reports",
  "reports.cash": "Cash Reports",
  "reports.accounting": "Accounting Reports",
  "reports.profitability": "Profitability Reports",
  "reports.expenses": "Expense Reports",
  "reports.operations": "Operations Reports",
  "reports.export_excel": "Export Excel",
  "reports.export_pdf": "Export PDF",
  "reports.print": "Print",
  "reports.saved_views": "Saved Views",
  "reports.admin": "Reports Administration",
};

const REPORT_PERMISSION_BY_KEY: Record<string, ReportPermission> = {
  "claims-register": "reports.insurance",
  "insurance-company-statement": "reports.insurance",
  "cash-invoices": "reports.cash",
  "all-company-invoices": "reports.accounting",
  "work-orders": "reports.operations",
  "vehicles-in-workshop": "reports.operations",
  "completed-without-invoice": "reports.operations",
  "delivered-awaiting-collection": "reports.accounting",
  expenses: "reports.expenses",
  "gross-profitability": "reports.profitability",
  "workshop-duration": "reports.operations",
  invoices: "reports.accounting",
  payments: "reports.accounting",
  aging: "reports.accounting",
};

export function reportPermissionForKey(reportKey: string): ReportPermission {
  return REPORT_PERMISSION_BY_KEY[reportKey] || "reports.admin";
}
export function canUseReportPermission(
  role: AppRole | null | undefined,
  permission: ReportPermission,
): boolean {
  return can(role, "Reports Center", ACTION_BY_PERMISSION[permission]);
}

export function canOpenReportsCenter(role: AppRole | null | undefined): boolean {
  return canUseReportPermission(role, "reports.view");
}

export function canOpenReport(role: AppRole | null | undefined, reportKey: string): boolean {
  return (
    canOpenReportsCenter(role) &&
    canUseReportPermission(role, reportPermissionForKey(reportKey))
  );
}

export function canExportReport(
  role: AppRole | null | undefined,
  format: "xlsx" | "pdf" | "print",
): boolean {
  const permission: ReportPermission =
    format === "xlsx"
      ? "reports.export_excel"
      : format === "pdf"
        ? "reports.export_pdf"
        : "reports.print";
  return canUseReportPermission(role, permission);
}
