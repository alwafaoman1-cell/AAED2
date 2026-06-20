// مصدّرات موحدة للتقارير: PDF (HTML→Canvas→PDF) | Excel (XLSX) | CSV | طباعة مباشرة بدون header/footer
// تم استبدال jsPDF+Amiri بـ html2canvas للحفاظ على دعم 100% للعربية والاتجاه RTL والخطوط الجميلة
// وإلغاء أي رابط/تاريخ/عنوان من المتصفح في الطباعة.

import * as XLSX from "xlsx";
import { generatePdfFromHtml } from "./htmlToPdf";
import { getTemplateSettings, STAMP_SIZE_PX } from "./pdfGenerator";
import { buildHtmlWithPageMarginStyle } from "./pdfLayoutSettings";

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: (v: any) => string;
}

export interface ReportExportPayload {
  title: string;
  subtitle?: string;
  rangeLabel?: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  summary?: { label: string; value: string }[];
}

const fmtNum = (n: number) => {
  if (typeof n !== "number" || isNaN(n)) return "—";
  return n.toLocaleString("ar-OM", { maximumFractionDigits: 2 });
};

export function formatCellValue(v: any, col: ReportColumn): string {
  if (col.format) return col.format(v);
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return fmtNum(v);
  return String(v);
}

// ============== HTML قابل للطباعة (مشترك بين PDF والطباعة المباشرة) ==============
function buildReportHtml(p: ReportExportPayload, opts: { forPrint?: boolean } = {}): string {
  const headRow = p.columns
    .map((c) => `<th style="text-align:${c.align || "right"}">${escapeHtml(c.label)}</th>`)
    .join("");

  const bodyRows = p.rows
    .map(
      (r) =>
        `<tr>${p.columns
          .map(
            (c) =>
              `<td style="text-align:${c.align || "right"}">${escapeHtml(
                formatCellValue(r[c.key], c)
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("");

  const summary = (p.summary || [])
    .map(
      (s) =>
        `<div class="sum-row"><span>${escapeHtml(s.label)}</span><strong>${escapeHtml(
          s.value
        )}</strong></div>`
    )
    .join("");

  // إعدادات الختم/التوقيع للتقارير
  let stampHtml = "";
  try {
    const tpl = getTemplateSettings();
    if (tpl.stampEnabled && tpl.stampOnReport && (tpl.stampUrl || tpl.signatureUrl)) {
      const sizePx = STAMP_SIZE_PX[tpl.stampSize] || 150;
      const align =
        tpl.stampPosition === "bottom-left"
          ? "flex-start"
          : tpl.stampPosition === "watermark-center"
          ? "center"
          : "flex-end";
      stampHtml = `
        <div class="stamp-area" style="justify-content:${align}">
          ${
            tpl.stampUrl
              ? `<img src="${tpl.stampUrl}" style="width:${sizePx}px;height:${sizePx}px;object-fit:contain;${
                  tpl.stampPosition === "watermark-center" ? "opacity:.18" : ""
                }" />`
              : ""
          }
          ${
            tpl.signatureUrl && tpl.stampPosition !== "watermark-center"
              ? `<img src="${tpl.signatureUrl}" style="width:${sizePx}px;height:${sizePx * 0.45}px;object-fit:contain;margin-${
                  align === "flex-end" ? "right" : "left"
                }:8px" />`
              : ""
          }
          ${
            tpl.responsibleName && tpl.stampPosition !== "watermark-center"
              ? `<div class="resp">${escapeHtml(tpl.responsibleName)}</div>`
              : ""
          }
        </div>`;
    }
  } catch {/* ignore */}

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(p.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  /* إخفاء كل header/footer من نافذة الطباعة (الرابط، التاريخ، رقم الصفحة) */
  @page { size: A4 portrait; margin: 0; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; }
    .no-print { display: none !important; }
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
    margin: 0;
    background: #fff;
    color: #111827;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm; /* A4 exact */
    min-height: 297mm;
    margin: 0 auto;
    padding: 12mm 10mm;
    background: #fff;
  }
  /* تقسيم آمن للجداول عبر الصفحات */
  table { page-break-inside: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr, td, th { page-break-inside: avoid; break-inside: avoid; }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 3px solid #d4af37;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .head .brand h1 { color: #d4af37; margin: 0 0 2px; font-size: 22px; font-weight: 700; }
  .head .brand small { color: #6b7280; font-size: 11px; letter-spacing: .3px; }
  .head .doc-title { font-size: 16px; font-weight: 700; color: #111827; text-align: left; }
  .meta { color: #6b7280; font-size: 12px; margin: 2px 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-top: 12px;
    table-layout: auto;
  }
  th {
    background: #1e293b;
    color: #fff;
    padding: 8px 6px;
    text-align: right;
    font-weight: 700;
    border: 1px solid #1e293b;
  }
  td {
    padding: 6px;
    border: 1px solid #e5e7eb;
    text-align: right;
    vertical-align: middle;
  }
  tr:nth-child(even) td { background: #f8fafc; }
  .summary {
    margin-top: 18px;
    padding: 14px 16px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }
  .summary h3 { margin: 0 0 10px; font-size: 14px; color: #111827; font-weight: 700; }
  .sum-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px dashed #e5e7eb;
    font-size: 13px;
  }
  .sum-row:last-child { border-bottom: 0; }
  .stamp-area {
    margin-top: 28px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .stamp-area .resp {
    font-weight: 700;
    color: #374151;
    font-size: 12px;
    margin-right: 6px;
  }
  .footer {
    margin-top: 30px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    color: #9ca3af;
    font-size: 10px;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="head">
      <div class="brand">
        <h1>شركة الوفاء للأعمال المتكاملة</h1>
        <small>Alwafa Integrated Services — Reports</small>
      </div>
      <div class="doc-title">${escapeHtml(p.title)}</div>
    </div>
    ${p.subtitle ? `<div class="meta">${escapeHtml(p.subtitle)}</div>` : ""}
    ${p.rangeLabel ? `<div class="meta">الفترة: ${escapeHtml(p.rangeLabel)}</div>` : ""}
    <table>
      <thead><tr>${headRow}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${p.columns.length}" style="text-align:center;color:#9ca3af;padding:24px">لا توجد بيانات</td></tr>`}</tbody>
    </table>
    ${
      summary
        ? `<div class="summary"><h3>ملخص التقرير</h3>${summary}</div>`
        : ""
    }
    ${stampHtml}
    <div class="footer">
      <span>صدر بتاريخ: ${new Date().toLocaleString("ar-OM")}</span>
      <span>نظام إدارة الورش — الوفاء</span>
    </div>
  </div>
  ${
    opts.forPrint
      ? `<script>window.onload=()=>{setTimeout(()=>{window.print();},250);};</script>`
      : ""
  }
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============== PDF (عبر html2canvas — يدعم العربية تماماً) ==============
export async function exportReportToPdf(p: ReportExportPayload, filename = "report.pdf") {
  const html = buildReportHtml(p);
  const baseName = filename.replace(/\.pdf$/i, "");
  await generatePdfFromHtml({
    htmlContent: html,
    fileName: baseName,
    download: true,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

// ============== Excel (XLSX) ==============
export function exportReportToXlsx(p: ReportExportPayload, filename = "report.xlsx") {
  const headers = p.columns.map((c) => c.label);
  const data = p.rows.map((r) =>
    p.columns.map((c) => {
      const v = r[c.key];
      if (typeof v === "number") return v;
      return formatCellValue(v, c);
    })
  );

  const ws = XLSX.utils.aoa_to_sheet([
    [p.title],
    p.subtitle ? [p.subtitle] : [],
    p.rangeLabel ? [`الفترة: ${p.rangeLabel}`] : [],
    [],
    headers,
    ...data,
  ]);

  ws["!cols"] = p.columns.map(() => ({ wch: 20 }));

  if (p.summary && p.summary.length) {
    const lastRow = data.length + 6;
    XLSX.utils.sheet_add_aoa(ws, [[], ["ملخص"], ...p.summary.map((s) => [s.label, s.value])], {
      origin: `A${lastRow}`,
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, filename);
}

// ============== CSV ==============
export function exportReportToCsv(p: ReportExportPayload, filename = "report.csv") {
  const headers = p.columns.map((c) => `"${c.label}"`).join(",");
  const rows = p.rows.map((r) =>
    p.columns
      .map((c) => {
        const v = formatCellValue(r[c.key], c);
        return `"${v.replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  const csv = "\ufeff" + [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ============== طباعة مباشرة (نافذة منفصلة RTL) ==============
// @page { margin: 0 } يلغي header/footer الافتراضي للمتصفح (الرابط والتاريخ)
export function printReport(p: ReportExportPayload) {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  const html = buildHtmlWithPageMarginStyle(buildReportHtml(p, { forPrint: true }));
  win.document.write(html);
  win.document.close();
}
