import DOMPurify from "dompurify";
import { getPdfV2Layout, inferPdfV2Layout } from "./pdfLayout";
import type { PdfV2BuildInput, PdfV2Layout, PdfV2Meta } from "./documentTypes";
import { escapeHtml, toEnglishDigits } from "./pdfFormatters";
import { normalizePdfV2Meta } from "./pdfTemplates";
import { pdfV2Theme } from "./pdfTheme";
import { ensureArabicFont } from "../arabicPdfFont";

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
    html,body{margin:0;padding:0;background:#eef2f7;color:${pdfV2Theme.colors.ink};font-family:${lang === "en" ? pdfV2Theme.fonts.latin : pdfV2Theme.fonts.arabic};font-size:10.5px;line-height:1.42}
    .pdf-v2-preview-root{min-height:100vh;padding:14px;display:flex;justify-content:center;align-items:flex-start}
    .pdf-v2-page{width:${layout.widthMm}mm;min-height:${layout.heightMm}mm;background:#fff;padding:${pagePadding};box-shadow:0 8px 30px rgba(15,23,42,.18);position:relative;overflow:visible}
    .pdf-v2-header{display:flex;align-items:flex-start;justify-content:space-between;gap:9mm;border-bottom:1px solid ${pdfV2Theme.colors.line};padding-bottom:3mm;margin-bottom:0;break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-brand{display:flex;align-items:center;gap:3mm;min-width:0}
    .pdf-v2-logo{width:16mm;height:16mm;border:1px solid ${pdfV2Theme.colors.primary};border-radius:2mm;background:#fff;color:${pdfV2Theme.colors.primary};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:9px;letter-spacing:.4px;flex:0 0 auto}
    .pdf-v2-company{font-size:13px;font-weight:900;color:${pdfV2Theme.colors.ink};white-space:normal}
    .pdf-v2-company-line{font-size:8.5px;color:${pdfV2Theme.colors.muted};margin-top:.8mm}
    .pdf-v2-doc-meta{text-align:${dir === "rtl" ? "left" : "right"};font-size:9px;color:${pdfV2Theme.colors.muted};min-width:36mm}
    .pdf-v2-doc-title{font-size:14px;color:${pdfV2Theme.colors.primary};font-weight:900;margin-bottom:1mm}
    .pdf-v2-title-band{display:flex;align-items:center;justify-content:space-between;gap:6mm;background:${pdfV2Theme.colors.primary};color:#fff;border-radius:1.5mm;margin:3mm 0;padding:2mm 3mm;border-inline-start:3mm solid ${pdfV2Theme.colors.accent};break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-title-band strong{font-size:12px}
    .pdf-v2-title-band span{font-size:8.5px;opacity:.95}
    .pdf-v2-vehicle-strip{border:1px solid ${pdfV2Theme.colors.line};background:#f8fafc;border-radius:1.5mm;margin:0 0 4mm;padding:2mm 3mm;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2mm;font-size:8.5px;break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-vehicle-strip b{color:${pdfV2Theme.colors.primary};display:block;font-size:8px}
    .pdf-v2-content{min-height:${qrMode ? "42mm" : "220mm"}}
    .pdf-v2-footer{display:flex;justify-content:space-between;gap:8mm;border-top:1px solid ${pdfV2Theme.colors.line};padding-top:2.5mm;margin-top:5mm;color:${pdfV2Theme.colors.muted};font-size:7.8px;break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-card,.pdf-card,.card{border:1px solid ${pdfV2Theme.colors.line};border-radius:1.8mm;padding:3mm;background:#fff;margin-bottom:3mm;break-inside:avoid;page-break-inside:avoid}
    .pdf-v2-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4mm}
    h1,h2,h3,h4{margin:0 0 3mm;break-after:avoid;page-break-after:avoid;color:${pdfV2Theme.colors.ink}}
    table{width:100%;border-collapse:collapse;margin:3mm 0;break-inside:auto;page-break-inside:auto}
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    tr{break-inside:avoid;page-break-inside:avoid}
    th,td{border:1px solid ${pdfV2Theme.colors.line};padding:1.8mm 2.2mm;vertical-align:top}
    th{background:${pdfV2Theme.colors.primary};font-weight:800;color:#fff}
    .pdf-v2-totals,.totals{margin-inline-start:auto;max-width:72mm;border:1px solid ${pdfV2Theme.colors.line};border-radius:1.5mm;padding:2mm 3mm;background:#fafafa}
    .pdf-v2-qr,.qr-box{margin-top:4mm;display:flex;align-items:center;gap:3mm;break-inside:avoid;page-break-inside:avoid}
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

function safeFileName(value: string) {
  return `${(value || "document").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
}

function findFirstMatch(lines: string[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const line = lines.find((item) => pattern.test(item));
    if (line) return line.replace(pattern, "").replace(/^[:：\-\s]+/, "").trim() || line.trim();
  }
  return "";
}

function extractTables(html: string): string[][][] {
  const doc = new DOMParser().parseFromString(sanitizePdfV2Html(html), "text/html");
  return Array.from(doc.querySelectorAll("table")).map((table) =>
    Array.from(table.querySelectorAll("tr"))
      .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => toEnglishDigits((cell.textContent || "").trim())))
      .filter((row) => row.some(Boolean)),
  ).filter((table) => table.length > 0);
}

function extractBodyLinesWithoutTables(html: string): string[] {
  const doc = new DOMParser().parseFromString(sanitizePdfV2Html(html), "text/html");
  doc.querySelectorAll("script,style,table,svg").forEach((node) => node.remove());
  return (doc.body?.innerText || "")
    .split(/\n+/)
    .map((line) => toEnglishDigits(line.replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .slice(0, 220);
}

function extractQrText(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizePdfV2Html(html), "text/html");
  const explicit = doc.querySelector("[data-qr], [data-qr-value], [data-short-link]");
  const attr = explicit?.getAttribute("data-qr") || explicit?.getAttribute("data-qr-value") || explicit?.getAttribute("data-short-link");
  if (attr) return attr;
  const link = Array.from(doc.querySelectorAll("a"))
    .map((a) => a.getAttribute("href") || "")
    .find((href) => /\/p\/|qr|tracking/i.test(href));
  if (link) return link;
  const text = doc.body?.innerText || "";
  return text.match(/https?:\/\/[^\s<>"']+\/p\/[A-Za-z0-9._-]+/)?.[0] || text.match(/\/p\/[A-Za-z0-9._-]+/)?.[0] || "";
}

async function qrDataUrl(value: string): Promise<string | null> {
  if (!value) return null;
  try {
    const mod: any = await import("qrcode");
    return await mod.toDataURL(value, { margin: 1, width: 220, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

function stripHtmlTables(lines: string[], tables: string[][][]) {
  const tableWords = new Set(tables.flat(2).map((cell) => cell.trim()).filter((cell) => cell.length > 2));
  return lines.filter((line) => !tableWords.has(line.trim()));
}

export async function createPdfV2Blob(input: PdfV2BuildInput): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const meta = normalizePdfV2Meta(input.meta);
  const layoutName = meta.layout || inferPdfV2Layout(input.html);
  const layout = getPdfV2Layout(layoutName);
  const orientation = layoutName === "a4-landscape" ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "mm", format: layoutName === "qr-label" ? [layout.widthMm, layout.heightMm] : "a4", orientation });
  pdf.setProperties({ title: meta.title || meta.documentType, creator: "AAED2 PDF v2" });
  await ensureArabicFont(pdf);

  const isRtl = meta.language !== "en";
  const left = layout.margins.left;
  const right = layout.widthMm - layout.margins.right;
  const width = right - left;
  const bottom = layout.heightMm - layout.margins.bottom;
  const title = toEnglishDigits(meta.title || meta.documentType);
  const docNo = toEnglishDigits(meta.documentNumber || "");
  const tables = extractTables(input.html);
  const bodyLines = stripHtmlTables(extractBodyLinesWithoutTables(input.html), tables);
  const allLines = extractPlainTextFromHtml(input.html);
  const qrText = extractQrText(input.html);
  const qr = await qrDataUrl(qrText);
  const vehicleInfo = [
    { label: isRtl ? "المستند" : "Document", value: docNo || title },
    { label: isRtl ? "العميل" : "Customer", value: findFirstMatch(allLines, [/^العميل\s*[:：-]?/i, /^Customer\s*[:：-]?/i]) || "—" },
    { label: isRtl ? "المركبة" : "Vehicle", value: findFirstMatch(allLines, [/^المركبة\s*[:：-]?/i, /^Vehicle\s*[:：-]?/i, /^السيارة\s*[:：-]?/i]) || "—" },
    { label: isRtl ? "اللوحة" : "Plate", value: findFirstMatch(allLines, [/^اللوحة\s*[:：-]?/i, /^Plate\s*[:：-]?/i, /^رقم اللوحة\s*[:：-]?/i]) || "—" },
  ];

  const setNormal = (size = 9) => {
    try { pdf.setFont("Amiri", "normal"); } catch { pdf.setFont("helvetica", "normal"); }
    pdf.setFontSize(size);
  };
  const setBold = (size = 10) => {
    try { pdf.setFont("Amiri", "bold"); } catch { pdf.setFont("helvetica", "bold"); }
    pdf.setFontSize(size);
  };
  const writeText = (text: string, x: number, y: number, opts: any = {}) => {
    pdf.text(toEnglishDigits(text || ""), x, y, { align: opts.align || (isRtl ? "right" : "left"), maxWidth: opts.maxWidth });
  };
  const drawHeader = (continued = false) => {
    pdf.setDrawColor(215, 221, 232);
    pdf.setFillColor(255, 255, 255);
    pdf.rect(left, layout.margins.top, width, 18, "S");
    pdf.setFillColor(11, 79, 162);
    pdf.rect(isRtl ? right - 18 : left, layout.margins.top + 3, 16, 12, "F");
    pdf.setTextColor(255, 255, 255);
    setBold(8);
    pdf.text("AAED", isRtl ? right - 10 : left + 8, layout.margins.top + 10.5, { align: "center" });
    pdf.setTextColor(17, 24, 39);
    setBold(12);
    const brandX = isRtl ? right - 22 : left + 22;
    writeText(toEnglishDigits(meta.companyName), brandX, layout.margins.top + 7, { align: isRtl ? "right" : "left", maxWidth: 82 });
    setNormal(7.5);
    (meta.companyDetails || []).slice(0, 2).forEach((line, i) =>
      writeText(line, brandX, layout.margins.top + 11 + i * 3.5, { align: isRtl ? "right" : "left", maxWidth: 88 }),
    );
    const metaX = isRtl ? left + 2 : right - 2;
    setBold(9.5);
    writeText(title, metaX, layout.margins.top + 7, { align: isRtl ? "left" : "right", maxWidth: 62 });
    setNormal(7.5);
    writeText(docNo, metaX, layout.margins.top + 11.5, { align: isRtl ? "left" : "right", maxWidth: 62 });
    writeText(toEnglishDigits(meta.documentDate || ""), metaX, layout.margins.top + 15, { align: isRtl ? "left" : "right", maxWidth: 62 });

    pdf.setFillColor(11, 79, 162);
    pdf.rect(left, layout.margins.top + 22, width, 9, "F");
    pdf.setFillColor(215, 154, 33);
    pdf.rect(isRtl ? right - 8 : left, layout.margins.top + 22, 8, 9, "F");
    pdf.setTextColor(255, 255, 255);
    setBold(10);
    writeText(continued ? `${title} - ${isRtl ? "تابع" : "continued"}` : title, isRtl ? right - 11 : left + 11, layout.margins.top + 28, {
      align: isRtl ? "right" : "left",
      maxWidth: width - 22,
    });
    pdf.setTextColor(17, 24, 39);

    pdf.setDrawColor(215, 221, 232);
    pdf.setFillColor(248, 250, 252);
    pdf.rect(left, layout.margins.top + 34, width, 16, "FD");
    const col = width / vehicleInfo.length;
    vehicleInfo.forEach((item, i) => {
      const x = isRtl ? right - col * i - col + 2 : left + col * i + 2;
      setBold(7.5);
      pdf.setTextColor(11, 79, 162);
      writeText(item.label, isRtl ? x + col - 4 : x, layout.margins.top + 40, { align: isRtl ? "right" : "left", maxWidth: col - 4 });
      setNormal(8);
      pdf.setTextColor(17, 24, 39);
      writeText(item.value || "—", isRtl ? x + col - 4 : x, layout.margins.top + 46, { align: isRtl ? "right" : "left", maxWidth: col - 4 });
    });
  };
  const drawFooter = (page: number, total: number) => {
    pdf.setDrawColor(215, 221, 232);
    pdf.line(left, bottom + 3, right, bottom + 3);
    pdf.setTextColor(107, 114, 128);
    setNormal(7);
    writeText(meta.footerNote || "Generated by AAED2", isRtl ? right : left, bottom + 8, { align: isRtl ? "right" : "left", maxWidth: width / 2 });
    writeText(`${page} / ${total}`, isRtl ? left : right, bottom + 8, { align: isRtl ? "left" : "right" });
    pdf.setTextColor(17, 24, 39);
  };
  let y = layoutName === "qr-label" ? layout.margins.top : layout.margins.top + 55;
  if (layoutName !== "qr-label") drawHeader(false);

  const addPageIfNeeded = (needed = 8) => {
    if (y + needed <= bottom) return;
    pdf.addPage();
    drawHeader(true);
    y = layout.margins.top + 55;
  };

  if (layoutName === "qr-label") {
    setBold(10);
    writeText(title, layout.widthMm / 2, y + 4, { align: "center", maxWidth: width });
    if (qr) pdf.addImage(qr, "PNG", (layout.widthMm - 34) / 2, y + 9, 34, 34);
    setNormal(7);
    writeText(qrText || docNo || title, layout.widthMm / 2, y + 48, { align: "center", maxWidth: layout.widthMm - 10 });
  } else {
    setNormal(8.5);
    for (const raw of bodyLines) {
      const clean = raw.replace(/\s+/g, " ").trim();
      if (!clean || clean === title || clean === docNo) continue;
      const wrapped = pdf.splitTextToSize(clean, width);
      addPageIfNeeded(wrapped.length * 4 + 1);
      for (const line of wrapped) {
        writeText(line, isRtl ? right : left, y, { maxWidth: width });
        y += 4;
      }
    }

    for (const table of tables) {
      addPageIfNeeded(14);
      y += 2;
      const columns = Math.max(...table.map((row) => row.length));
      const colW = width / Math.max(columns, 1);
      table.forEach((row, rowIndex) => {
        const rowLines = row.map((cell) => pdf.splitTextToSize(cell || "—", colW - 3));
        const rowH = Math.max(7, ...rowLines.map((lines) => lines.length * 3.5 + 3));
        addPageIfNeeded(rowH + 2);
        pdf.setDrawColor(215, 221, 232);
        if (rowIndex === 0) {
          pdf.setFillColor(11, 79, 162);
          pdf.rect(left, y - 4.5, width, rowH, "F");
          pdf.setTextColor(255, 255, 255);
          setBold(7.5);
        } else {
          pdf.setFillColor(rowIndex % 2 ? 255 : 248, rowIndex % 2 ? 255 : 250, rowIndex % 2 ? 255 : 252);
          pdf.rect(left, y - 4.5, width, rowH, "FD");
          pdf.setTextColor(17, 24, 39);
          setNormal(7.3);
        }
        rowLines.forEach((cellLines, i) => {
          const cellX = isRtl ? right - colW * i - 1.5 : left + colW * i + 1.5;
          const borderX = isRtl ? right - colW * (i + 1) : left + colW * i;
          pdf.setDrawColor(215, 221, 232);
          pdf.line(borderX, y - 4.5, borderX, y - 4.5 + rowH);
          writeText(cellLines.join("\n"), isRtl ? cellX - 1 : cellX, y, { align: isRtl ? "right" : "left", maxWidth: colW - 3 });
        });
        pdf.line(right, y - 4.5, right, y - 4.5 + rowH);
        y += rowH;
        pdf.setTextColor(17, 24, 39);
      });
      y += 3;
    }

    if (qr) {
      addPageIfNeeded(28);
      pdf.setDrawColor(215, 221, 232);
      pdf.setFillColor(248, 250, 252);
      pdf.rect(isRtl ? right - 52 : left, y, 52, 24, "FD");
      pdf.addImage(qr, "PNG", isRtl ? right - 23 : left + 3, y + 3, 18, 18);
      setNormal(6.8);
      writeText(qrText, isRtl ? right - 25 : left + 24, y + 9, { align: isRtl ? "right" : "left", maxWidth: 24 });
      y += 27;
    }
  }

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    if (layoutName !== "qr-label") drawFooter(page, totalPages);
  }
  const blob = pdf.output("blob");
  return blob;
}

export async function downloadPdfV2(input: PdfV2BuildInput, fileName: string, download = true): Promise<Blob> {
  const blob = await createPdfV2Blob(input);
  if (download) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName(fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  return blob;
}

export async function openPdfV2Viewer(input: PdfV2BuildInput): Promise<Window | null> {
  const placeholder = window.open("", "_blank", "noopener,noreferrer");
  const blob = await createPdfV2Blob(input);
  const url = URL.createObjectURL(blob);
  if (placeholder) {
    try { (placeholder as any).opener = null; } catch {}
    placeholder.location.replace(url);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return placeholder;
  }
  window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return null;
}

export async function printPdfV2InViewer(input: PdfV2BuildInput): Promise<void> {
  await openPdfV2Viewer(input);
}
