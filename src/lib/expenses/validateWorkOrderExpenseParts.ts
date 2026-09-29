interface ExpensePartInput {
  name: string;
  quantity: string;
  unitBuyPrice: string;
}

/** Reject incomplete part rows before allocating a voucher number or writing anything. */
export function validateWorkOrderExpenseParts(parts: ExpensePartInput[]): string | null {
  if (parts.length === 0) return "أضف قطعة غيار واحدة على الأقل";

  for (const [index, part] of parts.entries()) {
    const label = `القطعة ${index + 1}`;
    if (!part.name.trim()) return `${label}: أدخل اسم القطعة`;

    const quantity = Number(part.quantity);
    if (!part.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      return `${label}: أدخل كمية صحيحة أكبر من صفر`;
    }

    const buyPrice = Number(part.unitBuyPrice);
    if (!part.unitBuyPrice.trim() || !Number.isFinite(buyPrice) || buyPrice <= 0) {
      return `${label}: أدخل سعر شراء صحيحًا أكبر من صفر`;
    }
  }

  return null;
}
