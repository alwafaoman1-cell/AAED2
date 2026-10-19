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

/** Detect a scanned page with a selectable overlay; a small logo is not a scan. */
export async function hasPageSizedPdfImage(page: PDFPageProxy): Promise<boolean> {
  const operators = await page.getOperatorList();
  const pageSize = page.getViewport({ scale: 1 });
  const area = pageSize.width * pageSize.height;
  if (!area) return false;
  type Matrix = [number, number, number, number, number, number];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let imageArea = 0;
  for (let index = 0; index < operators.fnArray.length; index++) {
    const op = operators.fnArray[index];
    if (op === pdfjs.OPS.save) stack.push([...matrix]);
    else if (op === pdfjs.OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === pdfjs.OPS.transform) {
      const [a, b, c, d, e, f] = operators.argsArray[index] as number[];
      const [m0, m1, m2, m3, m4, m5] = matrix;
      matrix = [m0 * a + m2 * b, m1 * a + m3 * b, m0 * c + m2 * d,
        m1 * c + m3 * d, m0 * e + m2 * f + m4, m1 * e + m3 * f + m5];
    } else if (op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintInlineImageXObject) {
      imageArea += Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
      if (imageArea / area >= 0.45) return true;
    }
  }
  return false;
}

export function mergeNativeAndOcrPage(native: DocumentPage, recognized: DocumentPage): DocumentPage {
  if (!recognized.text.trim()) return native;
  const nativeLines = native.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const seen = new Set(nativeLines.map((line) => line.replace(/\s+/g, " ").toLocaleLowerCase()));
  const lines = [...nativeLines];
  for (const line of recognized.text.split(/\r?\n/)) {
    const cleaned = line.trim();
    const key = cleaned.replace(/\s+/g, " ").toLocaleLowerCase();
    if (key && !seen.has(key)) { lines.push(cleaned); seen.add(key); }
  }
  return { ...recognized, text: lines.join("\n") };
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
