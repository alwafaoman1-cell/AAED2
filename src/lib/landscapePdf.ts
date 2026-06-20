// مولّد PDF احترافي أفقي لتقارير الجداول التفصيلية
// يدعم: عنوان، فترة، KPIs، جدول رئيسي بكامل الأعمدة، صف إجمالي، ملاحظات سفلية
import { generatePdfFromHtml } from "./htmlToPdf";
import { getTemplateSettings, STAMP_SIZE_PX } from "./pdfGenerator";

export interface LandscapeColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string;        // مثل "8%" أو "120px"
  format?: (v: any, row: any) => string;
  /** لون النص (للأعمدة المالية) */
  color?: "default" | "success" | "danger" | "warning" | "info" | "primary";
  /** صف يستخدم خط mono */
  mono?: boolean;
}

export interface LandscapeKpi {
  label: string;
  value: string;
  color?: "default" | "success" | "danger" | "warning" | "info" | "primary";
}

export interface LandscapeSection {
  title: string;
  columns: LandscapeColumn[];
  rows: Record<string, any>[];
  /** صف مجموع اختياري */
  totals?: Record<string, any>;
}

export interface LandscapeReportPayload {
  title: string;
  subtitle?: string;
  rangeLabel?: string;
  kpis?: LandscapeKpi[];
  sections: LandscapeSection[];
  footerNote?: string;
}

const COLOR_MAP: Record<NonNullable<LandscapeColumn["color"]>, string> = {
  default: "#111827",
  success: "#16a34a",
  danger: "#dc2626",
  warning: "#d97706",
  info: "#0284c7",
  primary: "#1e40af",
};

