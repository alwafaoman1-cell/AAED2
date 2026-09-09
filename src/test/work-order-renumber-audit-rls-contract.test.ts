import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260909100000_work_order_renumber_audit_rls_hardening.sql"),
  "utf8",
);

describe("work-order renumber audit RLS hardening", () => {
  it("enables tenant-scoped authenticated reads and blocks anonymous access", () => {
    expect(sql).toContain("alter table public.work_order_number_renumber_audit enable row level security");
    expect(sql).toContain("using (tenant_id = public.get_user_tenant_id())");
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("grant select on table public.work_order_number_renumber_audit to authenticated");
  });

  it("does not rewrite work orders or historical audit rows", () => {
    expect(sql).not.toMatch(/\b(?:insert|update|delete|truncate)\b/i);
    expect(sql).not.toMatch(/alter\s+table\s+public\.job_orders/i);
  });
});
