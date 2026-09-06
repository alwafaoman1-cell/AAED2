import { calculateVatInclusive, roundMoney } from "@/lib/money";

export interface ExpenseTotals {
  subtotal: number;
  vatAmount: number;
  total: number;
}

/**
 * Expense amounts are entered as the final amount actually paid, including VAT
 * when the supplier has a tax number. VAT is split out of that amount; it is
 * never added on top of the user's entered value.
 */
export function deriveExpenseTotals(
  amount: number | string | null | undefined,
  isVatApplicable = true,
): ExpenseTotals {
  const enteredTotal = roundMoney(amount ?? 0);
  const breakdown = isVatApplicable
    ? calculateVatInclusive(enteredTotal)
    : { subtotalBeforeVat: enteredTotal, vatAmount: 0, totalIncludingVat: enteredTotal };
  return {
    subtotal: breakdown.subtotalBeforeVat,
    vatAmount: breakdown.vatAmount,
    total: breakdown.totalIncludingVat,
  };
}
