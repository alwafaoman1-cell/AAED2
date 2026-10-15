import { describe, expect, it } from "vitest";
import { normalizeArabicForComparison, parseDocumentPages } from "@/lib/documentExtraction/parsers";
import type { DocumentPage } from "@/lib/documentExtraction/types";

describe("Arabic claim evidence", () => {
  it("normalizes Arabic digits and diacritics for comparison without changing raw evidence", () => {
    expect(normalizeArabicForComparison("رَقْمُ المُطالبة: ٤٧٧٨٢")).toBe("رقم المطالبه 47782");
  });

  it("accepts a right-to-left value before its label and preserves its source box", () => {
    const page: DocumentPage = { number: 1, method: "ocr", confidence: 0.92, width: 1200, height: 1600,
      text: "مطالبة تأمين\nC/004/01/26/9999/00001 : رقم المطالبة\nالمدينة تكافل : شركة التأمين\n٤٧٧٨٢ : رقم اللوحة",
      segments: [
        { text: "C/004/01/26/9999/00001 : رقم المطالبة", box: { x: 300, y: 200, width: 500, height: 34 } },
        { text: "المدينة تكافل : شركة التأمين", box: { x: 300, y: 250, width: 420, height: 34 } },
        { text: "٤٧٧٨٢ : رقم اللوحة", box: { x: 300, y: 300, width: 300, height: 34 } },
      ] };
    const parsed = parseDocumentPages([page], "insurance_claim");
    expect(parsed.fields.claim_number.normalizedValue).toBe("C/004/01/26/9999/00001");
    expect(parsed.fields.plate_number.normalizedValue).toBe("47782");
    expect(parsed.fields.claim_number.sourceBox?.y).toBe(200);
  });

  it("does not silently validate a two-digit OCR hallucination as a claim number", () => {
    const parsed = parseDocumentPages([{ number: 1, method: "ocr", confidence: 0.7,
      text: "مطالبة تأمين\nرقم المطالبة: 71" }], "insurance_claim");
    expect(parsed.fields.claim_number.validation).toBe("warning");
    expect(parsed.issues.some((issue) => issue.code === "CLAIM_NUMBER_INVALID")).toBe(true);
  });
});