const fmt = (v: any, c: LandscapeColumn, row: any): string => {
  if (c.format) return c.format(v, row);
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(v);
};

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function buildHtml(p: LandscapeReportPayload): string {
  // ختم/توقيع
  let stampHtml = "";
  try {
    const tpl = getTemplateSettings();
    if (tpl.stampEnabled && tpl.stampOnReport && (tpl.stampUrl || tpl.signatureUrl)) {
      const sizePx = STAMP_SIZE_PX[tpl.stampSize] || 130;
      const align =
        tpl.stampPosition === "bottom-left" ? "flex-start"
        : tpl.stampPosition === "watermark-center" ? "center" : "flex-end";
      stampHtml = `<div class="stamp" style="justify-content:${align}">
        ${tpl.stampUrl ? `<img src="${tpl.stampUrl}" style="width:${sizePx}px;height:${sizePx}px;object-fit:contain"/>` : ""}
        ${tpl.signatureUrl && tpl.stampPosition !== "watermark-center"
          ? `<img src="${tpl.signatureUrl}" style="width:${sizePx}px;height:${sizePx*0.45}px;object-fit:contain;margin-right:8px"/>` : ""}
        ${tpl.responsibleName && tpl.stampPosition !== "watermark-center"
          ? `<div class="resp">${esc(tpl.responsibleName)}</div>` : ""}
      </div>`;
    }
  } catch {}

  const kpisHtml = p.kpis?.length
    ? `<div class="kpis">${p.kpis.map(k => `
        <div class="kpi" style="border-color:${COLOR_MAP[k.color || "default"]}33;background:${COLOR_MAP[k.color || "default"]}0d">
          <span class="kpi-l">${esc(k.label)}</span>
          <span class="kpi-v" style="color:${COLOR_MAP[k.color || "default"]}">${esc(k.value)}</span>
        </div>`).join("")}</div>`
    : "";

  const sectionsHtml = p.sections.map((s) => {
    const head = s.columns.map(c =>
      `<th style="text-align:${c.align || "right"};${c.width ? `width:${c.width};` : ""}">${esc(c.label)}</th>`).join("");

    const body = s.rows.length === 0
      ? `<tr><td colspan="${s.columns.length}" style="text-align:center;color:#9ca3af;padding:18px">— لا توجد بيانات —</td></tr>`
      : s.rows.map((r, i) =>
          `<tr class="${i % 2 ? "alt" : ""}">${s.columns.map(c => {
            const color = c.color ? COLOR_MAP[c.color] : "";
            return `<td style="text-align:${c.align || "right"};${color ? `color:${color};` : ""}${c.mono ? "font-family:'Roboto Mono',monospace;" : ""}">${esc(fmt(r[c.key], c, r))}</td>`;
          }).join("")}</tr>`).join("");

    const totalsRow = s.totals
      ? `<tr class="totals">${s.columns.map(c => {
          const color = c.color ? COLOR_MAP[c.color] : "";
          const val = s.totals![c.key];
          return `<td style="text-align:${c.align || "right"};${color ? `color:${color};` : ""}font-weight:700">${val !== undefined && val !== null ? esc(fmt(val, c, s.totals!)) : ""}</td>`;
        }).join("")}</tr>` : "";

    return `<section class="sec">
      <h2>${esc(s.title)}</h2>
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}${totalsRow}</tbody>
      </table>
    </section>`;
  }).join("");

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head>
<meta charset="utf-8"/><title>${esc(p.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Roboto+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 0; }
  *{box-sizing:border-box}
  body{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;margin:0;background:#fff;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:297mm;min-height:210mm;margin:0 auto;padding:10mm 12mm;background:#fff}
  thead{display:table-header-group}
  tfoot{display:table-footer-group}
  tr,td,th{page-break-inside:avoid;break-inside:avoid}
  .head{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:10px;border-bottom:3px solid #d4af37;margin-bottom:14px}
  .head .brand h1{margin:0 0 2px;color:#d4af37;font-size:22px;font-weight:800}
  .head .brand small{color:#6b7280;font-size:11px;letter-spacing:.3px}
  .head .doc-title{text-align:left;font-size:18px;font-weight:800;color:#111827}
  .meta{color:#6b7280;font-size:11px;margin:1px 0}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0 14px}
  .kpi{padding:8px 10px;border:1px solid;border-radius:6px;display:flex;flex-direction:column}
  .kpi-l{font-size:10px;color:#6b7280}
  .kpi-v{font-size:15px;font-weight:800;font-family:'Roboto Mono',monospace}
  section.sec{margin-bottom:14px}
  section.sec h2{font-size:13px;color:#fff;background:#1e293b;margin:0;padding:6px 10px;border-radius:4px 4px 0 0}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:auto}
  th{background:#0f172a;color:#fff;padding:6px 5px;border:1px solid #0f172a;font-weight:700;text-align:right}
  td{padding:5px;border:1px solid #e5e7eb;vertical-align:middle;text-align:right}
  tr.alt td{background:#f8fafc}
  tr.totals td{background:#fef3c7;border-top:2px solid #d4af37;font-weight:700}
  .stamp{margin-top:14px;display:flex;align-items:center;gap:8px}
  .stamp .resp{font-weight:700;color:#374151;font-size:11px;margin-right:6px}
  .footer{margin-top:18px;padding-top:8px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#9ca3af;font-size:9px}
</style>
</head><body>
<div class="page">
  <div class="head">
    <div class="brand">
      <h1>شركة الوفاء للأعمال المتكاملة</h1>
      <small>Alwafa Integrated Services — Detailed Reports (A4 Landscape)</small>
    </div>
    <div class="doc-title">${esc(p.title)}</div>
  </div>
  ${p.subtitle ? `<div class="meta">${esc(p.subtitle)}</div>` : ""}
  ${p.rangeLabel ? `<div class="meta">الفترة: ${esc(p.rangeLabel)}</div>` : ""}
  ${kpisHtml}
  ${sectionsHtml}
  ${stampHtml}
  ${p.footerNote ? `<div class="meta" style="margin-top:8px">${esc(p.footerNote)}</div>` : ""}
  <div class="footer">
    <span>صدر بتاريخ: ${new Date().toLocaleString("en-GB")}</span>
    <span>نظام إدارة الورش — الوفاء</span>
  </div>
</div>
</body></html>`;
}

export async function exportLandscapePdf(p: LandscapeReportPayload, fileName = "report.pdf") {
  const html = buildHtml(p);
  const baseName = fileName.replace(/\.pdf$/i, "");
  await generatePdfFromHtml({
    htmlContent: html,
    fileName: baseName,
    download: true,
    orientation: "landscape",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}
