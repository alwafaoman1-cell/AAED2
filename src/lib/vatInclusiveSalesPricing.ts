function finiteMoney(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizedRate(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Convert the VAT-inclusive price entered by the user to the stored net price. */
export function netUnitPriceFromVatInclusive(grossPrice: unknown, taxRate: unknown): number {
  const gross = finiteMoney(grossPrice);
  const rate = normalizedRate(taxRate);
  if (!rate) return gross;
  return Number((gross / (1 + rate / 100)).toFixed(9));
}

/** Rebuild the user-facing VAT-inclusive price from the stored net unit price. */
export function vatInclusiveUnitPrice(netPrice: unknown, taxRate: unknown): number {
  const net = finiteMoney(netPrice);
  const rate = normalizedRate(taxRate);
  if (!rate) return net;
  return Number((net * (1 + rate / 100)).toFixed(6));
}

/** Keep the entered final price unchanged when the VAT rate is changed. */
export function netUnitPriceForChangedTaxRate(netPrice: unknown, oldRate: unknown, newRate: unknown): number {
  return netUnitPriceFromVatInclusive(vatInclusiveUnitPrice(netPrice, oldRate), newRate);
}
