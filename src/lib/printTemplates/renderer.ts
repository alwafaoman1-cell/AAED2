// Template Renderer — converts schema JSON to wkhtmltopdf-safe HTML
// Strict rules: tables only, no flex/grid, mm units, RTL, inline styles
import { toEnglishDigits } from "@/lib/numberUtils";
import { bind, escapeHtml } from "./dataBindings";
import type { TemplateBlock, TemplatePage, TemplateSchema, BlockStyle } from "./schema";

const styleToCss = (s: BlockStyle = {}): string => {
  const parts: string[] = [];
  if (s.paddingTop != null) parts.push(`padding-top:${s.paddingTop}mm`);
  if (s.paddingRight != null) parts.push(`padding-right:${s.paddingRight}mm`);
  if (s.paddingBottom != null) parts.push(`padding-bottom:${s.paddingBottom}mm`);
  if (s.paddingLeft != null) parts.push(`padding-left:${s.paddingLeft}mm`);
  if (s.marginTop != null) parts.push(`margin-top:${s.marginTop}mm`);
  if (s.marginBottom != null) parts.push(`margin-bottom:${s.marginBottom}mm`);
  if (s.fontFamily) parts.push(`font-family:'${s.fontFamily}',Arial,sans-serif`);
  if (s.fontSize) parts.push(`font-size:${s.fontSize}pt`);
  if (s.fontWeight) parts.push(`font-weight:${s.fontWeight}`);
  if (s.color) parts.push(`color:${s.color}`);
  if (s.backgroundColor) parts.push(`background-color:${s.backgroundColor}`);
  if (s.textAlign) parts.push(`text-align:${s.textAlign}`);
  if (s.borderTop) parts.push(`border-top:${s.borderTop}`);
  if (s.borderBottom) parts.push(`border-bottom:${s.borderBottom}`);
  if (s.borderRadius != null) parts.push(`border-radius:${s.borderRadius}px`);
  if (s.height != null) parts.push(`height:${s.height}mm`);
  return parts.join(";");
};

function renderHeader(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const logo = data.logoUrl || data.companyLogo || "";
  const name = bind(p.text || "{{companyName}}", data);
  const nameEn = bind(p.textEn || "{{companyNameEn}}", data);
  const logoSize = p.logoSize ?? 22;
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr>
    <td style="width:${logoSize + 4}mm;vertical-align:middle;text-align:center">
      ${logo ? `<img src="${escapeHtml(logo)}" style="width:${logoSize}mm;height:${logoSize}mm;object-fit:contain"/>` : ""}
    </td>
    <td style="vertical-align:middle;text-align:right;direction:rtl">
      <div style="font-size:14pt;font-weight:700;color:${b.style?.color || '#1f2937'}">${escapeHtml(name)}</div>
      ${nameEn ? `<div style="font-size:9pt;color:#6b7280;direction:ltr;text-align:left">${escapeHtml(nameEn)}</div>` : ""}
      ${data.companyAddress ? `<div style="font-size:8pt;color:#6b7280;margin-top:1mm">${escapeHtml(data.companyAddress)}</div>` : ""}
      ${data.companyPhone ? `<div style="font-size:8pt;color:#6b7280">${escapeHtml(toEnglishDigits(data.companyPhone))}${data.companyEmail ? ` · ${escapeHtml(data.companyEmail)}` : ""}</div>` : ""}
      ${data.vatNumber ? `<div style="font-size:8pt;color:#6b7280">VAT: ${escapeHtml(toEnglishDigits(data.vatNumber))}${data.commercialReg ? ` · CR: ${escapeHtml(toEnglishDigits(data.commercialReg))}` : ""}</div>` : ""}
    </td>
  </tr></table>`;
}

function renderTitle(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const txt = bind(p.text || "Document", data);
  const en = bind(p.textEn || "", data);
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr>
    <td style="text-align:${b.style?.textAlign || "center"};padding:3mm 0;border-top:2px solid ${b.style?.color || '#1f2937'};border-bottom:2px solid ${b.style?.color || '#1f2937'}">
      <div style="font-size:${b.style?.fontSize || 16}pt;font-weight:700;letter-spacing:1px">${escapeHtml(txt)}</div>
      ${en ? `<div style="font-size:9pt;color:#6b7280;direction:ltr;letter-spacing:2px">${escapeHtml(en)}</div>` : ""}
    </td>
  </tr></table>`;
}

