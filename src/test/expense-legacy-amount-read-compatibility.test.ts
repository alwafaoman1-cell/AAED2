import { describe, expect, it } from "vitest";
import { normalizeLegacyExpenseAmounts } from "@/lib/expenses/expenseClassificationService";

describe("legacy expense amount read compatibility", () => {
  it("shows the historical amount when newer financial columns are zero", () => {
    expect(normalizeLegacyExpenseAmounts({ amount: 25, subtotal: 0, vat_amount: 0, total: 0 })).toMatchObject({
      amount: 25,
      subtotal: 25,
      vat_amount: 0,
      total: 25,
    });
  });

  it("adds explicitly stored VAT when the legacy total is zero", () => {
    expect(normalizeLegacyExpenseAmounts({ amount: 100, subtotal: 0, vat_amount: 5, total: 0 })).toMatchObject({
      subtotal: 100,
      vat_amount: 5,
      total: 105,
    });
  });

  it("preserves populated modern financial columns", () => {
    expect(normalizeLegacyExpenseAmounts({ amount: 100, subtotal: 90, vat_amount: 4.5, total: 94.5 })).toMatchObject({
      amount: 100,
      subtotal: 90,
      vat_amount: 4.5,
      total: 94.5,
    });
  });
});
