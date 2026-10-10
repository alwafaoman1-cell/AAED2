import { roundMoney } from "@/lib/money";

type InvoiceBalance = {
  total: number;
  paid_amount: number;
  settlement_discount_amount?: number | null;
};

/** Preview only. The manager RPC recalculates and validates the actual settlement under a row lock. */
export function chequeSettlementDiscount(invoice: InvoiceBalance, chequeAmount: number): number {
  const remaining = roundMoney(
    roundMoney(invoice.total) - roundMoney(invoice.paid_amount) - roundMoney(invoice.settlement_discount_amount || 0),
  );
  const amount = roundMoney(chequeAmount);
  return Number.isFinite(amount) && amount > 0 && remaining > amount
    ? roundMoney(remaining - amount)
    : 0;
}
