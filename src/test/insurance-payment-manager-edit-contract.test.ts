import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("insurance payment manager correction contract", () => {
  const migration = read("supabase/migrations/20260907173000_manager_insurance_payment_correction.sql");
  const hook = read("src/hooks/useClaimPayments.ts");
  const page = read("src/pages/insurance/InsurancePayments.tsx");
  const claimDetail = read("src/pages/insurance/InsuranceClaimDetail.tsx");
  const dialog = read("src/components/insurance/EditClaimPaymentDialog.tsx");

  it("restricts corrections to managers and records before/after audit values", () => {
    expect(migration).toContain("v_role not in ('admin', 'manager')");
    expect(migration).toContain("PAYMENT_EDIT_REASON_REQUIRED");
    expect(migration).toContain("insurance_payment_corrected");
    expect(migration).toContain("'before', jsonb_build_object");
    expect(migration).toContain("'after', jsonb_build_object");
  });

  it("uses row locks and rejects stale browser data", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("p_expected_updated_at");
    expect(migration).toContain("p_expected_edit_version");
    expect(migration).toContain("edit_version = v_payment.edit_version + 1");
    expect(migration).toContain("PAYMENT_CHANGED_BY_ANOTHER_USER");
    expect(hook).toContain('"update_insurance_payment_by_manager"');
  });

  it("never silently saves and requires an explicit review step", () => {
    expect(dialog).toContain("مراجعة التعديل");
    expect(dialog).toContain("تأكيد وحفظ التعديل");
    expect(dialog).toContain("لم يتم حفظ أي تغيير");
    expect(dialog).toContain("سبب التعديل");
  });

  it("shows the edit action only to admin or manager", () => {
    expect(page).toContain('hasRole("admin", "manager")');
    expect(page).toContain("canEditPayments &&");
    expect(page).toContain("EditClaimPaymentDialog");
    expect(claimDetail).toContain("EditClaimPaymentDialog");
    expect(claimDetail).toContain("canEditPayments &&");
  });

  it("preserves invoice and settlement invariants", () => {
    expect(migration).toContain("PAYMENT_EXCEEDS_INVOICE_TOTAL");
    expect(migration).toContain("SETTLEMENT_DISCOUNT_MUST_CLOSE_INVOICE");
    expect(migration).toContain("SETTLEMENT_DISCOUNT_REQUIRES_CLEARED_NON_CHEQUE");
    expect(migration).not.toMatch(/update\s+public\.insurance_invoices\s+set\s+total/i);
  });
});
