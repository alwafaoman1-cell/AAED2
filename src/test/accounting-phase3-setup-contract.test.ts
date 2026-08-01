import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const pages = readFileSync("src/pages/accounting/setup/AccountingSetupPages.tsx", "utf8");
const guard = readFileSync("src/components/accounting/AccountingSetupRouteGuard.tsx", "utf8");
const availability = readFileSync("src/lib/accounting/accountingSetupAvailability.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260801112000_accounting_administration_setup.sql", "utf8");
const roleAlignment = readFileSync("supabase/migrations/20260801113000_accounting_accountant_role_alignment.sql", "utf8");

describe("Phase 3 accounting administration contracts", () => {
  it("defines every core setup function as a standalone route", () => {
    for (const route of [
      "/accounting/setup", "/accounting/setup/accounts", "/accounting/setup/accounts/new",
      "/accounting/setup/accounts/:accountId", "/accounting/setup/fiscal-years",
      "/accounting/setup/fiscal-years/new", "/accounting/setup/fiscal-years/:fiscalYearId",
      "/accounting/setup/periods", "/accounting/setup/periods/:periodId",
      "/accounting/setup/cost-centers", "/accounting/setup/cost-centers/new",
      "/accounting/setup/cost-centers/:costCenterId", "/accounting/setup/mappings",
      "/accounting/setup/mappings/new", "/accounting/setup/mappings/:mappingId",
      "/accounting/setup/posting-rules", "/accounting/setup/posting-rules/:ruleId",
      "/accounting/setup/cash-bank-accounts", "/accounting/setup/opening-balances",
      "/accounting/setup/opening-balances/new", "/accounting/setup/opening-balances/:batchId",
      "/accounting/setup/readiness",
    ]) expect(app).toContain(`path="${route}"`);
  });

  it("does not use modal, dialog, drawer, popup, or overlay forms", () => {
    expect(pages).not.toMatch(/<\s*(Dialog|Drawer|Modal|AlertDialog|Sheet|Popover)\b/);
    expect(pages).not.toMatch(/window\.open\s*\(/);
  });

  it("guards direct URLs with role, permission, and feature availability", () => {
    expect(app).toContain("AccountingSetupRouteGuard permission=");
    expect(guard).toContain("hasAccountingPermission(permission)");
    expect(guard).toContain('profile?.role === "admin" || profile?.role === "accountant"');
    expect(availability).toContain("import.meta.env.DEV");
    expect(availability).toContain('VITE_ACCOUNTING_SETUP_ENABLED === "true"');
  });

  it("does not query accounting setup at application startup", () => {
    expect(app).not.toContain("getAccountingSetupReadiness");
    expect(app).not.toContain("listAccountingAccounts(");
  });

  it("keeps posting rules inactive and blocks Phase 3 activation", () => {
    expect(migration).toContain("ACCOUNTING_POSTING_RULE_ACTIVATION_DEFERRED_PHASE_3");
    expect(pages).toContain("isActive:false");
    expect(pages).not.toContain("isActive:true");
    expect(migration).not.toMatch(/insert\s+into\s+public\.accounting_posting_rules/i);
  });

  it("enforces tenant RLS and does not grant anonymous access", () => {
    expect(migration).toContain("tenant_id=public.get_user_tenant_id()");
    expect(migration).toContain("revoke all on public.accounting_cash_bank_accounts from anon, public");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/grant\s+.+\s+to\s+(anon|public)/i);
  });

  it("prevents mapping overlap and inactive or non-postable mappings", () => {
    expect(migration).toContain("ACCOUNTING_MAPPING_EFFECTIVE_RANGE_OVERLAP");
    expect(migration).toContain("ACCOUNTING_MAPPING_ACCOUNT_NOT_POSTABLE");
    expect(migration).toContain("a.is_active and a.is_postable");
  });

  it("requires a balanced opening balance batch before approval", () => {
    expect(migration).toContain("ACCOUNTING_OPENING_BATCH_UNBALANCED");
    expect(migration).toContain("v_debit=0 or v_debit<>v_credit");
    expect(pages).toContain('debit!==credit');
  });

  it("stores only a short bank reference and OMR currency", () => {
    expect(migration).toContain("length(reference_suffix)<=8");
    expect(migration).toContain("check (currency='OMR')");
    expect(pages).not.toMatch(/iban|swift|account_number/i);
  });

  it("uses generated IDs and never hard-codes tenant IDs", () => {
    expect(migration).toContain("default gen_random_uuid()");
    expect(pages).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("contains no destructive database operations", () => {
    expect(migration).not.toMatch(/drop\s+(table|column|schema)|truncate\s+|delete\s+from/i);
    expect(roleAlignment).toContain("add value if not exists 'accountant'");
    expect(roleAlignment).not.toMatch(/drop\s+|delete\s+|truncate\s+/i);
  });
});
