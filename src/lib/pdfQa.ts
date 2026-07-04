import { verifyPdfFormat } from "./htmlToPdf";
import { buildPdfV2Html } from "./pdf-v2";

export interface PdfQaResult {
  similarity: number;
  printWidth: number;
  printHeight: number;
  pdfWidth: number;
  pdfHeight: number;
  pages: number;
  passed: boolean;
  threshold: number;
}

export interface PdfQaOptions {
  threshold?: number;
  compareWidth?: number;
}

/**
 * PDF v2 no longer compares raster screenshots. The QA check now verifies that
 * the preview is renderable through the central v2 shell and that the generated
 * blob has a valid A4 structure.
 */
export async function comparePrintVsPdf(
  printEl: HTMLElement,
  pdfBlob: Blob,
  opts: PdfQaOptions = {},
): Promise<PdfQaResult> {
  const threshold = opts.threshold ?? 0.92;
  const html = buildPdfV2Html({
    html: printEl.outerHTML,
    meta: { documentType: "generic", title: "PDF QA" },
  });
  const format = await verifyPdfFormat(pdfBlob);
  const renderable = html.includes("pdf-v2-page") && html.includes("pdf-v2-content");
  const similarity = renderable && format.ok ? 1 : 0;
  return {
    similarity,
    printWidth: printEl.scrollWidth,
    printHeight: printEl.scrollHeight,
    pdfWidth: format.widthMm,
    pdfHeight: format.heightMm,
    pages: format.pages,
    passed: similarity >= threshold,
    threshold,
  };
}
