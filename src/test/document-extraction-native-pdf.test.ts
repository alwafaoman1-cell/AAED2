import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import * as pdfjs from "pdfjs-dist";
import { processDocumentLocally } from "@/lib/documentExtraction/engine";

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
});
