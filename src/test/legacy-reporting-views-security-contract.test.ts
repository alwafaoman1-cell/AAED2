import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260915120000_legacy_reporting_views_security_hardening.sql",
);

const migration = readFileSync(migrationPath, "utf8").toLowerCase();

const protectedViews = [
  "vehicle_duplicates",
  "vehicle_identity_duplicate_report",
  "completed_work_orders_without_invoice_view",
  "overdue_invoices_view",
];

describe("legacy reporting view security hardening", () => {
  it.each(protectedViews)("makes %s use caller RLS", (view) => {
    expect(migration).toContain(
      `alter view if exists public.${view}\n  set (security_invoker = true)`,
    );
  });

  it.each(protectedViews)("removes anonymous access from %s", (view) => {
    expect(migration).toContain(
      `revoke all on table public.${view} from anon, public`,
    );
  });

  it.each(protectedViews)("keeps authenticated read access to %s", (view) => {
    expect(migration).toContain(
      `grant select on table public.${view} to authenticated`,
    );
  });

  it("does not recreate views or mutate operational data", () => {
    expect(migration).not.toMatch(/create\s+(or\s+replace\s+)?view/);
    expect(migration).not.toMatch(/\b(insert|update|delete|truncate)\b/);
  });
});
