import { describe, expect, it } from "vitest";
import { normalizeLegacyExpenseAmounts } from "@/lib/expenses/expenseClassificationService";

describe("legacy expense amount read compatibility", () => {
  it("shows the historical amount when newer financial columns are zero", () => {
    expect(normalizeLegacyExpenseAmounts({ amount: 25, subtotal: 0, vat_amount: 0, total: 0 })).toMatchObject({
      amount: 25,
      subtotal: 25,
      vat_amount: 0,
      total: 25,
    });
  });

  it("adds explicitly stored VAT when the legacy total is zero", () => {
    expect(normalizeLegacyExpenseAmounts({ amount: 100, subtotal: 0, vat_amount: 5, total: 0 })).toMatchObject({
      subtotal: 100,
      vat_amount: 5,
      total: 105,
    });
  });

  it("preserves populated modern financial columns", () => {
    expect(normalizeLegacyExpenseAmounts({ amount: 100, subtotal: 90, vat_amount: 4.5, total: 94.5 })).toMatchObject({
      amount: 100,
      subtotal: 90,
      vat_amount: 4.5,
      total: 94.5,
    });
  });

  it("restores a historical supplier stored in beneficiary/meta fields", () => {
    expect(normalizeLegacyExpenseAmounts({
      amount: 25,
      supplier_id: null,
      supplier_name: null,
      beneficiary: "علامة الثقة",
      meta: { supplierTaxNumber: "VAT-123", supplierInvoiceNumber: "SUP-52" },
    })).toMatchObject({
      supplier_name: "علامة الثقة",
      supplier_tax_number: "VAT-123",
      supplier_invoice_number: "SUP-52",
    });
  });

  it("prefers the canonical linked supplier over historical display fields", () => {
    expect(normalizeLegacyExpenseAmounts({
      amount: 25,
      supplier_id: "a745d877-98ef-4d79-b629-166740743300",
      supplier_name: "Canonical Supplier",
      beneficiary: "Old Supplier",
      meta: { supplierName: "Older Supplier" },
    })).toMatchObject({
      supplier_id: "a745d877-98ef-4d79-b629-166740743300",
      supplier_name: "Canonical Supplier",
    });
  });
});
