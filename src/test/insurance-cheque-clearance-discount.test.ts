import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chequeSettlementDiscount } from "@/lib/insuranceChequeSettlement";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261010100000_insurance_cleared_cheque_settlement_discount.sql");
const previousMigration = read("supabase/migrations/20260907173000_manager_insurance_payment_correction.sql");
const dialog = read("src/components/insurance/ChequeClearanceDialog.tsx");
const hook = read("src/hooks/useClaimPayments.ts");

describe("insurance cheque settlement at actual clearance", () => {
  it("previews only the unpaid, undiscounted portion after the cheque amount", () => {
    expect(chequeSettlementDiscount({ total: 100, paid_amount: 20, settlement_discount_amount: 5 }, 70)).toBe(5);
    expect(chequeSettlementDiscount({ total: 100, paid_amount: 20, settlement_discount_amount: 5 }, 75)).toBe(0);
    expect(chequeSettlementDiscount({ total: 100, paid_amount: 20, settlement_discount_amount: 5 }, 80)).toBe(0);
    expect(chequeSettlementDiscount({ total: 100, paid_amount: 0, settlement_discount_amount: 0 }, 0)).toBe(0);
    expect(chequeSettlementDiscount({ total: 1, paid_amount: 0.4, settlement_discount_amount: 0 }, 0.5)).toBe(0.1);
  });

  it("retains the same payment and requires manager approval, a reason and a cleared status", () => {
    expect(dialog).toContain('if (payment.status !== "pending" || payment.payment_method !== "cheque")');
    expect(dialog).toContain('if (!canApproveSettlement)');
    expect(dialog).toContain('if (!discountReason.trim())');
    expect(dialog).toContain('await invoiceQuery.refetch()');
    expect(dialog).toContain('await updatePayment.mutateAsync({');
    expect(dialog).not.toContain("useCreateClaimPayment");
    expect(hook).toContain('"update_insurance_payment_by_manager"');
    expect(migration).toContain("if p_status <> 'cleared' then");
    expect(migration).toContain("SETTLEMENT_DISCOUNT_REQUIRES_CLEARED");
    expect(migration).not.toContain("SETTLEMENT_DISCOUNT_REQUIRES_CLEARED_NON_CHEQUE");
  });

  it("keeps tenant isolation, concurrency control, invoice bounds and before/after audit", () => {
    expect(migration).toContain("v_role not in ('admin', 'manager')");
    expect(migration).toContain("where tenant_id = v_tenant and id = p_payment_id");
    expect(migration).toContain("v_payment.edit_version <> p_expected_edit_version");
    expect(migration).toContain("for update");
    expect(migration).toContain("PAYMENT_EXCEEDS_INVOICE_TOTAL");
    expect(migration).toContain("SETTLEMENT_DISCOUNT_MUST_CLOSE_INVOICE");
    expect(migration).toContain("'before', jsonb_build_object");
    expect(migration).toContain("'after', jsonb_build_object");
    expect(migration).not.toMatch(/insert\s+into\s+public\.claim_payments/i);
    expect(migration).not.toMatch(/update\s+public\.insurance_invoices\s+set\s+total/i);
  });

  it("changes only the cheque discount guard in the established manager RPC", () => {
    const definition = (sql: string) => sql.match(/create or replace function public\.update_insurance_payment_by_manager\([\s\S]*?\$\$;/i)?.[0];
    const expected = definition(previousMigration)
      ?.replace("if p_payment_method = 'cheque' or p_status <> 'cleared' then", "if p_status <> 'cleared' then")
      .replace("raise exception 'SETTLEMENT_DISCOUNT_REQUIRES_CLEARED_NON_CHEQUE';", "raise exception 'SETTLEMENT_DISCOUNT_REQUIRES_CLEARED';");
    expect(definition(migration)).toBe(expected);
  });
});
