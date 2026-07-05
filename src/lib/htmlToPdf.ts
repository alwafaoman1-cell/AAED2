// Unified HTML → PDF engine for Alwafa Pro (ERP-grade output).
// Pipeline: render HTML inside an off-screen A4 iframe → html2canvas → jsPDF.
// Shared behavior:
//   • Preview, browser print, and PDF download use the same prepared `.page` DOM.
//   • Long content is paginated at block/table-row boundaries before capture.
//   • PDF download is rasterized by html2canvas, so it is visually aligned but
//     is not described as pixel-perfect compared with native browser printing.
//   • Full RTL Arabic support; numbers stay Latin.

import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { buildHtmlWithPageMarginStyle } from "./pdfLayoutSettings";
import { preparePagedPdfDocument, waitForPdfAssets } from "./pdfDocumentRenderer";

export interface PdfMargins {
  top: number;    // mm
  right: number;  // mm
  bottom: number; // mm
  left: number;   // mm
}

/** Default margins match the wkhtmltopdf 0.12.2 defaults used by the legacy print pipeline. */
export const DEFAULT_MARGINS: PdfMargins = { top: 12, right: 10, bottom: 14, left: 10 };

export interface PdfFooterContext {
  /** Workshop / company name shown in the centre of the footer (Latin/Arabic both OK). */
  companyName?: string;
  /** Optional extra label shown after the timestamp (e.g. invoice number). */
  reference?: string;
  /** Set to false to hide the auto generated footer (page X/N + timestamp). */
  enabled?: boolean;
}

interface HtmlToPdfOpts {
  htmlContent: string;
  fileName: string;               // without extension
  download?: boolean;             // default true
  margins?: PdfMargins;
  orientation?: "portrait" | "landscape";
  footer?: PdfFooterContext;
  /** PDF metadata. */
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string };
}

