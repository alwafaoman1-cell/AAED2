import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(path.join(
  root,
  "supabase/migrations/20260801110000_accounting_posting_rules_engine.sql",
), "utf8");
const service = fs.readFileSync(path.join(
  root,
  "src/lib/accounting/accountingPostingService.ts",
), "utf8");
const supplierExtension = fs.readFileSync(path.join(
  root,
  "supabase/migrations/20260801111000_accounting_supplier_posting_extension.sql",
), "utf8");

describe("Phase 2 source posting contract", () => {
  it("keeps source posting explicit and never adds source-table triggers", () => {
    expect(migration).toContain("No source-table triggers");
    expect(migration).not.toMatch(/create\s+trigger[\s\S]*\bon\s+public\.(sales_documents|invoices|insurance_invoices|sales_payments|claim_payments|expenses)/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.accounting_posting_rules/i);
  });

  it("supports preview, manual posting, and source reversal", () => {
    expect(migration).toContain("preview_accounting_source_posting");
    expect(migration).toContain("post_accounting_source");
    expect(migration).toContain("reverse_accounting_source_posting");
    expect(migration).toContain("'write_performed', false");
    expect(service).toContain("previewAccountingSourcePosting");
    expect(service).toContain("postAccountingSource");
    expect(service).toContain("reverseAccountingSourcePosting");
  });

  it("covers cash, insurance, actual payments, and eligible expenses", () => {
    for (const source of [
      "sales_invoice",
      "cash_invoice",
      "insurance_invoice",
      "sales_payment",
      "claim_payment",
      "expense",
    ]) {
      expect(migration).toContain(`when '${source}'`);
    }
    expect(migration).toContain("p.status::text = 'cleared'");
    expect(migration).toContain("public.is_accounting_source_eligible");
    expect(supplierExtension).toContain("'supplier_invoice'");
    expect(supplierExtension).toContain("'supplier_payment'");
    expect(supplierExtension).toContain("public.is_accounting_source_eligible");
  });

  it("uses mapping keys and never hard-codes account ids", () => {
    expect(migration).toContain("resolve_accounting_account_mapping");
    expect(migration).toContain("$receivable");
    expect(migration).toContain("$revenue");
    expect(migration).toContain("$payment_account");
    expect(migration).toContain("$expense_account");
    expect(migration).not.toMatch(/account_id\s*=\s*'[0-9a-f-]{36}'/i);
  });

  it("provides atomic idempotency and duplicate source protection", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("accounting_posting_requests_tenant_key");
    expect(migration).toContain("accounting_posting_requests_source_event_key");
    expect(migration).toContain("accounting_source_links");
  });

  it("fails closed and exposes no posting RPC to anon", () => {
    expect(migration).toContain("ACCOUNTING_POSTING_RULE_NOT_FOUND");
    expect(migration).toContain("ACCOUNTING_SOURCE_INELIGIBLE");
    expect(migration).toContain("ACCOUNTING_POSTING_PREVIEW_UNBALANCED");
    expect(migration).toMatch(/revoke all on function public\.post_accounting_source[\s\S]*from public, anon/i);
  });
});
