// Insurance Damage Inspection Report — English-only (Al Madina Takaful style)
// Three columns: REPAIR / SUSPECT / REPLACE per item, optional comment under each row.
// Page 2+: one page per annotated vehicle image.

// (jsPDF/autoTable removed — مولّد PDF يستخدم HTML→PDF لمطابقة المعاينة تماماً)
import { openSanitizedPdfWindow } from "./safePdfWindow";

export type HighlightColor = "blue" | "yellow" | "red";
export interface TextHighlight {
  /** char start (inclusive) within the item.en string */
  start: number;
  /** char end (exclusive) */
  end: number;
  color: HighlightColor;
}

export interface InsuranceInspItem {
  key: string;
  ar: string;       // kept on the item record for in-app UI only
  en: string;       // shown in the PDF
  repair?: boolean;
  suspect?: boolean;
  replace?: boolean;
  comment?: string;
  /** Optional highlights on the EN text — same color codes as the action buttons */
  highlights?: TextHighlight[];
}

export interface InsuranceInspSection {
  titleAr: string;
  titleEn: string;
  items: InsuranceInspItem[];
}

export interface InsuranceInspectionData {
  reportNo: string;
  date: string;
  claimNo: string;
  regNo: string;
  gatePass: string;
  garageName: string;
  makeModel: string;
  modelYear: string;
  area: string;
  type: string;
  workshopGrade: string;
  insuranceCompany: string;
  remarks: string;
  surveyorName: string;
  sections: InsuranceInspSection[];
  /** PNG dataURLs of annotated vehicle images — one PDF page each */
  annotatedImages?: string[];
  /** Back-compat: single image */
  annotatedImageDataUrl?: string;
  /** Original (non-annotated) damage photos — rendered as gallery pages */
  photos?: string[];
}

const COMPANY_NAME_EN = "Alwafa Integrated Services";

const HIGHLIGHT_BG: Record<HighlightColor, string> = {
  blue: "#dbeafe",
  yellow: "#fef3c7",
  red: "#fecaca",
};
const HIGHLIGHT_FG: Record<HighlightColor, string> = {
  blue: "#1e3a8a",
  yellow: "#854d0e",
  red: "#991b1b",
};

// (helper download removed — مسار HTML→PDF يتولى التنزيل)


function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function renderHighlightedText(text: string, highlights?: TextHighlight[]): string {
  if (!highlights || highlights.length === 0) return escapeHtml(text);
  // Merge overlapping by sorting; render piecewise.
  const sorted = [...highlights]
    .filter(h => h && h.end > h.start && h.start >= 0 && h.end <= text.length)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return escapeHtml(text);
  let out = "";
  let cursor = 0;
  for (const h of sorted) {
    if (h.start < cursor) continue; // skip overlap
    if (h.start > cursor) out += escapeHtml(text.slice(cursor, h.start));
    const seg = escapeHtml(text.slice(h.start, h.end));
    out += `<span style="background:${HIGHLIGHT_BG[h.color]};color:${HIGHLIGHT_FG[h.color]};padding:0 2px;border-radius:2px;font-weight:700;">${seg}</span>`;
    cursor = h.end;
  }
  if (cursor < text.length) out += escapeHtml(text.slice(cursor));
  return out;
}

// Color-coded check cells: REPAIR=blue, SUSPECT=yellow, REPLACE=red
function checkCell(active: boolean | undefined, kind: "repair" | "suspect" | "replace"): string {
  const palette = {
    repair:  { bg: "#dbeafe", fg: "#1e3a8a", mark: "✓" },
    suspect: { bg: "#fef3c7", fg: "#854d0e", mark: "?" },
    replace: { bg: "#fecaca", fg: "#991b1b", mark: "✗" },
  }[kind];
  return `<td style="text-align:center;width:32px;border:0.5px solid #b7b7b7;padding:3px;font-family:'Inter',sans-serif;font-weight:800;font-size:13px;line-height:1.15;vertical-align:middle;color:${active ? palette.fg : '#ccc'};background:${active ? palette.bg : '#fff'};">${active ? palette.mark : ''}</td>`;
}

