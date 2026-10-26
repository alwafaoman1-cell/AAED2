import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAllUnifiedInvoices,
  fetchUnifiedInvoicePage,
  summarizeOutputVat,
  type UnifiedInvoiceFilters,
  type UnifiedInvoiceRow,
} from "@/lib/unifiedInvoiceTaxReport";

const mock = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  response: (_from: number, _to: number) => ({ data: [] as UnifiedInvoiceRow[], count: 0, error: null }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      mock.calls.push(["from", table]);
      const query = {
        select: (...args: unknown[]) => { mock.calls.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { mock.calls.push(["eq", ...args]); return query; },
        gte: (...args: unknown[]) => { mock.calls.push(["gte", ...args]); return query; },
        lte: (...args: unknown[]) => { mock.calls.push(["lte", ...args]); return query; },
        gt: (...args: unknown[]) => { mock.calls.push(["gt", ...args]); return query; },
        ilike: (...args: unknown[]) => { mock.calls.push(["ilike", ...args]); return query; },
        order: (...args: unknown[]) => { mock.calls.push(["order", ...args]); return query; },
        range: (from: number, to: number) => { mock.calls.push(["range", from, to]); return Promise.resolve(mock.response(from, to)); },
      };
      return query;
    },
  },
}));

const filters: UnifiedInvoiceFilters = {
  tenantId: "tenant-1", source: "all", from: "", to: "", invoiceNumber: "", party: "", plate: "", collection: "all", vat: "all",
};

function row(id: string, source_type: string, subtotal: number, vat: number): UnifiedInvoiceRow {
  return { id, source_type, invoice_number: `INV-${id}`, invoice_date: "2026-10-26", status: "issued", claim_id: null, claim_number: null, party_name: "Test", plate: null, subtotal, vat, total: subtotal + vat, paid: 0, outstanding: subtotal + vat };
}

beforeEach(() => {
  mock.calls.length = 0;
  mock.response = () => ({ data: [], count: 0, error: null });
});

describe("unified invoice and output VAT report", () => {
  it("provides Arabic and English labels for every invoice table column", () => {
    const ar = JSON.parse(readFileSync("src/i18n/locales/ar.json", "utf8")).unifiedInvoices;
    const en = JSON.parse(readFileSync("src/i18n/locales/en.json", "utf8")).unifiedInvoices;
    for (const key of ["source", "number", "date", "party", "plate", "subtotal", "vat", "total", "collection"]) {
      expect(ar[key], `Arabic ${key}`).toBeTruthy();
      expect(en[key], `English ${key}`).toBeTruthy();
    }
  });

  it("reads only the tenant-scoped security-invoker view and filters source, date, collection, and VAT on the server", async () => {
    await fetchUnifiedInvoicePage({ ...filters, source: "insurance_invoice", from: "2026-07-01", to: "2026-07-31", collection: "partial", vat: "positive" }, 2, 50);
    expect(mock.calls).toContainEqual(["from", "reports_invoice_facts_v1"]);
    expect(mock.calls).toContainEqual(["eq", "tenant_id", "tenant-1"]);
    expect(mock.calls).toContainEqual(["eq", "source_type", "insurance_invoice"]);
    expect(mock.calls).toContainEqual(["gte", "invoice_date", "2026-07-01"]);
    expect(mock.calls).toContainEqual(["lte", "invoice_date", "2026-07-31"]);
    expect(mock.calls).toContainEqual(["gt", "paid", 0.001]);
    expect(mock.calls).toContainEqual(["gt", "vat", 0]);
    expect(mock.calls).toContainEqual(["range", 50, 99]);
    const migration = readFileSync("supabase/migrations/20260729120000_reports_center_detail_read_models.sql", "utf8").toLowerCase();
    expect(migration).toContain("reports_invoice_facts_v1");
    expect(migration).toContain("security_invoker = true");
    expect(migration).toContain("from public.insurance_invoices i");
    expect(migration).toContain("from public.sales_documents s");
  });

  it("fetches every filtered invoice for export and totals cash and insurance VAT independently in baisa", async () => {
    mock.response = (from) => from === 0
      ? { data: Array.from({ length: 500 }, (_, index) => row(String(index), "customer_invoice", 10, 0.5)), count: 501, error: null }
      : { data: [row("last", "insurance_invoice", 20, 1)], count: 501, error: null };
    const rows = await fetchAllUnifiedInvoices(filters);
    expect(rows).toHaveLength(501);
    expect(mock.calls).toContainEqual(["range", 500, 999]);
    const summary = summarizeOutputVat(rows);
    expect(summary.customer_invoice).toEqual({ count: 500, subtotal: 5000, vat: 250, total: 5250 });
    expect(summary.insurance_invoice).toEqual({ count: 1, subtotal: 20, vat: 1, total: 21 });
    expect(summary.all.vat).toBe(251);
  });

  it("rejects an incomplete or changing export instead of silently writing a partial tax file", async () => {
    mock.response = (from) => from === 0
      ? { data: Array.from({ length: 500 }, (_, index) => row(String(index), "customer_invoice", 10, 0.5)), count: 501, error: null }
      : { data: [row("last", "insurance_invoice", 20, 1)], count: 502, error: null };
    await expect(fetchAllUnifiedInvoices(filters)).rejects.toThrow("INVOICE_SET_CHANGED_DURING_EXPORT");
    await expect(fetchUnifiedInvoicePage({ ...filters, tenantId: "" }, 1)).rejects.toThrow("TENANT_REQUIRED");
  });
});
