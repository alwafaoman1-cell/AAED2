// Bilingual (AR/EN) Comprehensive Vehicle Inspection Report
import { openSanitizedPdfWindow } from "./safePdfWindow";
const COMPANY_NAME = "شركة الوفاء للأعمال المتكاملة";
const COMPANY_NAME_EN = "Alwafa Integrated Services";
const COMPANY_CR = "السجل التجاري / CR: XXXXXXXXXX";
const COMPANY_VAT_NUM = "الرقم الضريبي / VAT: OM1XXXXXXXXX";

interface InspectionReportData {
  vehicleInfo: {
    brand: string; model: string; year: string; plate: string;
    vin: string; color: string; mileage: string;
    customerName: string; customerPhone: string;
  };
  bodyChecks: Record<string, string>;
  mechChecks: Record<string, string>;
  elecChecks: Record<string, string>;
  damageMarkers: { x: number; y: number; type: string }[];
  notes: string;
  recommendation: string;
  overallRating: string;
  bodyItems: string[];
  mechItems: string[];
  elecItems: string[];
  statusLabels: Record<string, string>;
  /** Photo URLs (data: or remote) to embed at the bottom of the report. */
  photos?: string[];
}

const ratingLabels: Record<string, [string, string]> = {
  excellent: ["ممتاز", "Excellent"],
  good: ["جيد", "Good"],
  fair: ["مقبول", "Fair"],
  damaged: ["متضرر", "Damaged"],
};

const ratingColors: Record<string, string> = {
  excellent: "#22c55e",
  good: "#3b82f6",
  fair: "#f59e0b",
  damaged: "#ef4444",
};

const damageTypeLabels: Record<string, [string, string]> = {
  scratch: ["خدش", "Scratch"],
  dent: ["انبعاج", "Dent"],
  crack: ["كسر", "Crack"],
  paint: ["تقشر طلاء", "Paint Peel"],
  rust: ["صدأ", "Rust"],
  missing: ["قطعة مفقودة", "Missing Part"],
};

// Bilingual versions of common item names (best-effort fallback to AR if not found)
const ITEM_EN: Record<string, string> = {
  // Body
  "الصدام الأمامي": "Front Bumper",
  "الصدام الخلفي": "Rear Bumper",
  "غطاء المحرك": "Hood",
  "الغطاء الأمامي (البونيت)": "Hood / Bonnet",
  "غطاء الصندوق": "Trunk Lid",
  "صندوق الخلفي": "Rear Trunk",
  "السقف": "Roof",
  "الباب الأمامي الأيمن": "Front Right Door",
  "الباب الأمامي الأيسر": "Front Left Door",
  "الباب الخلفي الأيمن": "Rear Right Door",
  "الباب الخلفي الأيسر": "Rear Left Door",
  "الجناح الأمامي الأيمن": "Front Right Fender",
  "الجناح الأمامي الأيسر": "Front Left Fender",
  "الجناح الخلفي الأيمن": "Rear Right Fender",
  "الجناح الخلفي الأيسر": "Rear Left Fender",
  "المرايا الجانبية": "Side Mirrors",
  "الزجاج الأمامي": "Windshield",
  "الزجاج الخلفي": "Rear Windshield",
  "المصابيح الأمامية": "Headlights",
  "المصابيح الخلفية": "Tail Lights",
  // Mechanical
  "المحرك": "Engine",
  "ناقل الحركة": "Transmission",
  "نظام التبريد": "Cooling System",
  "نظام الفرامل": "Brake System",
  "نظام التعليق": "Suspension",
  "الإطارات": "Tires",
  "نظام العادم": "Exhaust System",
  "زيت المحرك": "Engine Oil",
  "نظام التوجيه": "Steering",
  "التوجيه (الدركسيون)": "Steering",
  "نظام الوقود": "Fuel System",
  "المحاور والعجلات": "Axles & Wheels",
  // Electrical
  "البطارية": "Battery",
  "المولد (الدينمو)": "Alternator",
  "المارش": "Starter Motor",
  "المنبه (الكلكسون)": "Horn",
  "نظام التكييف": "A/C System",
  "المكيف": "A/C",
  "نظام التدفئة": "Heater",
  "الراديو والصوت": "Audio System",
  "نظام الصوت": "Audio System",
  "النوافذ الكهربائية": "Power Windows",
  "أقفال الأبواب": "Door Locks",
  "إشارات الانعطاف": "Turn Signals",
  "أضواء الفرامل": "Brake Lights",
  "ممسحات الزجاج": "Windshield Wipers",
  "الأنوار الأمامية": "Front Lights",
  "الأنوار الخلفية": "Rear Lights",
  "لوحة العدادات": "Instrument Panel",
  "حساسات الركن": "Parking Sensors",
};

