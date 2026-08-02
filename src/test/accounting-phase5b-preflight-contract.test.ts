import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("accounting Phase 5B production preflight contract", () => {
  it("keeps the corrective migration forward-only and data-neutral", () => {
    const sql = read(
      "supabase/migrations/20260802100000_accounting_production_preflight_security_and_dependencies.sql",
    );

    expect(sql).toContain("add column supplier_id uuid null");
    expect(sql).toContain("on delete set null");
    expect(sql).toContain("revoke all privileges");
    expect(sql).toContain("alter default privileges");
    expect(sql).not.toMatch(/\b(drop\s+table|truncate\s+table|delete\s+from|update\s+public\.)\b/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.(accounting_|expenses|suppliers)/i);
  });

  it("ships every controlled production package file", () => {
    const files = [
      "00_preflight_readonly.sql",
      "01_batch_preflight.sql",
      "02_batch_foundation.sql",
      "03_batch_posting.sql",
      "04_batch_administration.sql",
      "05_batch_reports.sql",
      "90_verify_security.sql",
      "91_verify_data_unchanged.sql",
      "99_rollback_plan.md",
    ];

    for (const file of files) {
      expect(read(`supabase/production/accounting/${file}`).trim().length).toBeGreaterThan(80);
    }
  });

  it("requires explicit project and accountant-enum approvals", () => {
    const preflight = read("supabase/production/accounting/01_batch_preflight.sql");
    const administration = read("supabase/production/accounting/04_batch_administration.sql");

    expect(preflight).toContain("confirmed_project_ref");
    expect(preflight).toContain("expected_project_ref");
    expect(preflight).toContain("project ref mismatch");
    expect(administration).toContain("approve_accountant_enum");
    expect(administration).toContain("accountant enum not approved");
  });

  it("contains no embedded credentials or automatic posting", () => {
    const packageText = [
      "00_preflight_readonly.sql",
      "01_batch_preflight.sql",
      "02_batch_foundation.sql",
      "03_batch_posting.sql",
      "04_batch_administration.sql",
      "05_batch_reports.sql",
      "90_verify_security.sql",
      "91_verify_data_unchanged.sql",
    ]
      .map((file) => read(`supabase/production/accounting/${file}`))
      .join("\n");

    expect(packageText).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(packageText).not.toMatch(/service[_-]?role|access[_-]?token|app[_-]?secret/i);
    expect(packageText).not.toMatch(/create\s+trigger[\s\S]{0,120}(invoice|payment|expense)/i);
  });
});
