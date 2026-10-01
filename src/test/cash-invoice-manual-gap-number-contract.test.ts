import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("optional manual earlier number for new cash invoices", () => {
  const migration = read("supabase/migrations/20261001100000_cash_invoice_manual_gap_issuance.sql");
  const editor = read("src/components/sales/SalesDocEditorPage.tsx");
  const store = read("src/lib/salesStore.ts");

  it("never mutates the current numbering counter or old invoice rows", () => {
    expect(migration).toContain("v_sequence >= v_next_value");
    expect(migration).toContain("invoice_number_sequences");
    expect(migration).not.toMatch(/\b(update|delete|insert into)\s+public\.invoice_number_sequences\b/i);
    expect(migration).not.toMatch(/\b(update|delete)\s+public\.invoice_number_registry\b/i);
    expect(migration).not.toMatch(/\b(update|delete)\s+public\.insurance_invoices\b/i);
  });

  it("enforces tenant, role, draft, year and all-source uniqueness in PostgreSQL", () => {
    expect(migration).toContain("v_role not in ('admin', 'manager')");
    expect(migration).toContain("tenant_id = v_tenant_id for update");
    expect(migration).toContain("MANUAL_NUMBER_REQUIRES_UNNUMBERED_DRAFT");
    expect(migration).toContain("MANUAL_NUMBER_YEAR_OR_FORMAT_INVALID");
    expect(migration).toContain("from public.invoice_number_audit_events");
    expect(migration).toContain("from public.sales_documents");
    expect(migration).toContain("from public.insurance_invoices");
    expect(migration).toContain("from public.invoices");
    expect(migration).toContain("for update");
    expect(migration).toContain("'allocated'");
    expect(migration).toContain('"allocation_mode":"manual_gap"');
  });

  it("preserves the automatic path and requests manual allocation only when filled", () => {
    expect(editor).toContain("requestedInvoiceNumber: requestedNumber || undefined");
    expect(editor).toContain("doc.requestedInvoiceNumber || \"\"");
    expect(store).toContain('requestedNumber ? "issue_sales_document_invoice_with_number" : "issue_sales_document_invoice"');
    expect(store).toContain("requestedInvoiceNumber: doc.requestedInvoiceNumber");
    expect(store).toContain("requestedInvoiceNumber: m.requestedInvoiceNumber");
    expect(store).toContain("requestedInvoiceNumber: undefined,");
    expect(store).toContain("if (error) throw error");
    expect(store).toContain("await refreshSalesDocumentFromCloud(cloudDraft.id)");
  });
});
