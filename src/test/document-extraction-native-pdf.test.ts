import { describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import * as pdfjs from "pdfjs-dist";
import { readFileSync } from "node:fs";
import { processDocumentLocally } from "@/lib/documentExtraction/engine";

// Node has no rendering canvas; keep real PDF inspection and stub only the
// browser renderer so the PDF -> OCR -> parser decision is exercised.
vi.mock("@/lib/documentExtraction/nativePdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documentExtraction/nativePdf")>();
  return { ...actual, renderPdfPageForOcr: async () => ({ blob: new Blob(["test-image"]), width: 1300, height: 1800 }) };
});

function syntheticRegistrationPdf(): File {
  const pdf = new jsPDF();
  [
    "Vehicle Registration Card",
    "Plate No: 47782 B",
    "VIN: 1HGCM82633A004352",
    "Make: BYD",
    "Model: Song Plus",
    "Owner Name: TEST OWNER",
  ].forEach((line, index) => pdf.text(line, 18, 24 + index * 12));
  return new File([pdf.output("arraybuffer")], "synthetic-registration.pdf", { type: "application/pdf" });
}

describe("native PDF extraction without OCR or AI", () => {
  it("reads a real PDF text layer, parses fields, and never starts OCR", async () => {
    // Vitest runs in Node; the browser build's Vite worker URL is not a Node file URL.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
    const file = syntheticRegistrationPdf();
    const sanity = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    expect(sanity.numPages).toBe(1);
    await sanity.destroy();
    let ocrCalled = false;
    const result = await processDocumentLocally(file, "application/pdf", "a".repeat(64), {
      tenantId: "synthetic-tenant",
      expectedType: "vehicle_registration",
      ocrFactory: async () => { ocrCalled = true; throw new Error("OCR_MUST_NOT_RUN"); },
      match: async () => ({ matches: [], issues: [] }),
      policy: { allowAiFallback: false },
    });
    expect(ocrCalled).toBe(false);
    expect(result.aiUsed).toBe(false);
    expect(result.method).toBe("native_pdf");
    expect(result.pages[0].text).toContain("Vehicle Registration Card");
    expect(result.fields.plate_number.normalizedValue).toBe("47782");
    expect(result.fields.vin.normalizedValue).toBe("1HGCM82633A004352");
    expect(result.fields.make.normalizedValue).toBe("BYD");
  }, 30_000);

  it("reads a page-sized scan even when the same PDF page has a selectable heading", async () => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
    const pdf = new jsPDF();
    pdf.text("Insurance company selectable heading with more than forty-five characters", 15, 20);
    const image = readFileSync(new URL("../../public/icon-192.png", import.meta.url));
    pdf.addImage(image, "PNG", 15, 30, 180, 235);
    const file = new File([pdf.output("arraybuffer")], "mixed.pdf", { type: "application/pdf" });
    let ocrCalls = 0;
    const result = await processDocumentLocally(file, "application/pdf", "b".repeat(64), {
      tenantId: "synthetic-tenant", expectedType: "insurance_claim",
      ocrFactory: async () => ({
        recognize: async () => {
          ocrCalls++;
          return { number: 1, method: "ocr", confidence: 0.9, width: 1300, height: 1800,
            text: "Insurance Claim\nClaim No: C/004/01/26/9999/00001\nPlate No: 47782 B" };
        },
        close: async () => {},
      }),
      match: async () => ({ matches: [], issues: [] }),
      policy: { allowAiFallback: false },
    });
    expect(ocrCalls).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].method).toBe("ocr");
    expect(result.pages[0].text).toContain("Insurance company selectable heading");
    expect(result.pages[0].text).toContain("C/004/01/26/9999/00001");
    expect(result.fields.claim_number.normalizedValue).toBe("C/004/01/26/9999/00001");
  }, 30_000);

  it("keeps a complete text PDF with a small logo on the fast native path", async () => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
    const pdf = new jsPDF();
    pdf.text("Vehicle Registration Card with selectable information and enough text", 15, 20);
    pdf.text("Plate No: 47782 B", 15, 30);
    const image = readFileSync(new URL("../../public/icon-192.png", import.meta.url));
    pdf.addImage(image, "PNG", 170, 10, 20, 20);
    const file = new File([pdf.output("arraybuffer")], "native-with-logo.pdf", { type: "application/pdf" });
    let ocrCalled = false;
    const result = await processDocumentLocally(file, "application/pdf", "c".repeat(64), {
      tenantId: "synthetic-tenant", expectedType: "vehicle_registration",
      ocrFactory: async () => { ocrCalled = true; throw new Error("OCR_MUST_NOT_RUN"); },
      match: async () => ({ matches: [], issues: [] }),
      policy: { allowAiFallback: false },
    });
    expect(ocrCalled).toBe(false);
    expect(result.pages[0].method).toBe("native_pdf");
    expect(result.fields.plate_number.normalizedValue).toBe("47782");
  }, 30_000);
});
