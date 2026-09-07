import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("insurance early settlement discount contract", () => {
  const migration = read("supabase/migrations/20260907143000_insurance_early_settlement_discount.sql");
  const hook = read("src/hooks/useClaimPayments.ts");
  const dialog = read("src/components/payments/UnifiedAddPaymentDialog.tsx");
  const pdf = read("src/lib/insurancePdfTemplates.ts");

  it("keeps cash received and settlement discount as separate values", () => {
    expect(migration).toContain("settlement_discount_amount");
    expect(migration).toContain("v_paid + v_discount >= v_inv_total - 0.001");
    expect(migration).toContain("set paid_amount = round(v_paid, 3)");
    expect(migration).not.toMatch(/set\s+total\s*=.*settlement_discount/i);
  });

  it("uses an atomic tenant-scoped RPC and locks the insurance invoice", () => {
    expect(migration).toContain("create_insurance_payment_with_settlement");
    expect(migration).toContain("limit 1 for update");
    expect(migration).toContain("public.get_user_tenant_id()");
    expect(migration).toContain("SETTLEMENT_DISCOUNT_MUST_CLOSE_INVOICE");
    expect(hook).toContain('"create_insurance_payment_with_settlement"');
    expect(hook).not.toContain('.from("claim_payments" as any)\n        .insert(payment');
  });

  it("requires manager approval and a reason for an internal discount", () => {
    expect(migration).toContain("SETTLEMENT_DISCOUNT_APPROVAL_REQUIRED");
    expect(migration).toContain("SETTLEMENT_DISCOUNT_REASON_REQUIRED");
    expect(migration).toContain("settlement_approved_by");
    expect(dialog).toContain('hasRole("admin", "manager")');
    expect(dialog).toContain("سبب الخصم *");
  });

  it("does not add settlement details to the customer invoice PDF", () => {
    expect(pdf).not.toContain("settlement_discount_amount");
    expect(pdf).not.toContain("خصم تسوية مبكرة");
  });

  it("splits cloud accounting into received cash, discount, and cleared receivable", () => {
    expect(migration).toContain("accounting_get_source_posting_snapshot_base");
    expect(migration).toContain("round(p.settlement_discount_amount::numeric,3)");
    expect(migration).toContain("round((p.amount+p.settlement_discount_amount)::numeric,3)");
    expect(migration).toContain('"mapping_key":"discounts"');
    expect(migration).toContain('"amount":"total_amount"');
  });
});
