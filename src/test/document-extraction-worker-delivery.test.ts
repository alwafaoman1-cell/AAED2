import { describe, expect, it } from "vitest";
import { alignedEnglishClaimReference } from "@/lib/documentExtraction/ocr";
import { buildAutofillPayload, defaultReviewSelection, verifiedFieldMayBeApplied } from "@/lib/documentExtraction/autofill";
import { parseDocumentPages } from "@/lib/documentExtraction/parsers";
import { extractAndPersistDocument } from "@/lib/documentExtraction/engine";
import type { DocumentExtractionResult, ExtractedField, SourceSegment } from "@/lib/documentExtraction/types";

const label: SourceSegment = { text: "71 :رقم المطالبة", confidence: 0.86,
  box: { x: 60, y: 173, width: 738, height: 50 } };
const reference: SourceSegment = { text: "C/004/01/26/9999/00001", confidence: 0.81,
  box: { x: 280, y: 180, width: 518, height: 36 } };

describe("worker/browser document delivery contracts", () => {
  it("does not silently use low-accuracy local OCR for a claim or purchase invoice", async () => {
    const file = new File(["%PDF-1.4\n"], "synthetic.pdf", { type: "application/pdf" });
    for (const expectedType of ["insurance_claim", "purchase_invoice"] as const) {
      await expect(extractAndPersistDocument(file, { tenantId: "synthetic-only", expectedType }))
        .rejects.toMatchObject({ code: "DOCUMENT_WORKER_REQUIRED" });
    }
  });
  it("accepts only complete, aligned, high-confidence claim evidence", () => {
    expect(alignedEnglishClaimReference([label], [reference])?.text).toBe(reference.text);
    expect(alignedEnglishClaimReference([label], [{ ...reference, confidence: 0.3 }])).toBeNull();
    expect(alignedEnglishClaimReference([label], [{ ...reference, text: "C/004/01" }])).toBeNull();
    expect(alignedEnglishClaimReference([label], [{ ...reference, box: { ...reference.box!, y: 400 } }])).toBeNull();
    expect(alignedEnglishClaimReference([], [reference])).toBeNull();
  });

  it("delivers parsed worker pages to a reviewed claim form without auto-selecting OCR identifiers", () => {
    const parsed = parseDocumentPages([{ number: 1, method: "ocr", confidence: 0.9,
      text: "مطالبة تأمين\nرقم المطالبة: C/004/01/26/9999/00001\nشركة التأمين: شركة تجريبية\nرقم اللوحة: ٤٧٧٨٢", width: 1700, height: 800,
      segments: [label, reference] }], "insurance_claim");
    const result = { fields: parsed.fields, issues: parsed.issues, status: "needs_review" } as DocumentExtractionResult;
    expect(parsed.fields.claim_number?.normalizedValue).toBe(reference.text);
    expect(parsed.fields.plate_number?.normalizedValue).toBe("47782");
    expect(defaultReviewSelection(result).claim_number).toBe(false);
    expect(defaultReviewSelection(result).plate_number).toBe(false);
    const reviewed = { claim_number: reference.text, insurance_company: "شركة تجريبية", plate_number: "47782" };
    const form = buildAutofillPayload(result, "insurance_claim", reviewed);
    expect(form).toMatchObject({ claim_number: reference.text, insurance_company: "شركة تجريبية", plate: "47782" });
  });

  it("carries a gate-pass value row through Review into claim autofill", () => {
    const parsed = parseDocumentPages([{ number: 1, method: "ocr", confidence: 0.87,
      text: ["SAMPLE INSURANCE COMPANY (S.A.O.G)", "Gate Pass To Example Workshop LLC",
        "Claim No : 103/0501/2026/C/009999", "Date of Accident : 06/10/2026",
        "Customer Name", "SAMPLE CUSTOMER", "Customer Contact", "91234567",
        "Registration No.", "RW 1620", "Make /Model", "Mitsubishi /L200"].join("\n"),
      width: 1178, height: 1599,
      segments: [
        { text: "Customer Name", box: { x: 47, y: 263, width: 191, height: 33 } },
        { text: "SAMPLE CUSTOMER", box: { x: 339, y: 266, width: 296, height: 36 } },
        { text: "Customer Contact", box: { x: 44, y: 289, width: 213, height: 35 } },
        { text: "91234567", box: { x: 335, y: 290, width: 124, height: 37 } },
        { text: "Registration No.", box: { x: 42, y: 349, width: 192, height: 37 } },
        { text: "RW 1620", box: { x: 334, y: 351, width: 129, height: 38 } },
      ],
    }], "insurance_claim");
    const result = { fields: parsed.fields, issues: parsed.issues, status: "needs_review" } as DocumentExtractionResult;
    expect(defaultReviewSelection(result).plate_number).toBe(false);
    expect(defaultReviewSelection(result).owner_phone).toBe(false);
    const reviewed = Object.fromEntries(Object.entries(parsed.fields).map(([key, field]) => [key, field.normalizedValue]));
    expect(buildAutofillPayload(result, "insurance_claim", reviewed)).toMatchObject({
      claim_number: "103/0501/2026/C/009999",
      owner_name: "SAMPLE CUSTOMER",
      owner_phone: "91234567",
      plate: "RW 1620",
      make: "Mitsubishi",
      model: "L200",
      incident_date: "2026-10-06",
    });
  });

  it("prevents an already verified field from being silently changed on reuse", () => {
    const field = { normalizedValue: "C/004/01/26/9999/00001", reviewStatus: "accepted" } as ExtractedField;
    expect(verifiedFieldMayBeApplied(field, true, field.normalizedValue)).toBe(true);
    expect(verifiedFieldMayBeApplied(field, true, "C/004/01/26/9999/00002")).toBe(false);
    expect(verifiedFieldMayBeApplied({ ...field, reviewStatus: "rejected" }, true, field.normalizedValue)).toBe(false);
    expect(verifiedFieldMayBeApplied({ ...field, reviewStatus: "corrected", reviewedValue: "C/004/01/26/9999/00003" }, true,
      "C/004/01/26/9999/00003")).toBe(true);
    expect(verifiedFieldMayBeApplied(field, false, "anything")).toBe(true);
  });
});