const STATUS_EN: Record<string, string> = {
  "ممتاز": "Excellent",
  "جيد": "Good",
  "مقبول": "Fair",
  "متضرر": "Damaged",
  "غير مطبق": "N/A",
  "غ/م": "N/A",
};

const statusCellColors: Record<string, string> = {
  excellent: "#d1fae5",
  good: "#dbeafe",
  fair: "#fef3c7",
  damaged: "#fecaca",
  na: "#f3f4f6",
};

function renderCheckTable(titleAr: string, titleEn: string, items: string[], checks: Record<string, string>, statusLabels: Record<string, string>) {
  const rows = items.map(item => {
    const cells = Object.keys(statusLabels).map(s => {
      const active = checks[item] === s;
      return `<td style="text-align:center; padding:6px 4px; background:${active ? statusCellColors[s] : 'transparent'}; font-weight:${active ? '700' : '400'}; color:${active ? '#1a1a2e' : '#ccc'};">${active ? '●' : '○'}</td>`;
    }).join('');
    const itemEn = ITEM_EN[item] || '';
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:6px 8px; font-size:11px;">
        ${item}
        ${itemEn ? `<span style="display:block;font-size:8.5px;color:#aaa;font-family:'Inter',sans-serif;line-height:1;margin-top:1px;">${itemEn}</span>` : ''}
      </td>${cells}
    </tr>`;
  }).join('');

  const headers = Object.values(statusLabels).map(v => {
    const en = STATUS_EN[v] || '';
    return `<th style="padding:6px 4px; text-align:center; font-size:10px; font-weight:600; color:#888;">
      ${v}
      ${en ? `<span style="display:block;font-size:8px;color:#bbb;font-family:'Inter',sans-serif;font-weight:500;">${en}</span>` : ''}
    </th>`;
  }).join('');

  return `
    <div style="margin-bottom:15px;">
      <div style="font-size:12px; font-weight:600; color:#d4a537; border-right:3px solid #d4a537; padding-right:8px; margin-bottom:8px;">
        ${titleAr}
        <span style="font-size:10px;color:#888;font-family:'Inter',sans-serif;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;margin-right:8px;">/ ${titleEn}</span>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead><tr style="border-bottom:2px solid #ddd;"><th style="text-align:right; padding:6px 8px; font-size:10px; color:#888;">البند<span style="display:block;font-size:8px;color:#bbb;font-family:'Inter',sans-serif;font-weight:500;">Item</span></th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function generateInspectionReportPdf(data: InspectionReportData) {
  const rColor = ratingColors[data.overallRating] || "#3b82f6";
  const [rLabelAr, rLabelEn] = ratingLabels[data.overallRating] || ["جيد", "Good"];

  const damageList = data.damageMarkers.length > 0
    ? data.damageMarkers.map((m, i) => {
        const [ar, en] = damageTypeLabels[m.type] || [m.type, m.type];
        return `<span style="display:inline-block; margin:2px 4px; padding:3px 10px; border-radius:12px; font-size:10px; background:#fef3c7; color:#92400e;">${i + 1}. ${ar} <span style="color:#b88;font-family:'Inter',sans-serif;font-size:9px;">/ ${en}</span></span>`;
      }).join('')
    : '<span style="color:#888; font-size:11px;">لا توجد أضرار مسجلة <span style="font-family:\'Inter\',sans-serif;font-size:10px;">/ No damages recorded</span></span>';

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<title>Inspection Report - ${data.vehicleInfo.plate}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans Arabic','Inter',sans-serif;direction:rtl;color:#1a1a2e;background:#f8f9fa;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;margin:10mm auto;background:white;padding:12mm 18mm;box-shadow:0 2px 20px rgba(0,0,0,.1);position:relative}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #d4a537;padding-bottom:12px;margin-bottom:20px}
.company-info h1{font-size:20px;font-weight:700;color:#1a1a2e;margin-bottom:1px}
.company-info .en{font-size:12px;color:#444;margin-bottom:6px;font-family:'Inter',sans-serif;font-weight:600}
.company-info .det{font-size:9px;color:#888;line-height:1.8}
.badge{background:linear-gradient(135deg,#d4a537,#c49a2f);color:white;padding:10px 18px;border-radius:8px;text-align:center;min-width:165px}
.badge .l-ar{font-size:11px;font-weight:600}
.badge .l-en{font-size:9px;opacity:.85;font-family:'Inter',sans-serif;letter-spacing:0.5px;text-transform:uppercase}
.badge .n{font-size:16px;font-weight:700;font-family:'Inter',sans-serif;margin:3px 0}
.badge .d{font-size:9px;opacity:.85;font-family:'Inter',sans-serif}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 25px;margin-bottom:15px}
.info-row{display:flex;gap:6px;font-size:11px;padding:3px 0;align-items:baseline}
.info-row .lbl{color:#888;min-width:130px;font-weight:500}
.info-row .lbl .en{display:block;font-size:8.5px;color:#bbb;font-family:'Inter',sans-serif;font-weight:500;line-height:1}
.info-row .val{color:#1a1a2e;font-weight:600;flex:1}
.section-title{font-size:12px;font-weight:600;color:#d4a537;border-right:3px solid #d4a537;padding-right:8px;margin:15px 0 8px;display:flex;align-items:baseline;gap:8px}
.section-title .en{font-size:10px;color:#888;font-family:'Inter',sans-serif;font-weight:500;text-transform:uppercase;letter-spacing:0.5px}
.footer{position:absolute;bottom:12mm;left:18mm;right:18mm;text-align:center;font-size:8.5px;color:#aaa;border-top:1px solid #eee;padding-top:8px;line-height:1.6}
.footer .en{display:block;font-family:'Inter',sans-serif;color:#bbb}
.print-bar{text-align:center;padding:12px;background:#1a1a2e;position:sticky;top:0;z-index:100}
.print-bar button{padding:8px 25px;margin:0 6px;border:none;border-radius:6px;font-family:'Noto Sans Arabic',sans-serif;font-size:13px;font-weight:600;cursor:pointer;color:white}
.btn-p{background:linear-gradient(135deg,#d4a537,#c49a2f)}.btn-c{background:#444}
@media print{.print-bar{display:none!important}html,body{background:white!important;padding:0!important;margin:0!important}.page{margin:0!important;box-shadow:none!important;width:100%!important}}
</style>
</head>
<body>
<div class="print-bar">
<button class="btn-c" onclick="window.close()">✕ إغلاق / Close</button>
</div>

<div class="page">
<div class="header">
<div class="company-info">
<h1>${COMPANY_NAME}</h1>
<div class="en">${COMPANY_NAME_EN}</div>
<div class="det">${COMPANY_CR}<br/>${COMPANY_VAT_NUM}</div>
</div>
<div class="badge">
<div class="l-ar">تقرير فحص شامل</div>
<div class="l-en">Comprehensive Inspection</div>
<div class="n">INS-${Date.now().toString().slice(-6)}</div>
<div class="d">${new Date().toLocaleDateString('en-GB')}</div>
</div>
</div>

<div class="section-title">معلومات العميل والمركبة <span class="en">/ Customer &amp; Vehicle Info</span></div>
<div class="info-grid">
<div class="info-row"><span class="lbl">العميل:<span class="en">Customer</span></span><span class="val">${data.vehicleInfo.customerName || '-'}</span></div>
<div class="info-row"><span class="lbl">الهاتف:<span class="en">Phone</span></span><span class="val" style="direction:ltr;text-align:right;font-family:'Inter',sans-serif;">${data.vehicleInfo.customerPhone || '-'}</span></div>
<div class="info-row"><span class="lbl">الماركة/الموديل:<span class="en">Make / Model</span></span><span class="val">${data.vehicleInfo.brand} ${data.vehicleInfo.model} ${data.vehicleInfo.year}</span></div>
<div class="info-row"><span class="lbl">اللون:<span class="en">Color</span></span><span class="val">${data.vehicleInfo.color || '-'}</span></div>
<div class="info-row"><span class="lbl">رقم اللوحة:<span class="en">Plate No.</span></span><span class="val">${data.vehicleInfo.plate || '-'}</span></div>
<div class="info-row"><span class="lbl">رقم الهيكل:<span class="en">VIN</span></span><span class="val" style="direction:ltr;text-align:right;font-family:monospace;font-size:10px;">${data.vehicleInfo.vin || '-'}</span></div>
<div class="info-row"><span class="lbl">عداد الكيلومترات:<span class="en">Mileage</span></span><span class="val" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.vehicleInfo.mileage || '-'} km</span></div>
<div class="info-row"><span class="lbl">التقييم العام:<span class="en">Overall Rating</span></span><span class="val"><span style="display:inline-block;padding:3px 12px;border-radius:12px;font-size:10px;background:${rColor}22;color:${rColor};font-weight:700">${rLabelAr} <span style="font-family:'Inter',sans-serif;font-size:9px;opacity:0.8;">/ ${rLabelEn}</span></span></span></div>
</div>

${renderCheckTable('فحص الهيكل الخارجي', 'Body / Exterior Inspection', data.bodyItems, data.bodyChecks, data.statusLabels)}
${renderCheckTable('فحص الميكانيكا', 'Mechanical Inspection', data.mechItems, data.mechChecks, data.statusLabels)}
${renderCheckTable('الفحص الكهربائي', 'Electrical Inspection', data.elecItems, data.elecChecks, data.statusLabels)}

<div class="section-title">الأضرار المسجلة على المركبة <span class="en">/ Recorded Vehicle Damages</span></div>
<div style="padding:8px 12px;background:#f8f9fa;border-radius:8px;margin-bottom:12px">${damageList}</div>

${data.notes ? `<div style="margin-bottom:10px;padding:10px 12px;background:#f8f9fa;border-radius:8px;border-right:3px solid #d4a537;font-size:11px;color:#555"><span style="display:block;font-size:9px;color:#999;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Inspector Notes</span><strong>ملاحظات الفاحص:</strong> ${data.notes}</div>` : ''}
${data.recommendation ? `<div style="margin-bottom:10px;padding:10px 12px;background:#fef3c7;border-radius:8px;border-right:3px solid #f59e0b;font-size:11px;color:#92400e"><span style="display:block;font-size:9px;color:#b88300;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Recommendations</span><strong>التوصيات:</strong> ${data.recommendation}</div>` : ''}

${(data.photos && data.photos.length > 0) ? `
<div class="section-title">صور الفحص <span class="en">/ Inspection Photos (${data.photos.length})</span></div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:15px;page-break-inside:auto;">
${data.photos.map((src, i) => `
<div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;background:#fafafa;page-break-inside:avoid;">
  <img src="${src}" style="display:block;width:100%;height:130px;object-fit:cover;" loading="lazy" crossorigin="anonymous"/>
  <div style="text-align:center;font-size:9px;color:#888;padding:4px;font-family:'Inter',sans-serif;">Photo ${i + 1}</div>
</div>`).join('')}
</div>` : ''}


<div style="margin-top:40px;display:flex;justify-content:space-between">
<div style="text-align:center;width:170px"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#888">توقيع الفاحص<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Inspector Signature</span></div></div>
<div style="text-align:center;width:170px"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#888">توقيع المدير<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Manager Signature</span></div></div>
<div style="text-align:center;width:170px"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#888">توقيع العميل<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
</div>

<div class="footer">
${COMPANY_NAME} • جميع الحقوق محفوظة © ${new Date().getFullYear()}
<span class="en">${COMPANY_NAME_EN} • All Rights Reserved © ${new Date().getFullYear()}</span>
</div>
</div>
</body></html>`;
  openSanitizedPdfWindow(html);
}
