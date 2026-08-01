import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAccountingSourceEligible, isActiveAccountingRecord } from "@/lib/accounting/accountingEligibility";

const migration = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");
const core = migration("20260801100000_accounting_cloud_foundation.sql");
const security = migration("20260801101000_accounting_cloud_security.sql");
const eligibility = migration("20260801102000_accounting_source_eligibility.sql");
const posting = migration("20260801103000_accounting_validation_and_posting.sql");
const indexes = migration("20260801104000_accounting_foundation_indexes.sql");
const allSql = [core, security, eligibility, posting, indexes].join("\n");

describe("cloud accounting schema contract", () => {
  it("is non-destructive and performs no historical backfill", () => {
    expect(allSql).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(allSql).not.toMatch(/\bdelete\s+from\b/i);
    expect(allSql).not.toContain("insert into public.accounting_accounts");
    expect(allSql).not.toContain("insert into public.accounting_account_mappings");
  });

  it("creates the complete tenant-scoped foundation", () => {
    for (const table of [
      "accounting_accounts", "accounting_fiscal_years", "accounting_periods",
      "accounting_cost_centers", "accounting_journal_entries", "accounting_journal_lines",
      "accounting_source_links", "accounting_account_mappings", "accounting_posting_rules",
      "accounting_opening_balances", "accounting_audit_logs",
    ]) expect(core).toContain(`create table if not exists public.${table}`);
  });

  it("uses numeric OMR precision and never float money", () => {
    expect(core).toContain("numeric(18,3)");
    expect(allSql).not.toMatch(/\b(real|float|double precision)\b/i);
  });

  it("prevents duplicate accounts, journal numbers, lines, and source posting", () => {
    expect(core).toContain("accounting_accounts_tenant_code_key");
    expect(core).toContain("accounting_journal_entries_number_key");
    expect(core).toContain("accounting_journal_lines_entry_line_key");
    expect(core).toContain("accounting_source_links_primary_unique");
  });

  it("prevents account and cost-center tree cycles", () => {
    expect(posting).toContain("ACCOUNTING_ACCOUNT_TREE_CYCLE");
    expect(posting).toContain("ACCOUNTING_COST_CENTER_TREE_CYCLE");
  });

  it("prevents overlapping fiscal years and periods and dates outside the year", () => {
    expect(posting).toContain("ACCOUNTING_FISCAL_YEAR_OVERLAP");
    expect(posting).toContain("ACCOUNTING_PERIOD_OVERLAP");
    expect(posting).toContain("ACCOUNTING_PERIOD_OUTSIDE_FISCAL_YEAR");
    expect(posting).toContain("ACCOUNTING_DATE_OUTSIDE_PERIOD");
  });
});

