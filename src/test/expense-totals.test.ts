import { describe, expect, it } from "vitest";
import { deriveExpenseTotals } from "@/lib/expenses/expenseTotals";

describe("expense totals", () => {
  it("recalculates VAT and total from the edited VAT-exclusive amount", () => {
    expect(deriveExpenseTotals(100, true)).toEqual({
      subtotal: 100,
      vatAmount: 5,
      total: 105,
    });
    expect(deriveExpenseTotals(1200, true)).toEqual({
      subtotal: 1200,
      vatAmount: 60,
      total: 1260,
    });
  });

  it("keeps non-VAT expenses equal to their entered amount", () => {
    expect(deriveExpenseTotals(1550.85, false)).toEqual({
      subtotal: 1550.85,
      vatAmount: 0,
      total: 1550.85,
    });
  });

  it("uses three-decimal OMR rounding", () => {
    expect(deriveExpenseTotals(1477, true)).toEqual({
      subtotal: 1477,
      vatAmount: 73.85,
      total: 1550.85,
    });
  });
});
