import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260823100000_unified_invoice_numbering.sql",
  "utf8",
);
const hardeningMigration = readFileSync(
  "supabase/migrations/20260823110000_unified_invoice_numbering_cutover_hardening.sql",
  "utf8",
);
const shortYearMigration = readFileSync(
  "supabase/migrations/20260831100000_unified_invoice_short_year_format.sql",
  "utf8",
);
const unifiedSearch = readFileSync("src/lib/unifiedInvoiceSearch.ts", "utf8");
const invoiceList = readFileSync("src/components/sales/SalesDocList.tsx", "utf8");
const salesStore = readFileSync("src/lib/salesStore.ts", "utf8");
const insuranceHook = readFileSync("src/hooks/useInsuranceInvoices.ts", "utf8");
const pdfGenerator = readFileSync("src/lib/pdfGenerator.ts", "utf8");
const cloudReports = readFileSync("src/pages/reports/CloudAdvancedReports.tsx", "utf8");
const salesAccounting = readFileSync("src/lib/salesAccounting.ts", "utf8");
const appRoutes = readFileSync("src/App.tsx", "utf8");
const cutoverPreflight = readFileSync(
  "supabase/tests/unified_invoice_numbering_cutover_preflight.sql",
  "utf8",
);

describe("unified invoice numbering contract", () => {
  it("uses a tenant/year sequence and a cross-source registry", () => {
    expect(migration).toContain("create table if not exists public.invoice_number_sequences");
    expect(migration).toContain("primary key (tenant_id, invoice_year)");
    expect(migration).toContain("create table if not exists public.invoice_number_registry");
    expect(migration).toContain("unique (tenant_id, invoice_number)");
    expect(migration).toContain("unique (tenant_id, invoice_year, sequence_number)");
    expect(migration).toContain("unique (tenant_id, source_table, source_id)");
    expect(migration).toContain("create table if not exists public.invoice_number_audit_events");
    expect(migration).toContain("official invoice number registry records are immutable");
  });

  it("allocates atomically in PostgreSQL and not with client MAX + 1", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("on conflict (tenant_id, invoice_year) do update");
    expect(migration).toContain("public.invoice_number_sequences.next_value + 1");
    expect(salesStore).toContain('if (type === "invoice") return "";');
    expect(salesStore).toContain('"issue_sales_document_invoice"');
    expect(appRoutes).toContain('<Route path="/sales" element={<Navigate to="/sales/invoices" replace />} />');
  });

  it("keeps drafts unnumbered and allocates only through issuance", () => {
    expect(migration).toContain("A future draft never consumes or displays an official invoice number");
    expect(migration).toContain("new.doc_number := ''");
    expect(salesStore).toContain('number: type === "invoice" ? ""');
    expect(salesStore).toContain('invoiceStatus: type === "invoice" ? "draft"');
  });

  it("is explicitly activated per tenant and never renumbers history", () => {
    expect(migration).toContain("activate_unified_invoice_numbering");
    expect(migration).toContain("Historical issued rows have no registry and are deliberately untouched");
    expect(migration).not.toMatch(
      /update\s+public\.(sales_documents|insurance_invoices)\s+set\s+(doc_number|invoice_number)\b/i,
    );
  });

  it("locks every pre-cutover numbered source even when its status drifted to draft", () => {
    expect(hardeningMigration).toContain("v_row.created_at < v_settings.activated_at");
    expect(hardeningMigration).toContain("return query select v_row.id, v_row.doc_number");
    expect(hardeningMigration).toContain("v_source_created_at < v_settings.activated_at");
    expect(hardeningMigration).not.toMatch(
      /update\s+public\.(sales_documents|insurance_invoices)\s+set\s+(doc_number|invoice_number)\b/i,
    );
    expect(salesStore).toContain('issueResult?.invoice_status !== "issued"');
    expect(salesStore).toContain("return historical");
  });

  it("rejects activation at or below the historical maximum", () => {
    expect(hardeningMigration).toContain("INVOICE_SEQUENCE_START_COLLIDES_WITH_HISTORY");
    expect(hardeningMigration).toContain("p_first_sequence <= v_highest_history");
    expect(hardeningMigration).toContain("pg_advisory_xact_lock");
  });

  it("uses one source for future cash and insurance invoice numbers", () => {
    expect(migration).toContain("'sales_documents', new.id, 'cash'");
    expect(migration).toContain("'insurance_invoices', new.id, 'insurance'");
    expect(migration).toContain("drop trigger if exists trg_ins_invoice_number");
    expect(insuranceHook).toContain('invoice_number: ""');
  });

  it("keeps the official database number in PDF templates", () => {
    expect(pdfGenerator).toContain("data.invoiceNumber");
    expect(pdfGenerator).toContain("invoiceRefEscape(data.invoiceNumber)");
  });

  it("keeps database invoice numbers aligned in reports, XLSX and print", () => {
    expect(cloudReports).toContain('invoiceNumber: String(s.doc_number || "—")');
    expect(cloudReports).toContain('invoiceNumber: String(i.invoice_number || "—")');
    expect(cloudReports).toContain('"Invoice Number": r.invoiceNumber');
    expect(cloudReports).toContain('<td>${esc(r.invoiceNumber)}</td>');
  });

  it("posts by technical source id while displaying the official number", () => {
    expect(salesAccounting).toContain("removeJournalBySource(src, args.invoiceId)");
    expect(salesAccounting).toContain("sourceId: args.invoiceId");
    expect(salesAccounting).toContain("فاتورة ${args.invoiceNumber}");
  });

  it("provides a read-only cutover report instead of guessing production start", () => {
    expect(cutoverPreflight).toContain("'sales_documents'::text as source");
    expect(cutoverPreflight).toContain("'insurance_invoices'::text");
    expect(cutoverPreflight).toContain("highest_relevant_sequence");
    expect(cutoverPreflight).not.toMatch(/\b(insert|update|delete|alter|drop|create)\b/i);
  });

  it("does not expose internal allocation to browser roles", () => {
    expect(migration).toContain(
      "revoke all on function public.allocate_invoice_number_internal(uuid,text,uuid,text,date,timestamptz,uuid)",
    );
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("searches the registry first and falls back to every customer invoice source", () => {
    expect(hardeningMigration).toContain("public.invoice_number_registry");
    expect(hardeningMigration).toContain("from public.sales_documents sd");
    expect(hardeningMigration).toContain("from public.insurance_invoices ii");
    expect(hardeningMigration).toContain("from public.invoices i");
    expect(hardeningMigration).not.toContain("from public.purchase_invoices");
    expect(hardeningMigration).toContain("ambiguous_historical_number");
    expect(unifiedSearch).toContain('"find_unified_invoice_number"');
    expect(invoiceList).toContain("runUnifiedInvoiceSearch");
  });

  it("documents the dormant legacy source without deleting or activating it", () => {
    expect(hardeningMigration).toContain("Legacy / dormant customer invoice source");
    expect(hardeningMigration).not.toMatch(/drop\s+table\s+(if\s+exists\s+)?public\.invoices/i);
  });

  it("uses the approved short-year format without changing sequence identity", () => {
    expect(shortYearMigration).toContain("'INV-YY-NNNNNN'");
    expect(shortYearMigration).toContain("right(v_year::text, 2)");
    expect(shortYearMigration).toContain("regexp_replace(r.invoice_number, '^INV-2026-', 'INV-26-')");
    expect(shortYearMigration).toContain("r.invoice_year = 2026");
    expect(shortYearMigration).toContain("set invoice_number = m.new_number");
    expect(shortYearMigration).not.toMatch(/update\s+public\.invoice_number_sequences/i);
  });

  it("renames both official sources atomically and preserves the old lookup alias", () => {
    expect(shortYearMigration).toContain("update public.sales_documents sd");
    expect(shortYearMigration).toContain("update public.insurance_invoices ii");
    expect(shortYearMigration).toContain("event_type = 'allocated'");
    expect(shortYearMigration).toContain("Old official number remains a lookup alias");
    expect(shortYearMigration).toContain("INVOICE_SHORT_YEAR_NUMBER_COLLISION");
  });

  it("accepts short and historical official formats in the cash issuance client", () => {
    expect(salesStore).toContain("/^INV-(?:\\d{2}|\\d{4})-\\d{6,}$/");
  });
});
