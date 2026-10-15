import { deriveExpenseTotals } from "@/lib/expenses/expenseTotals";
import { parseMoneyMilli } from "./parsers";
import type { DocumentExtractionResult } from "./types";

export interface ExpenseReceiptSuggestion {
  supplierName: string;
  supplierId: string;
  supplierTaxNumber: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  amount: string | null;
  warning: "VAT_OR_SUPPLIER_REVIEW_REQUIRED" | null;
}

/** Finance fields remain suggestions. Never infer 5% VAT from an OCR name match. */
export function buildExpenseReceiptSuggestion(
  data: Record<string, string>, result: DocumentExtractionResult,
): ExpenseReceiptSuggestion {
  const vatMatched = result.matches.filter((match) => match.entity === "supplier" && match.exact && match.reason === "VATIN exact");
  const supplier = vatMatched.length === 1 ? vatMatched[0] : null;
  const amountMilli = data.total ? parseMoneyMilli(data.total) : null;
  const vatMilli = data.vat ? parseMoneyMilli(data.vat) : null;
  const taxNumber = supplier ? data.vat_number || "" : "";
  const expectedVatMilli = amountMilli !== null && taxNumber
    ? Math.round(deriveExpenseTotals(amountMilli / 1000, true).vatAmount * 1000)
    : 0;
  const amountsAgree = amountMilli !== null && vatMilli !== null &&
    (taxNumber ? Math.abs(expectedVatMilli - vatMilli) <= 1 : vatMilli === 0);
  return {
    supplierName: supplier?.label || data.vendor || "",
    supplierId: amountsAgree ? supplier?.id || "" : "",
    supplierTaxNumber: amountsAgree ? taxNumber : "",
    supplierInvoiceNumber: data.invoice_number || "",
    supplierInvoiceDate: data.date || "",
    amount: amountsAgree ? data.total : null,
    warning: amountMilli !== null && !amountsAgree ? "VAT_OR_SUPPLIER_REVIEW_REQUIRED" : null,
  };
}