function renderSection(section: InsuranceInspSection): string {
  const items = section.items;
  const half = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, half);
  const rightItems = items.slice(half);
  const maxLen = Math.max(leftItems.length, rightItems.length);

  const itemCell = (it?: InsuranceInspItem) => it
    ? `<td style="border:0.5px solid #b7b7b7;padding:2.5px 5px;font-size:8.5px;line-height:1.28;vertical-align:middle;">
        <div style="font-weight:600;color:#000;text-transform:uppercase;letter-spacing:0.2px;">${renderHighlightedText(it.en, it.highlights)}</div>
        ${it.comment ? `<div style="margin-top:1px;padding:1px 3px;background:#fffbe6;border-left:2px solid #d4a537;font-size:7.5px;color:#5a4500;font-style:italic;">${escapeHtml(it.comment)}</div>` : ''}
      </td>${checkCell(it.repair, "repair")}${checkCell(it.suspect, "suspect")}${checkCell(it.replace, "replace")}`
    : `<td colspan="4" style="border:0.5px solid #b7b7b7;background:#fafafa;"></td>`;

  const rows: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push(`<tr>${itemCell(leftItems[i])}${itemCell(rightItems[i])}</tr>`);
  }

  return `
    <tr>
      <td colspan="8" style="background:#1a1a2e;color:#fff;padding:3.5px 6px;font-size:9.5px;font-weight:700;letter-spacing:0.4px;border:0.5px solid #1a1a2e;line-height:1.25;">
        ${section.titleEn}
      </td>
    </tr>
    ${rows.join('')}
  `;
}

