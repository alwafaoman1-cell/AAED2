import DOMPurify from "dompurify";
import { getPdfV2Layout, inferPdfV2Layout } from "./pdfLayout";
import type { PdfV2BuildInput, PdfV2Layout, PdfV2Meta } from "./documentTypes";
import { escapeHtml, toEnglishDigits } from "./pdfFormatters";
import { normalizePdfV2Meta } from "./pdfTemplates";
import { pdfV2Theme } from "./pdfTheme";

function stripLegacyPrintArtifacts(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s(on\w+)=["'][^"']*["']/gi, "");
}

export function sanitizePdfV2Html(html: string): string {
  return DOMPurify.sanitize(stripLegacyPrintArtifacts(toEnglishDigits(html || "")), {
    WHOLE_DOCUMENT: false,
    ADD_TAGS: ["style", "link", "meta", "svg", "path"],
    ADD_ATTR: ["target", "dir", "lang", "viewBox", "fill", "stroke", "stroke-width", "d", "data-pdf-layout", "data-pdf-orientation"],
  });
}

function documentLabel(meta: PdfV2Meta) {
  const title = meta.title || meta.documentType;
  return escapeHtml(title);
}

export function buildPdfV2Html(input: PdfV2BuildInput): string {
  const meta = normalizePdfV2Meta(input.meta);
  const layoutName: PdfV2Layout = meta.layout || inferPdfV2Layout(input.html);
  const layout = getPdfV2Layout(layoutName);
  const dir = meta.language === "en" ? "ltr" : "rtl";
  const lang = meta.language || "ar";
  const body = sanitizePdfV2Html(input.html);
  const pagePadding = `${layout.margins.top}mm ${layout.margins.right}mm ${layout.margins.bottom}mm ${layout.margins.left}mm`;
  const qrMode = layoutName === "qr-label";

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${documentLabel(meta)}</title>
  <style>
    @page{size:${layout.pageCss};margin:0}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    html,body{margin:0;padding:0;background:#eef2f7;color:${pdfV2Theme.colors.ink};font-family:${lang === "en" ? pdfV2Theme.fonts.latin : pdfV2Theme.fonts.arabic};font-size:11px;line-height:1.45}
    .pdf-v2-preview-root{min-height:100vh;padding:14px;display:flex;justify-content:center;align-items:flex-start}
    .pdf-v2-page{width:${layout.widthMm}mm;min-height:${layout.heightMm}mm;background:#fff;padding:${pagePadding};box-shadow:0 8px 30px rgba(15,23,42,.18);position:relative;overflow:visible}
    .pdf-v2-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10mm;border-bottom:1px solid ${pdfV2Theme.colors.line};padding-bottom:5mm;margin-bottom:6mm;break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-brand{display:flex;align-items:center;gap:4mm;min-width:0}
    .pdf-v2-logo{width:18mm;height:18mm;border-radius:5mm;background:${pdfV2Theme.colors.primary};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px;letter-spacing:.4px;flex:0 0 auto}
    .pdf-v2-company{font-size:14px;font-weight:800;color:${pdfV2Theme.colors.ink};white-space:normal}
    .pdf-v2-company-line{font-size:9px;color:${pdfV2Theme.colors.muted};margin-top:1mm}
    .pdf-v2-doc-meta{text-align:${dir === "rtl" ? "left" : "right"};font-size:9.5px;color:${pdfV2Theme.colors.muted};min-width:38mm}
    .pdf-v2-doc-title{font-size:16px;color:${pdfV2Theme.colors.primary};font-weight:800;margin-bottom:2mm}
    .pdf-v2-content{min-height:${qrMode ? "42mm" : "220mm"}}
    .pdf-v2-footer{display:flex;justify-content:space-between;gap:8mm;border-top:1px solid ${pdfV2Theme.colors.line};padding-top:3mm;margin-top:6mm;color:${pdfV2Theme.colors.muted};font-size:8px;break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-card,.pdf-card,.card{border:1px solid ${pdfV2Theme.colors.line};border-radius:3mm;padding:4mm;background:#fff;margin-bottom:4mm;break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4mm}
    h1,h2,h3,h4{margin:0 0 3mm;break-after:avoid;page-break-after:avoid;color:${pdfV2Theme.colors.ink}}
    table{width:100%;border-collapse:collapse;margin:3mm 0;break-inside:auto;page-break-inside:auto}
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    tr{break-inside:avoid;page-break-inside:avoid}
    th,td{border:1px solid ${pdfV2Theme.colors.line};padding:2mm 2.5mm;vertical-align:top}
    th{background:${pdfV2Theme.colors.soft};font-weight:800;color:${pdfV2Theme.colors.ink}}
    img,svg{max-width:100%;height:auto}
    .no-print,.print-bar,.pdf-v2-toolbar{display:none!important}
    .page{width:auto!important;min-height:auto!important;margin:0!important;padding:0!important;box-shadow:none!important;overflow:visible!important}
    ${qrMode ? `.pdf-v2-header,.pdf-v2-footer{display:none}.pdf-v2-page{display:flex;align-items:center;justify-content:center;padding:${pagePadding};min-height:${layout.heightMm}mm}` : ""}
    @media print{
      html,body{background:#fff!important}
      .pdf-v2-preview-root{display:block;padding:0}
      .pdf-v2-page{box-shadow:none!important;margin:0!important;break-after:page;page-break-after:always}
      .pdf-v2-page:last-child{break-after:auto;page-break-after:auto}
    }
    @media screen and (max-width:900px){
      .pdf-v2-preview-root{padding:8px;overflow:auto;justify-content:flex-start}
      .pdf-v2-page{transform-origin:top ${dir === "rtl" ? "right" : "left"}}
    }
  </style>
</head>
<body>
  <div class="pdf-v2-preview-root">
    <article class="pdf-v2-page" data-pdf-layout="${layoutName}">
      ${qrMode ? body : `
      <header class="pdf-v2-header">
        <div class="pdf-v2-brand">
          <div class="pdf-v2-logo">AAED</div>
          <div>
            <div class="pdf-v2-company">${escapeHtml(meta.companyName)}</div>
            ${(meta.companyDetails || []).map((line) => `<div class="pdf-v2-company-line">${escapeHtml(line)}</div>`).join("")}
          </div>
        </div>
        <div class="pdf-v2-doc-meta">
          <div class="pdf-v2-doc-title">${documentLabel(meta)}</div>
          ${meta.documentNumber ? `<div>${escapeHtml(meta.documentNumber)}</div>` : ""}
          ${meta.documentDate ? `<div>${escapeHtml(meta.documentDate)}</div>` : ""}
        </div>
      </header>
      <main class="pdf-v2-content">${body}</main>
      <footer class="pdf-v2-footer">
        <span>${escapeHtml(meta.footerNote || "Generated by AAED2")}</span>
        <span>${escapeHtml(new Date().toISOString().slice(0, 16).replace("T", " "))}</span>
      </footer>`}
    </article>
  </div>
</body>
</html>`;
}

export function openPdfV2Window(input: PdfV2BuildInput): Window | null {
  const html = buildPdfV2Html(input);
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return null;
  try { (win as any).opener = null; } catch {}
  win.document.open();
  win.document.write(html);
  win.document.close();
  return win;
}

export async function printPdfV2(input: PdfV2BuildInput): Promise<void> {
  const win = openPdfV2Window(input);
  if (!win) throw new Error("PDF preview window was blocked");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  win.focus();
  win.print();
}

function extractPlainTextFromHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(sanitizePdfV2Html(html), "text/html");
  return (doc.body?.innerText || "")
    .split(/\n+/)
    .map((line) => toEnglishDigits(line.trim()))
    .filter(Boolean);
}

export async function downloadPdfV2(input: PdfV2BuildInput, fileName: string, download = true): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const meta = normalizePdfV2Meta(input.meta);
  const layoutName = meta.layout || inferPdfV2Layout(input.html);
  const layout = getPdfV2Layout(layoutName);
  const orientation = layoutName === "a4-landscape" ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "mm", format: layoutName === "qr-label" ? [layout.widthMm, layout.heightMm] : "a4", orientation });
  pdf.setProperties({ title: meta.title || fileName, creator: "AAED2 PDF v2" });
  const lines = extractPlainTextFromHtml(input.html);
  const left = layout.margins.left;
  const right = layout.widthMm - layout.margins.right;
  const maxW = right - left;
  let y = layout.margins.top;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(toEnglishDigits(meta.title || meta.documentType), left, y);
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  for (const raw of lines.length ? lines : [meta.title || meta.documentType]) {
    const wrapped = pdf.splitTextToSize(raw, maxW);
    for (const line of wrapped) {
      if (y > layout.heightMm - layout.margins.bottom) {
        pdf.addPage();
        y = layout.margins.top;
      }
      pdf.text(line, left, y);
      y += 5;
    }
  }
  const blob = pdf.output("blob");
  if (download) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  return blob;
}
