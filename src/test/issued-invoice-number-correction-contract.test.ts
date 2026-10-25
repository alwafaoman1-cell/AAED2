import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("temporary issued invoice number correction", () => {
  const migration = read("supabase/migrations/20261025140739_temporary_issued_invoice_number_correction.sql");
  const pdfGuard = read("supabase/migrations/20261025140744_issued_insurance_invoice_pdf_snapshot_guard.sql");
  const accountingGuard = read("supabase/migrations/20261025140748_issued_invoice_number_accounting_link_guard.sql");
  const numericGuard = read("supabase/migrations/20261025140752_issued_invoice_legacy_numeric_reservation_guard.sql");
  const historicalCash = read("supabase/migrations/20261025140756_historical_cash_invoice_number_correction_window.sql");
  const historicalInsuranceGuard = read("supabase/migrations/20261025140800_historical_insurance_number_period_and_status_guard.sql");
  const runtime = read("supabase/tests/issued_invoice_number_correction_runtime.sql");
  const service = read("src/lib/invoiceNumberCorrection.ts");
  const cash = read("src/components/sales/SalesDocEditorPage.tsx");
  const insurance = read("src/components/insurance/EditInsuranceInvoiceDialog.tsx");
  const settings = read("src/pages/settings/NumberingSettingsPage.tsx");

  it("installs a default-closed, admin-only, automatically expiring correction window", () => {
    expect(migration).toContain("add column if not exists correction_enabled_until timestamptz");
    expect(migration).toContain("public.get_user_role()::text is distinct from 'admin'");
    expect(migration).toContain("p_minutes not between 0 and 60");
    expect(migration).toContain("make_interval(mins => p_minutes)");
    expect(migration).toContain("correction_enabled_until <= clock_timestamp()");
    expect(migration).toContain("invoice_number_correction_access_audit");
    expect(settings).toContain("setInvoiceNumberCorrectionWindow(minutes, correctionReason)");
    expect(settings).toContain("changeCorrectionWindow(0)");
  });

  it("corrects both invoice families atomically without changing money or future sequence", () => {
    expect(migration).toContain("p_source_table not in ('sales_documents','insurance_invoices')");
    expect(migration).toContain("for update");
    expect(migration).toContain("v_sequence >= v_next");
    expect(migration).toContain("update public.invoice_number_registry r");
    expect(migration).toContain("update public.sales_documents d set doc_number = v_new");
    expect(migration).toContain("update public.insurance_invoices i set invoice_number = v_new");
    expect(migration).toContain("'old_invoice_number', v_old, 'new_invoice_number', v_new");
    expect(migration).not.toMatch(/update public\.invoice_number_sequences/i);
    expect(migration).not.toMatch(/set\s+(subtotal|total|vat|paid_amount)\s*=/i);
    expect(runtime).toContain("TEST_ISSUANCE_COUNTER_CHANGED");
    expect(runtime).toContain("TEST_FINANCIAL_TOTAL_CHANGED");
    expect(runtime).toContain("rollback;");
  });

  it("blocks direct writes, reused numbers, accounting-linked and finalized invoices", () => {
    expect(migration).toContain("INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED");
    expect(migration).toContain("INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED");
    expect(migration).toContain("INVOICE_NUMBER_ALREADY_USED");
    expect(migration).toContain("ISSUED_CASH_INVOICE_NUMBER_IMMUTABLE");
    expect(pdfGuard).toContain("old.pdf_url is not null");
    expect(accountingGuard).toContain("before update of invoice_number on public.invoice_number_registry");
    expect(accountingGuard).toContain("l.tenant_id = old.tenant_id and l.source_id = old.source_id");
    expect(accountingGuard).toContain("guard_historical_insurance_number_window");
    expect(runtime).toContain("TEST_ACCOUNTING_LINKED_NUMBER_CHANGED");
    expect(numericGuard).toContain("trg_guard_legacy_numeric_invoice_reservation");
    expect(runtime).toContain("TEST_LEGACY_NUMERIC_SLOT_REUSED");
    expect(historicalCash).toContain("correct_historical_cash_invoice_number");
    expect(runtime).toContain("TEST_HISTORICAL_CASH_CORRECTION_FAILED");
    expect(historicalInsuranceGuard).toContain("INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED");
    expect(historicalInsuranceGuard).toContain("INVOICE_NUMBER_CORRECTION_FINALIZED");
    expect(runtime).toContain("TEST_HISTORICAL_INSURANCE_CLOSED_PERIOD_CHANGED");
    expect(runtime).toContain("TEST_ARCHIVED_PDF_NUMBER_CHANGED");
    expect(runtime).toContain("TEST_RETIRED_NUMBER_REUSED");
    expect(runtime).toContain("TEST_MANAGER_CORRECTION_ALLOWED");
    expect(runtime).toContain("TEST_WRONG_TENANT_ALLOWED");
    expect(runtime).toContain("TEST_ANONYMOUS_EXECUTE_ALLOWED");
  });

  it("uses a distinct number-only action and confirms the database result", () => {
    expect(service).toContain('"correct_issued_invoice_number"');
    expect(service).toContain("row?.invoice_number !== expected");
    expect(cash).toContain("salesStore.correctIssuedInvoiceNumber(");
    expect(cash).toContain("onClick={() => void correctNumber()}");
    expect(insurance).toContain("correctIssuedNumber.mutateAsync(correction)");
    expect(insurance).toContain("otherFieldsEdited");
  });
});
