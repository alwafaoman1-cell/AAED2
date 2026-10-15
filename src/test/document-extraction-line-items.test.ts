import { describe, expect, it } from "vitest";
import { defaultReviewSelection } from "@/lib/documentExtraction/autofill";
import { extractPurchaseLineItems, reviewedPurchaseLineItems } from "@/lib/documentExtraction/lineItems";
import { normalizeCandidate } from "@/lib/documentExtraction/parsers";
import type { DocumentExtractionResult, DocumentPage, SourceSegment } from "@/lib/documentExtraction/types";

const segment = (text: string, x: number, y: number): SourceSegment => ({
  text, confidence: 0.96, box: { x, y, width: 70, height: 20 },
});
const page = (segments: SourceSegment[]): DocumentPage => ({
  number: 1, text: segments.map((item) => item.text).join("\n"), method: "ocr", confidence: 0.94,
  width: 800, height: 500, segments,
});

describe("purchase table extraction", () => {
  const header = [segment("Description", 20, 30), segment("Qty", 300, 30),
    segment("Rate", 450, 30), segment("Total", 600, 30)];
  const first = [segment("Oil Filter", 20, 80), segment("2", 300, 80),
    segment("10.000", 450, 80), segment("20.000", 600, 80)];
  const second = [segment("Brake Pads", 20, 125), segment("1", 300, 125),
    segment("25.000", 450, 125), segment("25.000", 600, 125)];

  it("extracts whole arithmetic-verified rows and requires explicit review", () => {
    const extracted = extractPurchaseLineItems([page([...header, ...first, ...second,
      segment("Grand Total: 47.250", 20, 175)])]);
    expect(extracted.issues).toEqual([]);
    expect(extracted.fields.line_item_1_name.normalizedValue).toBe("Oil Filter");
    expect(extracted.fields.line_item_2_qty.normalizedValue).toBe("1");
    const selected = defaultReviewSelection({ fields: extracted.fields, status: "needs_review", issues: [] } as unknown as DocumentExtractionResult);
    expect(Object.values(selected).every((value) => value === false)).toBe(true);
    const values = Object.fromEntries(Object.entries(extracted.fields).map(([key, field]) => [key, field.normalizedValue]));
    expect(reviewedPurchaseLineItems(values)).toMatchObject({ valid: true, items: [
      { name: "Oil Filter", qty: 2, unitPrice: 10, lineTotal: 20 },
      { name: "Brake Pads", qty: 1, unitPrice: 25, lineTotal: 25 },
    ] });
  });

  it("rejects an OCR-damaged row instead of importing a partial invoice", () => {
    const damaged = first.map((item) => item.text === "20.000" ? { ...item, text: "26.000" } : item);
    const extracted = extractPurchaseLineItems([page([...header, ...damaged, ...second])]);
    expect(extracted.fields).toEqual({});
    expect(extracted.issues[0].code).toBe("LINE_ITEMS_UNRELIABLE");
  });

  it("rejects ambiguous comma-only prices and quantities", () => {
    const ambiguous = first.map((item) => item.text === "10.000" ? { ...item, text: "10,000" } : item);
    expect(extractPurchaseLineItems([page([...header, ...ambiguous])]).fields).toEqual({});
    expect(reviewedPurchaseLineItems({ line_item_1_name: "Oil Filter", line_item_1_qty: "1,000",
      line_item_1_unit_price: "10.000", line_item_1_total: "10.000" }).valid).toBe(false);
  });

  it("rejects selecting half a line or changing arithmetic during review", () => {
    expect(reviewedPurchaseLineItems({ line_item_1_name: "Oil Filter" }).valid).toBe(false);
    expect(reviewedPurchaseLineItems({ line_item_1_name: "Oil Filter", line_item_1_qty: "2",
      line_item_1_unit_price: "10.000", line_item_1_total: "21.000" }).valid).toBe(false);
  });

  it("reads an RTL table by header geometry, not fixed left-to-right column positions", () => {
    const rtl = page([
      segment("البيان", 600, 30), segment("الكمية", 450, 30),
      segment("السعر", 300, 30), segment("الإجمالي", 20, 30),
      segment("فلتر زيت", 600, 80), segment("٢", 450, 80),
      segment("١٠.٠٠٠", 300, 80), segment("٢٠.٠٠٠", 20, 80),
    ]);
    expect(extractPurchaseLineItems([rtl]).fields.line_item_1_name.normalizedValue).toBe("فلتر زيت");
  });
});

describe("Arabic OCR date safety", () => {
  it("decodes complete unambiguous day/month/year digits only", () => {
    expect(normalizeCandidate("accident_date", "٢٧٠٤٢٠٢٦")).toMatchObject({ value: "2026-04-27", valid: true });
    expect(normalizeCandidate("accident_date", "٠٧٠٤٢٠٢٦").valid).toBe(false);
    expect(normalizeCandidate("accident_date", "٣١٠٢٢٠٢٦").valid).toBe(false);
    expect(normalizeCandidate("accident_date", "٢٧٠٤٢٠٢").valid).toBe(false);
  });
});
