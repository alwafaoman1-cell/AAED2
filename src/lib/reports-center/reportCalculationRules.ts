import { addMoney, roundMoney, subtractMoney } from "@/lib/money";

export const REPORT_ACCOUNTING_RULES = {
  estimateAmount: "Estimate is informational only and is never recognized as revenue.",
  approvedAmount: "Insurance approval is not revenue and is never treated as collected cash.",
  invoiceRevenue: "Revenue is recognized from non-cancelled issued invoice subtotal only.",
  vat: "VAT is reported separately and is excluded from profit.",
  paidAmount: "Paid amount includes successful, active payments only.",
  directCosts: "Direct costs include actual parts, labour, transport, purchases and other direct expenses only.",
  grossProfit: "Gross profit equals invoice subtotal minus actual direct costs.",
  netProfit: "The term net profit is not used unless all indirect and operating expenses are complete.",
} as const;

export function calculateOutstanding(invoiceTotal: unknown, paidAmount: unknown): number {
  return Math.max(0, subtractMoney(invoiceTotal, paidAmount));
}

export function calculateDirectCosts(values: {
  parts?: unknown;
  labor?: unknown;
  transport?: unknown;
  purchases?: unknown;
  other?: unknown;
}): number {
  return addMoney(values.parts, values.labor, values.transport, values.purchases, values.other);
}

export function calculateGrossProfit(invoiceSubtotal: unknown, directCosts: unknown): number {
  return subtractMoney(invoiceSubtotal, directCosts);
}

export function calculateGrossMargin(invoiceSubtotal: unknown, grossProfit: unknown): number {
  const subtotal = roundMoney(invoiceSubtotal);
  if (subtotal <= 0) return 0;
  return roundMoney((roundMoney(grossProfit) / subtotal) * 100);
}
