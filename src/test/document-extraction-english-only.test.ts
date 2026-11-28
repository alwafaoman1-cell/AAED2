import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { englishDocumentPages, parseEnglishDocumentPages } from "@/lib/documentExtraction/englishOnly";
import { containsArabicScript, englishOnlyValue } from "@/lib/documentExtraction/languagePolicy";
import { parseDocumentPages } from "@/lib/documentExtraction/parsers";
import { createBrowserOcrProvider } from "@/lib/documentExtraction/ocr";
import { processDocumentLocally } from "@/lib/documentExtraction/engine";
import { documentErrorMessage, documentIssueMessage } from "@/lib/documentExtraction/errors";
import { DOCUMENT_ENGINE_VERSION, VEHICLE_ENTRY_AUTO_ENGINE_VERSION, isEnglishExtractionVersion, type DocumentPage } from "@/lib/documentExtraction/types";

const mock = vi.hoisted(() => ({ createWorker: vi.fn(), recognize: vi.fn(), reinitialize: vi.fn(), terminate: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: mock.createWorker }));
vi.mock("@/lib/documentExtraction/ocr", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/documentExtraction/ocr")>(),
  imageDimensions: async () => ({ width: 1000, height: 1400 }),
}));

const identifiers = "Insurance Claim\nClaim No: C/004/01/26/9999/00001\nPlate No: 47782 B\nVIN: 1HGCM82633A004352";
const arabic = "مطالبة تأمين\nرقم المطالبة: C/004/01/26/9999/00001\nرقم اللوحة: ٤٧٧٨٢ B\nرقم الشاصي: 1HGCM82633A004352";
const page = (text: string): DocumentPage => ({ number: 1, text, method: "ocr", confidence: .95, width: 1000, height: 1400 });

beforeEach(() => {
  vi.clearAllMocks();
  mock.createWorker.mockResolvedValue({ recognize: mock.recognize, reinitialize: mock.reinitialize, terminate: mock.terminate });
  mock.recognize.mockResolvedValue({ data: { text: identifiers, confidence: 95, blocks: [] } });
});
afterEach(() => vi.unstubAllEnvs());

