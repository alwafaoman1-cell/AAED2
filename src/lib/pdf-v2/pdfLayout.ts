import type { PdfV2Layout, PdfV2Margins } from "./documentTypes";

export const PDF_V2_LAYOUTS: Record<PdfV2Layout, { widthMm: number; heightMm: number; margins: PdfV2Margins; pageCss: string }> = {
  "a4-portrait": {
    widthMm: 210,
    heightMm: 297,
    margins: { top: 12, right: 12, bottom: 14, left: 12 },
    pageCss: "A4 portrait",
  },
  "a4-landscape": {
    widthMm: 297,
    heightMm: 210,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    pageCss: "A4 landscape",
  },
  "qr-label": {
    widthMm: 100,
    heightMm: 70,
    margins: { top: 4, right: 4, bottom: 4, left: 4 },
    pageCss: "100mm 70mm",
  },
};

export function getPdfV2Layout(layout: PdfV2Layout = "a4-portrait") {
  return PDF_V2_LAYOUTS[layout] || PDF_V2_LAYOUTS["a4-portrait"];
}

export function inferPdfV2Layout(html: string): PdfV2Layout {
  if (/data-pdf-layout=["']qr-label["']|qr label|qr-label/i.test(html)) return "qr-label";
  if (/@page[^}]*landscape|data-pdf-orientation=["']landscape["']/i.test(html)) return "a4-landscape";
  return "a4-portrait";
}