describe("posting and reversal contract", () => {
  it("rejects unbalanced or zero journals at approval/posting", () => {
    expect(posting).toContain("v_debit = 0 or v_debit <> v_credit");
    expect(posting).toContain("ACCOUNTING_ENTRY_UNBALANCED");
  });

  it("blocks inactive, non-postable, and missing cost-center accounts", () => {
    expect(posting).toContain("not a.is_active or not a.is_postable");
    expect(posting).toContain("a.requires_cost_center and l.cost_center_id is null");
  });

  it("blocks closed periods and posting outside a fiscal year", () => {
    expect(posting).toContain("ACCOUNTING_PERIOD_NOT_OPEN");
    expect(posting).toContain("ACCOUNTING_DATE_OUTSIDE_PERIOD");
  });

  it("prevents direct posted edits, posted line edits, and hard delete", () => {
    expect(posting).toContain("ACCOUNTING_POSTED_ENTRY_IMMUTABLE");
    expect(posting).toContain("ACCOUNTING_POSTED_LINES_IMMUTABLE");
    expect(posting).toContain("ACCOUNTING_NON_DRAFT_ENTRY_CANNOT_BE_DELETED");
  });

  it("uses atomic tenant/fiscal-year numbering instead of MAX plus one", () => {
    expect(posting).toContain("on conflict (tenant_id, fiscal_year_id) do update");
    expect(posting).toContain("create_accounting_journal_entry");
    expect(posting).not.toMatch(/max\s*\(/i);
  });

  it("posts through one server transaction with permission and row locking", () => {
    expect(posting).toContain("post_accounting_journal_entry");
    expect(posting).toContain("accounting.post_journal");
    expect(posting).toContain("for update");
    expect(posting).toContain("ACCOUNTING_DUPLICATE_POSTING");
  });

  it("creates a separate reversing journal and leaves the original posted", () => {
    expect(posting).toContain("reverse_accounting_journal_entry");
    expect(posting).toContain("select tenant_id,v_reversal.id,account_id,line_number,description,credit,debit");
    expect(posting).not.toContain("set status='reversed' where id=v_original.id");
    expect(posting).toContain("ACCOUNTING_ENTRY_ALREADY_REVERSED");
  });
});

describe("central source eligibility", () => {
  const tenant = "tenant-a";
  const active = { id: "1", tenant_id: tenant, status: "issued" };

  it("excludes deleted, archived, cancelled, failed, and wrong-tenant records", () => {
    expect(isActiveAccountingRecord(active, tenant)).toBe(true);
    expect(isActiveAccountingRecord({ ...active, deleted_at: "2026-08-01" }, tenant)).toBe(false);
    expect(isActiveAccountingRecord({ ...active, archived_at: "2026-08-01" }, tenant)).toBe(false);
    expect(isActiveAccountingRecord({ ...active, status: "cancelled" }, tenant)).toBe(false);
    expect(isActiveAccountingRecord({ ...active, status: "failed" }, tenant)).toBe(false);
    expect(isActiveAccountingRecord(active, "tenant-b")).toBe(false);
  });

  it("excludes an invoice or expense whose work order/claim parent is deleted", () => {
    expect(isAccountingSourceEligible({ tenantId: tenant, sourceType: "expense", source: active,
      parentWorkOrder: { ...active, deleted_at: "2026-08-01" } })).toBe(false);
    expect(isAccountingSourceEligible({ tenantId: tenant, sourceType: "insurance_invoice", source: active,
      parentClaim: { ...active, status: "cancelled" } })).toBe(false);
  });

  it("excludes a payment whose parent invoice is ineligible", () => {
    expect(isAccountingSourceEligible({ tenantId: tenant, sourceType: "sales_payment", source: active,
      parentInvoice: { ...active, deleted_at: "2026-08-01" } })).toBe(false);
  });

  it("implements database-first rules for every required source family", () => {
    for (const token of ["sales_invoice", "cash_invoice", "insurance_invoice", "expense", "supplier_invoice",
      "sales_payment", "claim_payment", "supplier_payment", "work_order", "claim", "vehicle", "customer", "supplier"])
      expect(eligibility).toContain(`when '${token}'`);
    expect(eligibility).toContain("accounting_json_record_is_active(v_parent)");
    expect(posting).toContain("ACCOUNTING_ENTRY_HAS_INELIGIBLE_SOURCE");
  });
});

describe("tenant security and audit contract", () => {
  it("enables RLS everywhere, denies anon, and never uses permissive using true", () => {
    expect(security).toContain("enable row level security");
    expect(security).toContain("revoke all on table public.%I from public, anon");
    expect(security).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(security).not.toMatch(/grant\s+.+\s+to\s+anon/i);
  });

  it("derives tenant and role server-side and supports granular accounting permissions", () => {
    expect(security).toContain("get_user_tenant_id()");
    expect(security).toContain("get_user_role()");
    for (const permission of ["manage_accounts", "manage_fiscal_years", "manage_periods", "manage_cost_centers",
      "create_journal", "approve_journal", "post_journal", "reverse_journal", "view_journal", "manage_mappings"])
      expect(core).toContain(`accounting.${permission}`);
  });

  it("blocks cross-tenant accounts, sources, and line references", () => {
    expect(core).toContain("foreign key (tenant_id, account_id)");
    expect(core).toContain("foreign key (tenant_id, journal_entry_id)");
    expect(posting).toContain("ACCOUNTING_CROSS_TENANT_WORK_ORDER_REFERENCE");
    expect(posting).toContain("ACCOUNTING_CROSS_TENANT_INVOICE_REFERENCE");
    expect(eligibility).toContain("d.tenant_id = p_tenant_id");
  });

  it("records financial state changes with user and before/after snapshots", () => {
    expect(core).toContain("accounting_audit_logs");
    expect(posting).toContain("before_snapshot,after_snapshot");
    expect(posting).toContain("auth.uid()");
    expect(posting).toContain("app.accounting_reason");
  });
});

describe("cloud service boundary", () => {
  it("does not use LocalStorage/Zustand as the new accounting source", () => {
    const files = ["accountingAccountsService.ts", "accountingPeriodsService.ts", "accountingJournalService.ts",
      "accountingPostingService.ts", "accountingMappingsService.ts", "accountingOpeningBalancesService.ts",
      "accountingPostingRulesService.ts"];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), "src/lib/accounting", file), "utf8");
      expect(source).toContain("supabase");
      expect(source).not.toMatch(/localStorage|createStore|zustand/i);
    }
  });

  it("contains no hard-coded account UUID mapping", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/accounting/accountingMappingsService.ts"), "utf8");
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("creates only indexes with demonstrated ledger lookup paths", () => {
    expect(indexes).toContain("accounting_journal_entries_status_date_idx");
    expect(indexes).toContain("accounting_journal_lines_account_idx");
    expect(indexes).toContain("accounting_source_links_source_idx");
    expect(indexes).toContain("accounting_mappings_lookup_idx");
  });

  it("keeps posting rules inactive and account mappings empty by default", () => {
    expect(core).toContain("is_active boolean not null default false");
    expect(allSql).not.toMatch(/insert\s+into\s+public\.accounting_(posting_rules|account_mappings)/i);
  });

  it("requires reversal to reference an existing posted original", () => {
    expect(posting).toContain("status='posted' for update");
    expect(posting).toContain("ACCOUNTING_POSTED_ENTRY_NOT_FOUND");
  });

  it("requires a reason when reopening locked periods and years", () => {
    expect(posting).toContain("ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED");
    expect(posting).toContain("ACCOUNTING_FISCAL_YEAR_REOPEN_REASON_REQUIRED");
  });

  it("rejects unknown source types and validates links before insert", () => {
    expect(eligibility).toContain("else\n      return false");
    expect(eligibility).toContain("before insert or update on public.accounting_source_links");
  });

  it("does not expose privileged trigger helpers for direct execution", () => {
    expect(posting).toContain("revoke all on function public.accounting_write_audit() from public, anon, authenticated");
    expect(posting).toContain("revoke all on function public.accounting_assert_entry_ready(uuid,text) from public, anon, authenticated");
  });

  it("keeps the later accounting report UI production-gated and outside the Phase 1 migration", () => {
    const routes = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    const availability = readFileSync(resolve(process.cwd(), "src/lib/accounting/accountingReportsAvailability.ts"), "utf8");
    expect(core).not.toContain('/accounting/reports/general-ledger');
    expect(routes).toContain('/accounting/reports/general-ledger');
    expect(routes).toContain('AccountingReportsRouteGuard');
    expect(availability).toContain('import.meta.env.DEV');
    expect(availability).toContain('VITE_ACCOUNTING_REPORTS_ENABLED');
  });
});