describe("English-only extraction is a new immutable policy", () => {
  it("uses a separate queue version while recognizing old versions as historical", () => {
    expect(DOCUMENT_ENGINE_VERSION).toBe("1.0.8-en");
    expect(VEHICLE_ENTRY_AUTO_ENGINE_VERSION).toBe(DOCUMENT_ENGINE_VERSION);
    expect(isEnglishExtractionVersion(`${DOCUMENT_ENGINE_VERSION}-worker`)).toBe(true);
    expect(isEnglishExtractionVersion("1.0.7-en")).toBe(true);
    expect(isEnglishExtractionVersion("1.0.7-en-worker")).toBe(true);
    expect(isEnglishExtractionVersion("1.0.6-worker")).toBe(false);
  });

  it("explains ignored Arabic content without changing the interface language", () => {
    const issue = { code: "ENGLISH_ONLY_NO_RELIABLE_FIELDS", severity: "warning" as const, message: "No reliable English fields were found." };
    expect(documentIssueMessage(issue, true)).toBe(issue.message);
    expect(documentIssueMessage(issue, false)).toContain("تم تجاهل المحتوى العربي");
    expect(documentErrorMessage(new Error("DOCUMENT_ENGINE_VERSION_MISMATCH"), true)).toContain("Reload the page");
  });

  it("keeps exact English identifiers and their evidence boxes", () => {
    const input = { ...page(identifiers), segments: [{ text: "Plate No: 47782 B", box: { x: 20, y: 100, width: 300, height: 30 } }] };
    const result = parseEnglishDocumentPages([input], "insurance_claim");
    expect(result.language).toBe("en");
    expect(result.fields.claim_number.normalizedValue).toBe("C/004/01/26/9999/00001");
    expect(result.fields.plate_number.normalizedValue).toBe("47782");
    expect(result.fields.plate_letters.normalizedValue).toBe("B");
    expect(result.fields.vin.normalizedValue).toBe("1HGCM82633A004352");
    expect(result.fields.plate_number.sourceBox?.y).toBe(100);
  });

  it("does not guess Latin identifiers from Arabic-only labels", () => {
    const result = parseEnglishDocumentPages([page(arabic)], "insurance_claim");
    expect(result.fields).toEqual({});
    expect(result.language).toBe("unknown");
    expect(result.issues.some(issue => issue.code === "ENGLISH_ONLY_NO_RELIABLE_FIELDS")).toBe(true);
  });

  it("leaves historical bilingual parsing and archived input objects unchanged", () => {
    const input = page(arabic);
    Object.freeze(input);
    expect(parseDocumentPages([input], "insurance_claim").fields.plate_number.normalizedValue).toBe("47782");
    expect(parseEnglishDocumentPages([input], "insurance_claim").fields).toEqual({});
    expect(input.text).toBe(arabic);
  });

  it("accepts English labels in a bilingual heading without accepting Arabic values", () => {
    const input = page("Insurance Claim\nClaim No / رقم المطالبة: C/004/01/26/9999/00001\nOwner Name: أحمد ALI\nPlate No: ٤٧٧٨٢ B\nVIN: 1HGCM82633A004352");
    const result = parseEnglishDocumentPages([input], "insurance_claim");
    expect(result.fields.claim_number.normalizedValue).toBe("C/004/01/26/9999/00001");
    expect(result.fields.vin.normalizedValue).toBe("1HGCM82633A004352");
    expect(result.fields.owner_name).toBeUndefined();
    expect(result.fields.plate_number).toBeUndefined();
    expect(Object.values(result.fields).every(field => !containsArabicScript(field.rawValue + field.normalizedValue))).toBe(true);
  });

  it("does not resurrect a dropped mixed name from separate OCR segments", () => {
    const input = { ...page("Insurance Claim\nOwner Name: أحمد ALI"), segments: [
      { text: "Owner Name", box: { x: 10, y: 100, width: 150, height: 30 } },
      { text: "أحمد", box: { x: 170, y: 100, width: 100, height: 30 } },
      { text: "ALI", box: { x: 280, y: 100, width: 80, height: 30 } },
    ] };
    const evidence = englishDocumentPages([input])[0];
    expect(evidence.segments).toEqual([]);
    expect(parseEnglishDocumentPages([input], "insurance_claim").fields.owner_name).toBeUndefined();
  });

  it("keeps an English continuation page but rejects Arabic plus bare Latin words", () => {
    expect(englishDocumentPages([{ ...page("Oil Filter Replacement"), method: "native_pdf" }])[0].text).toBe("Oil Filter Replacement");
    expect(englishDocumentPages([page("Oil Filter Replacement")])[0].text).toBe("");
    expect(englishDocumentPages([page("نموذج عربي\nALI SALIM FAREED")])[0].text).toBe("");
  });

  it.each(["C/ABC/DEF/GHI/2026", "C/VIN/ABC/DEF/2026"])("does not mistake slash-reference chunks for English document evidence", reference => {
    const input = `${reference}\n1HGCM82633A004352\n47782`;
    expect(englishDocumentPages([{ ...page(input), method: "native_pdf" }])[0].text).toBe("");
    expect(englishDocumentPages([page(input)])[0].text).toBe("");
    expect(parseEnglishDocumentPages([{ ...page(input), method: "native_pdf" }], "insurance_claim").fields).toEqual({});
  });

  it.each(["أحمد ALI", "١٢٣٤٥", { text: "TEST" }, null, true])("rejects a whole unsupported value without partial translation", value => {
    expect(englishOnlyValue(value)).toBe("");
  });

  it("uses one English WASM model and never starts the Arabic retry", async () => {
    mock.recognize.mockResolvedValue({ data: { text: arabic, confidence: 95, blocks: [] } });
    const provider = await createBrowserOcrProvider(true);
    const result = await provider.recognize({ blob: new Blob(["synthetic"]), page: 1, width: 1000, height: 1400 });
    await provider.close();
    expect(mock.createWorker).toHaveBeenCalledWith("eng", 1, expect.any(Object));
    expect(mock.recognize).toHaveBeenCalledTimes(1);
    expect(mock.reinitialize).not.toHaveBeenCalled();
    expect(result.text).toBe("");
    expect(mock.terminate).toHaveBeenCalledTimes(1);
  });

  it("applies the new policy to local processing and filters optional AI values", async () => {
    const result = await processDocumentLocally(new File(["synthetic"], "test.png", { type: "image/png" }), "image/png", "a".repeat(64), {
      tenantId: "synthetic-tenant", expectedType: "insurance_claim",
      ocrFactory: async () => ({ recognize: async () => page(arabic), close: async () => {} }),
      match: async () => ({ matches: [], issues: [] }),
      policy: { allowAiFallback: true, aiFallbackBelow: 1 },
      aiFallback: async () => ({ owner_name: "أحمد ALI", claim_number: "C/004/01/26/9999/00001" }),
    });
    expect(result.engineVersion).toBe("1.0.8-en");
    expect(result.ocrModelVersion).toBe("eng");
    expect(result.pages[0].text).toBe("");
    expect(result.fields.owner_name).toBeUndefined();
    expect(result.fields.claim_number.normalizedValue).toBe("C/004/01/26/9999/00001");
  });
});