function renderInfoGrid(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const fields = p.fields || [];
  const cols = p.columns || 2;
  const cellW = (100 / cols).toFixed(2);
  const rows: string[] = [];
  for (let i = 0; i < fields.length; i += cols) {
    const tds: string[] = [];
    for (let j = 0; j < cols; j++) {
      const f = fields[i + j];
      if (!f) { tds.push(`<td style="width:${cellW}%;border:1px solid #e5e7eb"></td>`); continue; }
      const val = bind(`{{${f.bind}}}`, data) || "—";
      tds.push(`<td style="width:${cellW}%;border:1px solid #e5e7eb;padding:2mm 3mm;vertical-align:top">
        <div style="font-size:7pt;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:.5mm">${escapeHtml(f.label)}${f.labelEn ? ` <span style="direction:ltr">/ ${escapeHtml(f.labelEn)}</span>` : ""}</div>
        <div style="font-size:9pt;font-weight:600;color:#1f2937">${escapeHtml(val)}</div>
      </td>`);
    }
    rows.push(`<tr>${tds.join("")}</tr>`);
  }
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}">${rows.join("")}</table>`;
}

function renderItemsTable(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const items: any[] = data[p.itemsBind || "items"] || [];
  const cols = p.columnsConfig || [
    { key: "description", label: "البيان", labelEn: "Description", align: "right" },
    { key: "quantity", label: "الكمية", labelEn: "Qty", width: 15, align: "center" },
    { key: "unitPrice", label: "السعر", labelEn: "Price", width: 20, align: "center" },
    { key: "total", label: "الإجمالي", labelEn: "Total", width: 22, align: "center" },
  ];
  const accent = b.style?.color || "#1f2937";
  const head = `<tr style="background:${accent};color:#fff">
    ${p.showRowNumbers ? `<th style="width:8%;padding:2mm;font-size:9pt;border:1px solid ${accent}">#</th>` : ""}
    ${cols.map(c => `<th style="${c.width ? `width:${c.width}%;` : ""}padding:2mm;font-size:9pt;border:1px solid ${accent};text-align:${c.align || "right"}">${escapeHtml(c.label)}${c.labelEn ? `<div style="font-size:7pt;font-weight:400;opacity:.85;direction:ltr">${escapeHtml(c.labelEn)}</div>` : ""}</th>`).join("")}
  </tr>`;
  const body = items.length === 0
    ? `<tr><td colspan="${cols.length + (p.showRowNumbers ? 1 : 0)}" style="padding:6mm;text-align:center;color:#9ca3af;font-size:9pt;border:1px solid #e5e7eb">لا توجد بنود</td></tr>`
    : items.map((it, i) => {
        const bg = p.zebra && i % 2 === 1 ? "background:#f9fafb;" : "";
        return `<tr style="${bg}">
          ${p.showRowNumbers ? `<td style="padding:2mm;text-align:center;font-size:9pt;border:1px solid #e5e7eb">${i + 1}</td>` : ""}
          ${cols.map(c => {
            const v = it[c.key];
            const display = typeof v === "number" ? toEnglishDigits(v.toFixed(2)) : escapeHtml(toEnglishDigits(v ?? "—"));
            return `<td style="padding:2mm;text-align:${c.align || "right"};font-size:9pt;border:1px solid #e5e7eb">${display}</td>`;
          }).join("")}
        </tr>`;
      }).join("");
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}">${head}${body}</table>`;
}

