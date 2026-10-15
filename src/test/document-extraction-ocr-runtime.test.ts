import { afterAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { parseDocumentPages } from "@/lib/documentExtraction/parsers";
import { alignedEnglishClaimReference } from "@/lib/documentExtraction/ocr";
import type { SourceSegment } from "@/lib/documentExtraction/types";

// Run explicitly with RUN_REAL_OCR=1. It downloads the public ara+eng model and
// measures real OCR; no customer document or external AI provider is used.
const runRealOcr = process.env.RUN_REAL_OCR === "1";
const metrics: Array<{ type: string; expected: number; exact: number; ms: number }> = [];
const workerOptions = { cachePath: tmpdir() };

function syntheticImage(lines: string[]) {
  const canvas = createCanvas(1700, 230 + lines.length * 95);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = "bold 48px Arial";
  lines.forEach((line, index) => ctx.fillText(line, 60, 120 + index * 95));
  return canvas.toBuffer("image/png");
}

describe.skipIf(!runRealOcr)("real bilingual WASM OCR baseline on synthetic images", () => {
  afterAll(() => { if (metrics.length) process.stdout.write(`TEMO_OCR_BASELINE ${JSON.stringify(metrics)}\n`); });

  it("recognizes an English vehicle registration with fields", async () => {
    const blob = syntheticImage([
      "Vehicle Registration Card", "Plate No: 47782 B", "VIN: 1HGCM82633A004352",
      "Make: BYD", "Model: Song Plus", "Owner Name: TEST OWNER",
    ]);
    const started = performance.now();
    const worker = await createWorker("ara+eng", 1, workerOptions);
    try {
      // Node's Tesseract image normalizer expects Buffer; production's browser adapter receives Blob.
      const { data } = await worker.recognize(blob);
      const page = { number: 1, text: data.text, method: "ocr" as const, confidence: data.confidence / 100 };
      const result = parseDocumentPages([page], "vehicle_registration");
      const expected = { plate_number: "47782", vin: "1HGCM82633A004352", make: "BYD", model: "Song Plus" };
      const exact = Object.entries(expected).filter(([key, value]) => result.fields[key]?.normalizedValue === value).length;
      metrics.push({ type: "vehicle_registration_en", expected: 4, exact, ms: Math.round(performance.now() - started) });
      expect(exact).toBe(4);
    } finally { await worker.terminate(); }
  }, 180_000);

  it("measures mixed Arabic/English supplier invoice extraction", async () => {
    const blob = syntheticImage([
      "فاتورة ضريبية / TAX INVOICE",
      "اسم المورد: شركة تجريبية",
      "VATIN: OM123456789",
      "Invoice No: TEST-2026-41",
      "Invoice Date: 18/08/2026",
      "Subtotal: 100.000 OMR",
      "VAT Amount: 5.000 OMR",
      "Grand Total: 105.000 OMR",
    ]);
    const started = performance.now();
    const worker = await createWorker("ara+eng", 1, workerOptions);
    try {
      const { data } = await worker.recognize(blob);
      const result = parseDocumentPages([{ number: 1, text: data.text, method: "ocr", confidence: data.confidence / 100 }], "supplier_invoice");
      const expected = { supplier_name: "شركة تجريبية", supplier_vatin: "OM123456789", invoice_number: "TEST-2026-41", invoice_date: "2026-08-18", subtotal: "100.000", vat: "5.000", total: "105.000" };
      const exact = Object.entries(expected).filter(([key, value]) => result.fields[key]?.normalizedValue === value).length;
      metrics.push({ type: "supplier_invoice_mixed", expected: 7, exact, ms: Math.round(performance.now() - started) });
      expect(result.language).toBe("mixed");
      expect(exact).toBe(7);
    } finally { await worker.terminate(); }
  }, 180_000);

  it("measures Arabic insurance claim recognition without external AI", async () => {
    const blob = syntheticImage([
      "مطالبة تأمين",
      "رقم المطالبة: C/004/01/26/9999/00001",
      "شركة التأمين: شركة تجريبية",
      "رقم اللوحة: ٤٧٧٨٢ B",
      "تاريخ الحادث: ٢٧/٠٤/٢٠٢٦",
    ]);
    const started = performance.now();
    const worker = await createWorker("ara+eng", 1, workerOptions);
    try {
      const { data } = await worker.recognize(blob, {}, { blocks: true });
      const primarySegments: SourceSegment[] = (data.blocks || []).flatMap((block) => block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.map((line) => ({ text: line.text, confidence: line.confidence / 100,
          box: { x: line.bbox.x0, y: line.bbox.y0, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0 } }))));
      const raw = parseDocumentPages([{ number: 1, text: data.text, method: "ocr", confidence: data.confidence / 100 }], "insurance_claim");
      await worker.reinitialize("eng");
      const secondary = await worker.recognize(blob, {}, { blocks: true });
      const englishWords: SourceSegment[] = (secondary.data.blocks || []).flatMap((block) => block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) => line.words.map((word) => ({ text: word.text, confidence: word.confidence / 100,
          box: { x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 } })))));
      const reference = alignedEnglishClaimReference(primarySegments, englishWords);
      const result = parseDocumentPages([{ number: 1, text: `${data.text}\n${reference?.text || ""}`, method: "ocr",
        confidence: data.confidence / 100, width: 1700, height: 705,
        segments: reference ? [...primarySegments, reference] : primarySegments }], "insurance_claim");
      if (process.env.OCR_DEBUG === "1") process.stdout.write(`TEMO_ARABIC_OCR_DEBUG ${JSON.stringify({
        text: data.text,
        fields: Object.fromEntries(Object.entries(result.fields).map(([key, field]) => [key, {
          value: field.normalizedValue, confidence: field.confidence,
        }])),
      })}\n`);
      const expected = { claim_number: "C/004/01/26/9999/00001", insurance_company: "شركة تجريبية", plate_number: "47782", accident_date: "2026-04-27" };
      const exact = Object.entries(expected).filter(([key, value]) => result.fields[key]?.normalizedValue === value).length;
      metrics.push({ type: "insurance_claim_ar", expected: 4, exact, ms: Math.round(performance.now() - started) });
      if (process.env.OCR_DEBUG === "1") process.stdout.write(`TEMO_ARABIC_RAW_BASELINE ${JSON.stringify({
        exact: Object.entries(expected).filter(([key, value]) => raw.fields[key]?.normalizedValue === value).length,
        expected: 4,
      })}\n`);
      expect(result.type).toBe("insurance_claim");
      expect(exact).toBeGreaterThanOrEqual(2);
    } finally { await worker.terminate(); }
  }, 180_000);
});
