import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseReportCenterFilters } from "@/lib/reports-center/reportCenterUrlState";

const db = vi.hoisted(() => ({ rpc: vi.fn(), allowed: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc } }));
vi.mock("@/lib/permissions", () => ({ getCurrentRole: () => "manager" }));
vi.mock("@/lib/reports-center/reportPermissions", () => ({
  canUseReportPermission: () => db.allowed, canOpenReport: () => db.allowed,
}));
import { fetchAllReportRows, fetchReportCenterSummary, fetchReportData } from "@/lib/reports-center/reportCenterService";

const filters = parseReportCenterFilters(new URLSearchParams("from=2026-07-01&to=2026-07-31&businessType=insurance"), "tenant-test");
function payload() {
  return {
    claims_count: 1, work_orders_count: 1, vehicles_in_workshop: 0, delivered_vehicles: 1,
    estimate_total: 100, approved_total: 100, invoice_subtotal: 95.238, vat: 4.762,
    invoice_total: 100, paid: "85.000", outstanding: "0.000", expenses: 50,
    parts_cost: 50, labor_cost: 0, transport_cost: 0, gross_profit: 45.238,
    gross_margin: 47.5, average_workshop_days: 5, overdue_invoices: 0,
    claims_awaiting_collection: 0, completed_without_invoice: 0,
  };
}
beforeEach(() => {
  db.allowed = true;
  db.rpc.mockReset().mockResolvedValue({ data: payload(), error: null });
});

