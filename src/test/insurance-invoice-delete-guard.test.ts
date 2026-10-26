import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("insurance invoice financial history protection", () => {
  it("guards every hard DELETE before legacy receipt cleanup can run", () => {
    const migration = readFileSync(
      "supabase/migrations/20261025175100_insurance_invoice_hard_delete_guard.sql", "utf8",
    );
    expect(migration).toContain("INSURANCE_INVOICE_HARD_DELETE_FORBIDDEN");
    expect(migration).toMatch(/create trigger trg_00_guard_insurance_invoice_delete\s+before delete on public\.insurance_invoices/i);
    expect(migration).toContain("revoke all on function public.prevent_insurance_invoice_hard_delete()");
  });

  it("does not expose the unsafe invoice deletion action or API call", () => {
    const page = readFileSync("src/pages/insurance/InsuranceAccounting.tsx", "utf8");
    const hooks = readFileSync("src/hooks/useInsuranceInvoices.ts", "utf8");
    expect(page).not.toContain("useDeleteInsuranceInvoice");
    expect(hooks).not.toMatch(/\.from\("insurance_invoices"[^\n]*\)\.delete\(/);
  });
});
