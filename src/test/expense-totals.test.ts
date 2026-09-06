import { describe, expect, it } from "vitest";
import { deriveExpenseTotals } from "@/lib/expenses/expenseTotals";

describe("expense totals", () => {
  it("splits VAT from the edited VAT-inclusive amount", () => {
    expect(deriveExpenseTotals(100, true)).toEqual({
      subtotal: 95.238,
      vatAmount: 4.762,
      total: 100,
    });
    expect(deriveExpenseTotals(1200, true)).toEqual({
      subtotal: 1142.857,
      vatAmount: 57.143,
      total: 1200,
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
      subtotal: 1406.667,
      vatAmount: 70.333,
      total: 1477,
    });
  });
});
