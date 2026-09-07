import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { roundMoney, subtractMoney } from "@/lib/money";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("cash invoice payment atomicity", () => {
  it("normalizes OMR floating point residue to three decimals", () => {
    expect(roundMoney(5.0000000001)).toBe(5);
    expect(subtractMoney(5.0000000001, 5)).toBe(0);
  });

  it("uses one locked and idempotent database write path", () => {
    const store = read("src/lib/salesStore.ts");
    const migration = read("supabase/migrations/20260907120000_atomic_cash_invoice_payment.sql");
    expect(store).toContain('"create_sales_payment_atomic"');
    expect(migration).toContain("for update");
    expect(migration).toContain("INVOICE_ALREADY_FULLY_PAID");
    expect(migration).toContain("PAYMENT_EXCEEDS_REMAINING");
    expect(migration).toContain("where p.id = p_payment_id");
    expect(migration).toContain("round(coalesce(p_amount, 0), 3)");
  });

  it("guards both payment dialogs against repeated submit", () => {
    const detail = read("src/components/sales/SalesDocDetailPage.tsx");
    const unified = read("src/components/payments/UnifiedAddPaymentDialog.tsx");
    expect(detail).toContain("if (savingRef.current) return");
    expect(unified).toContain("if (savingRef.current) return");
    expect(detail).toContain("disabled={saving}");
  });
});
