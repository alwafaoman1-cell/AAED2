import { downloadPdfV2, inferPdfV2Layout, type PdfV2Layout } from "@/lib/pdf-v2";

export interface PdfMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGINS: PdfMargins = { top: 12, right: 12, bottom: 14, left: 12 };

export interface PdfFooterContext {
  companyName?: string;
  reference?: string;
  enabled?: boolean;
}

interface HtmlToPdfOpts {
  htmlContent: string;
  fileName: string;
  download?: boolean;
  margins?: PdfMargins;
  orientation?: "portrait" | "landscape";
  footer?: PdfFooterContext;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string };
}

function normalizeFileName(fileName: string) {
  return (fileName || "document").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._\-\u0600-\u06FF]/g, "_");
}

function mapLayout(html: string, orientation?: "portrait" | "landscape"): PdfV2Layout {
  if (orientation === "landscape") return "a4-landscape";
  if (orientation === "portrait") return "a4-portrait";
  return inferPdfV2Layout(html);
}

/**
 * Compatibility facade for existing callers.
 *
 * The previous implementation rasterized HTML with PDF v2 and produced a
 * separate PDF pipeline. This file now delegates to PDF v2 only, so legacy
 * buttons no longer invoke the old screenshot-based renderer.
 */
export async function generatePdfFromHtml(opts: HtmlToPdfOpts): Promise<Blob> {
  const fileName = normalizeFileName(opts.fileName);
  return downloadPdfV2(
    {
      html: opts.htmlContent,
      meta: {
        documentType: "generic",
        title: opts.metadata?.title || fileName,
        layout: mapLayout(opts.htmlContent, opts.orientation),
        footerNote: opts.footer?.reference,
      },
    },
    fileName,
    opts.download !== false,
  );
}

export async function verifyPdfFormat(blob: Blob): Promise<{
  ok: boolean;
  pages: number;
  widthMm: number;
  heightMm: number;
  isA4: boolean;
  isPortrait: boolean;
  consistent: boolean;
  notes: string[];
}> {
  const notes: string[] = [];
  try {
    const pdfjs = await import("pdfjs-dist");
    const buf = await blob.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const widthMm = +(vp.width * 0.352778).toFixed(1);
    const heightMm = +(vp.height * 0.352778).toFixed(1);
    const isA4 =
      (Math.abs(widthMm - 210) <= 1 && Math.abs(heightMm - 297) <= 1) ||
      (Math.abs(widthMm - 297) <= 1 && Math.abs(heightMm - 210) <= 1);
    const isPortrait = heightMm > widthMm;
    let consistent = true;
    for (let i = 2; i <= doc.numPages; i += 1) {
      const pg = await doc.getPage(i);
      const pvp = pg.getViewport({ scale: 1 });
      const wMm = +(pvp.width * 0.352778).toFixed(1);
      const hMm = +(pvp.height * 0.352778).toFixed(1);
      if (Math.abs(wMm - widthMm) > 0.5 || Math.abs(hMm - heightMm) > 0.5) {
        consistent = false;
        break;
      }
    }
    if (!isA4) notes.push(`PDF size is ${widthMm}x${heightMm}mm, expected A4.`);
    if (!consistent) notes.push("PDF page sizes are not consistent.");
    return { ok: isA4 && consistent, pages: doc.numPages, widthMm, heightMm, isA4, isPortrait, consistent, notes };
  } catch (e: any) {
    notes.push(e?.message || "Could not inspect PDF");
    return { ok: false, pages: 0, widthMm: 0, heightMm: 0, isA4: false, isPortrait: false, consistent: false, notes };
  }
}