describe("settlement summary service boundary", () => {
  it("preserves server receivables and cash separately without replacing a settled balance by invoice minus cash", async () => {
    const result = await fetchReportCenterSummary(filters);
    expect(result).toMatchObject({ available: true, summary: { paid: 85, outstanding: 0, invoiceTotal: 100 } });
    expect(db.rpc).toHaveBeenCalledWith("reports_center_secure_summary_rpc", {
      p_tenant_id: "tenant-test", p_from_date: "2026-07-01", p_to_date: "2026-07-31",
      p_business_type: "insurance", p_insurance_company_id: null,
    });
  });
  it.each([null, [], {}, { ...payload(), paid: null }, { ...payload(), outstanding: "" },
    { ...payload(), vat: "not a number" }, { ...payload(), gross_profit: Infinity }])(
    "rejects malformed summaries instead of displaying financial zeros: %j", async (data) => {
      db.rpc.mockResolvedValue({ data, error: null });
      await expect(fetchReportCenterSummary(filters)).rejects.toThrow(/REPORT_SUMMARY_INVALID/);
    },
  );
  it("does not mislabel RLS failure mentioning the RPC as a missing activation", async () => {
    const error = { code: "42501", message: "permission denied for function reports_center_secure_summary_rpc" };
    db.rpc.mockResolvedValue({ data: null, error });
    await expect(fetchReportCenterSummary(filters)).rejects.toBe(error);
  });
  it("returns unavailable only for an actually missing RPC", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    expect(await fetchReportCenterSummary(filters)).toMatchObject({ available: false, summary: null, reason: "summary_rpc_not_activated" });
  });
  it("denies before querying for a role without report access", async () => {
    db.allowed = false;
    await expect(fetchReportCenterSummary(filters)).rejects.toThrow("reports_permission_denied");
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("report detail/export confirmation", () => {
  function detail(rows: unknown[] = [{ id: "row-1", paid: 85, outstanding: 0 }], totalRows = 1, totalPages = 1) {
    return { rows, pagination: { page: 1, pageSize: 100, totalRows, totalPages }, aggregates: { paid: 85, outstanding: 0 } };
  }
  it("does not hide a detail RPC permission error as an inactive report", async () => {
    const error = { code: "42501", message: "permission denied for function reports_invoices_rpc" };
    db.rpc.mockResolvedValue({ data: null, error });
    await expect(fetchReportData("cash-invoices", filters)).rejects.toBe(error);
  });
  it.each([null, {}, { rows: null }, { rows: [], pagination: {} }])("rejects malformed detailed results: %j", async (data) => {
    db.rpc.mockResolvedValue({ data, error: null });
    await expect(fetchReportData("cash-invoices", filters)).rejects.toThrow(/REPORT_DETAIL_INVALID/);
  });
  it("rejects a single-page truncated export too", async () => {
    db.rpc.mockResolvedValue({ data: detail([], 1, 1), error: null });
    await expect(fetchAllReportRows("cash-invoices", filters)).rejects.toThrow("REPORT_EXPORT_INCOMPLETE");
  });
  it("exports all filtered rows without recalculating authoritative aggregates", async () => {
    db.rpc.mockResolvedValueOnce({ data: detail([{ id: "a" }], 2, 2), error: null })
      .mockResolvedValueOnce({ data: detail([{ id: "b" }], 2, 2), error: null });
    const result = await fetchAllReportRows("cash-invoices", filters);
    expect(result.rows).toHaveLength(2);
    expect(result.aggregates).toEqual({ paid: 85, outstanding: 0 });
  });
  it("rejects changing financial totals between pages even if the row count stayed constant", async () => {
    db.rpc.mockResolvedValueOnce({ data: detail([{ id: "a" }], 2, 2), error: null })
      .mockResolvedValueOnce({ data: { ...detail([{ id: "b" }], 2, 2), aggregates: { paid: 90 } }, error: null });
    await expect(fetchAllReportRows("cash-invoices", filters)).rejects.toThrow("REPORT_SET_CHANGED_DURING_EXPORT");
  });
});

describe("additive settlement SQL contracts (runtime is tested separately on Development)", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const view = read("supabase/migrations/20261101082501_reports_invoice_settlement_discount_receivables.sql");
  const summary = read("supabase/migrations/20261104043300_reports_summary_payment_period_and_receivable_parity.sql");
  it("retains tenant boundaries, invoker RLS and invoice-specific payment allocation", () => {
    expect(view).toContain("security_invoker = true");
    expect(view).toContain("p.offset_against_invoice_id = i.id");
    expect(view).toContain("i.active_invoice_count = 1");
    expect(view).toContain("coalesce(i.settlement_discount_amount, 0)");
    expect(summary).toContain("security invoker");
    expect(summary).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(summary).toContain("i.tenant_id = p.tenant_id and i.id = p.sales_document_id");
  });
  it("uses canonical invoice balances and independently date-filtered real receipts", () => {
    expect(summary).toContain("join public.reports_invoice_facts_v1 f");
    expect(summary).toContain("from eligible_insurance_invoice_rows i");
    expect(summary).toContain("join eligible_cash_invoice_rows i");
    expect(summary).toContain("p.payment_date >= p_from_date");
    expect(summary).toContain("due_date < current_date and outstanding > 0");
    expect(summary).toContain("'outstanding', round((select outstanding from invoice_totals), 3)");
  });
  it("does not label previous-filter totals/rows with a newly selected period while loading", () => {
    for (const path of ["src/pages/ReportsCenter.tsx", "src/components/reports/ReportDataPanel.tsx"]) {
      expect(read(path)).not.toContain("placeholderData:");
    }
  });
  it("never mutates invoices, numbers, historical data or posting rules", () => {
    for (const sql of [view, summary]) {
      expect(sql).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|drop\s+table|setval\s*\(|nextval\s*\()\b/i);
      expect(sql).not.toMatch(/\b(grant|revoke)\s+/i);
    }
    const runtime = read("supabase/tests/reports_invoice_settlement_discount_runtime.sql");
    expect(runtime.trim()).toMatch(/rollback;$/);
    expect(runtime).toContain("is distinct from");
  });
  it("enforces parent eligibility after optional joins without changing historical records", () => {
    const monthly = read("supabase/migrations/20261104043915_monthly_vehicle_parent_eligibility_guard.sql");
    expect(monthly).toContain("and (a.work_order_id is null or w.id is not null)");
    expect(monthly).toContain("coalesce(w.claim_id, a.claim_id) is null");
    expect(monthly).toContain("c.id is not null and lower(coalesce(c.status::text, '')) not in");
    expect(monthly).toContain("cost_release_discount_ex_vat");
    expect(monthly).toContain("ACCOUNTING_REPORT_PERMISSION_DENIED");
    expect(monthly).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|drop\s+table)\b/i);
  });
});