const safePdfName = (fileName: string) => `${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const triggerBlobDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safePdfName(fileName);
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1500);
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} استغرق وقتاً طويلاً. جرّب تقليل عدد/حجم الصور ثم أعد التحميل.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Universal export CSS injected into every PDF render. Template typography is preserved. */
const PDF_EXPORT_CSS = `
  html.pdf-export, html.pdf-export body{
    background:#fff!important;
    margin:0!important;
    padding:0!important;
    overflow:visible!important;
    height:auto!important;
    min-height:0!important;
    max-height:none!important;
    color:#000!important;
  }
  html.pdf-export *{letter-spacing:0!important;text-rendering:geometricPrecision!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  html.pdf-export .print-bar, html.pdf-export .no-print{display:none!important}
  /* Keep the template's own inner padding as the visible margin — do NOT force padding:0 here, otherwise content bleeds to the paper edges when the engine renders .page at offset 0,0. */
  html.pdf-export .page{
    margin:0!important;
    box-shadow:none!important;
    outline:none!important;
    border:0!important;
    min-height:0!important;
    max-height:none!important;
    overflow:visible!important;
  }
  html.pdf-export .page + .page{page-break-before:always!important;break-before:page!important}
  /* Table integrity — never cut rows or headers across pages */
  html.pdf-export table{border-collapse:collapse!important;width:100%!important}
  html.pdf-export thead{display:table-header-group!important}
  html.pdf-export tfoot{display:table-footer-group!important}
  html.pdf-export tr,html.pdf-export td,html.pdf-export th,html.pdf-export li,html.pdf-export .pdf-keep,html.pdf-export .no-break{page-break-inside:avoid!important;break-inside:avoid!important}
  html.pdf-export h1,html.pdf-export h2,html.pdf-export h3,html.pdf-export h4{page-break-after:avoid!important;break-after:avoid!important}
  html.pdf-export img{max-width:100%!important;height:auto!important}
`;

const cropCanvasWhitespace = (source: HTMLCanvasElement, preservePx = 28): HTMLCanvasElement => {
  const ctx = source.getContext("2d");
  if (!ctx || source.width === 0 || source.height === 0) return source;
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, source.width, source.height).data; }
  catch (err) { console.warn("[pdf] crop skipped (tainted canvas):", err); return source; }
  let top = source.height, right = 0, bottom = 0, left = source.width;
  const isBlank = (idx: number) => data[idx + 3] < 12 || (data[idx] > 248 && data[idx + 1] > 248 && data[idx + 2] > 248);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const idx = (y * source.width + x) * 4;
      if (!isBlank(idx)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (left > right || top > bottom) return source;
  left = Math.max(0, left - preservePx); top = Math.max(0, top - preservePx);
  right = Math.min(source.width - 1, right + preservePx); bottom = Math.min(source.height - 1, bottom + preservePx);
  if (left <= 2 && top <= 2 && right >= source.width - 3 && bottom >= source.height - 3) return source;
  const cropped = document.createElement("canvas");
  cropped.width = right - left + 1; cropped.height = bottom - top + 1;
  const cctx = cropped.getContext("2d")!;
  cctx.fillStyle = "#ffffff"; cctx.fillRect(0, 0, cropped.width, cropped.height);
  cctx.drawImage(source, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped;
};

/** Returns true if the given canvas row is uniformly near-white (safe slice boundary). */
const isRowBlank = (data: Uint8ClampedArray, width: number, y: number, tolerancePx = 2): boolean => {
  let nonBlank = 0;
  const rowStart = y * width * 4;
  for (let x = 0; x < width; x++) {
    const idx = rowStart + x * 4;
    const isPx = !(data[idx + 3] < 12 || (data[idx] > 245 && data[idx + 1] > 245 && data[idx + 2] > 245));
    if (isPx) { nonBlank++; if (nonBlank > tolerancePx) return false; }
  }
  return true;
};

/**
 * Find the deepest blank pixel row at or before `maxY`, within [maxY - searchPx, maxY].
 * Falls back to maxY when none found — guarantees forward progress.
 */
const findSafeSliceRow = (canvas: HTMLCanvasElement, maxY: number, searchPx = 60): number => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return maxY;
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
  catch { return maxY; }
  const lower = Math.max(1, maxY - searchPx);
  for (let y = maxY; y >= lower; y--) {
    if (isRowBlank(data, canvas.width, y)) return y;
  }
  return maxY;
};

const fmtTimestamp = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Draw the vector footer (page X/N + timestamp + company) on every PDF page. */
const drawVectorFooter = (pdf: jsPDF, footer: PdfFooterContext | undefined) => {
  if (footer?.enabled !== true) return;
  const total = pdf.getNumberOfPages();
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const stamp = fmtTimestamp();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(110, 110, 110);
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    // top border line of footer area
    pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.1);
    pdf.line(8, pageH - 8.5, pageW - 8, pageH - 8.5);
    const y = pageH - 4.5;
    pdf.text(`Page ${i} / ${total}`, 10, y, { align: "left" });
    if (footer?.companyName) pdf.text(footer.companyName, pageW / 2, y, { align: "center" });
    const right = footer?.reference ? `${stamp} · ${footer.reference}` : stamp;
    pdf.text(right, pageW - 10, y, { align: "right" });
  }
  pdf.setPage(1);
};

export async function generatePdfFromHtml(opts: HtmlToPdfOpts): Promise<Blob> {
  const { htmlContent, fileName, download = true, margins = DEFAULT_MARGINS, orientation = "portrait", footer, metadata } = opts;
  const fastHtmlContent = buildHtmlWithPageMarginStyle(htmlContent, orientation);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = orientation === "landscape" ? "1123px" : "794px";
  iframe.style.height = orientation === "landscape" ? "794px" : "1123px";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument!;
    doc.open(); doc.write(fastHtmlContent); doc.close();

    await new Promise<void>((resolve) => {
      const ready = () => setTimeout(() => resolve(), 50);
      if (doc.readyState === "complete") ready();
      else iframe.addEventListener("load", ready, { once: true });
    });
    await waitForPdfAssets(doc);

    doc.documentElement.classList.add("pdf-export");
    const exportStyle = doc.createElement("style");
    exportStyle.textContent = PDF_EXPORT_CSS;
    doc.head.appendChild(exportStyle);
    // Inject unified page margins from /settings/pdf-layout so every export
    // shares the same corners and margins as the print preview.
    try {
      const { injectPageMarginStyle } = await import("./pdfLayoutSettings");
      injectPageMarginStyle(doc, orientation);
    } catch { /* noop */ }
    preparePagedPdfDocument(doc, orientation);
    await new Promise<void>((resolve) => iframe.contentWindow?.requestAnimationFrame(() => resolve()) ?? setTimeout(resolve, 0));

    const pageEls = Array.from(doc.querySelectorAll<HTMLElement>(".page"));

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation, compress: true });
    pdf.setProperties({
      title: metadata?.title ?? fileName,
      author: metadata?.author ?? "Alwafa Pro System",
      subject: metadata?.subject ?? `A4 ${orientation} document`,
      keywords: metadata?.keywords ?? "Alwafa,ERP,PDF,A4",
      creator: "Alwafa Pro System",
    });

    const pageWmm = pdf.internal.pageSize.getWidth();
    const pageHmm = pdf.internal.pageSize.getHeight();
    const printableWmm = pageWmm - margins.left - margins.right;
    const printableHmm = pageHmm - margins.top - margins.bottom;
    // Reserve footer space only when the caller explicitly requests a generated footer.
    // The default stays identical to the HTML preview.
    const usableHmm = footer?.enabled === true ? pageHmm - 8 : pageHmm;

    const renderEl = async (el: HTMLElement) => {
      const siblings = pageEls.filter((p) => p !== el).map((p) => [p, p.style.display] as const);
      siblings.forEach(([p]) => { p.style.display = "none"; });
      await yieldToBrowser();
      try {
        return await withTimeout(html2canvas(el, {
          scale: 2.5,
          useCORS: true,
          allowTaint: false,
          imageTimeout: 2500,
          backgroundColor: "#ffffff",
          logging: false,
          windowWidth: Math.max(el.scrollWidth, el.offsetWidth),
          windowHeight: Math.max(el.scrollHeight, el.offsetHeight),
          ignoreElements: (node) => node instanceof HTMLElement && (node.classList.contains("print-bar") || node.classList.contains("no-print")),
        }), 12000, "تحضير صفحة PDF");
      } finally {
        siblings.forEach(([p, display]) => { p.style.display = display; });
      }
    };

    const addSlicedCanvas = async (canvas: HTMLCanvasElement, targetWmm: number, targetMaxHmm: number, offsetX = 0, offsetY = 0, firstAlreadyExists = true) => {
      const pxPerMm = canvas.width / targetWmm;
      let pageHpx = Math.floor(targetMaxHmm * pxPerMm);
      // html2canvas can round an exact A4 page a few pixels taller than the
      // calculated slice. Absorb that tiny difference to avoid a blank sliver page.
      if (canvas.height <= pageHpx + 12) pageHpx = canvas.height;
      let renderedPx = 0;
      let isFirstSlice = true;
      while (renderedPx < canvas.height) {
        const remaining = canvas.height - renderedPx;
        let sliceEnd = renderedPx + Math.min(pageHpx, remaining);
        // Snap to whitespace if we're cutting mid-content (not the final slice)
        if (sliceEnd < canvas.height) {
          sliceEnd = findSafeSliceRow(canvas, sliceEnd, Math.min(120, pageHpx / 6));
          if (sliceEnd <= renderedPx + 10) sliceEnd = renderedPx + Math.min(pageHpx, remaining); // forward progress
        }
        const sliceHpx = sliceEnd - renderedPx;
        const slice = document.createElement("canvas");
        slice.width = canvas.width; slice.height = sliceHpx;
        const sctx = slice.getContext("2d")!;
        sctx.fillStyle = "#ffffff"; sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);
        const sliceImg = slice.toDataURL("image/jpeg", 0.95);
        const sliceHmm = sliceHpx / pxPerMm;
        if (!(firstAlreadyExists && isFirstSlice)) pdf.addPage();
        pdf.addImage(sliceImg, "JPEG", offsetX, offsetY, targetWmm, sliceHmm, undefined, "FAST");
        isFirstSlice = false;
        renderedPx = sliceEnd;
      }
    };

    if (pageEls.length > 0) {
      for (let i = 0; i < pageEls.length; i++) {
        // Do not crop `.page` captures: the white A4 edges are the configured margins,
        // and cropping them makes downloaded PDFs differ from the on-screen preview.
        const canvas = await renderEl(pageEls[i]);
        await addSlicedCanvas(canvas, pageWmm, usableHmm, 0, 0, i === 0);
      }
    } else {
      const canvas = cropCanvasWhitespace(await renderEl(doc.body));
      await addSlicedCanvas(canvas, printableWmm, Math.min(printableHmm, usableHmm - margins.top), margins.left, margins.top, true);
    }

    drawVectorFooter(pdf, footer);

    const blob = pdf.output("blob");
    if (download) triggerBlobDownload(blob, fileName);
    return blob;
  } finally {
    iframe.remove();
  }
}

/**
 * Verify a generated PDF is A4 portrait/landscape, with consistent page sizes.
 * Used by PdfPreviewDialog to show a green/red badge.
 */
export async function verifyPdfFormat(blob: Blob): Promise<{
  ok: boolean; pages: number; widthMm: number; heightMm: number;
  isA4: boolean; isPortrait: boolean; consistent: boolean; notes: string[];
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
    const isA4 = Math.abs(widthMm - 210) <= 1 && Math.abs(heightMm - 297) <= 1
              || Math.abs(widthMm - 297) <= 1 && Math.abs(heightMm - 210) <= 1;
    const isPortrait = heightMm > widthMm;
    let consistent = true;
    for (let i = 2; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const pvp = pg.getViewport({ scale: 1 });
      const wMm = +(pvp.width * 0.352778).toFixed(1);
      const hMm = +(pvp.height * 0.352778).toFixed(1);
      if (Math.abs(wMm - widthMm) > 0.5 || Math.abs(hMm - heightMm) > 0.5) { consistent = false; break; }
    }
    if (!isA4) notes.push(`الحجم ${widthMm}×${heightMm}mm — متوقع 210×297mm (A4).`);
    if (!consistent) notes.push("أحجام الصفحات غير موحدة.");
    return { ok: isA4 && consistent, pages: doc.numPages, widthMm, heightMm, isA4, isPortrait, consistent, notes };
  } catch (e: any) {
    notes.push(e?.message || "تعذّر فحص الملف");
    return { ok: false, pages: 0, widthMm: 0, heightMm: 0, isA4: false, isPortrait: false, consistent: false, notes };
  }
}
