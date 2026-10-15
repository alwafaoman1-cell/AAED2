import { describe, expect, it } from "vitest";
import { buildAutofillPayload, defaultReviewSelection } from "@/lib/documentExtraction/autofill";
import { overallDocumentConfidence } from "@/lib/documentExtraction/confidence";
import { detectDocumentType, parseDocumentPages, parseMoneyMilli } from "@/lib/documentExtraction/parsers";
import type { DocumentPage, DocumentExtractionResult } from "@/lib/documentExtraction/types";

function page(text: string, method: "native_pdf" | "ocr" = "native_pdf", confidence = 0.95): DocumentPage {
  return { number: 1, text, method, confidence };
}

describe("TEMO deterministic document extraction", () => {
  it("identifies vehicle registration and validates VIN/plate without inventing missing fields", () => {
    const result = parseDocumentPages([page([
      "Vehicle Registration Card", "Plate No: 47782 B", "VIN: 1HGCM82633A004352",
      "Make: BYD", "Model: Song Plus", "Model Year: 2025", "Owner Name: ALI AL HARTHI", "Expiry Date: 27/04/2027",
    ].join("\n"))]);
    expect(result.type).toBe("vehicle_registration");
    expect(result.fields.plate_number.normalizedValue).toBe("47782");
    expect(result.fields.plate_letters.normalizedValue).toBe("B");
    expect(result.fields.vin.validation).toBe("valid");
    expect(result.fields.registration_expiry.normalizedValue).toBe("2027-04-27");
    expect(result.fields.owner_phone).toBeUndefined();
  });

  it("extracts Arabic insurance fields and converts Arabic digits", () => {
    const result = parseDocumentPages([page([
      "مطالبة تأمين / Insurance Claim", "رقم المطالبة: C/004/01/26/2539/00003", "شركة التأمين: شركة الاختبار",
      "رقم اللوحة: ٤٧٧٨٢ B", "رقم التواصل: ٩٣٩٥٢٥٣٦", "تاريخ الحادث: ٢٧/٠٤/٢٠٢٦",
    ].join("\n"))]);
    expect(result.type).toBe("insurance_claim");
    expect(result.language).toBe("mixed");
    expect(result.fields.claim_number.normalizedValue).toBe("C/004/01/26/2539/00003");
    expect(result.fields.plate_number.normalizedValue).toBe("47782");
    expect(result.fields.owner_phone.normalizedValue).toBe("93952536");
    expect(result.fields.accident_date.normalizedValue).toBe("2026-04-27");
  });

  it("does not convert a following field label into a claim number", () => {
    const result = parseDocumentPages([page([
      "مطالبة تأمين", "رقم المطالبة", "شركة التأمين: شركة تجريبية", "رقم اللوحة٤", "تاريخ الحادث٤",
    ].join("\n"), "ocr", 0.84)], "insurance_claim");
    expect(result.fields.claim_number).toBeUndefined();
    expect(result.fields.insurance_company?.normalizedValue).toBe("شركة تجريبية");
    expect(result.fields.accident_date?.validation).not.toBe("valid");
  });

  it("prefers a validated Latin OCR reference over a damaged RTL label value", () => {
    const result = parseDocumentPages([page([
      "مطالبة تأمين", "71 :رقم المطالبة", "شركة التأمين: شركة تجريبية",
      "C/004/01/26/9999/00001", "تاريخ الحادث: 17/4/7075",
    ].join("\n"), "ocr", 0.9)], "insurance_claim");
    expect(result.fields.claim_number?.normalizedValue).toBe("C/004/01/26/9999/00001");
    expect(result.fields.accident_date?.validation).toBe("warning");
  });

  it("reassembles nearby RTL OCR fragments without borrowing a different row", () => {
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.82, width: 1700, height: 850,
      text: ["مطالبة تأمين", "المطالبة", "C/004/01/26/9999/00001 ر قم", "التأمين شركة تجريبية", "شركة", "٤٧٧٨٢", "اللوحة", "B رقم"].join("\n"),
      segments: [
        { text: "التأمين شركة تجريبية", box: { x: 55, y: 293, width: 390, height: 69 } },
        { text: "شركة", box: { x: 433, y: 297, width: 115, height: 56 } },
        { text: "٤٧٧٨٢", box: { x: 62, y: 405, width: 144, height: 45 } },
        { text: "اللوحة", box: { x: 209, y: 403, width: 144, height: 57 } },
        { text: "B رقم", box: { x: 336, y: 404, width: 125, height: 58 } },
      ],
    }], "insurance_claim");
    expect(result.fields.insurance_company?.normalizedValue).toBe("شركة تجريبية");
    expect(result.fields.plate_number?.normalizedValue).toBe("47782");
    expect(result.fields.claim_number?.normalizedValue).toBe("C/004/01/26/9999/00001");
  });

  it("prefers a separately recognized plate value over truncated digits embedded in its OCR label", () => {
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.84, width: 1700, height: 850,
      text: "مطالبة تأمين\nرقم اللوحة٤٢\n٤٧٧٨٢\nتاريخ الحادث٤",
      segments: [
        { text: "رقم اللوحة٤٢", box: { x: 160, y: 404, width: 382, height: 68 } },
        { text: "٤٧٧٨٢", box: { x: 168, y: 417, width: 146, height: 44 } },
        { text: "تاريخ الحادث٤", box: { x: 166, y: 504, width: 481, height: 72 } },
      ],
    }], "insurance_claim");
    expect(result.fields.plate_number?.normalizedValue).toBe("47782");
    expect(result.fields.accident_date?.validation).not.toBe("valid");
  });

  it("does not alter a supplier invoice to force VAT arithmetic", () => {
    const base = ["Tax Invoice", "Supplier Name: Example Parts LLC", "VATIN: OM123456789", "Invoice No: SUP-2026-44", "Invoice Date: 18/08/2026", "Subtotal: 100.000 OMR", "VAT Amount: 5.000 OMR"];
    const result = parseDocumentPages([page([...base, "Grand Total: 105.000 OMR"].join("\n"))]);
    expect(result.type).toBe("supplier_invoice");
    expect(result.fields.total.normalizedValue).toBe("105.000");
    expect(result.issues.some((issue) => issue.code === "VAT_TOTAL_MISMATCH")).toBe(false);
    const mismatch = parseDocumentPages([page([...base, "Grand Total: 106.000 OMR"].join("\n"))]);
    expect(mismatch.fields.total.normalizedValue).toBe("106.000");
    expect(mismatch.issues.some((issue) => issue.code === "VAT_TOTAL_MISMATCH")).toBe(true);
  });

  it("treats invalid dates and VIN as review warnings", () => {
    const vehicle = parseDocumentPages([page("Vehicle Registration Card\nVIN: IHGCM82633A004352\nExpiry Date: 31/02/2026")]);
    expect(vehicle.fields.vin.validation).toBe("warning");
    expect(vehicle.fields.registration_expiry.validation).toBe("warning");
    expect(vehicle.issues.map((issue) => issue.code)).toContain("VIN_FORMAT_INVALID");
  });

  it("classifies unclear documents as unknown instead of guessing", () => {
    expect(detectDocumentType("Hello 1234 and no document labels").type).toBe("unknown");
    expect(detectDocumentType("Purchase Invoice\nSupplier Name: TEST PARTS").type).toBe("purchase_invoice");
  });

  it("normalizes an unambiguous short year in document dates", () => {
    const result = parseDocumentPages([page("Insurance Claim\nClaim No: C/004/01/26/9999/00001\nAccident Date: 27/04/26")]);
    expect(result.fields.accident_date.normalizedValue).toBe("2026-04-27");
  });

  it("keeps OMR in integer milli-units, including negative zero", () => {
    expect(parseMoneyMilli("1,550.850 OMR")).toBe(1550850);
    expect(parseMoneyMilli("-0.500")).toBe(-500);
    expect(parseMoneyMilli("5.0000000001")).toBeNull();
  });

  it("only autofills allowlisted review fields", () => {
    const parsed = parseDocumentPages([page("Vehicle Registration Card\nPlate No: 47782 B\nVIN: 1HGCM82633A004352\nOwner Name: TEST CUSTOMER")]);
    const result = { fields: parsed.fields } as DocumentExtractionResult;
    expect(defaultReviewSelection(result).vin).toBe(true);
    const payload = buildAutofillPayload(result, "vehicle_customer", {
      vin: "1HGCM82633A004352", plate_number: "47782", plate_letters: "B", owner_name: null,
    });
    expect(payload).toEqual({ vin: "1HGCM82633A004352", plate_number: "47782", plate_letters: "B", plate: "B 47782" });
  });

  it("can retain a reviewed unreadable document without writing form fields", () => {
    const result = { fields: {} } as DocumentExtractionResult;
    expect(defaultReviewSelection(result)).toEqual({});
    expect(buildAutofillPayload(result, "vehicle_customer", {})).toEqual({});
  });

  it("requires explicit review for OCR identifiers and AI-suggested fields", () => {
    const parsed = parseDocumentPages([page("Vehicle Registration Card\nPlate No: 47782 B\nVIN: 1HGCM82633A004352\nOwner Name: TEST CUSTOMER", "ocr", 0.98)]);
    const result = { status: "needs_review", fields: parsed.fields } as DocumentExtractionResult;
    expect(defaultReviewSelection(result).vin).toBe(false);
    expect(defaultReviewSelection(result).plate_number).toBe(false);
    result.fields.owner_name.method = "ai";
    expect(defaultReviewSelection(result).owner_name).toBe(false);
  });

  it("does not auto-select fields when the actual document type differs from the form", () => {
    const parsed = parseDocumentPages([page("Insurance Claim\nClaim No: C/004/01/26/9999/00001\nPlate No: 47782 B")], "vehicle_registration");
    expect(parsed.issues.map((issue) => issue.code)).toContain("DOCUMENT_TYPE_MISMATCH");
    expect(defaultReviewSelection({ status: "needs_review", fields: parsed.fields, issues: parsed.issues } as DocumentExtractionResult).plate_number).toBe(false);
  });

  it("lowers overall confidence when DB matching fails or an identity conflict exists", () => {
    const parsed = parseDocumentPages([page("Vehicle Registration Card\nPlate No: 47782 B\nVIN: 1HGCM82633A004352")]);
    const base = { fields: parsed.fields, issues: parsed.issues, documentTypeConfidence: parsed.typeConfidence, matchingStatus: "complete" } as DocumentExtractionResult;
    expect(overallDocumentConfidence(base)).toBeGreaterThan(0.6);
    expect(overallDocumentConfidence({ ...base, matchingStatus: "failed" })).toBeLessThanOrEqual(0.6);
    expect(overallDocumentConfidence({ ...base, issues: [{ code: "VEHICLE_IDENTITY_CONFLICT", severity: "error", message: "conflict" }] })).toBeLessThanOrEqual(0.35);
  });
});
