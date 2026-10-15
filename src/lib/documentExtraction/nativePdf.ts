import * as pdfjs from "pdfjs-dist";
// Vite emits the worker as a version-matched local asset.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { DocumentFileError } from "./fileSafety";
import type { DocumentPage, SourceSegment } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function openDocumentPdf(file: File, maxPages: number): Promise<PDFDocumentProxy> {
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > maxPages) {
      await pdf.destroy();
      throw new DocumentFileError("DOCUMENT_PAGE_LIMIT", `PDF must have 1–${maxPages} pages.`);
    }
    return pdf;
  } catch (error) {
    if (error instanceof DocumentFileError) throw error;
    throw new DocumentFileError("DOCUMENT_PDF_UNREADABLE", "PDF is encrypted, damaged or unreadable.");
  }
}

export async function extractNativePdfPage(page: PDFPageProxy, number: number): Promise<DocumentPage> {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const segments: SourceSegment[] = [];
  const rows: Array<{ x: number; y: number; text: string; rtl: boolean }> = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = viewport.height - item.transform[5];
    const height = Math.max(6, Math.abs(item.height || item.transform[3] || 10));
    const width = Math.max(1, Math.abs(item.width || 1));
    segments.push({ text: item.str, box: { x, y: y - height, width, height } });
    rows.push({ x, y, text: item.str, rtl: item.dir === "rtl" });
  }
  rows.sort((a, b) => Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x);
  const lines: typeof rows[] = [];
  for (const row of rows) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - row.y) <= 3) line.push(row);
    else lines.push([row]);
  }
  const text = lines.map((line) => {
    const rtl = line.filter((item) => item.rtl).length > line.length / 2;
    line.sort((a, b) => rtl ? b.x - a.x : a.x - b.x);
    return line.map((item) => item.text).join(" ").trim();
  }).filter(Boolean).join("\n");
  return { number, text, method: "native_pdf", confidence: text.trim() ? 0.95 : 0, width: viewport.width, height: viewport.height, segments };
}

export async function renderPdfPageForOcr(page: PDFPageProxy): Promise<{ blob: Blob; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, 2400 / Math.max(base.width, base.height), Math.sqrt(4_000_000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) throw new DocumentFileError("DOCUMENT_RENDER_FAILED", "Could not render the scanned PDF page.");
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("canvas_export_failed")), "image/png"));
  const dimensions = { width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0;
  return { blob, ...dimensions };
}
