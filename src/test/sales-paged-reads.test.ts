import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/salesStore", () => ({ numberPrefix: () => "QT" }));
vi.mock("@/lib/numberingSettings", () => ({ resolveSeriesByPrefix: () => ({ startFrom: 1, padding: 5 }) }));

import {
  fetchCashSalesPaymentsPage,
  fetchSalesDocumentExport,
  fetchSalesDocumentPage,
  fetchSalesFinancialSummary,
} from "@/lib/salesDocumentQueries";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sales read architecture", () => {
  beforeEach(() => rpc.mockReset());

  it("requests only the selected document page and maps authoritative payment summary", async () => {
    rpc.mockResolvedValue({ data: { totalCount: 57, items: [{
      id: "one", doc_number: "INV-26-000174", doc_type: "invoice", status: "partial",
      date: "2026-10-01", created_at: "2026-10-01T00:00:00Z", customer_name: "A",
      customer_phone: "1", customer_tax_no: "OM123", subtotal: 10, tax_total: 0.5,
      total: 10.5, paid_amount: 5, balance_due: 5.5, last_payment_date: "2026-10-02",
    }] }, error: null });
    const page = await fetchSalesDocumentPage({ tenantId: "tenant-a", type: "invoice", page: 2, status: "partial", search: "OM123" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_sales_documents_page_rpc", expect.objectContaining({
      p_tenant_id: "tenant-a", p_doc_type: "invoice", p_page: 2, p_page_size: 30,
      p_status: "partial", p_search: "OM123",
    }));
    expect(page.total).toBe(57);
    expect(page.rows[0]).toMatchObject({ total: 10.5, paidTotal: 5, balanceDue: 5.5, customerTaxNo: "OM123" });
  });

  it("exports all filtered rows only after an explicit call and fails closed on a page error", async () => {
    rpc.mockResolvedValueOnce({ data: { totalCount: 101, items: Array.from({ length: 100 }, (_, id) => ({ id: String(id) })) }, error: null })
      .mockResolvedValueOnce({ data: { totalCount: 101, items: [{ id: "last" }] }, error: null });
    const rows = await fetchSalesDocumentExport({ tenantId: "tenant-a", type: "invoice", status: "paid", search: "A" });
    expect(rows).toHaveLength(101);
    expect(rpc).toHaveBeenNthCalledWith(2, "list_sales_documents_page_rpc", expect.objectContaining({ p_page: 2 }));
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: new Error("network") });
    await expect(fetchSalesDocumentExport({ tenantId: "tenant-a", type: "invoice" })).rejects.toThrow("network");
  });

  it("keeps cash sales summary and payment rows as bounded, tenant-scoped reads", async () => {
    rpc.mockResolvedValueOnce({ data: { invoiceCount: 2, revenue: 20, invoiceTotal: 21, paid: 10, unpaidCount: 1, monthly: [] }, error: null })
      .mockResolvedValueOnce({ data: { totalCount: 1, items: [{ id: "p", amount: 5, invoice_id: "i", invoice_number: "INV-1", customer_name: "A" }] }, error: null });
    const summary = await fetchSalesFinancialSummary("tenant-a", "2026-10-01", "2026-10-31");
    const payments = await fetchCashSalesPaymentsPage("tenant-a", 1, "INV-1");
    expect(summary.revenue).toBe(20);
    expect(payments.rows[0]).toMatchObject({ invoiceNumber: "INV-1", amount: 5 });
    expect(rpc).toHaveBeenNthCalledWith(1, "sales_financial_read_summary_rpc", expect.objectContaining({ p_tenant_id: "tenant-a" }));
    expect(rpc).toHaveBeenNthCalledWith(2, "list_cash_sales_payments_page_rpc", expect.objectContaining({ p_tenant_id: "tenant-a", p_page_size: 30 }));
  });

  it("does not start a full sales sync on login or from the invoice list", () => {
    const store = source("src/lib/salesStore.ts");
    const list = source("src/components/sales/SalesDocList.tsx");
    expect(store).not.toContain("scheduleSalesRefresh(1500)");
    expect(list).not.toContain("salesStore.refresh()");
    expect(list).toContain("fetchSalesDocumentPage");
    expect(list).toContain("pageCount");
    expect(list).toContain('refetchOnMount: "always"');
    expect(list).toContain("refetchOnWindowFocus: false");
    expect(source("src/components/sales/SalesDocDetailPage.tsx")).toContain("salesStore.refreshOne(id)");
  });

  it("requires tenant authorization and returns no insurance invoices from financial summaries", () => {
    const sql = source("supabase/migrations/20261007100000_sales_financial_read_summary.sql");
    expect(sql.match(/security invoker/g)?.length).toBe(3);
    expect(sql.match(/p_tenant_id = public\.get_user_tenant_id\(\)/g)?.length).toBe(3);
    expect(sql).toContain("d.doc_type = 'invoice'");
    expect(sql).toContain("d.deleted_at is null");
    expect(sql).toContain("d.status not in ('draft', 'cancelled')");
    expect(sql).toContain("from public.sales_payments p");
    expect(sql.match(/filtered as not materialized/g)?.length).toBe(2);
    expect(sql).toContain("sales_documents_tenant_type_number_active_idx");
    expect(sql).toContain("sales_payments_tenant_date_page_idx");
  });
});
