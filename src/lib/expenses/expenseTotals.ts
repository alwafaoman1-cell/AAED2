import { calculateVatExclusive, roundMoney } from "@/lib/money";

export interface ExpenseTotals {
  subtotal: number;
  vatAmount: number;
  total: number;
}

/**
 * Expense amounts are entered before VAT. Financial totals are always derived
 * from that amount so an edited voucher cannot retain an older subtotal/total.
 */
export function deriveExpenseTotals(
  amount: number | string | null | undefined,
  isVatApplicable = true,
): ExpenseTotals {
  const subtotal = roundMoney(amount ?? 0);
  const vatAmount = isVatApplicable ? calculateVatExclusive(subtotal).vatAmount : 0;
  return {
    subtotal,
    vatAmount,
    total: roundMoney(subtotal + vatAmount),
  };
}
