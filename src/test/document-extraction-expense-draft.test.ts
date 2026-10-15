import { describe, expect, it } from "vitest";
import { buildExpenseReceiptSuggestion } from "@/lib/documentExtraction/expenseDraft";
import type { DocumentExtractionResult } from "@/lib/documentExtraction/types";

const exactSupplier = { entity: "supplier" as const, id: "supplier-1", label: "Test Parts", confidence: 0.99, reason: "VATIN exact", exact: true };

describe("safe expense receipt suggestion", () => {
  it("fills VAT-inclusive gross only when extracted VAT matches the existing accounting split", () => {
    const result = { matches: [exactSupplier] } as DocumentExtractionResult;
    const proposed = buildExpenseReceiptSuggestion({ vendor: "Test Parts", vat_number: "OM123", total: "105.000", vat: "5.000", date: "2026-08-18" }, result);
    expect(proposed.amount).toBe("105.000");
    expect(proposed.supplierId).toBe("supplier-1");
    expect(proposed.supplierTaxNumber).toBe("OM123");
    expect(proposed.warning).toBeNull();
  });

  it("does not silently fill an amount or VAT flag when VAT differs", () => {
    const result = { matches: [exactSupplier] } as DocumentExtractionResult;
    const proposed = buildExpenseReceiptSuggestion({ vendor: "Test Parts", vat_number: "OM123", total: "105.000", vat: "0.000" }, result);
    expect(proposed.amount).toBeNull();
    expect(proposed.supplierId).toBe("");
    expect(proposed.warning).toBe("VAT_OR_SUPPLIER_REVIEW_REQUIRED");
  });

  it("requires supplier review when a receipt has VAT but no exact VATIN match", () => {
    const result = { matches: [{ ...exactSupplier, reason: "Supplier name", confidence: 0.85 }] } as DocumentExtractionResult;
    const proposed = buildExpenseReceiptSuggestion({ vendor: "Test Parts", total: "105.000", vat: "5.000" }, result);
    expect(proposed.amount).toBeNull();
    expect(proposed.supplierId).toBe("");
    expect(proposed.warning).toBe("VAT_OR_SUPPLIER_REVIEW_REQUIRED");
  });
});
