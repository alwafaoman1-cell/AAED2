import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateTotals } from "@/lib/salesStore";
import {
  netUnitPriceForChangedTaxRate,
  netUnitPriceFromVatInclusive,
  vatInclusiveUnitPrice,
} from "@/lib/vatInclusiveSalesPricing";

describe("cash sales VAT-inclusive price entry", () => {
  it("extracts VAT from the entered price instead of adding it on top", () => {
    const unitPrice = netUnitPriceFromVatInclusive(10, 5);
    const totals = calculateTotals([{ id: "1", description: "Service", quantity: 1, unitPrice, discount: 0, tax: 5 }]);

    expect(unitPrice).toBeCloseTo(9.523809524, 8);
    expect(totals.subtotal).toBeCloseTo(9.523809524, 8);
    expect(totals.taxTotal).toBeCloseTo(0.476190476, 8);
    expect(totals.total).toBeCloseTo(10, 8);
    expect(vatInclusiveUnitPrice(unitPrice, 5)).toBe(10);
  });

  it("keeps the final entered amount stable when VAT is toggled", () => {
    const netAtFive = netUnitPriceFromVatInclusive(200, 5);
    const netAtZero = netUnitPriceForChangedTaxRate(netAtFive, 5, 0);
    expect(netAtZero).toBe(200);
    expect(netUnitPriceForChangedTaxRate(netAtZero, 0, 5)).toBeCloseTo(netAtFive, 8);
  });

  it("uses VAT-inclusive price fields in both cash invoice editors", () => {
    for (const file of [
      "src/components/sales/SalesDocEditorPage.tsx",
      "src/components/sales/InvoiceEditor.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain("netUnitPriceFromVatInclusive");
      expect(source).toContain("vatInclusiveUnitPrice");
      expect(source).toContain("netUnitPriceForChangedTaxRate");
      expect(source).toContain("Price incl. VAT");
    }
  });
});