export function buildInsuranceInspectionHtml(data: InsuranceInspectionData): string {
  const sectionsHtml = data.sections.map(renderSection).join('');
  const images: string[] = (data.annotatedImages && data.annotatedImages.length > 0)
    ? data.annotatedImages
    : (data.annotatedImageDataUrl ? [data.annotatedImageDataUrl] : []);

  const diagramPages = images.length > 0
    ? images.map((src, i) => `
      <div class="page">
        <div class="brand-bar">
          <h1>${COMPANY_NAME_EN}</h1>
          <div style="text-align:right">
            <div style="font-weight:700;font-size:10px;font-family:'Inter',sans-serif">${data.reportNo}</div>
            <div style="font-size:8.5px;color:#666;font-family:'Inter',sans-serif">${data.regNo || '—'}</div>
          </div>
        </div>
        <div class="page-2-title">VEHICLE DAMAGE DIAGRAM ${images.length > 1 ? `— View ${i + 1} of ${images.length}` : ''}</div>
        <div class="diagram-wrap"><img src="${src}" alt="Damage diagram ${i + 1}" crossorigin="anonymous"/></div>
        <div style="font-size:9.5px;color:#444;line-height:1.7;border:1px solid #ccc;padding:8px 10px;background:#f9f9f9">
          <strong>LEGEND:</strong>
          <span style="display:inline-block;margin:3px 8px 3px 0">→ Arrow (Points to damage)</span>
          <span style="display:inline-block;margin:3px 8px 3px 0">○ Circle (Damaged area)</span>
          <span style="display:inline-block;margin:3px 8px 3px 0">✕ Cross (Impact point)</span>
          <span style="display:inline-block;margin:3px 8px 3px 0">▭ Rectangle (Replacement zone)</span>
        </div>
        <div class="signatures">
          <div class="sig-box"><div class="name">${data.surveyorName || '—'}</div>SURVEYOR SIGNATURE</div>
          <div class="sig-box"><div class="name">${data.date}</div>DATE</div>
        </div>
        <div class="footer">${COMPANY_NAME_EN} • ${new Date().getFullYear()}</div>
      </div>
    `).join('')
    : `
      <div class="page">
        <div class="brand-bar">
          <h1>${COMPANY_NAME_EN}</h1>
          <div style="text-align:right">
            <div style="font-weight:700;font-size:10px;font-family:'Inter',sans-serif">${data.reportNo}</div>
          </div>
        </div>
        <div class="page-2-title">VEHICLE DAMAGE DIAGRAM</div>
        <div class="diagram-wrap"><div style="padding:80px 20px;color:#999;font-size:12px">No diagram provided</div></div>
        <div class="footer">${COMPANY_NAME_EN} • ${new Date().getFullYear()}</div>
      </div>
    `;

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8"/>
<title>Damage Inspection — ${data.reportNo}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;direction:ltr;color:#000;background:#e9ecef;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;margin:8mm auto;background:white;padding:14mm 10mm 16mm;box-shadow:0 2px 12px rgba(0,0,0,.12);position:relative;page-break-after:always}
.page.compact{padding:10mm 10mm 12mm}
.page:last-child{page-break-after:auto}
.brand-bar{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1a1a2e;padding-bottom:4px;margin-bottom:5px}
.brand-bar h1{font-size:13px;font-weight:700;letter-spacing:0.3px}
.report-title{text-align:center;background:#1a1a2e;color:#fff;padding:5px;font-size:11px;font-weight:700;letter-spacing:1.2px;margin-bottom:5px}
.meta-table{width:100%;border-collapse:collapse;margin-bottom:5px;font-size:8.5px}
.meta-table td{border:0.5px solid #b7b7b7;padding:2.5px 5px;vertical-align:middle;line-height:1.28;text-align:center}
.meta-table .lbl{background:#f3f4f6;font-weight:700;width:18%;text-transform:uppercase;letter-spacing:0.4px;font-size:8px;text-align:center}
.checks-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
.checks-table th{background:#1a1a2e;color:#fff;border:0.5px solid #1a1a2e;padding:3.5px 3px;font-size:8.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;line-height:1.2;vertical-align:middle}
.checks-table td{position:relative;background-clip:padding-box;box-shadow:inset 0 0 0 0.01px transparent}
.remarks-box{margin-top:5px;border:0.5px solid #b7b7b7;padding:4px 6px;font-size:9px;min-height:24px;line-height:1.35}
.remarks-box .lbl{font-weight:700;color:#1a1a2e;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;font-size:8.5px}
.signatures{display:flex;justify-content:space-between;gap:3px;margin-top:10px}
.sig-box{flex:1;min-width:0;text-align:center;border-top:1px solid #444;padding:4px 2px 0;font-size:7.5px;text-transform:uppercase;letter-spacing:0.1px;white-space:nowrap;overflow:visible}
.sig-box .name{font-weight:700;margin-bottom:2px;text-transform:none;letter-spacing:0;font-size:9px;min-height:12px}
.footer{position:absolute;bottom:6mm;left:10mm;right:10mm;text-align:center;font-size:7.5px;color:#666;border-top:1px solid #ccc;padding-top:3px}
.print-bar{text-align:center;padding:10px;background:#1a1a2e;position:sticky;top:0;z-index:100}
.print-bar button{padding:7px 22px;margin:0 5px;border:none;border-radius:5px;font-family:'Inter',sans-serif;font-size:12px;font-weight:600;cursor:pointer;color:white}
.btn-p{background:#d4a537}.btn-c{background:#444}
.page-2-title{text-align:center;background:#1a1a2e;color:#fff;padding:6px;font-size:12px;font-weight:700;margin-bottom:8px;letter-spacing:1.2px}
.diagram-wrap{border:2px solid #1a1a2e;padding:6px;background:#fafafa;text-align:center;margin-bottom:8px}
.diagram-wrap img{max-width:100%;max-height:200mm;height:auto;display:block;margin:0 auto}
.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.photo-card{border:1px solid #999;background:#fafafa;padding:4px;text-align:center}
.photo-card img{width:100%;height:90mm;object-fit:contain;display:block;background:#fff}
.photo-card .cap{font-size:8.5px;color:#444;margin-top:3px;font-weight:600}
@media print{.print-bar{display:none!important}html,body{background:white!important;padding:0!important;margin:0!important}.page{margin:0!important;box-shadow:none!important;width:100%!important}}
</style>
</head>
<body>
<div class="print-bar">
<button class="btn-p" onclick="window.print()">🖨️ Print</button>
<button class="btn-c" onclick="window.close()">✕ Close</button>
</div>

<!-- ========= PAGE 1 — single-page compact ========= -->
<div class="page compact">

<div class="brand-bar">
  <h1>${COMPANY_NAME_EN}</h1>
  <div style="text-align:right">
    <div style="font-weight:700;font-size:10px">${data.insuranceCompany || '—'}</div>
    <div style="font-size:8.5px;color:#666">Insurance Company</div>
  </div>
</div>

<div class="report-title">MOTOR VEHICLE DAMAGE INSPECTION REPORT</div>

<table class="meta-table">
  <tr>
    <td class="lbl">Claim No.</td><td style="font-weight:700">${data.claimNo || '—'}</td>
    <td class="lbl">Report No.</td><td style="font-weight:700">${data.reportNo}</td>
  </tr>
  <tr>
    <td class="lbl">Reg No.</td><td>${data.regNo || '—'}</td>
    <td class="lbl">Gate Pass</td><td>${data.gatePass || '—'}</td>
  </tr>
  <tr>
    <td class="lbl">Make / Model</td><td>${data.makeModel || '—'}</td>
    <td class="lbl">Model Year</td><td>${data.modelYear || '—'}</td>
  </tr>
  <tr>
    <td class="lbl">Area</td><td>${data.area || '—'}</td>
    <td class="lbl">Type</td><td>${data.type || '—'}</td>
  </tr>
  <tr>
    <td class="lbl">Garage Name</td><td>${data.garageName || COMPANY_NAME_EN}</td>
    <td class="lbl">W/S Grade</td><td>${data.workshopGrade || 'A'}</td>
  </tr>
  <tr>
    <td class="lbl">Date</td><td>${data.date}</td>
    <td class="lbl">Surveyor</td><td>${data.surveyorName || '—'}</td>
  </tr>
</table>

<table class="checks-table">
  <thead>
    <tr>
      <th style="width:32%">Item</th>
      <th style="width:5.3%;background:#1d4ed8 !important;color:#fff !important;border-color:#1d4ed8 !important">Repair</th>
      <th style="width:5.3%;background:#ca8a04 !important;color:#fff !important;border-color:#ca8a04 !important">Suspect</th>
      <th style="width:5.3%;background:#b91c1c !important;color:#fff !important;border-color:#b91c1c !important">Replace</th>
      <th style="width:32%">Item</th>
      <th style="width:5.3%;background:#1d4ed8 !important;color:#fff !important;border-color:#1d4ed8 !important">Repair</th>
      <th style="width:5.3%;background:#ca8a04 !important;color:#fff !important;border-color:#ca8a04 !important">Suspect</th>
      <th style="width:5.3%;background:#b91c1c !important;color:#fff !important;border-color:#b91c1c !important">Replace</th>
    </tr>
  </thead>
  <tbody>
    ${sectionsHtml}
  </tbody>
</table>

<div class="remarks-box">
  <div class="lbl">Remarks</div>
  <div>${data.remarks || '—'}</div>
</div>

<div class="signatures">
  <div class="sig-box"><div class="name">${data.surveyorName || '—'}</div>Surveyor Signature</div>
  <div class="sig-box"><div class="name">&nbsp;</div>Workshop Manager</div>
  <div class="sig-box"><div class="name">&nbsp;</div>Insurance Company</div>
</div>

<div class="footer">${COMPANY_NAME_EN} • ${new Date().getFullYear()}</div>
</div>

${diagramPages}

${(data.photos && data.photos.length > 0) ? (() => {
  const per = 4; // 4 photos per page (2x2)
  const pages: string[] = [];
  for (let i = 0; i < data.photos!.length; i += per) {
    const chunk = data.photos!.slice(i, i + per);
    const pageNum = Math.floor(i / per) + 1;
    const totalPages = Math.ceil(data.photos!.length / per);
    pages.push(`
      <div class="page">
        <div class="brand-bar">
          <h1>${COMPANY_NAME_EN}</h1>
          <div style="text-align:right">
            <div style="font-weight:700;font-size:10px">${data.reportNo}</div>
            <div style="font-size:8.5px;color:#666">${data.regNo || '—'}</div>
          </div>
        </div>
        <div class="page-2-title">DAMAGE PHOTOS ${totalPages > 1 ? `— Page ${pageNum} of ${totalPages}` : ''}</div>
        <div class="photo-grid">
          ${chunk.map((src, j) => `
            <div class="photo-card">
              <img src="${src}" alt="Photo ${i + j + 1}"/>
              <div class="cap">Photo ${i + j + 1}</div>
            </div>
          `).join('')}
        </div>
        <div class="footer">${COMPANY_NAME_EN} • ${new Date().getFullYear()}</div>
      </div>
    `);
  }
  return pages.join('');
})() : ''}

</body></html>`;

  return html;
}

export function generateInsuranceInspectionPdf(data: InsuranceInspectionData): void {
  openSanitizedPdfWindow(buildInsuranceInspectionHtml(data));
}

/**
 * يولّد PDF فحص التأمين عبر مسار HTML→PDF حتى يطابق التقرير المعاينة تماماً
 * (تلوين الكلمات المحددة، الأقسام، الصور التوضيحية، والصور الفعلية).
 */
export async function generateInsuranceInspectionPdfBlob(data: InsuranceInspectionData, fileName: string, download = true): Promise<Blob> {
  const { generatePdfFromHtml, DEFAULT_MARGINS } = await import("./htmlToPdf");
  const html = buildInsuranceInspectionHtml(data);
  return generatePdfFromHtml({
    htmlContent: html,
    fileName,
    download,
    margins: DEFAULT_MARGINS,
    orientation: "portrait",
  });
}

/** Default checklist sections matching Al Madina Takaful template structure */
export const DEFAULT_INSURANCE_INSPECTION_SECTIONS: InsuranceInspSection[] = [
  {
    titleAr: "أجزاء الهيكل (الباڊي)",
    titleEn: "BODY PARTS",
    items: [
      { key: "front_bumper", ar: "الصدام الأمامي + التقوية + الماصّ", en: "Front Bumper + Reinforcement + Absorber" },
      { key: "rear_bumper", ar: "الصدام الخلفي + التقوية + الماصّ", en: "Rear Bumper + Reinforcement + Absorber" },
      { key: "spoiler_front", ar: "سبويلر أمامي + حساس + واقي", en: "Front Spoiler + Sensor + Guard" },
      { key: "spoiler_rear", ar: "سبويلر خلفي + لوح حماية + عاكس", en: "Rear Spoiler + Skid Plate + Reflector" },
      { key: "bumper_grill", ar: "شبك الصدام + الغطاء السفلي + رفراف", en: "Bumper Grill + Under Cover + Mud Flap" },
      { key: "front_fender_lh", ar: "رفرف أمامي يسار + بطانة", en: "Front Fender LH + Liner" },
      { key: "front_fender_rh", ar: "رفرف أمامي يمين + بطانة", en: "Front Fender RH + Liner" },
      { key: "rear_fender_lh", ar: "رفرف خلفي يسار + بطانة", en: "Rear Fender LH + Liner" },
      { key: "rear_fender_rh", ar: "رفرف خلفي يمين + بطانة", en: "Rear Fender RH + Liner" },
      { key: "radiator_panel", ar: "لوحة الراديتر + الغطاء", en: "Radiator Panel + Cover" },
      { key: "pillars", ar: "الأعمدة (أمامي/أوسط/خلفي)", en: "Pillars (Front / Center / Rear)" },
      { key: "grill", ar: "الشبك + الشعار + الرادار + الكاميرا", en: "Grill + Emblem + Radar + Camera" },
      { key: "hood", ar: "غطاء المحرك + القفل + المفاصل", en: "Hood + Lock + Hinges" },
      { key: "roof", ar: "السقف + البطانة الداخلية", en: "Roof + Lining" },
      { key: "door_mirror_lh", ar: "مرآة الباب يسار + الغطاء", en: "Door Mirror LH + Cover" },
      { key: "door_mirror_rh", ar: "مرآة الباب يمين + الغطاء", en: "Door Mirror RH + Cover" },
      { key: "door_fr_lh", ar: "الباب الأمامي يسار + الزجاج + القفل", en: "Door Front LH + Glass + Lock" },
      { key: "door_fr_rh", ar: "الباب الأمامي يمين + الزجاج + القفل", en: "Door Front RH + Glass + Lock" },
      { key: "door_rr_lh", ar: "الباب الخلفي يسار + الزجاج + القفل", en: "Door Rear LH + Glass + Lock" },
      { key: "door_rr_rh", ar: "الباب الخلفي يمين + الزجاج + القفل", en: "Door Rear RH + Glass + Lock" },
      { key: "trunk_lid", ar: "غطاء الصندوق + القفل + المفاصل", en: "Trunk Lid + Lock + Hinges" },
      { key: "back_panel", ar: "اللوحة الخلفية + الإطار", en: "Back Panel + Garnish" },
      { key: "rocker_panel", ar: "العتبات الجانبية يسار/يمين", en: "Rocker Panel LH / RH" },
      { key: "windshield", ar: "الزجاج الأمامي/الخلفي", en: "Wind Screen Front / Rear" },
      { key: "wheel_rim", ar: "جنوط (2) + كفرات (2) جديدة", en: "Wheel Rim (2) + Tyres (2) New" },
      { key: "chassis_front", ar: "شاسيه أمامي يسار/يمين", en: "Front Chassis L / R" },
      { key: "chassis_rear", ar: "شاسيه خلفي يسار/يمين", en: "Rear Chassis L / R" },
    ],
  },
  {
    titleAr: "أجزاء كهربائية وإلكترونية",
    titleEn: "ELECTRICAL & ELECTRONIC PARTS",
    items: [
      { key: "headlight_lh", ar: "المصباح الأمامي يسار + الكروم", en: "Head Light LH + Chrome" },
      { key: "headlight_rh", ar: "المصباح الأمامي يمين + الكروم", en: "Head Light RH + Chrome" },
      { key: "tail_light_lh", ar: "المصباح الخلفي يسار", en: "Tail Light LH" },
      { key: "tail_light_rh", ar: "المصباح الخلفي يمين", en: "Tail Light RH" },
      { key: "fog_lamp", ar: "كشاف الضباب يسار/يمين", en: "Fog Lamp LH / RH" },
      { key: "indicator", ar: "الإشارات اليسار/اليمين", en: "Indicator L / R" },
      { key: "side_lamp", ar: "إنارة جانبية + إنارة الصندوق", en: "Side Lamp + Trunk Lamp" },
      { key: "camera", ar: "الكاميرات (أمامية/خلفية/جانبية)", en: "Cameras (Front/Rear/Side)" },
      { key: "combination_switch", ar: "مفتاح التحكم + الهوائي", en: "Combination Switch + Antenna" },
      { key: "wiring_ecu", ar: "ضفائر الأسلاك + ECM + ECU", en: "Wiring Harness + ECM + ECU" },
      { key: "battery", ar: "البطارية + علبة الفيوزات", en: "Battery + Fuse Box" },
      { key: "airbag", ar: "وسائد هوائية + المستشعرات (جديد)", en: "Air Bag + Module + Sensors (New)" },
      { key: "horn_wiper", ar: "البوق + المساحات + المحرك", en: "Horn + Wiper + Motor" },
      { key: "alternator", ar: "الدينمو + المارش", en: "Alternator + Starter" },
      { key: "stereo", ar: "نظام الصوت/الملاحة + الهوائي", en: "Stereo / Navigation + Antenna" },
      { key: "tpms", ar: "حساس ضغط الإطارات + النقطة العمياء", en: "TPMS Sensor + Blind Spot Sensor" },
    ],
  },
  {
    titleAr: "الأجزاء الميكانيكية",
    titleEn: "MECHANICAL PARTS",
    items: [
      { key: "lower_arm_lh", ar: "ذراع سفلي/علوي يسار أمامي", en: "Lower/Upper Arm Front LH" },
      { key: "lower_arm_rh", ar: "ذراع سفلي/علوي يمين أمامي", en: "Lower/Upper Arm Front RH" },
      { key: "knuckle_hub", ar: "النكل + الموزع + الرولمان يسار/يمين", en: "Knuckle + Hub + Bearings L/R" },
      { key: "shock_front", ar: "ممتص الصدمات الأمامي يسار/يمين", en: "Shock Absorber Front L/R" },
      { key: "shock_rear", ar: "ممتص الصدمات الخلفي يسار/يمين", en: "Shock Absorber Rear L/R" },
      { key: "tie_rod", ar: "ذراع التوجيه + كرة المفصل (جديد)", en: "Tie Rod Arm + Ball Joint (New)" },
      { key: "axle", ar: "الإكسل الأمامي/الخلفي يسار/يمين", en: "Axle Front/Rear L/R" },
      { key: "crossmember", ar: "العضو العرضي (Crossmember)", en: "Crossmember Front / Rear" },
      { key: "engine", ar: "محرك كامل + التثبيتات + الغطاء العلوي", en: "Engine Assy + Mountings + Top Cover" },
      { key: "gearbox", ar: "ناقل الحركة + التثبيتات", en: "Gear Box + Mountings" },
      { key: "stg_pump", ar: "مضخة التوجيه + الخزان", en: "Steering Pump + Reservoir" },
      { key: "stg_rack", ar: "علبة التوجيه + العمود (جديد)", en: "Steering Rack + Column (New)" },
      { key: "radiator", ar: "الراديتر + مبرد الزيت + الخزان", en: "Radiator + Oil Cooler + Reservoir" },
      { key: "exhaust", ar: "الإكزوز + المنفولد + درع الحرارة", en: "Exhaust Muffler + Manifold + Heat Shield" },
      { key: "abs_brakes", ar: "نظام ABS/EBD + التيربو + المبرد البيني", en: "ABS + EBD + Turbo + Inter Cooler" },
      { key: "brake_system", ar: "نظام الفرامل + الكاليبر (2) + الديسك (2)", en: "Brake System + Caliper (2) + Disc (2)" },
      { key: "wheel_alignment", ar: "ضبط زوايا العجلات", en: "Wheel Alignment" },
    ],
  },
  {
    titleAr: "أجزاء التكييف",
    titleEn: "A/C PARTS",
    items: [
      { key: "condenser", ar: "المكثف + التوصيلات", en: "Condenser + Related" },
      { key: "ac_pipe", ar: "أنابيب التكييف + المراوح + المجاري", en: "A/C Pipe + Fan Motors + Ducts" },
      { key: "ac_compressor", ar: "كومبريسر التكييف", en: "A/C Compressor + Related" },
      { key: "evaporator", ar: "المبخّر + التوصيلات", en: "Evaporator + Related" },
      { key: "ac_heater", ar: "المدفأة + المنفاخ + المستقبل", en: "A/C Heater + Blower + Receiver" },
      { key: "stickers", ar: "الملصقات والكتابات الخارجية", en: "Stickers & Sign Writings" },
    ],
  },
];
