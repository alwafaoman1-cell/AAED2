import { formatCurrencyEnglish, parseMoneyInput } from "@/lib/formatters/numberFormat";

export const OMR_DECIMALS = 3;
export const OMAN_VAT_RATE = 0.05;

export interface VatBreakdown {
  subtotalBeforeVat: number;
  vatAmount: number;
  totalIncludingVat: number;
}

export function normalizeMoneyInput(value: unknown): number {
  return parseMoneyInput(value);
}

export function roundMoney(value: unknown, decimals = OMR_DECIMALS): number {
  const numeric = typeof value === "string" ? normalizeMoneyInput(value) : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

export const roundOMR = roundMoney;

export function addMoney(...values: unknown[]): number {
  return roundMoney(values.reduce<number>((sum, value) => sum + roundMoney(value), 0));
}

export function subtractMoney(left: unknown, right: unknown): number {
  return roundMoney(roundMoney(left) - roundMoney(right));
}

export function calculateVatExclusive(subtotalBeforeVat: unknown, vatRate = OMAN_VAT_RATE): VatBreakdown {
  const subtotal = roundMoney(subtotalBeforeVat);
  const rate = Number(vatRate);
  if (!subtotal || !Number.isFinite(rate) || rate <= 0) {
    return { subtotalBeforeVat: subtotal, vatAmount: 0, totalIncludingVat: subtotal };
  }
  const vatAmount = roundMoney(subtotal * rate);
  return {
    subtotalBeforeVat: subtotal,
    vatAmount,
    totalIncludingVat: roundMoney(subtotal + vatAmount),
  };
}

export function calculateTotalWithVat(subtotalBeforeVat: unknown, vatRate = OMAN_VAT_RATE): number {
  return calculateVatExclusive(subtotalBeforeVat, vatRate).totalIncludingVat;
}

export function calculateVatInclusive(totalIncludingVat: unknown, vatRate = OMAN_VAT_RATE): VatBreakdown {
  const total = roundMoney(totalIncludingVat);
  const rate = Number(vatRate);
  if (!total || !Number.isFinite(rate) || rate <= 0) {
    return { subtotalBeforeVat: total, vatAmount: 0, totalIncludingVat: total };
  }
  const subtotalBeforeVat = roundMoney(total / (1 + rate));
  return {
    subtotalBeforeVat,
    vatAmount: roundMoney(total - subtotalBeforeVat),
    totalIncludingVat: total,
  };
}

export function formatOMR(value: unknown, suffix = "OMR"): string {
  return formatCurrencyEnglish(roundMoney(value), {
    minimumFractionDigits: OMR_DECIMALS,
    maximumFractionDigits: OMR_DECIMALS,
  }, suffix);
}
