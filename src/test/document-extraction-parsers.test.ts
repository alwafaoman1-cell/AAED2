import { describe, expect, it } from "vitest";
import { buildAutofillPayload, defaultReviewSelection } from "@/lib/documentExtraction/autofill";
import { overallDocumentConfidence } from "@/lib/documentExtraction/confidence";
import { detectDocumentType, normalizeCandidate, parseDocumentPages, parseMoneyMilli } from "@/lib/documentExtraction/parsers";
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

  it("does not present headings, legal prose or a plate reference as claim vehicle fields", () => {
    const result = parseDocumentPages([page([
      "Identity Card required / بطاقة الشخصية", "رقم المطالبة: C/004/01/26/9999/00002",
      "تاريخ الحادث", "تاريخ الإبلاغ", "رقم اللوحة", "تاريخالإبلاغ",
      "VIN", "To leave my vehicle at the above-mentioned garage for repairs as per Unified Motor",
      "Make: A R/4841", "Model: A R/4841", "Registration Date", "OD Vehicle",
      "هاتف المالك: 91234567",
    ].join("\n"), "ocr", 0.92)], "insurance_claim");
    expect(result.fields.claim_number?.normalizedValue).toBe("C/004/01/26/9999/00002");
    expect(result.fields.owner_phone?.normalizedValue).toBe("91234567");
    expect(result.type).toBe("insurance_claim");
    for (const key of ["accident_date", "plate_number", "vin", "make", "model", "registration_date"]) {
      expect(result.fields[key], key).toBeUndefined();
    }
    expect(result.issues.some((issue) => issue.code === "DOCUMENT_TYPE_MISMATCH")).toBe(false);
  });

  it("parses a letters-first plate only at its own label, not as the make or model", () => {
    const result = parseDocumentPages([page([
      "Insurance Claim", "Claim No: C/004/01/26/9999/00002", "Plate No: A R/4841",
      "Make: Toyota", "Model: RAV4",
    ].join("\n"), "ocr", 0.9)], "insurance_claim");
    expect(result.fields.plate_number?.normalizedValue).toBe("4841");
    expect(result.fields.plate_letters?.normalizedValue).toBe("AR");
    expect(result.fields.make?.normalizedValue).toBe("Toyota");
    expect(result.fields.model?.normalizedValue).toBe("RAV4");
  });

  it("extracts only the value from an English Claim No / Policy No. cell", () => {
    const result = parseDocumentPages([page([
      "Al Madina Takaful", "Repair Gate Pass For Accident vehicle",
      "Claim No / Policy No. C/004/01/26/2501/00545",
      "Date of Loss 01/10/2026", "Date of Intimation 05/10/2026",
      "Vehicle Make & Model Toyota - Land Cruiser",
    ].join("\n"), "ocr", .88)], "insurance_claim");
    expect(result.fields.claim_number?.normalizedValue).toBe("C/004/01/26/2501/00545");
    expect(result.fields.accident_date?.normalizedValue).toBe("2026-10-01");
    expect(normalizeCandidate("claim_number", "Policy No. C/004/01/26/2501/00545").valid).toBe(false);
  });

  it("reads the real claim gate-pass layout without swapping the loss and report dates", () => {
    const result = parseDocumentPages([page([
      "Al Madina Takaful", "Claim No / Policy No.", "C/004/16/26/2510/00266",
      "Vehicle Make & Model", "Toyota - Corolla", "نوع المركبة و الفئة",
      "Vehicle No", "A R/4841", "رقم المركبة",
      "Date of Intimation", "15/10/2026", "تاريخ الإبلاغ",
      "Date of Loss", "14/10/2026", "تاريخ الحادث",
      "VIN", "To leave my vehicle at the above-mentioned garage for repairs as per Unified Motor",
    ].join("\n"), "ocr", 0.92)], "insurance_claim");
    expect(result.fields.claim_number?.normalizedValue).toBe("C/004/16/26/2510/00266");
    expect(result.fields.accident_date?.normalizedValue).toBe("2026-10-14");
    expect(result.fields.plate_number?.normalizedValue).toBe("4841");
    expect(result.fields.plate_letters?.normalizedValue).toBe("AR");
    expect(result.fields.make?.normalizedValue).toBe("Toyota");
    expect(result.fields.model?.normalizedValue).toBe("Corolla");
    expect(result.fields.vin).toBeUndefined();
    expect(result.fields.insurance_company?.normalizedValue).toBe("Al Madina Takaful");
    expect(result.fields.insurance_company?.validation).toBe("warning");
  });

  it("reads a scanned insurance gate pass in OCR order without treating the report date as the accident date", () => {
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.88, width: 1488, height: 2105,
      text: [
        "تصريح المرور لتصليح المركبات المتضررة", "Claim No / Policy No.", "C/004/01/26/9999/00001",
        "Name of Driver, Owner of", "EXAMPLE CUSTOMER", "the vehicle", "Contact No", "91234567",
        "Vehicle Make & Model", "Toyota - Land Cruiser", "21السنة", "B C/48261", "رقم المركبة", "Vehicle No",
        "Date of Intimation", "05/10/2026", "تاريخ الإبلاغ", "Date of Loss", "01/10/2026", "تاريخ الحادث",
        "First Registration Date", "04/11/2021", "Name of Customer", "Contact No",
      ].join("\n"),
      segments: [
        { text: "B C/48261", box: { x: 405, y: 470, width: 145, height: 34 } },
        { text: "21السنة", box: { x: 790, y: 430, width: 190, height: 34 } },
        { text: "2021", box: { x: 990, y: 430, width: 80, height: 34 } },
        { text: "رقم المركبة", box: { x: 1130, y: 470, width: 150, height: 34 } },
        { text: "Vehicle No", box: { x: 115, y: 470, width: 135, height: 34 } },
      ],
    }], "insurance_claim");
    expect(result.type).toBe("insurance_claim");
    expect(result.issues.some((issue) => issue.code === "DOCUMENT_TYPE_MISMATCH")).toBe(false);
    expect(result.fields.claim_number?.normalizedValue).toBe("C/004/01/26/9999/00001");
    expect(result.fields.owner_name?.normalizedValue).toBe("EXAMPLE CUSTOMER");
    expect(result.fields.owner_name?.validation).toBe("warning");
    expect(defaultReviewSelection({ status: "needs_review", fields: result.fields, issues: result.issues } as DocumentExtractionResult).owner_name).toBe(false);
    expect(result.fields.owner_phone?.normalizedValue).toBe("91234567");
    expect(result.fields.make?.normalizedValue).toBe("Toyota");
    expect(result.fields.model?.normalizedValue).toBe("Land Cruiser");
    expect(result.fields.year?.normalizedValue).toBe("2021");
    expect(defaultReviewSelection({ status: "needs_review", fields: result.fields, issues: result.issues } as DocumentExtractionResult).year).toBe(false);
    expect(result.fields.plate_number?.normalizedValue).toBe("48261");
    expect(result.fields.plate_letters?.normalizedValue).toBe("BC");
    expect(result.fields.accident_date?.normalizedValue).toBe("2026-10-01");
    expect(result.fields.registration_date).toBeUndefined();
  });

  it("takes the name from the gate-pass value cell, not the next line of its split label", () => {
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.92, width: 1489, height: 2106,
      text: [
        "تصريح المرور لتصليح المركبات المتضررة", "Claim No: C/004/01/26/9999/00001",
        "Name of Driver, Owner of", "AMAL SALIM AL HARTHI", "the vehicle", "اسم السائق ، مالك المركبة",
        "Contact No: 91234567",
      ].join("\n"),
      segments: [
        { text: "AMAL SALIM AL HARTHI", box: { x: 408, y: 315, width: 440, height: 24 } },
        { text: "Name of Driver, Owner of", box: { x: 127, y: 316, width: 241, height: 24 } },
        { text: "the vehicle", box: { x: 127, y: 342, width: 106, height: 25 } },
      ],
    }], "insurance_claim");
    expect(result.fields.owner_name?.normalizedValue).toBe("AMAL SALIM AL HARTHI");
    expect(result.fields.owner_name?.sourceBox?.x).toBe(408);
    expect(result.fields.owner_name?.validation).toBe("warning");
    expect(result.issues.map((issue) => issue.code)).toContain("DRIVER_OR_OWNER_REVIEW_REQUIRED");
    expect(defaultReviewSelection({ status: "needs_review", fields: result.fields, issues: result.issues } as DocumentExtractionResult).owner_name).toBe(false);
  });

  it("does not offer a split gate-pass label as a customer name when the value cell is empty", () => {
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.92, width: 1489, height: 2106,
      text: "تصريح المرور لتصليح المركبات المتضررة\nName of Driver, Owner of\nthe vehicle\nContact No: 91234567",
      segments: [
        { text: "Name of Driver, Owner of", box: { x: 127, y: 316, width: 241, height: 24 } },
        { text: "the vehicle", box: { x: 127, y: 342, width: 106, height: 25 } },
      ],
    }], "insurance_claim");
    expect(result.fields.owner_name).toBeUndefined();
  });

  it("extracts a second insurer gate-pass layout from its labeled value cells", () => {
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.868, width: 1178, height: 1599,
      text: [
        "SAMPLE INSURANCE COMPANY (S.A.O.G)", "C", "Gate Pass To Example Workshop LLC",
        "Claim No : 103/0501/2026/C/009999", "Date of Accident : 06/10/2026",
        "Customer Name", "SAMPLE CUSTOMER", "Customer Contact", "91234567", "92972932",
        "Vehicle Type", "11014", "Registration No.", "RW 1620", "Make /Model", "Mitsubishi /L200",
      ].join("\n"),
      segments: [
        { text: "SAMPLE INSURANCE COMPANY (S.A.O.G)", box: { x: 267, y: 122, width: 352, height: 34 } },
        { text: "C", box: { x: 870, y: 127, width: 29, height: 16 } },
        { text: "Claim No : 103/0501/2026/C/009999", box: { x: 53, y: 226, width: 455, height: 37 } },
        { text: "Date of Accident : 06/10/2026", box: { x: 707, y: 236, width: 358, height: 39 } },
        { text: "Customer Name", box: { x: 47, y: 263, width: 191, height: 33 } },
        { text: "SAMPLE CUSTOMER", box: { x: 339, y: 266, width: 296, height: 36 } },
        { text: "Customer Contact", box: { x: 44, y: 289, width: 213, height: 35 } },
        { text: "91234567", box: { x: 335, y: 290, width: 124, height: 37 } },
        { text: "92972932", box: { x: 493, y: 300, width: 215, height: 54 } },
        { text: "Vehicle Type", box: { x: 42, y: 317, width: 165, height: 40 } },
        { text: "11014", box: { x: 335, y: 320, width: 85, height: 36 } },
        { text: "Registration No.", box: { x: 42, y: 349, width: 192, height: 37 } },
        { text: "RW 1620", box: { x: 334, y: 351, width: 129, height: 38 } },
        { text: "Make /Model", box: { x: 43, y: 381, width: 163, height: 35 } },
        { text: "Mitsubishi /L200", box: { x: 336, y: 382, width: 201, height: 41 } },
      ],
    }], "insurance_claim");
    expect(result.type).toBe("insurance_claim");
    expect(result.fields.claim_number?.normalizedValue).toBe("103/0501/2026/C/009999");
    expect(result.fields.insurance_company?.normalizedValue).toBe("SAMPLE INSURANCE COMPANY (S.A.O.G)");
    expect(result.fields.insurance_company?.validation).toBe("warning");
    expect(result.fields.owner_name?.normalizedValue).toBe("SAMPLE CUSTOMER");
    expect(result.fields.owner_phone?.normalizedValue).toBe("91234567");
    expect(result.fields.plate_number?.normalizedValue).toBe("1620");
    expect(result.fields.plate_letters?.normalizedValue).toBe("RW");
    expect(result.fields.make?.normalizedValue).toBe("Mitsubishi");
    expect(result.fields.model?.normalizedValue).toBe("L200");
    expect(result.fields.accident_date?.normalizedValue).toBe("2026-10-06");
    const selected = defaultReviewSelection({ status: "needs_review", fields: result.fields, issues: result.issues } as DocumentExtractionResult);
    expect(selected.plate_number).toBe(false);
    expect(selected.owner_phone).toBe(false);
  });

  it("reads an insurer repair order as an LPO without mixing approval amounts with an invoice", () => {
    const result = parseDocumentPages([page([
      "EXAMPLE INSURANCE COMPANY (S.A.O.G)", "MOTOR VEHICLE REPAIR ORDER",
      "LPO No.", "90783", "Print Date", "17/09/2026", "Issue Date", "14/09/2026",
      "Ref. Our Claim No", ": 103/0502/2026/C/001669", "Policy No", ": 103/0502/2026/P/034138",
      "Accident Date", ": 11/09/2026", "Owners", "SAMPLE PERSON",
      "Cont.No.", ":99601817", "Regn.No.: DD/94260", "Make", "BYD", "Model", "Qin Pro", "Year", "2025",
      "Spare Parts", "1,200.000", "Labour Charges", "250.000", "Total", "1,450.000",
    ].join("\n"), "ocr", 0.92)], "insurance_claim");
    expect(result.type).toBe("lpo");
    expect(result.issues.some((issue) => issue.code === "DOCUMENT_TYPE_MISMATCH")).toBe(false);
    expect(result.fields.lpo_number?.normalizedValue).toBe("90783");
    expect(result.fields.claim_number?.normalizedValue).toBe("103/0502/2026/C/001669");
    expect(result.fields.policy_number?.normalizedValue).toBe("103/0502/2026/P/034138");
    expect(result.fields.accident_date?.normalizedValue).toBe("2026-09-11");
    expect(result.fields.lpo_issue_date?.normalizedValue).toBe("2026-09-14");
    expect(result.fields.owner_name?.normalizedValue).toBe("SAMPLE PERSON");
    expect(result.fields.owner_phone?.normalizedValue).toBe("99601817");
    expect(result.fields.plate_number?.normalizedValue).toBe("94260");
    expect(result.fields.plate_letters?.normalizedValue).toBe("DD");
    expect(result.fields.make?.normalizedValue).toBe("BYD");
    expect(result.fields.model?.normalizedValue).toBe("Qin Pro");
    expect(result.fields.approved_amount?.normalizedValue).toBe("1450.000");
    expect(result.fields.lpo_parts_amount?.normalizedValue).toBe("1200.000");
    expect(result.fields.lpo_labour_amount?.normalizedValue).toBe("250.000");
    expect(result.fields.invoice_number).toBeUndefined();
    const selected = defaultReviewSelection({ status: "needs_review", fields: result.fields, issues: result.issues } as DocumentExtractionResult);
    expect(selected.approved_amount).toBe(false);
    expect(selected.lpo_number).toBe(false);
  });

  it("reads a filled gate pass but does not borrow an unlabeled handwritten phone or a form date", () => {
    const result = parseDocumentPages([page([
      "77123306", "EXAMPLE INSURANCE COMPANY", "Gate Pass To Workshop",
      "Claim No : 706/0502/2026/C/000072", "Date of Accident : 04/10/2026",
      "Customer Name", "SAMPLE CUSTOMER", "Customer Contact", "91329999",
      "Vehicle Type", "SUV", "Registration No.", "DD 44872", "Make /Model", "BYD/Song Plus",
      "Delivery Date:", "", "Date", "06/10/2026",
    ].join("\n"), "ocr", 0.88)], "insurance_claim");
    expect(result.type).toBe("insurance_claim");
    expect(result.fields.claim_number?.normalizedValue).toBe("706/0502/2026/C/000072");
    expect(result.fields.owner_name?.normalizedValue).toBe("SAMPLE CUSTOMER");
    expect(result.fields.owner_phone?.normalizedValue).toBe("91329999");
    expect(result.fields.plate_number?.normalizedValue).toBe("44872");
    expect(result.fields.plate_letters?.normalizedValue).toBe("DD");
    expect(result.fields.make?.normalizedValue).toBe("BYD");
    expect(result.fields.model?.normalizedValue).toBe("Song Plus");
    expect(result.fields.accident_date?.normalizedValue).toBe("2026-10-04");
    expect(result.fields.approved_amount).toBeUndefined();
  });

  it("does not turn an OCR question mark in a scanned contact number into a valid phone", () => {
    const parsed = parseDocumentPages([page([
      "Repair Gate Pass For Accident vehicle", "Claim No / Policy No. C/004/16/26/2501/00140",
      "Contact No", "9956 6626?", "Date of Intimation", "18/10/2026", "Date of Loss", "16/10/2026",
    ].join("\n"), "ocr", 0.9)], "insurance_claim");
    expect(parsed.fields.owner_phone?.normalizedValue).toBe("9956 6626?");
    expect(parsed.fields.owner_phone?.validation).toBe("warning");
    expect(parsed.fields.accident_date?.normalizedValue).toBe("2026-10-16");
  });

  it("keeps LPO identity cells on their own OCR row when other printed values share it", () => {
    const rows: Array<[string, number, number]> = [
      ["MOTOR VEHICLE REPAIR ORDER", 337, 116], ["LPO No.", 68, 134], ["90783", 168, 136],
      ["Print Date 17/09/2026", 623, 137], ["Issue Date 14/09/2026", 625, 163],
      ["Ref. Our Claim No", 286, 254], [": 103/0502/2026/C/001669", 424, 252],
      ["Policy No", 285, 280], [": 103/0502/2026/P/034138", 436, 281],
      ["Accident Date", 285, 306], [": 11/09/2026", 436, 304],
      ["Owners", 70, 408], ["SAMPLE PERSON", 158, 405],
      ["Cont.No.", 70, 435], [":99601817", 161, 436],
      ["Make", 454, 433], ["BYD", 571, 434], ["Regn.No.: DD/94260", 68, 458],
      ["Model", 455, 460], ["Qin Pro", 562, 461], ["Year", 456, 487], ["2025", 569, 488],
      ["Spare Parts", 71, 571], ["1,200.000", 327, 573],
      ["Labour Charges", 71, 595], ["250.000", 325, 597],
      ["Total", 72, 646], ["1,450.000", 325, 648],
    ];
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.93, width: 932, height: 1200,
      text: ["EXAMPLE INSURANCE COMPANY", ...rows.map(([value]) => value)].join("\n"),
      segments: rows.map(([value, x, y]) => ({ text: value, box: { x, y, width: value.length * 7, height: 22 } })),
    }], "insurance_claim");
    expect(result.type).toBe("lpo");
    expect(result.fields.lpo_number?.normalizedValue).toBe("90783");
    expect(result.fields.policy_number?.normalizedValue).toBe("103/0502/2026/P/034138");
    expect(result.fields.make?.normalizedValue).toBe("BYD");
    expect(result.fields.model?.normalizedValue).toBe("Qin Pro");
    expect(result.fields.approved_amount?.normalizedValue).toBe("1450.000");
    expect(normalizeCandidate("policy_number", "103/0502/2026/C/001669").valid).toBe(false);
    expect(normalizeCandidate("claim_number", "103/0502/2026/P/034138").valid).toBe(false);
    expect(normalizeCandidate("lpo_number", "Print Date 17/09/2026").valid).toBe(false);
  });

  it("reads the combined make/model and year from the correct printed row of a scanned gate pass", () => {
    const rows: Array<[string, number, number]> = [
      ["Repair Gate Pass For Accident vehicle", 284, 227],
      ["Claim No / Policy No.", 122, 299], ["C/004/16/26/2501/00140", 403, 299],
      ["Vehicle Make & Model", 123, 441], ["Toyota - Camry", 401, 435],
      ["Year/: 2019", 780, 437], ["Vehicle No", 120, 479], ["R W/2525", 403, 475],
      ["Date of Intimation", 122, 514], ["18/10/2026", 402, 514],
      ["Date of Loss", 123, 553], ["16/10/2026", 402, 548],
    ];
    const result = parseDocumentPages([{
      number: 1, method: "ocr", confidence: 0.88, width: 1488, height: 2105,
      text: rows.map(([value]) => value).join("\n"),
      segments: rows.map(([value, x, y]) => ({ text: value, box: { x, y, width: value.length * 8, height: 26 } })),
    }], "insurance_claim");
    expect(result.fields.make?.normalizedValue).toBe("Toyota");
    expect(result.fields.model?.normalizedValue).toBe("Camry");
    expect(result.fields.year?.normalizedValue).toBe("2019");
    expect(result.fields.plate_number?.normalizedValue).toBe("2525");
    expect(result.fields.accident_date?.normalizedValue).toBe("2026-10-16");
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
    expect(detectDocumentType("Repair Gate Pass For Accident vehicle\nDate of Loss: 01/10/2026", "insurance_claim").type).toBe("insurance_claim");
    expect(detectDocumentType("Purchase Invoice\nSupplier Name: TEST PARTS").type).toBe("purchase_invoice");
  });

  it("classifies a claim reference above an ID-card mention in authorization boilerplate", () => {
    const reference = "C/004/01/26/9999/00002";
    expect(detectDocumentType(`Claim No: ${reference}\nIdentity Card of owner`).type).toBe("insurance_claim");
    expect(detectDocumentType("Identity Card of owner").type).toBe("customer_id");
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

  it("keeps claim fields from later pages when a mixed PDF is classified as an invoice", () => {
    const pages = [
      { ...page("Tax Invoice\nSupplier: Example Parts\nVATIN: OM123456789\nInvoice No: 123"), number: 1 },
      { ...page("Claim No: CLM-2026-44\nAccident Date: 27/04/2026\nPlate No: 47782 B"), number: 2 },
    ];
    const parsed = parseDocumentPages(pages, "insurance_claim");
    expect(parsed.type).toBe("supplier_invoice");
    expect(parsed.issues.map((issue) => issue.code)).toContain("DOCUMENT_TYPE_MISMATCH");
    expect(parsed.fields.claim_number?.normalizedValue).toBe("CLM-2026-44");
    expect(parsed.fields.claim_number?.sourcePage).toBe(2);
    expect(parsed.fields.accident_date?.normalizedValue).toBe("2026-04-27");
    expect(parsed.fields.plate_number?.normalizedValue).toBe("47782");
    expect(defaultReviewSelection({ status: "needs_review", fields: parsed.fields, issues: parsed.issues } as DocumentExtractionResult).claim_number).toBe(false);
  });

  it("lowers overall confidence when DB matching fails or an identity conflict exists", () => {
    const parsed = parseDocumentPages([page("Vehicle Registration Card\nPlate No: 47782 B\nVIN: 1HGCM82633A004352")]);
    const base = { fields: parsed.fields, issues: parsed.issues, documentTypeConfidence: parsed.typeConfidence, matchingStatus: "complete" } as DocumentExtractionResult;
    expect(overallDocumentConfidence(base)).toBeGreaterThan(0.6);
    expect(overallDocumentConfidence({ ...base, matchingStatus: "failed" })).toBeLessThanOrEqual(0.6);
    expect(overallDocumentConfidence({ ...base, issues: [{ code: "VEHICLE_IDENTITY_CONFLICT", severity: "error", message: "conflict" }] })).toBeLessThanOrEqual(0.35);
  });
});
