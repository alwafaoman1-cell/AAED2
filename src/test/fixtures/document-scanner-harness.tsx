import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@/index.css";
import i18n from "@/i18n";
import DocumentScanner from "@/components/documents/DocumentScanner";
import { processDocumentLocally } from "@/lib/documentExtraction/engine";

declare global {
  interface Window {
    __setScannerLanguage: (language: "ar" | "en") => Promise<unknown>;
    __scannerExtracted?: { name: string; size: number; pdfMagic: boolean; ocrPages: number; ocrEngine?: string; fields: string[]; claimNumber?: string; markerMatches: number };
    __scannerError?: string;
  }
}

window.__setScannerLanguage = (language) => i18n.changeLanguage(language);

export function Harness() {
  const [open, setOpen] = useState(true);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Reopen scanner</button>
    <DocumentScanner open={open} onClose={() => setOpen(false)} onExtract={async (file) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // Test-only evidence. No file is uploaded and no real document is read.
        const pdfMagic = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
        const result = await processDocumentLocally(file, "application/pdf", "a".repeat(64), {
          tenantId: "synthetic-only", expectedType: "insurance_claim",
          policy: { allowAiFallback: false }, match: async () => ({ matches: [], issues: [] }),
        });
        window.__scannerExtracted = { name: file.name, size: file.size, pdfMagic,
          ocrPages: result.pages.filter((page) => page.method === "ocr").length,
          ocrEngine: result.ocrEngine, fields: Object.keys(result.fields),
          claimNumber: result.fields.claim_number?.normalizedValue,
          markerMatches: ["temo", "syn001"].filter((value) => result.rawText.replace(/[^a-z0-9]/gi, "").toLowerCase().includes(value)).length };
        return true;
      } catch (error) {
        window.__scannerError = error instanceof Error ? error.message : String(error);
        return false;
      }
    }} />
  </>;
}

void i18n.changeLanguage("en").then(() => createRoot(document.getElementById("root")!).render(<Harness />));
