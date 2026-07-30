import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  calculateDirectCosts,
  calculateGrossMargin,
  calculateGrossProfit,
  calculateOutstanding,
} from "@/lib/reports-center/reportCalculationRules";
import { parseReportCenterFilters } from "@/lib/reports-center/reportCenterUrlState";
import { REPORT_DEFINITIONS } from "@/lib/reports-center/reportDefinitions";
import { classifyReportBusinessType } from "@/lib/reports-center/reportBusinessType";
import { buildReportWorkbook } from "@/lib/reports-center/reportExportService";
import {
  canExportReport,
  canOpenReport,
  canOpenReportsCenter,
} from "@/lib/reports-center/reportPermissions";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("reports center contract", () => {
  it("keeps insurance and cash definitions explicitly separated", () => {
    expect(REPORT_DEFINITIONS.some((report) => report.businessTypes.includes("insurance"))).toBe(true);
    expect(REPORT_DEFINITIONS.some((report) => report.businessTypes.includes("cash"))).toBe(true);
    expect(REPORT_DEFINITIONS.find((report) => report.key === "claims-register")?.businessTypes).toEqual(["insurance"]);
    expect(REPORT_DEFINITIONS.find((report) => report.key === "cash-invoices")?.businessTypes).toEqual(["cash"]);
  });

  it("uses URL parameters as the normalized report filter source", () => {
    const filters = parseReportCenterFilters(
      new URLSearchParams("businessType=insurance&from=2026-07-01&to=2026-07-29&page=2&pageSize=50&plate=1234"),
      "tenant-a",
    );
    expect(filters).toMatchObject({
      tenantId: "tenant-a",
      businessType: "insurance",
      from: "2026-07-01",
      to: "2026-07-29",
      page: 2,
      pageSize: 50,
      plate: "1234",
    });
  });

  it("calculates OMR report values with the shared money rules", () => {
    expect(calculateOutstanding(105, 25)).toBe(80);
    expect(calculateDirectCosts({ parts: 10.1, labor: 20.2, transport: 0.005 })).toBe(30.305);
    expect(calculateGrossProfit(100, 30.305)).toBe(69.695);
    expect(calculateGrossMargin(100, 69.695)).toBe(69.695);
  });

  it("uses a tenant-bound server summary and never falls back to page totals", () => {
    const service = read("src/lib/reports-center/reportCenterService.ts");
    const page = read("src/pages/ReportsCenter.tsx");
    expect(service).toContain("reports_center_secure_summary_rpc");
    expect(service).toContain("p_tenant_id: filters.tenantId");
    expect(page).toContain("refetchOnWindowFocus: false");
    expect(page).toContain("No estimated or page-only totals are shown");
    expect(page).not.toContain("usePersistedState");
    expect(page).not.toContain("localStorage");
  });

  it("keeps the reports read-model migration non-destructive and accounting-safe", () => {
    const migration = read("supabase/migrations/20260729110000_reports_center_read_models.sql");
    expect(migration).toContain("reports_center_summary_rpc");
    expect(migration).toContain("report_saved_views");
    expect(migration).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(migration).toContain("i.subtotal");
    expect(migration).toContain("s.subtotal");
    expect(migration).toContain("direct_costs");
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/\bdrop\s+table\b/i);
    expect(migration).not.toContain("jo.subtotal");
    expect(migration).not.toContain("jo.final_total");
    expect(migration).toContain("e.deleted_at is null");
    expect(migration).toContain("e.archived_at is null");
    expect(migration).toContain("s.deleted_at is null");
    expect(migration).toContain("s.archived_at is null");
  });

  it("preserves the old report-center route as a redirect", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/reports-center"');
    expect(app).toContain('path="/reports/center" element={<ReportsLegacyRedirect to="/reports-center"');
  });

  it("classifies insurance, cash and unknown records structurally", () => {
    expect(
      classifyReportBusinessType({ recordKind: "work_order", claimId: "claim-a" }),
    ).toBe("insurance");
    expect(
      classifyReportBusinessType({ recordKind: "work_order", claimId: null }),
    ).toBe("cash");
    expect(
      classifyReportBusinessType({
        recordKind: "customer_invoice",
        linkedClaimId: "claim-a",
        hasCustomerInvoice: true,
      }),
    ).toBe("insurance");
    expect(
      classifyReportBusinessType({
        recordKind: "customer_invoice",
        hasCustomerInvoice: true,
      }),
    ).toBe("cash");
    expect(classifyReportBusinessType({ recordKind: "other" })).toBe("unknown");
  });

  it("defines tenant-safe paginated RPCs for every phase-two report family", () => {
    const migration = read(
      "supabase/migrations/20260729120000_reports_center_detail_read_models.sql",
    );
    [
      "reports_claims_register_rpc",
      "reports_work_orders_rpc",
      "reports_invoices_rpc",
      "reports_payments_rpc",
      "reports_expenses_rpc",
      "reports_vehicles_in_workshop_rpc",
      "reports_completed_without_invoice_rpc",
      "reports_delivered_awaiting_collection_rpc",
      "reports_insurance_company_statement_rpc",
      "reports_aging_rpc",
      "reports_profitability_rpc",
    ].forEach((rpc) => expect(migration).toContain(rpc));
    expect(migration).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("'unknown'");
    expect(migration).not.toMatch(/\busing\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/\bdrop\s+table\b/i);
  });

  it("prevents duplicate financial joins and excludes invalid accounting rows", () => {
    const migration = read(
      "supabase/migrations/20260729120000_reports_center_detail_read_models.sql",
    );
    expect(migration).toContain("active_invoice_count = 1");
    expect(migration).toContain("p.offset_against_invoice_id = i.id");
    expect(migration).toContain(
      "lower(p.status::text) in ('cleared', 'paid', 'completed', 'success', 'succeeded')",
    );
    expect(migration).toContain("e.deleted_at is null");
    expect(migration).toContain("e.archived_at is null");
    expect(migration).toContain("i.work_order_id = w.id");
    expect(migration).not.toContain("e.supplier_id,");
  });

  it("builds insurance statements from invoice and payment transactions", () => {
    const migration = read(
      "supabase/migrations/20260729120000_reports_center_detail_read_models.sql",
    );
    expect(migration).toContain("reports_insurance_statement_facts_v1");
    expect(migration).toContain("'invoice'::text as transaction_type");
    expect(migration).toContain("'payment'::text");
    expect(migration).toContain("rows between unbounded preceding and current row");
    expect(migration).toContain("'runningBalance', s.running_balance");
  });

  it("loads detail rows and full exports from the same server report service", () => {
    const service = read("src/lib/reports-center/reportCenterService.ts");
    const page = read("src/pages/ReportsCenter.tsx");
    const panel = read("src/components/reports/ReportDataPanel.tsx");
    expect(service).toContain("fetchReportData");
    expect(service).toContain("fetchAllReportRows");
    expect(service).toContain("p_page_size: filters.pageSize");
    expect(panel).toContain("fetchAllReportRows");
    expect(panel).toContain("refetchOnWindowFocus: false");
    expect(page).toContain('next.set("report", report.key)');
    expect(page).not.toContain("navigate(appendReportFilters");
  });

  it("builds a real filtered XLSX workbook with OMR precision and normalized dates", () => {
    const workbook = buildReportWorkbook({
      fileName: "report.xlsx",
      sheetName: "Invoices",
      title: "Invoice Report",
      filters: [{ label: "From", value: "2026-07-01" }],
      columns: [
        { key: "invoice", label: "Invoice", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "total", label: "Total", type: "money" },
      ],
      rows: [
        {
          invoice: "INV-2026-00001",
          date: "2026-07-29T09:30:00.000Z",
          total: 105,
        },
      ],
    });

    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    const parsed = XLSX.read(bytes, { type: "buffer", cellNF: true, cellStyles: true });
    const sheet = parsed.Sheets.Invoices;
    expect(sheet).toBeTruthy();
    expect(parsed.Sheets.Summary).toBeTruthy();
    expect(sheet.A7.v).toBe("INV-2026-00001");
    expect(sheet.B7.v).toBe("2026-07-29");
    expect(sheet.C7.v).toBe(105);
    expect(sheet.C7.z).toBe('0.000 "OMR"');
    expect(sheet["!autofilter"]?.ref).toBe("A6:C7");
    expect(sheet["!cols"]?.[0]?.wch).toBeGreaterThanOrEqual(16);
  });

  it("keeps report RPCs private to authenticated users and preserves requested sorting", () => {
    const securityMigration = read(
      "supabase/migrations/20260729130000_reports_center_security_hardening.sql",
    );
    const sortingMigration = read(
      "supabase/migrations/20260729140000_reports_center_sorting_fix.sql",
    );
    expect(securityMigration).toContain("from anon");
    expect(securityMigration).toContain("reports_center_summary_rpc");
    expect(securityMigration).toContain("reports_center_query_rpc");
    expect(sortingMigration).toContain("p_sort = 'reference'");
    expect(sortingMigration).toContain("p_sort = 'outstanding'");
    expect(sortingMigration).toContain("p_sort = 'gross_profit'");
    expect(sortingMigration).not.toMatch(/\bdelete\s+from\b/i);
    expect(sortingMigration).not.toMatch(/\bdrop\s+table\b/i);
  });

  it("keeps the completed-without-invoice KPI aligned with its detail report", () => {
    const parityMigration = read(
      "supabase/migrations/20260729150000_reports_center_summary_parity_fix.sql",
    );
    expect(parityMigration).toContain(
      "reports_center_summary_rpc completed-without-invoice source changed",
    );
    expect(parityMigration).toContain("deleted_at is null");
    expect(parityMigration).not.toMatch(/\bdrop\s+(table|view|function)\b/i);
    expect(parityMigration).not.toMatch(/\b(delete|truncate)\s+from\b/i);
  });

  it("enforces granular report permissions in UI, service and database layers", () => {
    const permissions = read("src/lib/reports-center/reportPermissions.ts");
    const page = read("src/pages/ReportsCenter.tsx");
    const panel = read("src/components/reports/ReportDataPanel.tsx");
    const service = read("src/lib/reports-center/reportCenterService.ts");
    const migration = read(
      "supabase/migrations/20260730103000_reports_center_permissions_and_work_orders_performance.sql",
    );
    for (const permission of [
      "reports.view",
      "reports.insurance",
      "reports.cash",
      "reports.accounting",
      "reports.profitability",
      "reports.expenses",
      "reports.operations",
      "reports.export_excel",
      "reports.export_pdf",
      "reports.print",
      "reports.saved_views",
      "reports.admin",
    ]) {
      expect(permissions).toContain(permission);
      expect(migration).toContain(permission);
    }
    expect(page).toContain("canOpenReport");
    expect(panel).toContain("canExportReport");
    expect(service).toContain("reports_permission_denied");
    expect(migration).toContain("reports_has_permission");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toContain("using (true)");
  });

  it("keeps reports routes and legacy redirects inside the reports center", () => {
    const app = read("src/App.tsx");
    const redirect = read("src/components/reports/ReportsLegacyRedirect.tsx");
    expect(app).toContain('path="/reports-center"');
    expect(app).toContain('path="/reports" element={<ReportsLegacyRedirect to="/reports-center"');
    expect(app).toContain(
      'path="/reports/completed-without-invoice" element={<ReportsLegacyRedirect to="/reports-center?report=completed-without-invoice',
    );
    expect(app).toContain(
      'path="/reports/center" element={<ReportsLegacyRedirect to="/reports-center"',
    );
    expect(redirect).toContain("location.search");
    expect(redirect).toContain("target.searchParams.append");
  });

  it("uses a dedicated pre-aggregated Work Orders RPC without financial data mutation", () => {
    const migration = read(
      "supabase/migrations/20260730103000_reports_center_permissions_and_work_orders_performance.sql",
    );
    expect(migration).toContain("scoped as materialized");
    expect(migration).toContain("invoice_totals as materialized");
    expect(migration).toContain("expense_totals as materialized");
    expect(migration).toContain("idx_reports_job_orders_tenant_created_active");
    expect(migration).not.toMatch(/\b(delete|truncate|update|insert)\b/i);
    expect(migration).not.toMatch(/\bdrop\s+(table|view|function)\b/i);
  });

  it("keeps report queries stable when the browser regains focus", () => {
    const page = read("src/pages/ReportsCenter.tsx");
    const panel = read("src/components/reports/ReportDataPanel.tsx");
    expect(page).toContain("refetchOnWindowFocus: false");
    expect(panel).toContain("refetchOnWindowFocus: false");
    expect(page).not.toContain("visibilitychange");
    expect(panel).not.toContain("visibilitychange");
  });

  it("enforces the intended Admin, Accounting, Operations and basic role matrix", () => {
    expect(canOpenReportsCenter("admin")).toBe(true);
    expect(canOpenReport("admin", "gross-profitability")).toBe(true);
    expect(canExportReport("admin", "xlsx")).toBe(true);

    expect(canOpenReport("accountant", "all-company-invoices")).toBe(true);
    expect(canOpenReport("accountant", "gross-profitability")).toBe(true);
    expect(canOpenReport("accountant", "work-orders")).toBe(false);
    expect(canExportReport("accountant", "pdf")).toBe(true);

    expect(canOpenReport("supervisor", "work-orders")).toBe(true);
    expect(canOpenReport("supervisor", "gross-profitability")).toBe(false);
    expect(canExportReport("supervisor", "xlsx")).toBe(false);

    expect(canOpenReportsCenter("technician")).toBe(false);
    expect(canOpenReport("technician", "work-orders")).toBe(false);
    expect(canExportReport("technician", "print")).toBe(false);
  });

  it("persists saved views in Supabase and protects them with granular RLS", () => {
    const service = read("src/lib/reports-center/savedViewsService.ts");
    const page = read("src/pages/ReportsCenter.tsx");
    const migration = read(
      "supabase/migrations/20260730113000_reports_center_access_assertion.sql",
    );
    expect(service).toContain('.from("report_saved_views")');
    expect(page).toContain("fetchReportSavedViews");
    expect(page).toContain("createReportSavedView");
    expect(page).not.toContain("localStorage");
    expect(migration).toContain("reports.saved_views");
    expect(migration).toContain("reports_assert_access");
    expect(migration).toContain("reports_permission_denied");
    expect(migration).not.toMatch(/\b(delete|truncate)\s+from\b/i);
    expect(migration).not.toMatch(/\bdrop\s+(table|view|function)\b/i);
  });

  it("fails closed when an authenticated identity has no matching tenant", () => {
    const migration = read(
      "supabase/migrations/20260730120000_reports_center_tenant_null_guard.sql",
    );
    expect(migration).toContain("is distinct from public.get_user_tenant_id()");
    expect(migration).toContain("reports_tenant_access_denied");
    expect(migration).toContain("perform public.reports_assert_access");
    expect(migration).not.toMatch(/\b(delete|truncate)\s+from\b/i);
    expect(migration).not.toMatch(/\bdrop\s+(table|view|function)\b/i);
    const wrapper = read(
      "supabase/migrations/20260730123000_reports_center_work_orders_fail_closed_wrapper.sql",
    );
    expect(wrapper).toContain("perform public.reports_assert_access");
    expect(wrapper).toContain("reports_work_orders_query_v1");
    expect(wrapper).toContain("from public, anon, authenticated");
    expect(wrapper).not.toMatch(/\b(delete|truncate)\s+from\b/i);
  });
});