function renderTotals(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const items = p.totalsItems || [
    { label: "المجموع الفرعي", labelEn: "Subtotal", bind: "subtotal" },
    { label: "ضريبة القيمة المضافة", labelEn: "VAT", bind: "vat" },
    { label: "الإجمالي", labelEn: "Total", bind: "total", bold: true },
  ];
  const accent = b.style?.color || "#1f2937";
  const rows = items.map((it) => {
    const raw = (data as any)[it.bind];
    const val = typeof raw === "number" ? toEnglishDigits(raw.toFixed(2)) : toEnglishDigits(raw ?? "0");
    const isBold = it.bold;
    return `<tr style="${isBold ? `background:${accent};color:#fff;` : ""}">
      <td style="padding:2mm 3mm;font-size:${isBold ? 11 : 9}pt;font-weight:${isBold ? 700 : 500};border:1px solid ${isBold ? accent : '#e5e7eb'}">${escapeHtml(it.label)}${it.labelEn ? ` <span style="font-size:7pt;opacity:.8;direction:ltr">/ ${escapeHtml(it.labelEn)}</span>` : ""}</td>
      <td style="padding:2mm 3mm;font-size:${isBold ? 11 : 9}pt;font-weight:${isBold ? 700 : 600};text-align:left;direction:ltr;border:1px solid ${isBold ? accent : '#e5e7eb'}">${val} ${data.currency || "OMR"}</td>
    </tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr>
    <td style="width:55%"></td>
    <td style="width:45%"><table style="width:100%;border-collapse:collapse">${rows}</table></td>
  </tr></table>`;
}

function renderEstimationBadge(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const txt = data.estimationType === "upl" ? "UPL" : (p.badgeText || "LUMP SUM");
  const color = p.badgeColor || b.style?.color || "#dc2626";
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr>
    <td style="text-align:center;padding:3mm">
      <span style="display:inline-block;padding:2mm 8mm;border:3px solid ${color};color:${color};font-size:18pt;font-weight:900;letter-spacing:4px;direction:ltr;border-radius:4px">${escapeHtml(txt)}</span>
    </td>
  </tr></table>`;
}

function renderQrZatca(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const size = p.qrSize ?? 28;
  const qr = data.qrDataUrl || data.zatcaQr || "";
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr>
    <td style="text-align:${p.qrPosition || "center"};padding:3mm">
      ${qr ? `<img src="${escapeHtml(qr)}" style="width:${size}mm;height:${size}mm"/>` : `<div style="width:${size}mm;height:${size}mm;border:1px dashed #d1d5db;display:inline-block;line-height:${size}mm;text-align:center;font-size:7pt;color:#9ca3af">ZATCA QR</div>`}
      <div style="font-size:7pt;color:#9ca3af;margin-top:1mm">ZATCA QR Code</div>
    </td>
  </tr></table>`;
}

function renderStamp(b: TemplateBlock, data: any): string {
  const p = b.props || {};
  const size = p.stampSize ?? 30;
  const stamp = data.stampUrl || data.companyStamp || "";
  const sig = data.signatureUrl || data.companySignature || "";
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr>
    <td style="width:50%;text-align:center;padding:4mm;border-top:1px solid #e5e7eb">
      <div style="font-size:8pt;color:#6b7280;margin-bottom:2mm">${escapeHtml(p.signatureLabel || "التوقيع / Signature")}</div>
      ${sig ? `<img src="${escapeHtml(sig)}" style="height:${size * 0.5}mm;object-fit:contain"/>` : `<div style="height:${size * 0.5}mm"></div>`}
    </td>
    <td style="width:50%;text-align:center;padding:4mm;border-top:1px solid #e5e7eb">
      <div style="font-size:8pt;color:#6b7280;margin-bottom:2mm">الختم / Stamp</div>
      ${stamp ? `<img src="${escapeHtml(stamp)}" style="height:${size}mm;object-fit:contain"/>` : `<div style="height:${size}mm"></div>`}
    </td>
  </tr></table>`;
}

function renderText(b: TemplateBlock, data: any): string {
  const txt = bind(b.props?.text || "", data);
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr><td style="text-align:${b.style?.textAlign || "right"};padding:1mm">${escapeHtml(txt)}</td></tr></table>`;
}

function renderImage(b: TemplateBlock, data: any): string {
  const src = b.props?.src || "";
  const w = b.props?.width || 60;
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}"><tr><td style="text-align:${b.style?.textAlign || "center"}">${src ? `<img src="${escapeHtml(src)}" style="width:${w}mm;max-width:100%;object-fit:contain"/>` : ""}</td></tr></table>`;
}

function renderDivider(b: TemplateBlock): string {
  return `<div style="border-top:1px solid ${b.style?.color || '#e5e7eb'};margin:${b.style?.marginTop ?? 2}mm 0 ${b.style?.marginBottom ?? 2}mm"></div>`;
}

function renderSpacer(b: TemplateBlock): string {
  return `<div style="height:${b.props?.size ?? 4}mm"></div>`;
}

function renderFooter(b: TemplateBlock, data: any): string {
  const txt = bind(b.props?.text || "شكراً لتعاملكم معنا · Thank you for your business", data);
  return `<table style="width:100%;border-collapse:collapse;${styleToCss(b.style)};border-top:1px solid #e5e7eb;margin-top:4mm"><tr><td style="text-align:center;padding:3mm;font-size:8pt;color:#6b7280">${escapeHtml(txt)}</td></tr></table>`;
}

function renderBlock(b: TemplateBlock, data: any): string {
  if (b.style?.visible === false) return "";
  switch (b.type) {
    case "header":            return renderHeader(b, data);
    case "title":             return renderTitle(b, data);
    case "info_grid":         return renderInfoGrid(b, data);
    case "items_table":       return renderItemsTable(b, data);
    case "totals":            return renderTotals(b, data);
    case "estimation_badge":  return renderEstimationBadge(b, data);
    case "qr_zatca":          return renderQrZatca(b, data);
    case "stamp":             return renderStamp(b, data);
    case "signature":         return renderStamp(b, data);
    case "text":              return renderText(b, data);
    case "image":             return renderImage(b, data);
    case "divider":           return renderDivider(b);
    case "spacer":            return renderSpacer(b);
    case "footer":            return renderFooter(b, data);
    case "logo":              return renderImage(b, { ...data, src: data.logoUrl || data.companyLogo });
    default:                  return "";
  }
}

const baseStyles = (page: TemplatePage): string => `
@page { size: ${page.size} ${page.orientation}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: '${page.baseFontFamily}', 'Cairo', 'Amiri', Arial, sans-serif;
  font-size: ${page.baseFontSize}pt;
  color: ${page.primaryColor};
  direction: ${page.rtl ? "rtl" : "ltr"};
  background: #fff;
}
table { border-collapse: collapse; }
img { display: inline-block; }
.page {
  width: ${page.size === "A4" ? "210mm" : page.size === "A5" ? "148mm" : "216mm"};
  min-height: ${page.size === "A4" ? "297mm" : page.size === "A5" ? "210mm" : "279mm"};
  padding: ${page.marginTop}mm ${page.marginRight}mm ${page.marginBottom}mm ${page.marginLeft}mm;
  margin: 0 auto;
  background: #fff;
  position: relative;
}
.print-actions { display: none; }
@media screen { body { background: #f3f4f6; padding: 16px 0; } .page { box-shadow: 0 4px 24px rgba(0,0,0,.08); } }
@media print { body { background: #fff; padding: 0; } .page { box-shadow: none; margin: 0; } }
${page.watermarkText ? `
.watermark { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:80pt; color:rgba(0,0,0,.04); font-weight:900; letter-spacing:6px; pointer-events:none; z-index:0; }
` : ""}
`;

export function renderTemplate(schema: TemplateSchema, data: any, title = "Document"): string {
  // Group blocks by zone, preserving order within each zone
  const headerBlocks = schema.blocks.filter((b) => (b.zone || "body") === "header");
  const bodyBlocks   = schema.blocks.filter((b) => (b.zone || "body") === "body");
  const footerBlocks = schema.blocks.filter((b) => (b.zone || "body") === "footer");

  const renderZone = (arr: TemplateBlock[]) => arr.map((b) => renderBlock(b, data)).join("\n");
  const headerHtml = renderZone(headerBlocks);
  const bodyHtml   = renderZone(bodyBlocks);
  const footerHtml = renderZone(footerBlocks);

  const wm = schema.page.watermarkText
    ? `<div class="watermark">${escapeHtml(schema.page.watermarkText)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="ar" dir="${schema.page.rtl ? "rtl" : "ltr"}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Amiri:wght@400;700&family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
<style>${baseStyles(schema.page)}</style>
</head>
<body>
<div class="page">
${wm}
<div style="position:relative;z-index:1">
  <div data-zone="header">${headerHtml}</div>
  <div data-zone="body">${bodyHtml}</div>
  <div data-zone="footer">${footerHtml}</div>
</div>
</div>
</body>
</html>`;
}
