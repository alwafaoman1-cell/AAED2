// PDF Generator for Alwafa ERP - Bilingual (Arabic/English) Professional Documents
// Returns HTML strings for inline preview + supports open-in-window
import { toEnglishDigits } from "./numberUtils";
import { renderWithCustomTemplate } from "./printTemplates/resolver";
import type { DocType } from "./printTemplates/schema";
import QRCode from "qrcode";
import { openSanitizedPdfWindow } from "./safePdfWindow";
import { buildPublicUrl } from "./publicAccessSettingsStore";

/** رابط تتبع عام آمن. المفتاح يجب أن يكون tracking_token وليس رقم الأمر أو UUID الداخلي. */
export function getTrackingUrl(trackingToken?: string): string {
  if (!trackingToken) return "";
  return buildPublicUrl(`/track/${encodeURIComponent(trackingToken)}`);
}

/** يبني QR كـ dataURL متزامناً (cache بسيط لتفادي إعادة التوليد) */
const _qrCache: Record<string, string> = {};
export async function buildTrackingQrDataUrl(trackingToken?: string): Promise<string> {
  const url = getTrackingUrl(trackingToken);
  if (!url) return "";
  if (_qrCache[url]) return _qrCache[url];
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    _qrCache[url] = dataUrl;
    return dataUrl;
  } catch {
    return "";
  }
}

/** نسخة sync تستخدم الـ cache فقط — للقوالب التي لا تستطيع await */
export function getTrackingQrFromCache(trackingToken?: string): string {
  const url = getTrackingUrl(trackingToken);
  return url ? (_qrCache[url] || "") : "";
}

/** Try custom template first; if no active template found, returns null and caller uses legacy generator. */
function tryCustomTemplate(docType: DocType, data: any, title?: string): string | null {
  try {
    return renderWithCustomTemplate(docType, data, title);
  } catch (e) {
    console.warn("[pdfGenerator] custom template render failed, fallback to legacy:", e);
    return null;
  }
}

interface InvoiceData {
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerPhone?: string;
  vehicleInfo: string;
  plateNumber: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  vat: number;
  total: number;
  notes?: string;
  /** شروط الدفع المختارة (تظهر تحت بطاقة العميل/المركبة) */
  paymentTerms?: string;
  /** عبارة "تم الدفع عبر …" تظهر في أسفل الفاتورة عند تسجيل الدفعات */
  paidVia?: string;
  /** المبلغ المدفوع والمتبقي لعرضهم في صندوق الإجماليات */
  paidTotal?: number;
  balanceDue?: number;
}

interface WorkOrderData {
  orderNumber: string;
  workOrderType?: "general_customer" | "insurance";
  trackingToken?: string;
  date: string;
  customerName: string;
  customerPhone: string;
  vehicleType: string;
  model: string;
  year: string;
  plateNumber: string;
  vin: string;
  insurance: string;
  claimNumber: string;
  serviceType: string;
  technician: string;
  status: string;
  totalCost: number;
  description?: string;
  color?: string;
  mileage?: string;
  laborCost?: number;
  partsCost?: number;
  extraExpenses?: { label: string; amount: number; notes?: string }[];
  depositApplied?: number;
  photos?: { phase: string; dataUrl: string; caption?: string }[];
  customerSignatureDataUrl?: string;
  customerSignatureName?: string;
  customerSignatureDate?: string;
}

// Bilingual stage labels: [AR, EN]
const WORK_ORDER_STAGES: [string, string][] = [
  ["تحت الفحص", "Under Inspection"],
  ["بانتظار الموافقة", "Awaiting Approval"],
  ["بانتظار قطع الغيار", "Awaiting Parts"],
  ["تحت الإصلاح", "Under Repair"],
  ["ضبط الجودة", "Quality Control"],
  ["جاهز للتسليم", "Ready for Delivery"],
  ["تم التسليم", "Delivered"],
];

interface InspectionData {
  inspectionId: string;
  workOrderId: string;
  date: string;
  customerName: string;
  vehicleInfo: string;
  damageType: string;
  photoCount: number;
  status: string;
  notes?: string;
}

// Stamp & signature configuration
export type StampPosition = "bottom-right" | "bottom-left" | "bottom-center" | "watermark-center";
export type StampSize = "sm" | "md" | "lg";

// Template settings stored in localStorage
export interface PdfTemplateSettings {
  companyName: string;
  companyNameEn: string;
  commercialReg: string;
  vatNumber: string;
  phone: string;
  email: string;
  address: string;
  addressEn?: string;
  vatRate: number;
  /** تفعيل/تعطيل الضريبة على المستندات افتراضياً */
  taxEnabled?: boolean;
  /** اسم الضريبة (يظهر في الفاتورة) */
  taxName?: string;
  taxNameEn?: string;
  /** إذا true: السعر شامل الضريبة (Inclusive)، وإلا فالضريبة تضاف فوق السعر */
  taxInclusive?: boolean;
  /** عملة العرض (مثل: ر.ع، SAR، AED) */
  currencySymbol?: string;
  /** كود العملة الدولي للمستندات الإنجليزية */
  currencyCode?: string;
  /** عدد الخانات العشرية (الأصفار بعد الفاصلة) */
  decimals?: number;
  /** بادئة الدولة الافتراضية لأرقام الهواتف (بدون +)، مثل 968 */
  defaultCountryCode?: string;
  logoUrl?: string;
  primaryColor: string;
  showWatermark: boolean;
  footerText: string;

  // ===== Stamp & signature =====
  stampUrl?: string;            // ختم الورشة
  signatureUrl?: string;        // التوقيع
  responsibleName?: string;     // اسم المسؤول النصي تحت التوقيع
  stampEnabled: boolean;        // التشغيل العام للختم/التوقيع
  stampPosition: StampPosition; // الموضع
  stampSize: StampSize;         // الحجم
  // التشغيل/الإيقاف لكل نوع مستند
  stampOnInvoice: boolean;
  stampOnQuote: boolean;
  stampOnVoucher: boolean;
  stampOnReport: boolean;
  stampOnWorkOrder: boolean;
  stampOnInspection: boolean;
}

const DEFAULT_SETTINGS: PdfTemplateSettings = {
  companyName: "شركة الوفاء للأعمال المتكاملة",
  companyNameEn: "Alwafa Integrated Services",
  commercialReg: "XXXXXXXXXX",
  vatNumber: "OM1XXXXXXXXX",
  phone: "+968 9XXX XXXX",
  email: "info@alwafa.om",
  address: "مسقط، سلطنة عمان",
  addressEn: "Muscat, Sultanate of Oman",
  vatRate: 5,
  taxEnabled: true,
  taxName: "ضريبة القيمة المضافة",
  taxNameEn: "VAT",
  taxInclusive: false,
  currencySymbol: "ر.ع",
  currencyCode: "OMR",
  decimals: 3,
  defaultCountryCode: "968",
  primaryColor: "#d4a537",
  showWatermark: true,
  footerText: "",
  stampEnabled: false,
  stampPosition: "bottom-center",
  stampSize: "md",
  stampOnInvoice: true,
  stampOnQuote: true,
  stampOnVoucher: true,
  stampOnReport: true,
  stampOnWorkOrder: false,
  stampOnInspection: false,
  responsibleName: "",
};

export const STAMP_SIZE_PX: Record<StampSize, number> = { sm: 100, md: 150, lg: 200 };

// In-memory cache + listeners so async cloud loads can notify open screens.
const TEMPLATE_KEY = "pdf_template_settings";
const CLOUD_KEY = "company_template_settings_v1";
let templateCache: PdfTemplateSettings | null = null;
const templateListeners = new Set<() => void>();

export function getTemplateSettings(): PdfTemplateSettings {
  if (templateCache) return templateCache;
  try {
    const saved = localStorage.getItem(TEMPLATE_KEY);
    if (saved) {
      templateCache = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      return templateCache!;
    }
  } catch {}
  templateCache = { ...DEFAULT_SETTINGS };
  return templateCache;
}

export function subscribeTemplateSettings(cb: () => void): () => void {
  templateListeners.add(cb);
  return () => { templateListeners.delete(cb); };
}

export function saveTemplateSettings(settings: PdfTemplateSettings) {
  templateCache = { ...settings };
  try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(settings)); } catch {}
  templateListeners.forEach((cb) => { try { cb(); } catch {} });
  // Fire-and-forget cloud persistence so data survives cache clears + syncs across devices.
  import("./cloudSettings").then(({ writeCloudSetting }) =>
    writeCloudSetting(CLOUD_KEY, settings).catch(() => {})
  ).catch(() => {});
}

/** Load company/template settings from cloud and merge into local cache.
 *  Call after sign-in and once at app startup. Safe to call multiple times. */
export async function loadTemplateSettingsFromCloud(): Promise<void> {
  try {
    const { readCloudSetting, writeCloudSetting } = await import("./cloudSettings");
    const cloud = await readCloudSetting<Partial<PdfTemplateSettings> | null>(CLOUD_KEY, null);
    if (cloud && typeof cloud === "object") {
      const merged = { ...DEFAULT_SETTINGS, ...cloud } as PdfTemplateSettings;
      templateCache = merged;
      try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(merged)); } catch {}
      templateListeners.forEach((cb) => { try { cb(); } catch {} });
    } else {
      // First time on cloud — push current local copy up so it isn't lost on cache clear.
      const local = getTemplateSettings();
      await writeCloudSetting(CLOUD_KEY, local).catch(() => {});
    }
  } catch { /* offline / not signed in — keep local */ }
}


// Bilingual label helper
const bi = (ar: string, en: string) =>
  `<span class="bi"><span class="ar">${ar}</span><span class="en">${en}</span></span>`;

function getBaseStyles(s: PdfTemplateSettings) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Noto Sans Arabic','Inter','Segoe UI',Tahoma,sans-serif;direction:rtl;color:#1a1a2e;background:#f8f9fa;padding:0}
    .page{width:210mm;min-height:297mm;margin:10mm auto;background:white;padding:15mm 18mm;box-shadow:0 2px 20px rgba(0,0,0,0.1);position:relative}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${s.primaryColor};padding-bottom:15px;margin-bottom:25px}
    .company-info h1{font-size:20px;font-weight:700;color:#1a1a2e;margin-bottom:2px}
    .company-info .en-name{font-size:13px;color:#444;font-weight:600;margin-bottom:6px;font-family:'Inter',sans-serif;letter-spacing:0.3px}
    .company-info .details{font-size:9.5px;color:#888;line-height:1.7}
    .company-info .details .en-line{font-family:'Inter',sans-serif;direction:ltr;text-align:right;display:block}
    .doc-badge{background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor,-15)});color:white;padding:10px 20px;border-radius:8px;text-align:center;min-width:160px}
    .doc-badge .label-ar{font-size:11px;opacity:0.95;font-weight:600}
    .doc-badge .label-en{font-size:9px;opacity:0.85;font-family:'Inter',sans-serif;letter-spacing:0.5px;text-transform:uppercase}
    .doc-badge .number{font-size:17px;font-weight:700;direction:ltr;font-family:'Inter',sans-serif;margin:3px 0}
    .doc-badge .date{font-size:9.5px;opacity:0.85;font-family:'Inter',sans-serif;direction:ltr}

    .section-title{font-size:13px;font-weight:600;color:${s.primaryColor};border-right:3px solid ${s.primaryColor};padding-right:10px;margin:18px 0 10px 0;display:flex;align-items:baseline;gap:10px}
    .section-title .en{font-size:10px;color:#888;font-weight:500;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:0.8px}

    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px;margin-bottom:18px}
    .info-row{display:flex;gap:8px;font-size:11.5px;padding:3px 0;align-items:baseline}
    .info-row .label{color:#888;min-width:130px;font-weight:500;font-size:11px}
    .info-row .label .en{font-size:9px;color:#aaa;font-family:'Inter',sans-serif;display:block;line-height:1}
    .info-row .value{color:#1a1a2e;font-weight:600;flex:1}

    .bi{display:inline-flex;flex-direction:column;line-height:1.15}
    .bi .ar{font-size:inherit}
    .bi .en{font-size:0.78em;color:#999;font-family:'Inter',sans-serif;font-weight:500;letter-spacing:0.3px}

    table{width:100%;border-collapse:collapse;margin:12px 0;font-size:11.5px;page-break-inside:auto}
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    tr,td,th{page-break-inside:avoid;break-inside:avoid}
    thead th{background:#1a1a2e;color:white;padding:9px 10px;text-align:right;font-weight:600;font-size:10.5px;vertical-align:top}
    thead th .en{display:block;font-size:8.5px;color:#bbb;font-family:'Inter',sans-serif;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;margin-top:1px}
    thead th:first-child{border-radius:0 6px 6px 0}
    thead th:last-child{border-radius:6px 0 0 6px}
    tbody td{padding:9px 10px;border-bottom:1px solid #eee}
    tbody tr:hover{background:#fafafa}

    .totals-box{margin-top:18px;margin-right:auto;width:280px;border:2px solid #eee;border-radius:8px;overflow:hidden}
    .totals-row{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;font-size:11.5px;gap:10px}
    .totals-row:not(:last-child){border-bottom:1px solid #eee}
    .totals-row .amount{font-family:'Inter',sans-serif;font-weight:600;direction:ltr}
    .totals-row.total{background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor,-15)});color:white;font-weight:700;font-size:13.5px}

    .notes-box{margin-top:18px;padding:11px 14px;background:#f8f9fa;border-radius:8px;border-right:3px solid ${s.primaryColor};font-size:10.5px;color:#555;line-height:1.7}
    .notes-box .label-en{display:block;font-size:9px;color:#999;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px}

    .footer{position:absolute;bottom:12mm;left:18mm;right:18mm;text-align:center;font-size:8.5px;color:#aaa;border-top:1px solid #eee;padding-top:8px;line-height:1.6}
    .footer .en{display:block;font-family:'Inter',sans-serif;color:#bbb}

    .status-badge{display:inline-flex;flex-direction:column;align-items:center;padding:4px 12px;border-radius:14px;font-size:10.5px;font-weight:600;line-height:1.2}
    .status-badge .en{font-size:8.5px;font-weight:500;font-family:'Inter',sans-serif;opacity:0.85}
    .status-completed{background:#d4edda;color:#155724}
    .status-progress{background:#fff3cd;color:#856404}
    .status-pending{background:#cce5ff;color:#004085}

    .watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:70px;font-weight:700;color:rgba(212,165,55,0.05);pointer-events:none;white-space:nowrap;font-family:'Inter',sans-serif}

    .currency{font-family:'Inter',sans-serif;direction:ltr;display:inline-block}

    @media print{body{background:white;padding:0}.page{margin:0;box-shadow:none;width:100%}}
  `;
}

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

function wrapHtml(title: string, styles: string, body: string): string {
  // ضمان عدم ظهور أرقام عربية هندية في أي مكان من المستند بعد التوليد
  const enforced = toEnglishDigits(body);
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>${toEnglishDigits(title)}</title><style>${styles}</style></head><body>${enforced}</body></html>`;
}

// Currency formatter — English digits, OMR-style with configurable decimals + symbol
const omr = (n: number) => {
  const s = getTemplateSettings();
  const d = Math.max(0, Math.min(6, s.decimals ?? 3));
  const v = (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `<span class="currency">${toEnglishDigits(v)} ${s.currencyCode || "OMR"}</span>`;
};

/** Centralized money formatter for UI — respects currency + decimals from settings */
export function formatMoney(n: number, opts?: { withSymbol?: boolean }): string {
  const s = getTemplateSettings();
  const d = Math.max(0, Math.min(6, s.decimals ?? 3));
  const v = (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return opts?.withSymbol === false ? v : `${v} ${s.currencySymbol || "ر.ع"}`;
}

function headerHtml(s: PdfTemplateSettings, docLabelAr: string, docLabelEn: string, docNumber: string, docDate: string, badgeStyle = "") {
  const logoBlock = s.logoUrl
    ? `<img src="${s.logoUrl}" alt="logo" style="max-height:62px;max-width:140px;object-fit:contain;margin-bottom:8px;display:block;" />`
    : '';
  return `
    <div class="header">
      <div class="company-info">
        ${logoBlock}
        <h1>${s.companyName}</h1>
        <div class="en-name">${s.companyNameEn}</div>
        <div class="details">
          السجل التجاري / CR: ${s.commercialReg}<br/>
          الرقم الضريبي / VAT: ${s.vatNumber}<br/>
          ${s.phone} • ${s.email}<br/>
          ${s.address}${s.addressEn ? `<span class="en-line">${s.addressEn}</span>` : ''}
        </div>
      </div>
      <div class="doc-badge" ${badgeStyle ? `style="${badgeStyle}"` : ''}>
        <div class="label-ar">${docLabelAr}</div>
        <div class="label-en">${docLabelEn}</div>
        <div class="number">${docNumber}</div>
        <div class="date">${docDate}</div>
      </div>
    </div>`;
}

function footerHtml(s: PdfTemplateSettings) {
  if (s.footerText) {
    return `<div class="footer">${s.footerText}</div>`;
  }
  return `<div class="footer">
    ${s.companyName} • جميع الحقوق محفوظة © ${new Date().getFullYear()}
    <span class="en">${s.companyNameEn} • All Rights Reserved © ${new Date().getFullYear()}</span>
  </div>`;
}

/**
 * Renders the stamp + signature block based on template settings.
 * @param docType - which document type (toggles read from settings)
 */
export function stampSignatureHtml(
  s: PdfTemplateSettings,
  docType: "invoice" | "quote" | "voucher" | "report" | "workOrder" | "inspection"
): string {
  if (!s.stampEnabled) return "";
  const enabledMap: Record<typeof docType, boolean> = {
    invoice: s.stampOnInvoice,
    quote: s.stampOnQuote,
    voucher: s.stampOnVoucher,
    report: s.stampOnReport,
    workOrder: s.stampOnWorkOrder,
    inspection: s.stampOnInspection,
  };
  if (!enabledMap[docType]) return "";
  if (!s.stampUrl && !s.signatureUrl) return "";

  const size = STAMP_SIZE_PX[s.stampSize] || 150;
  const stampImg = s.stampUrl
    ? `<img src="${s.stampUrl}" alt="ختم" style="max-width:${size}px;max-height:${size}px;object-fit:contain;display:block;" />`
    : "";
  const sigImg = s.signatureUrl
    ? `<img src="${s.signatureUrl}" alt="توقيع" style="max-width:${size}px;max-height:${Math.round(size * 0.55)}px;object-fit:contain;display:block;" />`
    : "";
  const respName = s.responsibleName
    ? `<div style="font-size:10px;color:#555;font-weight:600;margin-top:4px;text-align:center;">${s.responsibleName}</div>`
    : "";

  // Watermark behind content
  if (s.stampPosition === "watermark-center" && s.stampUrl) {
    return `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-12deg);opacity:0.12;pointer-events:none;z-index:0;">
      <img src="${s.stampUrl}" alt="ختم" style="max-width:${size * 1.6}px;max-height:${size * 1.6}px;object-fit:contain;" />
    </div>`;
  }

  // Block: stamp on top of signature, with name below
  const block = `
    <div style="display:inline-flex;flex-direction:column;align-items:center;gap:6px;">
      ${stampImg}
      ${sigImg}
      ${respName}
    </div>`;

  let containerStyle = "margin-top:30px;display:flex;page-break-inside:avoid;";
  if (s.stampPosition === "bottom-right") containerStyle += "justify-content:flex-end;";
  else if (s.stampPosition === "bottom-left") containerStyle += "justify-content:flex-start;";
  else containerStyle += "justify-content:center;"; // bottom-center

  return `<div style="${containerStyle}">${block}</div>`;
}

// Bilingual label cell
const lbl = (ar: string, en: string) =>
  `<span class="label">${ar}<span class="en">${en}</span></span>`;

const sectionTitle = (ar: string, en: string) =>
  `<div class="section-title">${ar}<span class="en">${en}</span></div>`;

const th = (ar: string, en: string, extraStyle = "") =>
  `<th${extraStyle ? ` style="${extraStyle}"` : ''}>${ar}<span class="en">${en}</span></th>`;

// ===== INVOICE =====
export function getInvoiceHtml(data: InvoiceData): string {
  const custom = tryCustomTemplate("tax_invoice", { ...data, ...getTemplateSettings(), date: data.date }, `Invoice ${data.invoiceNumber}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const itemsHtml = data.items.map((item, i) => `
    <tr>
      <td style="text-align:center;color:#888;">${i + 1}</td>
      <td>${item.description}</td>
      <td style="text-align:center;">${item.quantity}</td>
      <td style="text-align:center;">${omr(item.unitPrice)}</td>
      <td style="text-align:center;font-weight:600;">${omr(item.total)}</td>
    </tr>`).join('');

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'فاتورة ضريبية', 'TAX INVOICE', data.invoiceNumber, data.date)}

    <div style="margin:8px 0 12px;display:flex;gap:10px;">
      <div style="flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;background:#f9fafb;">
        <div style="font-size:9px;color:#6b7280;font-weight:700;letter-spacing:0.4px;margin-bottom:4px;">العميل · CUSTOMER</div>
        <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:2px;">${data.customerName || '—'}</div>
        <div style="font-size:9.5px;color:#4b5563;direction:ltr;text-align:right;font-family:'Inter',sans-serif;">${data.customerPhone || ''}</div>
      </div>
      <div style="flex:1.2;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;background:#f9fafb;">
        <div style="font-size:9px;color:#6b7280;font-weight:700;letter-spacing:0.4px;margin-bottom:4px;">المركبة · VEHICLE</div>
        <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:2px;">${data.vehicleInfo || '—'}</div>
        <div style="font-size:9.5px;color:#4b5563;">رقم اللوحة: <span style="font-family:monospace;font-weight:700;color:#111827;">${data.plateNumber || '—'}</span></div>
      </div>
    </div>

    ${data.paymentTerms ? `
    <div style="margin:0 0 10px;padding:6px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:10px;color:#1e3a8a;">
      <strong>شروط الدفع · Payment Terms:</strong> ${data.paymentTerms}
    </div>` : ''}

    ${sectionTitle('تفاصيل الفاتورة', 'Invoice Details')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:40px;text-align:center;')}
      ${th('الوصف', 'Description')}
      ${th('الكمية', 'Qty', 'width:60px;text-align:center;')}
      ${th('السعر', 'Unit Price', 'width:130px;text-align:center;')}
      ${th('المجموع', 'Total', 'width:140px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('المجموع الفرعي', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      <div class="totals-row"><span>${bi(`ضريبة القيمة المضافة (${s.vatRate}%)`, `VAT (${s.vatRate}%)`)}</span><span class="amount">${omr(data.vat)}</span></div>
      <div class="totals-row total"><span>${bi('الإجمالي', 'Grand Total')}</span><span class="amount">${omr(data.total)}</span></div>
      ${(data.paidTotal ?? 0) > 0 ? `
      <div class="totals-row" style="color:#059669;"><span>${bi('المدفوع', 'Paid')}</span><span class="amount">${omr(data.paidTotal!)}</span></div>
      <div class="totals-row" style="color:#dc2626;font-weight:700;"><span>${bi('المتبقي', 'Balance Due')}</span><span class="amount">${omr(data.balanceDue ?? Math.max(0, data.total - (data.paidTotal || 0)))}</span></div>
      ` : ''}
    </div>

    ${data.paidVia ? `
    <div style="margin-top:14px;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;font-size:11px;color:#065f46;text-align:center;font-weight:700;">
      ✓ تم الدفع عبر: ${data.paidVia} &nbsp;·&nbsp; Paid via: ${data.paidVia}
    </div>` : ''}

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes</span><strong>ملاحظات:</strong> ${data.notes}</div>` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">توقيع العميل<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المحاسب المسؤول<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Accountant</span></div></div>
    </div>

    ${stampSignatureHtml(s, "invoice")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Invoice ${data.invoiceNumber}`, getBaseStyles(s), body);
}

export function generateInvoicePdf(data: InvoiceData) {
  const html = getInvoiceHtml(data);
  openSanitizedPdfWindow(html);
}

// ===== WORK ORDER =====
export function getWorkOrderHtml(data: WorkOrderData): string {
  const custom = tryCustomTemplate("work_order", { ...data, ...getTemplateSettings(), totalCost: data.totalCost }, `WorkOrder ${data.orderNumber}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const statusClass = data.status.includes('إصلاح') || data.status.includes('Repair') ? 'status-progress'
    : data.status.includes('جاهز') || data.status.includes('تم') || data.status.includes('Ready') || data.status.includes('Delivered') ? 'status-completed'
    : data.status.includes('فحص') || data.status.includes('Inspection') ? 'status-pending'
    : 'status-progress';

  const currentStageIdx = WORK_ORDER_STAGES.findIndex(([ar]) => ar === data.status);
  const statusEn = currentStageIdx >= 0 ? WORK_ORDER_STAGES[currentStageIdx][1] : data.status;

  const timelineHtml = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin:8px 0 18px;padding:14px 6px;background:#fafafa;border-radius:8px;border:1px solid #eee;">
      ${WORK_ORDER_STAGES.map(([stageAr, stageEn], i) => {
        const done = currentStageIdx >= 0 && i <= currentStageIdx;
        const current = i === currentStageIdx;
        return `<div style="flex:1;text-align:center;position:relative;">
          <div style="width:26px;height:26px;border-radius:50%;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:'Inter',sans-serif;${
            done
              ? `background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor, -15)});color:white;`
              : 'background:#e5e5e5;color:#999;'
          }${current ? `box-shadow:0 0 0 3px ${s.primaryColor}33;` : ''}">${i + 1}</div>
          <div style="font-size:8px;color:${current ? s.primaryColor : '#888'};font-weight:${current ? '700' : '500'};line-height:1.25;">${stageAr}</div>
          <div style="font-size:7px;color:#aaa;font-family:'Inter',sans-serif;line-height:1.2;margin-top:1px;">${stageEn}</div>
          ${i < WORK_ORDER_STAGES.length - 1 ? `<div style="position:absolute;top:12px;right:-50%;width:100%;height:2px;background:${done && currentStageIdx > i ? s.primaryColor : '#e5e5e5'};z-index:-1;"></div>` : ''}
        </div>`;
      }).join('')}
    </div>`;

  const laborCost = data.laborCost ?? 0;
  const partsCost = data.partsCost ?? 0;
  const extras = data.extraExpenses || [];
  const extrasTotal = extras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const deposit = Number(data.depositApplied) || 0;
  const subtotal = laborCost + partsCost + extrasTotal || data.totalCost;
  const vat = Number((subtotal * (s.vatRate / 100)).toFixed(3));
  // ⚠️ المحاسبة: الإجمالي = subtotal + VAT الكامل. الدفعة لا تُخصم من الإيراد.
  const grandTotal = Number((subtotal + vat).toFixed(3));
  const balanceDue = Number(Math.max(0, grandTotal - deposit).toFixed(3));

  const extrasRowsHtml = extras.length === 0 ? '' : extras.map((e) => `
    <tr>
      <td style="padding-right:24px;color:#555;">↳ ${e.label}${e.notes ? ` <span style="color:#aaa;font-size:9.5px;">(${e.notes})</span>` : ''}</td>
      <td style="text-align:left;font-weight:600;">${omr(Number(e.amount) || 0)}</td>
    </tr>
  `).join('');

  const orderType = data.workOrderType === "insurance" ? "insurance" : "general_customer";
  const typeBadge = orderType === "insurance"
    ? `<span style="display:inline-block;padding:5px 10px;border-radius:999px;background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;font-size:10px;font-weight:700;">🛡 INSURANCE</span>`
    : `<span style="display:inline-block;padding:5px 10px;border-radius:999px;background:#dcfce7;color:#047857;border:1px solid #86efac;font-size:10px;font-weight:700;">🚗 GENERAL / CASH</span>`;
  const trackUrl = getTrackingUrl(data.trackingToken);
  const qrDataUrl = getTrackingQrFromCache(data.trackingToken);
  const qrCardHtml = qrDataUrl ? `
    <div style="display:flex;align-items:center;gap:14px;padding:10px 14px;margin:0 0 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
      <img src="${qrDataUrl}" alt="QR" style="width:90px;height:90px;flex-shrink:0;border-radius:6px;background:#fff;padding:4px;border:1px solid #e2e8f0;" />
      <div style="flex:1;">
        <div style="font-size:11px;font-weight:700;color:${s.primaryColor};margin-bottom:3px;">تتبع حالة السيارة <span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;font-weight:500;">/ Track Vehicle Status</span></div>
        <div style="font-size:9.5px;color:#555;line-height:1.55;">امسح الرمز بكاميرا الجوال لمتابعة مراحل الإصلاح والصور لحظياً.<br/><span style="font-family:'Inter',sans-serif;color:#888;">Scan with your phone camera to follow repair stages and photos in real-time.</span></div>
        <div style="font-size:8.5px;color:#888;font-family:monospace;margin-top:3px;direction:ltr;text-align:left;word-break:break-all;">${trackUrl}</div>
      </div>
    </div>` : '';

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'أمر عمل', 'WORK ORDER', data.orderNumber, data.date)}
    <div style="display:flex;justify-content:flex-end;margin:-4px 0 10px;">${typeBadge}</div>
    ${qrCardHtml}

    ${sectionTitle('مسار حالة الإصلاح', 'Repair Status Timeline')}
    ${timelineHtml}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div style="padding:10px 14px;background:#fafafa;border-right:3px solid ${s.primaryColor};border-radius:6px;">
        <div style="font-size:11px;font-weight:600;color:${s.primaryColor};margin-bottom:6px;">معلومات العميل <span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;font-weight:500;">/ Customer Info</span></div>
        <div class="info-row">${lbl('الاسم:', 'Name')}<span class="value">${data.customerName}</span></div>
        <div class="info-row">${lbl('الهاتف:', 'Phone')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;">${data.customerPhone}</span></div>
      </div>
      <div style="padding:10px 14px;background:#fafafa;border-right:3px solid ${s.primaryColor};border-radius:6px;">
        <div style="font-size:11px;font-weight:600;color:${s.primaryColor};margin-bottom:6px;">معلومات السيارة <span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;font-weight:500;">/ Vehicle Info</span></div>
        <div class="info-row">${lbl('النوع:', 'Make/Model')}<span class="value">${data.vehicleType} ${data.model} ${data.year}</span></div>
        <div class="info-row">${lbl('اللوحة:', 'Plate')}<span class="value">${data.plateNumber}</span></div>
        ${data.color ? `<div class="info-row">${lbl('اللون:', 'Color')}<span class="value">${data.color}</span></div>` : ''}
        ${data.mileage ? `<div class="info-row">${lbl('الكيلومترات:', 'Mileage')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;">${data.mileage} km</span></div>` : ''}
        <div class="info-row">${lbl('رقم الهيكل:', 'VIN')}<span class="value" style="direction:ltr;text-align:right;font-family:monospace;font-size:10px;">${data.vin}</span></div>
      </div>
    </div>

    ${sectionTitle('تفاصيل العمل', 'Job Details')}
    <div class="info-grid">
      <div class="info-row">${lbl('نوع الخدمة:', 'Service Type')}<span class="value">${data.serviceType}</span></div>
      <div class="info-row">${lbl('الفني المسؤول:', 'Technician')}<span class="value">${data.technician}</span></div>
      ${orderType === "insurance" ? `
      <div class="info-row">${lbl('شركة التأمين:', 'Insurance Co.')}<span class="value">${data.insurance}</span></div>
      <div class="info-row">${lbl('رقم المطالبة:', 'Claim No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.claimNumber}</span></div>` : `
      <div class="info-row">${lbl('نوع الأمر:', 'Order Type')}<span class="value">عميل عام / General Customer</span></div>`}
      <div class="info-row">${lbl('الحالة الحالية:', 'Current Status')}<span class="value"><span class="status-badge ${statusClass}">${data.status}<span class="en">${statusEn}</span></span></span></div>
    </div>

    ${data.description ? `<div class="notes-box"><span class="label-en">Diagnosis / Notes</span><strong>التشخيص / ملاحظات:</strong> ${data.description}</div>` : ''}

    ${sectionTitle('التكلفة', 'Cost Breakdown')}
    <table>
      <thead><tr>
        ${th('البيان', 'Description', 'width:60%;')}
        ${th('القيمة', 'Amount', 'text-align:left;')}
      </tr></thead>
      <tbody>
        <tr><td>${bi('أجور العمالة', 'Labor Cost')}</td><td style="text-align:left;font-weight:600;">${omr(laborCost)}</td></tr>
        <tr><td>${bi('قطع الغيار', 'Parts Cost')}</td><td style="text-align:left;font-weight:600;">${omr(partsCost)}</td></tr>
        ${extras.length > 0 ? `<tr><td>${bi('مصروفات إضافية', 'Extra Expenses')}</td><td style="text-align:left;font-weight:600;">${omr(extrasTotal)}</td></tr>${extrasRowsHtml}` : ''}
        <tr><td>${bi('المجموع الفرعي', 'Subtotal')}</td><td style="text-align:left;font-weight:600;">${omr(subtotal)}</td></tr>
        <tr><td>${bi(`ضريبة القيمة المضافة (${s.vatRate}%)`, `VAT (${s.vatRate}%)`)}</td><td style="text-align:left;font-weight:600;">${omr(vat)}</td></tr>
      </tbody>
    </table>
    <div class="totals-box">
      <div class="totals-row total"><span>${bi('إجمالي الفاتورة', 'Invoice Total')}</span><span class="amount">${omr(grandTotal)}</span></div>
      ${deposit > 0 ? `
      <div class="totals-row" style="color:#2d6a4f;"><span>${bi('دفعة مستلمة (دخل)', 'Payment Received')}</span><span class="amount">+ ${omr(deposit)}</span></div>
      <div class="totals-row total" style="color:#b45309;"><span>${bi('الرصيد المستحق', 'Balance Due')}</span><span class="amount">${omr(balanceDue)}</span></div>
      ` : ''}
    </div>

    ${(() => {
      const photos = data.photos || [];
      if (photos.length === 0) return '';
      const stageMap: Record<string, [string, string]> = {
        received: ['استلام', 'Received'],
        inspection: ['فحص', 'Inspection'],
        in_progress: ['تحت الإصلاح', 'In Progress'],
        quality: ['ضبط الجودة', 'Quality Check'],
        delivery: ['تسليم', 'Delivery'],
      };
      const orderArr: string[] = ['received', 'inspection', 'in_progress', 'quality', 'delivery'];
      const grouped = orderArr
        .map(phase => ({ phase, list: photos.filter(p => p.phase === phase) }))
        .filter(g => g.list.length > 0);
      if (grouped.length === 0) return '';
      const sections = grouped.map(({ phase, list }) => {
        const [ar, en] = stageMap[phase] || [phase, phase];
        const grid = list.map(p => `
          <div style="break-inside:avoid;border:1px solid #e5e5e5;border-radius:6px;overflow:hidden;background:#fafafa;">
            <img src="${p.dataUrl}" alt="" style="width:100%;height:110px;object-fit:cover;display:block;" />
            ${p.caption ? `<div style="padding:4px 6px;font-size:8.5px;color:#666;line-height:1.3;">${p.caption}</div>` : ''}
          </div>`).join('');
        return `
          <div style="margin-bottom:14px;break-inside:avoid;">
            <div style="font-size:11px;font-weight:600;color:${s.primaryColor};margin-bottom:6px;padding:5px 10px;background:${s.primaryColor}15;border-right:3px solid ${s.primaryColor};border-radius:4px;">
              ${ar} <span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;font-weight:500;">/ ${en}</span>
              <span style="float:left;font-size:9px;color:#888;font-family:'Inter',sans-serif;">${list.length} ${list.length === 1 ? 'photo' : 'photos'}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">${grid}</div>
          </div>`;
      }).join('');
      return `
        ${sectionTitle('صور مراحل العمل', 'Work Stage Photos')}
        <div style="page-break-inside:auto;">${sections}</div>
      `;
    })()}

    <div style="margin-top:40px;display:flex;justify-content:space-between;page-break-inside:avoid;">
      <div style="text-align:center;width:170px;">
        ${data.customerSignatureDataUrl
          ? `<img src="${data.customerSignatureDataUrl}" alt="customer signature" style="max-width:160px;max-height:60px;object-fit:contain;display:block;margin:0 auto 4px;" />`
          : `<div style="height:60px;"></div>`}
        <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">
          توقيع العميل<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span>
          ${data.customerSignatureName ? `<div style="font-size:9px;color:#555;margin-top:2px;">${data.customerSignatureName}</div>` : ''}
          ${data.customerSignatureDate ? `<div style="font-size:8.5px;color:#888;font-family:monospace;">${data.customerSignatureDate}</div>` : ''}
        </div>
      </div>
      <div style="text-align:center;width:170px;"><div style="height:60px;"></div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">الفني المسؤول<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Technician</span></div></div>
      <div style="text-align:center;width:170px;"><div style="height:60px;"></div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">مدير الورشة<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Workshop Manager</span></div></div>
    </div>
    ${stampSignatureHtml(s, "workOrder")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Work Order ${data.orderNumber}`, getBaseStyles(s), body);
}

export async function generateWorkOrderPdf(data: WorkOrderData) {
  // ابنِ QR التتبع مسبقاً قبل توليد الـ HTML
  await buildTrackingQrDataUrl(data.trackingToken);
  const html = getWorkOrderHtml(data);
  openSanitizedPdfWindow(html);
}

// ===== INSPECTION =====
export function getInspectionHtml(data: InspectionData): string {
  const custom = tryCustomTemplate("inspection", { ...data, ...getTemplateSettings() }, `Inspection ${data.inspectionId}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const statusEn = data.status === 'مكتمل' ? 'Completed' : data.status === 'قيد التنفيذ' ? 'In Progress' : data.status;
  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'تقرير فحص ومعاينة', 'INSPECTION REPORT', data.inspectionId, data.date)}

    ${sectionTitle('معلومات الفحص', 'Inspection Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('رقم أمر العمل:', 'Work Order No.')}<span class="value">${data.workOrderId}</span></div>
      <div class="info-row">${lbl('العميل:', 'Customer')}<span class="value">${data.customerName}</span></div>
      <div class="info-row">${lbl('السيارة:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>
      <div class="info-row">${lbl('نوع الضرر:', 'Damage Type')}<span class="value">${data.damageType}</span></div>
      <div class="info-row">${lbl('عدد الصور:', 'Photos Count')}<span class="value">${data.photoCount} ${bi('صورة', 'photos')}</span></div>
      <div class="info-row">${lbl('الحالة:', 'Status')}<span class="value"><span class="status-badge ${data.status === 'مكتمل' ? 'status-completed' : 'status-progress'}">${data.status}<span class="en">${statusEn}</span></span></span></div>
    </div>

    ${sectionTitle('تفاصيل الأضرار', 'Damage Details')}
    <div style="border:2px dashed #ddd;border-radius:12px;padding:30px;text-align:center;margin:12px 0;min-height:180px;display:flex;align-items:center;justify-content:center;">
      <div style="color:#aaa;font-size:12px;">
        <div style="font-size:40px;margin-bottom:8px;">🚗</div>
        مخطط الأضرار على السيارة
        <div style="font-family:'Inter',sans-serif;font-size:10px;margin-top:3px;">Vehicle Damage Diagram</div>
      </div>
    </div>

    ${data.notes
      ? `<div class="notes-box"><span class="label-en">Inspector Notes</span><strong>ملاحظات الفاحص:</strong> ${data.notes}</div>`
      : `<div class="notes-box"><span class="label-en">Inspector Notes</span><strong>ملاحظات الفاحص:</strong> تم فحص السيارة وتوثيق الأضرار الموضحة أعلاه. / Vehicle inspected and damages documented above.</div>`}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">توقيع الفاحص<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Inspector Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">توقيع المدير<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Manager Signature</span></div></div>
    </div>
    ${stampSignatureHtml(s, "inspection")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Inspection ${data.inspectionId}`, getBaseStyles(s), body);
}

export function generateInspectionPdf(data: InspectionData) {
  const html = getInspectionHtml(data);
  openSanitizedPdfWindow(html);
}

// ===== QUOTE =====
export function getQuoteHtml(data: InvoiceData & { quoteNumber: string }): string {
  const custom = tryCustomTemplate("quote", { ...data, ...getTemplateSettings() }, `Quote ${data.quoteNumber}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const itemsHtml = data.items.map((item, i) => `
    <tr>
      <td style="text-align:center;color:#888;">${i + 1}</td>
      <td>${item.description}</td>
      <td style="text-align:center;">${item.quantity}</td>
      <td style="text-align:center;">${omr(item.unitPrice)}</td>
      <td style="text-align:center;font-weight:600;">${omr(item.total)}</td>
    </tr>`).join('');

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'عرض سعر', 'PRICE QUOTATION', data.quoteNumber, data.date, 'background:linear-gradient(135deg,#2d6a4f,#1b4332);')}

    ${sectionTitle('معلومات العميل', 'Customer Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('اسم العميل:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      <div class="info-row">${lbl('السيارة:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>
      <div class="info-row">${lbl('رقم اللوحة:', 'Plate Number')}<span class="value">${data.plateNumber}</span></div>
    </div>

    ${sectionTitle('تفاصيل العرض', 'Quotation Details')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:40px;text-align:center;')}
      ${th('الوصف', 'Description')}
      ${th('الكمية', 'Qty', 'width:60px;text-align:center;')}
      ${th('السعر', 'Unit Price', 'width:130px;text-align:center;')}
      ${th('المجموع', 'Total', 'width:140px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('المجموع الفرعي', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      <div class="totals-row"><span>${bi(`ضريبة القيمة المضافة (${s.vatRate}%)`, `VAT (${s.vatRate}%)`)}</span><span class="amount">${omr(data.vat)}</span></div>
      <div class="totals-row total"><span>${bi('الإجمالي', 'Grand Total')}</span><span class="amount">${omr(data.total)}</span></div>
    </div>

    <div class="notes-box">
      <span class="label-en">Quote Terms &amp; Conditions</span>
      <strong>شروط العرض:</strong><br/>
      • هذا العرض ساري المفعول لمدة 15 يوماً من تاريخ الإصدار. <span style="color:#999;font-family:'Inter',sans-serif;">/ This quote is valid for 15 days from the issue date.</span><br/>
      • الأسعار شاملة ضريبة القيمة المضافة. <span style="color:#999;font-family:'Inter',sans-serif;">/ Prices are inclusive of VAT.</span><br/>
      • يتم البدء بالعمل بعد اعتماد العرض من قبل العميل. <span style="color:#999;font-family:'Inter',sans-serif;">/ Work commences upon customer approval.</span>
    </div>

    <div style="margin-top:40px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">توقيع العميل<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المدير المسؤول<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Authorized Manager</span></div></div>
    </div>

    ${stampSignatureHtml(s, "quote")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Quote ${data.quoteNumber}`, getBaseStyles(s), body);
}

export function generateQuotePdf(data: InvoiceData & { quoteNumber: string }) {
  const html = getQuoteHtml(data);
  openSanitizedPdfWindow(html);
}

// ===== DEPOSIT RECEIPT =====
export interface DepositReceiptData {
  receiptNumber: string;
  date: string;
  customerName: string;
  customerPhone?: string;
  plateNumber?: string;
  vehicleInfo?: string;
  amount: number;
  paymentMethod: string;
  scope: "customer" | "vehicle";
  notes?: string;
}

export function getDepositReceiptHtml(data: DepositReceiptData): string {
  const custom = tryCustomTemplate("deposit_receipt", { ...data, ...getTemplateSettings() }, `Deposit ${data.receiptNumber}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const scopeLabel = data.scope === "vehicle" ? "عربون مرتبط بسيارة" : "عربون عام للعميل";
  const scopeLabelEn = data.scope === "vehicle" ? "Vehicle-linked Deposit" : "General Customer Deposit";

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'سند قبض عربون', 'DEPOSIT RECEIPT', data.receiptNumber, data.date, 'background:linear-gradient(135deg,#2d6a4f,#1b4332);')}

    ${sectionTitle('بيانات العربون', 'Deposit Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('اسم العميل:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      ${data.customerPhone ? `<div class="info-row">${lbl('رقم الهاتف:', 'Phone')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;">${data.customerPhone}</span></div>` : ''}
      ${data.plateNumber ? `<div class="info-row">${lbl('رقم اللوحة:', 'Plate No.')}<span class="value">${data.plateNumber}</span></div>` : ''}
      ${data.vehicleInfo ? `<div class="info-row">${lbl('السيارة:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>` : ''}
      <div class="info-row">${lbl('نوع العربون:', 'Deposit Type')}<span class="value">${scopeLabel} <span style="color:#999;font-family:'Inter',sans-serif;font-size:9px;">/ ${scopeLabelEn}</span></span></div>
      <div class="info-row">${lbl('طريقة الدفع:', 'Payment Method')}<span class="value">${data.paymentMethod}</span></div>
    </div>

    <div style="margin:24px 0;padding:24px;background:linear-gradient(135deg,#2d6a4f,#1b4332);color:white;border-radius:12px;text-align:center;">
      <div style="font-size:11px;opacity:0.85;margin-bottom:6px;">المبلغ المستلم <span style="font-family:'Inter',sans-serif;">/ Amount Received</span></div>
      <div style="font-size:32px;font-weight:700;font-family:'Inter',sans-serif;direction:ltr;">${data.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} OMR</div>
    </div>

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes</span><strong>ملاحظات:</strong> ${data.notes}</div>` : ''}

    <div class="notes-box" style="margin-top:14px;background:#fff8e1;border-right-color:#d4a537;">
      <strong>تنويه:</strong> هذا المبلغ يُعتبر عربوناً ${data.scope === "vehicle" ? `مرتبطاً بالسيارة (${data.plateNumber || ""})` : "عاماً للعميل"} ويُخصم من الفاتورة النهائية لاحقاً.
      <span style="display:block;color:#999;font-family:'Inter',sans-serif;font-size:9px;margin-top:3px;">Notice: This amount is considered a ${data.scope === "vehicle" ? "vehicle-linked" : "general customer"} deposit and will be deducted from the final invoice.</span>
    </div>

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">توقيع العميل<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المحاسب<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Cashier / Accountant</span></div></div>
    </div>

    ${stampSignatureHtml(s, "voucher")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Deposit ${data.receiptNumber}`, getBaseStyles(s), body);
}

// ===== ADVANCED CUSTOM INVOICE/QUOTE (with custom fields + per-line discount/tax) =====
export interface AdvancedDocLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number; // percent
  tax: number;      // percent
}

export interface AdvancedDocData {
  docType: "invoice" | "quote";
  template: "default" | "modern" | "classic";
  number: string;
  issueDate: string;
  dueDate?: string;
  customerName: string;
  paymentTerms?: string;
  customFields: { label: string; value: string }[];
  items: AdvancedDocLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  notes?: string;
}

export function getAdvancedDocHtml(data: AdvancedDocData): string {
  const s = getTemplateSettings();
  const isInvoice = data.docType === "invoice";
  const docLabelAr = isInvoice ? "فاتورة ضريبية" : "عرض سعر";
  const docLabelEn = isInvoice ? "TAX INVOICE" : "QUOTATION";

  // Apply template variations
  const tplStyles = data.template === "modern"
    ? `.header{background:linear-gradient(135deg,${s.primaryColor}15,transparent);padding:18px;border-radius:10px;border-bottom:none;}thead th{background:${s.primaryColor};}`
    : data.template === "classic"
    ? `.header{border-bottom:4px double ${s.primaryColor};}thead th{background:#2c2c2c;}.totals-row.total{background:#2c2c2c;}`
    : "";

  const customFieldsHtml = data.customFields.filter(f => f.value).map(f => `
    <div class="info-row"><span class="label">${f.label}</span><span class="value">${f.value}</span></div>
  `).join('');

  const itemsHtml = data.items.filter(i => i.description.trim()).map((item, i) => {
    const line = item.quantity * item.unitPrice;
    const afterDisc = line - (line * item.discount) / 100;
    const lineTotal = afterDisc; // VAT shown separately in totals — never add to line
    return `<tr>
      <td style="text-align:center;color:#888;">${i + 1}</td>
      <td>${item.description}</td>
      <td style="text-align:center;">${item.quantity}</td>
      <td style="text-align:center;">${omr(item.unitPrice)}</td>
      <td style="text-align:center;color:#666;">${item.discount}%</td>
      <td style="text-align:center;color:#666;">${item.tax}%</td>
      <td style="text-align:center;font-weight:600;">${omr(lineTotal)}</td>
    </tr>`;
  }).join('');

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, docLabelAr, docLabelEn, data.number, data.issueDate)}

    ${sectionTitle('معلومات العميل', 'Customer Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('اسم العميل:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      ${data.dueDate ? `<div class="info-row">${lbl('تاريخ الاستحقاق:', 'Due Date')}<span class="value">${data.dueDate}</span></div>` : ''}
      ${data.paymentTerms ? `<div class="info-row" style="grid-column:1/-1">${lbl('شروط الدفع:', 'Payment Terms')}<span class="value">${data.paymentTerms}</span></div>` : ''}
      ${customFieldsHtml}
    </div>

    ${sectionTitle(isInvoice ? 'تفاصيل الفاتورة' : 'تفاصيل عرض السعر', isInvoice ? 'Invoice Details' : 'Quote Details')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:36px;text-align:center;')}
      ${th('الوصف', 'Description')}
      ${th('الكمية', 'Qty', 'width:55px;text-align:center;')}
      ${th('السعر', 'Price', 'width:115px;text-align:center;')}
      ${th('خصم', 'Disc', 'width:50px;text-align:center;')}
      ${th('ضريبة', 'Tax', 'width:55px;text-align:center;')}
      ${th('الإجمالي', 'Total', 'width:130px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('المجموع الفرعي', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      ${data.discountTotal > 0 ? `<div class="totals-row"><span>${bi('الخصم', 'Discount')}</span><span class="amount" style="color:#c33">- ${omr(data.discountTotal)}</span></div>` : ''}
      <div class="totals-row"><span>${bi('الضريبة', 'VAT')}</span><span class="amount">${omr(data.taxTotal)}</span></div>
      <div class="totals-row total"><span>${bi('الإجمالي', 'Grand Total')}</span><span class="amount">${omr(data.total)}</span></div>
    </div>

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes / ملاحظات</span>${data.notes}</div>` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">توقيع العميل<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">${isInvoice ? 'المحاسب المسؤول' : 'مدير المبيعات'}<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">${isInvoice ? 'Accountant' : 'Sales Manager'}</span></div></div>
    </div>

    ${stampSignatureHtml(s, isInvoice ? "invoice" : "quote")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`${docLabelEn} ${data.number}`, getBaseStyles(s) + tplStyles, body);
}

// ===== VEHICLE CARD =====
export interface VehicleCardData {
  plate: string;
  type: string;
  vin: string;
  year?: string;
  color?: string;
  mileage?: string;
  owner: string;
  ownerPhone?: string;
  visits: number;
  totalSpent: number;
  lastVisit: string;
  notes?: string;
  workOrders?: {
    orderNumber: string;
    date: string;
    serviceType: string;
    status: string;
    technician: string;
    cost: number;
    description?: string;
  }[];
  photoPairs?: {
    workOrderId?: string;
    date: string;
    beforeUrl: string;
    afterUrl: string;
    caption?: string;
  }[];
  claims?: {
    claimNumber: string;
    insuranceCompany: string;
    estimatedAmount: number;
    approvedAmount?: number;
    status: string;
  }[];
}

export function getVehicleCardHtml(data: VehicleCardData): string {
  const custom = tryCustomTemplate("vehicle_card", { ...data, ...getTemplateSettings() }, `Vehicle ${data.plate}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const today = new Date().toISOString().split("T")[0];

  const ordersHtml = (data.workOrders || []).length === 0
    ? `<div style="padding:14px;text-align:center;color:#aaa;font-size:11px;background:#fafafa;border-radius:6px;">لا يوجد سجل عمليات / No work orders</div>`
    : `<table><thead><tr>
        ${th('رقم الأمر', 'Order #', 'width:90px;')}
        ${th('التاريخ', 'Date', 'width:80px;text-align:center;')}
        ${th('نوع الخدمة', 'Service')}
        ${th('الفني', 'Technician', 'width:110px;')}
        ${th('الحالة', 'Status', 'width:90px;text-align:center;')}
        ${th('التكلفة', 'Cost', 'width:110px;text-align:center;')}
      </tr></thead><tbody>
      ${data.workOrders!.map(o => `
        <tr>
          <td style="font-family:'Inter',sans-serif;font-weight:600;color:${s.primaryColor};">${o.orderNumber}</td>
          <td style="text-align:center;font-family:'Inter',sans-serif;color:#666;">${o.date}</td>
          <td>${o.serviceType}${o.description ? `<div style="font-size:9.5px;color:#999;margin-top:2px;">${o.description}</div>` : ''}</td>
          <td style="color:#555;">${o.technician}</td>
          <td style="text-align:center;"><span style="font-size:9.5px;padding:2px 8px;border-radius:10px;background:#f0f0f0;color:#555;">${o.status}</span></td>
          <td style="text-align:center;font-weight:600;">${omr(o.cost)}</td>
        </tr>`).join('')}
      </tbody></table>`;

  const photoPairsHtml = (data.photoPairs || []).length === 0 ? '' : `
    ${sectionTitle('صور قبل / بعد', 'Before / After Photos')}
    <div style="display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:14px;">
      ${data.photoPairs!.map(p => `
        <div style="border:1px solid #eee;border-radius:8px;padding:10px;background:#fafafa;page-break-inside:avoid;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:10.5px;">
            <strong style="color:${s.primaryColor};">${p.caption || 'مرحلة الإصلاح'}</strong>
            <span style="color:#888;font-family:'Inter',sans-serif;">${p.workOrderId ? p.workOrderId + ' • ' : ''}${p.date}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <div style="font-size:9.5px;color:#888;margin-bottom:4px;text-align:center;font-weight:600;">قبل / Before</div>
              <img src="${p.beforeUrl}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" crossorigin="anonymous"/>
            </div>
            <div>
              <div style="font-size:9.5px;color:${s.primaryColor};margin-bottom:4px;text-align:center;font-weight:600;">بعد / After</div>
              <img src="${p.afterUrl}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:2px solid ${s.primaryColor};" crossorigin="anonymous"/>
            </div>
          </div>
        </div>
      `).join('')}
    </div>`;

  const claimsHtml = (data.claims || []).length === 0 ? '' : `
    ${sectionTitle('مطالبات التأمين المرتبطة', 'Linked Insurance Claims')}
    <table><thead><tr>
      ${th('رقم المطالبة', 'Claim #', 'width:110px;')}
      ${th('شركة التأمين', 'Insurance Company')}
      ${th('المقدر', 'Estimated', 'width:110px;text-align:center;')}
      ${th('المعتمد', 'Approved', 'width:110px;text-align:center;')}
      ${th('الحالة', 'Status', 'width:90px;text-align:center;')}
    </tr></thead><tbody>
    ${data.claims!.map(c => `
      <tr>
        <td style="font-family:'Inter',sans-serif;font-weight:600;">${c.claimNumber}</td>
        <td>${c.insuranceCompany}</td>
        <td style="text-align:center;">${omr(c.estimatedAmount)}</td>
        <td style="text-align:center;">${c.approvedAmount ? omr(c.approvedAmount) : '-'}</td>
        <td style="text-align:center;font-size:9.5px;">${c.status}</td>
      </tr>`).join('')}
    </tbody></table>`;

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'بطاقة سيارة', 'VEHICLE CARD', data.plate, today)}

    ${sectionTitle('معلومات السيارة والمالك', 'Vehicle & Owner Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('رقم اللوحة:', 'Plate Number')}<span class="value">${data.plate}</span></div>
      <div class="info-row">${lbl('النوع/الموديل:', 'Make/Model')}<span class="value">${data.type}</span></div>
      <div class="info-row">${lbl('السنة:', 'Year')}<span class="value">${data.year || '-'}</span></div>
      <div class="info-row">${lbl('اللون:', 'Color')}<span class="value">${data.color || '-'}</span></div>
      <div class="info-row">${lbl('رقم الهيكل:', 'VIN')}<span class="value" style="font-family:'Inter',sans-serif;font-size:10.5px;">${data.vin || '-'}</span></div>
      <div class="info-row">${lbl('عداد المسافة:', 'Mileage')}<span class="value">${data.mileage || '-'}</span></div>
      <div class="info-row">${lbl('المالك:', 'Owner')}<span class="value">${data.owner}</span></div>
      <div class="info-row">${lbl('الهاتف:', 'Phone')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;text-align:right;">${data.ownerPhone || '-'}</span></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 18px;">
      <div style="padding:12px;background:linear-gradient(135deg,${s.primaryColor}11,${s.primaryColor}05);border-right:3px solid ${s.primaryColor};border-radius:6px;">
        <div style="font-size:9.5px;color:#888;">عدد الزيارات / Visits</div>
        <div style="font-size:20px;font-weight:700;color:${s.primaryColor};font-family:'Inter',sans-serif;">${data.visits}</div>
      </div>
      <div style="padding:12px;background:#fafafa;border-right:3px solid #4caf50;border-radius:6px;">
        <div style="font-size:9.5px;color:#888;">إجمالي الإنفاق / Total Spent</div>
        <div style="font-size:16px;font-weight:700;color:#1a1a2e;">${omr(data.totalSpent)}</div>
      </div>
      <div style="padding:12px;background:#fafafa;border-right:3px solid #2196f3;border-radius:6px;">
        <div style="font-size:9.5px;color:#888;">آخر زيارة / Last Visit</div>
        <div style="font-size:13px;font-weight:600;color:#1a1a2e;font-family:'Inter',sans-serif;">${data.lastVisit}</div>
      </div>
    </div>

    ${sectionTitle('سجل أوامر العمل', 'Work Orders History')}
    ${ordersHtml}

    ${claimsHtml}

    ${photoPairsHtml}

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes</span><strong>ملاحظات:</strong> ${data.notes}</div>` : ''}

    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Vehicle ${data.plate}`, getBaseStyles(s), body);
}

// ===== INSURANCE COST ESTIMATE =====
// قالب تقدير تكلفة إصلاح موجَّه لشركات التأمين — نفس بنية محرر الفواتير
export interface InsuranceEstimateData extends AdvancedDocData {
  insuranceCompany: string;
  claimNumber: string;
  policyNumber?: string;
  vehiclePlate?: string;
  vehicleInfo?: string;
  incidentDate?: string;
  incidentDescription?: string;
  // Official insurance company identifiers (shown in header for invoices/estimates)
  insuranceCommercialRegistration?: string;
  insuranceTaxNumber?: string;
  insurancePoBox?: string;
  insuranceBranchCity?: string;
  insuranceAddress?: string;
  insurancePhone?: string;
  insuranceEmail?: string;
  // Bank details (shown only on the tax-invoice footer for transfers)
  insuranceBankName?: string;
  insuranceIban?: string;
  insuranceBankAccountName?: string;
  /** شروط مخصصة قابلة للتعديل — تستبدل الشروط الافتراضية */
  customTerms?: string;
}

export function getInsuranceEstimateHtml(data: InsuranceEstimateData): string {
  const custom = tryCustomTemplate("claim_estimate", { ...data, ...getTemplateSettings() }, `ClaimEstimate ${(data as any).claimNumber || ""}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const customFieldsHtml = data.customFields.filter(f => f.value).map(f => `
    <div class="info-row"><span class="label">${f.label}</span><span class="value">${f.value}</span></div>
  `).join('');

  const itemsHtml = data.items.filter(i => i.description.trim()).map((item, i) => {
    const line = item.quantity * item.unitPrice;
    const afterDisc = line - (line * item.discount) / 100;
    const lineTotal = afterDisc; // VAT shown separately in totals — never add to line
    return `<tr>
      <td style="text-align:center;color:#888;">${i + 1}</td>
      <td>${item.description}</td>
      <td style="text-align:center;">${item.quantity}</td>
      <td style="text-align:center;">${omr(item.unitPrice)}</td>
      <td style="text-align:center;color:#666;">${item.discount}%</td>
      <td style="text-align:center;color:#666;">${item.tax}%</td>
      <td style="text-align:center;font-weight:600;">${omr(lineTotal)}</td>
    </tr>`;
  }).join('');

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'تقدير تكلفة إصلاح', 'REPAIR COST ESTIMATE', data.number, data.issueDate, 'background:linear-gradient(135deg,#1e3a8a,#1e40af);')}

    ${sectionTitle('بيانات شركة التأمين', 'Insurance Company Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('شركة التأمين:', 'Insurance Company')}<span class="value">${data.insuranceCompany}${data.insuranceBranchCity ? ` — ${data.insuranceBranchCity}` : ''}</span></div>
      <div class="info-row">${lbl('رقم المطالبة:', 'Claim No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.claimNumber}</span></div>
      ${data.insuranceCommercialRegistration ? `<div class="info-row">${lbl('السجل التجاري:', 'CR No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.insuranceCommercialRegistration}</span></div>` : ''}
      ${data.insuranceTaxNumber ? `<div class="info-row">${lbl('الرقم الضريبي:', 'VAT No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.insuranceTaxNumber}</span></div>` : ''}
      ${data.insurancePoBox ? `<div class="info-row">${lbl('ص.ب / الرمز البريدي:', 'P.O. Box')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.insurancePoBox}</span></div>` : ''}
      ${data.insuranceAddress ? `<div class="info-row">${lbl('العنوان:', 'Address')}<span class="value">${data.insuranceAddress}</span></div>` : ''}
      ${data.insurancePhone ? `<div class="info-row">${lbl('الهاتف:', 'Phone')}<span class="value" style="direction:ltr;text-align:right;">${data.insurancePhone}</span></div>` : ''}
      ${data.policyNumber ? `<div class="info-row">${lbl('رقم البوليصة:', 'Policy No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.policyNumber}</span></div>` : ''}
      ${data.incidentDate ? `<div class="info-row">${lbl('تاريخ التقدير:', 'Incident Date')}<span class="value">${data.incidentDate}</span></div>` : ''}
    </div>

    ${sectionTitle('بيانات المؤمَّن له والمركبة', 'Insured & Vehicle Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('اسم المؤمَّن له:', 'Insured Name')}<span class="value">${data.customerName}</span></div>
      ${data.vehicleInfo ? `<div class="info-row">${lbl('السيارة:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>` : ''}
      ${data.vehiclePlate ? `<div class="info-row">${lbl('رقم اللوحة:', 'Plate No.')}<span class="value">${data.vehiclePlate}</span></div>` : ''}
      ${customFieldsHtml}
    </div>

    ${data.incidentDescription ? `<div class="notes-box"><span class="label-en">Incident Description</span><strong>وصف الحادث:</strong> ${data.incidentDescription}</div>` : ''}

    ${sectionTitle('تفاصيل الإصلاحات وقطع الغيار المطلوبة', 'Repair & Parts Breakdown')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:36px;text-align:center;')}
      ${th('الوصف', 'Description')}
      ${th('الكمية', 'Qty', 'width:55px;text-align:center;')}
      ${th('السعر', 'Price', 'width:115px;text-align:center;')}
      ${th('خصم', 'Disc', 'width:50px;text-align:center;')}
      ${th('ضريبة', 'Tax', 'width:55px;text-align:center;')}
      ${th('الإجمالي', 'Total', 'width:130px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('المجموع الفرعي', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      ${data.discountTotal > 0 ? `<div class="totals-row"><span>${bi('الخصم', 'Discount')}</span><span class="amount" style="color:#c33">- ${omr(data.discountTotal)}</span></div>` : ''}
      <div class="totals-row"><span>${bi('الضريبة', 'VAT')}</span><span class="amount">${omr(data.taxTotal)}</span></div>
      <div class="totals-row total"><span>${bi('إجمالي التقدير', 'Estimated Total')}</span><span class="amount">${omr(data.total)}</span></div>
    </div>

    <div class="notes-box">
      <span class="label-en">Estimate Terms</span>
      <strong>شروط التقدير:</strong><br/>
      ${data.customTerms
        ? data.customTerms.split(/\r?\n/).filter(Boolean).map(l => `• ${l}`).join('<br/>')
        : `• هذا التقدير ساري المفعول لمدة 30 يوماً من تاريخ الإصدار. <span style="color:#999;font-family:'Inter',sans-serif;">/ This estimate is valid for 30 days.</span><br/>
      • قد تتغير الأسعار حسب توفر القطع وتاريخ الموافقة. <span style="color:#999;font-family:'Inter',sans-serif;">/ Prices may change based on parts availability.</span><br/>
      • يبدأ العمل بعد اعتماد شركة التأمين رسمياً. <span style="color:#999;font-family:'Inter',sans-serif;">/ Work commences upon official insurance approval.</span>`}
      ${data.notes ? `<br/><br/><strong>ملاحظات إضافية:</strong> ${data.notes}` : ''}
    </div>

    <div style="margin-top:40px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:170px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المُقدِّر / الفاحص<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Estimator</span></div></div>
      <div style="text-align:center;width:170px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">مدير الورشة<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Workshop Manager</span></div></div>
      <div style="text-align:center;width:170px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">مندوب شركة التأمين<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Insurance Representative</span></div></div>
    </div>

    ${stampSignatureHtml(s, "quote")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Insurance Estimate ${data.number}`, getBaseStyles(s), body);
}

// ===== PAYMENT VOUCHER (سند صرف) =====
export interface PaymentVoucherData {
  voucherNumber: string;
  date: string;
  amount: number;
  categoryName: string;
  cashboxName: string;
  paymentMethod: string;
  beneficiary?: string;
  description?: string;
  photo?: string | null;
}

export function getPaymentVoucherHtml(data: PaymentVoucherData): string {
  const custom = tryCustomTemplate("payment_voucher", { ...data, ...getTemplateSettings() }, `Payment Voucher ${data.voucherNumber}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'سند صرف', 'PAYMENT VOUCHER', data.voucherNumber, data.date, 'background:linear-gradient(135deg,#dc2626,#991b1b);')}

    ${sectionTitle('بيانات السند', 'Voucher Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('المستفيد:', 'Beneficiary')}<span class="value">${data.beneficiary || '-'}</span></div>
      <div class="info-row">${lbl('التصنيف:', 'Category')}<span class="value">${data.categoryName}</span></div>
      <div class="info-row">${lbl('الخزينة:', 'Cashbox')}<span class="value">${data.cashboxName}</span></div>
      <div class="info-row">${lbl('طريقة الدفع:', 'Payment Method')}<span class="value">${data.paymentMethod}</span></div>
      <div class="info-row">${lbl('التاريخ:', 'Date')}<span class="value">${data.date}</span></div>
    </div>

    <div class="totals-box" style="width:100%;margin-top:20px;">
      <div class="totals-row total"><span>${bi('المبلغ المصروف', 'Amount Paid')}</span><span class="amount">${omr(data.amount)}</span></div>
    </div>

    ${data.description ? `<div class="notes-box"><span class="label-en">Description</span><strong>البيان:</strong> ${data.description}</div>` : ''}

    ${data.photo ? `
      ${sectionTitle('صورة الإيصال', 'Receipt Photo')}
      <div style="text-align:center;margin:15px 0;">
        <img src="${data.photo}" alt="receipt" style="max-width:100%;max-height:400px;border:1px solid #ddd;border-radius:8px;" />
      </div>
    ` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المستلم<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Recipient</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المحاسب<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Accountant</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المدير المعتمد<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Authorized Manager</span></div></div>
    </div>

    ${stampSignatureHtml(s, "voucher")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Payment Voucher ${data.voucherNumber}`, getBaseStyles(s), body);
}

// ===== STAGE PHOTOS ALBUM =====
export interface StagePhotosAlbumData {
  vehiclePlate: string;
  vehicleType?: string;
  owner?: string;
  groups: {
    orderId: string;
    orderDate: string;
    serviceType?: string;
    photos: { phase: string; phaseLabel: string; dataUrl: string; caption?: string; uploadedAt?: string }[];
  }[];
}

export function getStagePhotosAlbumHtml(data: StagePhotosAlbumData): string {
  const custom = tryCustomTemplate("stage_photos_album", { ...data, ...getTemplateSettings() }, `Stage Photos ${data.vehiclePlate}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const today = new Date().toISOString().split("T")[0];
  const totalPhotos = data.groups.reduce((sum, g) => sum + g.photos.length, 0);

  const groupsHtml = data.groups.map((g) => {
    const photosHtml = g.photos.map((p, i) => `
      <div style="break-inside:avoid;border:1px solid #e5e5e5;border-radius:6px;overflow:hidden;background:#fafafa;">
        <div style="aspect-ratio:4/3;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;">
          <img src="${p.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />
        </div>
        <div style="padding:5px 7px;font-size:9px;line-height:1.4;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
            <strong style="color:${s.primaryColor};">${p.phaseLabel}</strong>
            <span style="color:#999;font-family:'Inter',sans-serif;">#${i + 1}</span>
          </div>
          ${p.caption ? `<div style="color:#666;margin-top:2px;font-size:8.5px;">${p.caption}</div>` : ''}
          ${p.uploadedAt ? `<div style="color:#bbb;font-family:'Inter',sans-serif;font-size:8px;margin-top:1px;direction:ltr;text-align:right;">${new Date(p.uploadedAt).toLocaleString()}</div>` : ''}
        </div>
      </div>
    `).join('');

    return `
      <div style="margin-top:14px;break-inside:avoid;">
        <div style="display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor,-15)});color:white;padding:7px 12px;border-radius:6px;margin-bottom:8px;font-size:11px;">
          <div>
            <strong style="font-family:'Inter',sans-serif;letter-spacing:0.3px;">${g.orderId}</strong>
            ${g.serviceType ? ` <span style="opacity:0.85;font-size:10px;">• ${g.serviceType}</span>` : ''}
          </div>
          <div style="font-size:10px;opacity:0.9;font-family:'Inter',sans-serif;direction:ltr;">${g.orderDate} • ${g.photos.length} photos</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
          ${photosHtml}
        </div>
      </div>
    `;
  }).join('');

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, "ألبوم صور المراحل", "STAGE PHOTOS ALBUM", data.vehiclePlate, today)}

    <div style="background:#f8f9fa;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:11px;">
      <div><span style="color:#888;">السيارة / Vehicle:</span> <strong>${data.vehicleType || data.vehiclePlate}</strong></div>
      <div><span style="color:#888;">المالك / Owner:</span> <strong>${data.owner || '-'}</strong></div>
      <div><span style="color:#888;">إجمالي الصور / Total:</span> <strong>${totalPhotos}</strong> (${data.groups.length} ${data.groups.length === 1 ? 'order' : 'orders'})</div>
    </div>

    ${data.groups.length === 0
      ? `<div style="text-align:center;padding:60px;color:#999;font-size:12px;">لا توجد صور مراحل / No stage photos available</div>`
      : groupsHtml}

    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Stage Photos ${data.vehiclePlate}`, getBaseStyles(s), body);
}

// ===== NEEDED PARTS (طلب قطع غيار) =====
export interface NeededPartsRequestData {
  requestNumber: string;
  date: string;
  rows: Array<{
    workOrderId: string;
    customer: string;
    vehicle: string;
    plate: string;
    vin?: string;
    vehicleType?: string;
    year?: string;
    parts: Array<{ name: string; quantity: number; notes?: string; fulfilled?: boolean }>;
  }>;
}

export function getNeededPartsRequestHtml(data: NeededPartsRequestData): string {
  const custom = tryCustomTemplate("needed_parts_request", { ...data, ...getTemplateSettings() }, `Parts Request ${data.requestNumber}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const groupsHtml = data.rows.map((r) => {
    const partsRows = r.parts.map((p, i) => `
      <tr style="${p.fulfilled ? 'opacity:0.5;text-decoration:line-through;' : ''}">
        <td style="text-align:center;color:#888;width:36px;">${i + 1}</td>
        <td>${p.name || '-'}</td>
        <td style="text-align:center;width:70px;font-weight:bold;">${p.quantity}</td>
        <td style="color:#666;font-size:10.5px;">${p.notes || ''}</td>
        <td style="text-align:center;width:60px;">${p.fulfilled ? '✓' : '☐'}</td>
      </tr>
    `).join('');
    return `
      <div style="margin-bottom:18px;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">
        <div style="background:#f8f9fa;padding:8px 12px;border-bottom:1px solid #e5e5e5;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;font-size:11px;">
          <div><strong>أمر العمل / WO:</strong> <span style="font-family:monospace;color:#0070f3;">${r.workOrderId}</span></div>
          <div><strong>العميل / Customer:</strong> ${r.customer}</div>
          <div><strong>النوع / Make-Model:</strong> ${r.vehicleType || r.vehicle || '-'}${r.year ? ` — ${r.year}` : ''}</div>
          <div><strong>اللوحة / Plate:</strong> <span style="font-family:monospace;">${r.plate}</span></div>
          <div style="grid-column:1 / -1;"><strong>رقم الهيكل / VIN:</strong> <span style="font-family:monospace;letter-spacing:0.5px;">${r.vin || '-'}</span></div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="background:#fafafa;border-bottom:1px solid #eee;">
              ${th('#', '#', 'text-align:center;')}
              ${th('اسم القطعة', 'Part Name')}
              ${th('الكمية', 'Qty', 'text-align:center;')}
              ${th('ملاحظات', 'Notes')}
              ${th('مؤمّنة', 'Done', 'text-align:center;')}
            </tr>
          </thead>
          <tbody>${partsRows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  const totalParts = data.rows.reduce((sum, r) => sum + r.parts.reduce((s2, p) => s2 + (p.quantity || 0), 0), 0);
  const totalLines = data.rows.reduce((sum, r) => sum + r.parts.length, 0);

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'طلب قطع غيار', 'PARTS REQUEST', data.requestNumber, data.date)}

    ${sectionTitle('السيارات التي تحتاج قطع غيار', 'Vehicles Awaiting Parts')}
    ${data.rows.length === 0
      ? `<div style="text-align:center;padding:40px;color:#999;font-size:12px;">لا توجد قطع مطلوبة</div>`
      : groupsHtml}

    <div style="margin-top:14px;padding:10px 14px;background:#f0f7ff;border:1px solid #cfe3ff;border-radius:8px;font-size:11.5px;display:flex;justify-content:space-between;">
      <span><strong>عدد السيارات:</strong> ${data.rows.length}</span>
      <span><strong>عدد البنود:</strong> ${totalLines}</span>
      <span><strong>إجمالي القطع:</strong> ${totalParts}</span>
    </div>

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">طالب الطلب<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Requested By</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">المورد / المسؤول<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Supplier / Manager</span></div></div>
    </div>
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Parts Request ${data.requestNumber}`, getBaseStyles(s), body);
}

// ===== INSURANCE TAX INVOICE (فاتورة ضريبية رسمية لشركة التأمين مع QR) =====
export interface InsuranceTaxInvoiceData extends InsuranceEstimateData {
  invoiceNumber: string;          // رقم الفاتورة الرسمي
  qrDataUrl?: string;             // Data-URL لرمز ZATCA TLV
  paymentDueDate?: string;        // تاريخ استحقاق السداد
  lpoNumber?: string;             // رقم أمر الشراء الصادر من شركة التأمين (LPO)
}

export function getInsuranceTaxInvoiceHtml(data: InsuranceTaxInvoiceData): string {
  const custom = tryCustomTemplate("insurance_tax_invoice", { ...data, ...getTemplateSettings() }, `InsuranceTaxInvoice ${(data as any).invoiceNumber || ""}`);
  if (custom) return custom;
  const s = getTemplateSettings();

  // === Daftra-style template (matches reference screenshot) ===
  // English-leading layout: bilingual labels with English first; minimalist black/white tables
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter','Noto Sans Arabic','Segoe UI',sans-serif;color:#1a1a1a;background:#fff;padding:0;font-size:12px}
    .page{width:210mm;min-height:297mm;margin:0 auto;background:white;padding:14mm 16mm;position:relative}

    /* Header — logo + bilingual company name + Tax Invoice title */
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0284c7;padding-bottom:12px;margin-bottom:14px;background:linear-gradient(90deg,rgba(2,132,199,0.05),transparent 60%);padding:10px 12px 12px;border-radius:6px 6px 0 0}
    .top .left img{max-height:64px;max-width:160px;object-fit:contain;margin-bottom:4px;display:block}
    .top .left .name-en{font-size:15px;font-weight:800;letter-spacing:0.4px;color:#0c4a6e}
    .top .left .name-ar{font-size:11px;font-weight:600;color:#444;font-family:'Noto Sans Arabic',sans-serif;direction:rtl}
    .top .left .meta{font-size:9.5px;color:#666;line-height:1.6;margin-top:4px}
    .top .right{text-align:left}
    .top .right .title{font-size:20px;font-weight:800;letter-spacing:1.2px;color:#0c4a6e;text-transform:uppercase}
    .top .right .title-ar{font-size:11px;color:#0369a1;font-family:'Noto Sans Arabic',sans-serif;direction:rtl;margin-top:2px;font-weight:600}

    /* Top key-value summary block (matches the screenshot's two-column header) */
    .summary{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #1a1a1a;margin-bottom:14px;font-size:11px}
    .summary .col{padding:8px 12px}
    .summary .col + .col{border-right:1px solid #1a1a1a}
    .summary .row{display:flex;justify-content:space-between;padding:3px 0;gap:14px}
    .summary .row .k{color:#555;font-weight:500;font-family:'Inter',sans-serif}
    .summary .row .k .ar{font-family:'Noto Sans Arabic',sans-serif;color:#888;font-size:10px;display:inline-block;margin-right:4px}
    .summary .row .v{font-weight:700;color:#1a1a1a;font-family:'Inter',sans-serif;text-align:left}
    .tax-tag{display:inline-block;background:#0c4a6e;color:#fff;padding:2px 8px;border-radius:3px;font-weight:700;letter-spacing:1px;font-size:10px}
    .lpo-tag{display:inline-block;background:linear-gradient(135deg,#0284c7,#0ea5e9);color:#fff;padding:3px 10px;border-radius:4px;font-weight:800;letter-spacing:1px;font-size:11px;box-shadow:0 1px 3px rgba(2,132,199,0.4)}
    .lpo-row{background:linear-gradient(90deg,rgba(14,165,233,0.08),transparent);border-radius:4px;padding:4px 6px !important}

    /* Items table */
    table.items{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px}
    table.items thead th{background:#f5f5f5;border:1px solid #1a1a1a;padding:8px 10px;font-weight:700;text-align:left;font-family:'Inter',sans-serif}
    table.items thead th .ar{display:block;font-size:9px;color:#777;font-family:'Noto Sans Arabic',sans-serif;font-weight:500;margin-top:1px}
    table.items tbody td{border:1px solid #ccc;padding:7px 10px;vertical-align:top}
    table.items tbody td.num{text-align:left;font-family:'Inter',sans-serif;font-weight:600;direction:ltr;width:130px}
    table.items tbody td.idx{text-align:center;width:50px;color:#666;font-family:'Inter',sans-serif}

    /* Totals — same minimal style as the screenshot */
    .totals{margin-top:0;border-collapse:collapse;width:100%;font-size:11.5px}
    .totals td{padding:6px 10px;border:1px solid #ccc}
    .totals tr.subtotal td{background:#fafafa}
    .totals tr.grand td{background:#1a1a1a;color:#fff;font-weight:700;font-size:13px}
    .totals tr.grand td.label{letter-spacing:0.5px}
    .totals .lbl{font-weight:600;width:60%}
    .totals .lbl .ar{font-family:'Noto Sans Arabic',sans-serif;color:#888;font-size:10px;font-weight:500;display:inline-block;margin-right:6px}
    .totals .val{text-align:left;font-family:'Inter',sans-serif;direction:ltr}

    /* Footer area — QR + bank + signatures */
    .footer-area{margin-top:20px;display:grid;grid-template-columns:1fr auto;gap:18px;align-items:flex-end}
    .footer-area .qr-box{text-align:center}
    .footer-area .qr-box img{width:120px;height:120px;border:1px solid #ddd;padding:4px;background:white;display:block}
    .footer-area .qr-box .lbl{font-size:9px;color:#888;margin-top:4px;font-family:'Inter',sans-serif;letter-spacing:0.5px}
    .footer-area .left{font-size:10.5px;color:#444;line-height:1.7}
    .footer-area .left strong{color:#1a1a1a}
    .footer-area .left .ar{font-family:'Noto Sans Arabic',sans-serif;color:#666;display:inline-block;margin-right:6px}

    .bank{margin-top:14px;border:1px solid #1a1a1a;padding:8px 12px;font-size:10.5px;background:#fafafa}
    .bank .h{font-weight:700;color:#1a1a1a;margin-bottom:4px;letter-spacing:0.3px;font-size:11px}
    .bank .h .ar{font-family:'Noto Sans Arabic',sans-serif;color:#888;font-weight:500;margin-right:6px;font-size:10px}
    .bank .row{display:flex;justify-content:space-between;padding:2px 0;font-family:'Inter',sans-serif}
    .bank .row .k{color:#666}

    .stamp-row{margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px}
    .stamp-row .col{text-align:center;padding-top:36px;border-top:1px solid #888;font-size:10px;color:#666;font-family:'Inter',sans-serif}
    .stamp-row .col .ar{display:block;font-family:'Noto Sans Arabic',sans-serif;color:#999;font-size:9.5px;margin-top:1px}

    .doc-footer{margin-top:18px;text-align:center;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:6px;font-family:'Inter',sans-serif}
    @media print{body{padding:0}.page{margin:0;padding:14mm 16mm}}
  `;

  // ─── Items rows ─────────────────────────────────────────
  const itemsRows = data.items.filter(i => i.description.trim()).map((item, i) => {
    const line = item.quantity * item.unitPrice;
    const afterDisc = line - (line * item.discount) / 100;
    const lineTotal = afterDisc; // VAT shown separately at the bottom (matches screenshot style)
    return `<tr>
      <td class="idx">${i + 1}</td>
      <td>${item.description}</td>
      <td class="num">${omr(lineTotal)}</td>
    </tr>`;
  }).join('');

  // ─── Bank block ─────────────────────────────────────────
  const bankBlock = (data.insuranceBankName || data.insuranceIban) ? `
    <div class="bank">
      <div class="h">Bank Transfer Details <span class="ar">بيانات التحويل البنكي</span></div>
      ${data.insuranceBankName ? `<div class="row"><span class="k">Bank / البنك</span><span>${data.insuranceBankName}</span></div>` : ''}
      ${data.insuranceBankAccountName ? `<div class="row"><span class="k">Account Name / اسم الحساب</span><span>${data.insuranceBankAccountName}</span></div>` : ''}
      ${data.insuranceIban ? `<div class="row"><span class="k">IBAN</span><span style="letter-spacing:1px;font-weight:700">${data.insuranceIban}</span></div>` : ''}
    </div>` : '';

  // ─── Vehicle / claim metadata extraction (from data.vehicleInfo + customFields) ───
  // vehicleInfo is usually "Make Model - Year"
  const vehMake = (data.vehicleInfo || "").split(/\s+/)[0] || "—";
  const vehModelParts = (data.vehicleInfo || "").split(/\s+/).slice(1).join(" ").split("-")[0].trim() || "—";

  const body = `<div class="page">
    <!-- Top header -->
    <div class="top">
      <div class="left">
        ${s.logoUrl ? `<img src="${s.logoUrl}" alt="logo"/>` : ''}
        <div class="name-en">${s.companyNameEn}</div>
        <div class="name-ar">${s.companyName}</div>
        <div class="meta">
          ${s.address}<br/>
          ${s.phone} · ${s.email}
        </div>
      </div>
      <div class="right">
        <div class="title">Tax Invoice</div>
        <div class="title-ar">فاتورة ضريبية</div>
      </div>
    </div>

    <!-- Two-column key-value summary (matches reference) -->
    <div class="summary">
      <div class="col">
        <div class="row"><span class="k">Invoice number <span class="ar">رقم الفاتورة</span></span><span class="v">${data.invoiceNumber}</span></div>
        <div class="row"><span class="k">Invoice date <span class="ar">تاريخ الفاتورة</span></span><span class="v">${data.issueDate}</span></div>
        <div class="row"><span class="k">Vehicle Make <span class="ar">صنع المركبة</span></span><span class="v">${vehMake}</span></div>
        <div class="row"><span class="k">Model <span class="ar">الموديل</span></span><span class="v">${vehModelParts}</span></div>
        <div class="row"><span class="k">Reg. No. <span class="ar">رقم اللوحة</span></span><span class="v">${data.vehiclePlate || '—'}</span></div>
        <div class="row"><span class="k">Claim No. <span class="ar">رقم المطالبة</span></span><span class="v">${data.claimNumber}</span></div>
        ${data.lpoNumber ? `<div class="row lpo-row"><span class="k"><span class="lpo-tag">LPO</span> <span class="ar">رقم أمر الشراء</span></span><span class="v" style="color:#0284c7;font-weight:800">${data.lpoNumber}</span></div>` : ''}
      </div>
      <div class="col">
        <div class="row"><span class="k">Invoice to <span class="ar">إلى</span></span><span class="v">${data.insuranceCompany}</span></div>
        ${data.insuranceAddress ? `<div class="row"><span class="k">Address <span class="ar">العنوان</span></span><span class="v" style="font-weight:500;font-size:10.5px;text-align:left">${data.insuranceAddress}</span></div>` : ''}
        ${data.insurancePoBox ? `<div class="row"><span class="k">P.O. Box <span class="ar">ص.ب</span></span><span class="v">${data.insurancePoBox}</span></div>` : ''}
        ${data.insuranceTaxNumber ? `<div class="row"><span class="k"><span class="tax-tag">TAX</span></span><span class="v">${data.insuranceTaxNumber}</span></div>` : ''}
        ${data.insuranceCommercialRegistration ? `<div class="row"><span class="k">CR No. <span class="ar">السجل التجاري</span></span><span class="v">${data.insuranceCommercialRegistration}</span></div>` : ''}
        ${data.paymentDueDate ? `<div class="row"><span class="k">Due Date <span class="ar">الاستحقاق</span></span><span class="v">${data.paymentDueDate}</span></div>` : ''}
      </div>
    </div>

    <!-- Items -->
    <table class="items">
      <thead>
        <tr>
          <th style="width:50px;text-align:center">Item <span class="ar">البند</span></th>
          <th>Description <span class="ar">الوصف</span></th>
          <th style="width:130px;text-align:left">Total <span class="ar">الإجمالي</span></th>
        </tr>
      </thead>
      <tbody>${itemsRows || `<tr><td class="idx">1</td><td>The vehicle has been repaired in accordance with the report.</td><td class="num">${omr(data.subtotal)}</td></tr>`}</tbody>
    </table>

    <!-- Totals -->
    <table class="totals">
      <tr class="subtotal"><td class="lbl">Subtotal <span class="ar">المجموع الفرعي</span></td><td class="val">${omr(data.subtotal)}</td></tr>
      ${data.discountTotal > 0 ? `<tr><td class="lbl">Discount <span class="ar">الخصم</span></td><td class="val" style="color:#c33">- ${omr(data.discountTotal)}</td></tr>` : ''}
      <tr><td class="lbl">VAT 5% <span class="ar">ضريبة القيمة المضافة</span></td><td class="val">${omr(data.taxTotal)}</td></tr>
      <tr class="grand"><td class="lbl label">Total <span class="ar" style="color:#bbb">الإجمالي</span></td><td class="val">${omr(data.total)}</td></tr>
      <tr><td class="lbl">Paid <span class="ar">مدفوع</span></td><td class="val">${omr(0)}</td></tr>
      <tr><td class="lbl">Amount Due <span class="ar">الرصيد المستحق</span></td><td class="val" style="font-weight:700">${omr(data.total)}</td></tr>
    </table>

    ${bankBlock}

    <!-- Footer area: QR + legal -->
    <div class="footer-area">
      <div class="left">
        <strong>Notice <span class="ar">إشعار</span>:</strong> This is an official tax invoice issued under the VAT regulations of the Sultanate of Oman.
        <span class="ar">هذه فاتورة ضريبية رسمية صادرة وفق نظام ضريبة القيمة المضافة في سلطنة عمان.</span>
        ${data.notes ? `<br/><strong>Notes <span class="ar">ملاحظات</span>:</strong> ${data.notes}` : ''}
      </div>
      ${data.qrDataUrl ? `
        <div class="qr-box">
          <img src="${data.qrDataUrl}" alt="QR"/>
          <div class="lbl">ZATCA / TLV QR</div>
        </div>` : ''}
    </div>

    <!-- Signatures -->
    <div class="stamp-row">
      <div class="col">Accountant <span class="ar">المحاسب</span></div>
      <div class="col">Workshop Manager <span class="ar">مدير الورشة</span></div>
      <div class="col">Insurer Stamp & Sign <span class="ar">ختم وتوقيع شركة التأمين</span></div>
    </div>

    ${stampSignatureHtml(s, "invoice")}

    <div class="doc-footer">${s.companyNameEn} · ${s.companyName} · © ${new Date().getFullYear()}</div>
  </div>`;

  return wrapHtml(`Tax Invoice ${data.invoiceNumber}`, styles, body);
}

// ===== VEHICLE DELIVERY RECEIPT (إقرار استلام سيارة من الورشة) =====
export interface VehicleDeliveryReceiptData {
  receiptNumber: string;
  date: string;
  workOrderNumber?: string;
  customerName: string;
  customerPhone?: string;
  customerIdNumber?: string;
  receiverName?: string;
  receiverIdNumber?: string;
  vehicleType: string;
  model?: string;
  year?: number | string;
  plateNumber: string;
  vin?: string;
  color?: string;
  mileageOut?: string;
  workSummary?: string;
  partsReplaced?: string;
  warrantyNotes?: string;
  satisfactionNotes?: string;
  signatureDataUrl?: string;
  idPhotoDataUrl?: string;
}

export function getVehicleDeliveryReceiptHtml(data: VehicleDeliveryReceiptData): string {
  const s = getTemplateSettings();
  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'إقرار استلام سيارة', 'VEHICLE DELIVERY RECEIPT', data.receiptNumber, data.date, 'background:linear-gradient(135deg,#059669,#047857);')}

    <div style="background:#f0fdf4;border:2px solid #10b981;border-radius:10px;padding:14px 16px;margin:14px 0;font-size:13px;line-height:1.9;">
      <strong style="color:#047857;">إقرار استلام:</strong>
      أقرّ أنا الموقّع أدناه بأنني استلمت سيارتي الموصوفة بياناتها أدناه من
      <strong>${s.companyName}</strong> بحالة جيدة وسليمة وقمت بمعاينتها معاينة كاملة،
      وأنه تم تنفيذ الأعمال المطلوبة على أكمل وجه، ولا يحق لي مطالبة الورشة بأي مطالبات لاحقة بخصوص الأعمال المنفذة
      عدا ما هو مشمول بالضمان الموضح أدناه.
      ${data.workOrderNumber ? `<br/>أمر العمل المرجعي: <strong>${data.workOrderNumber}</strong>` : ''}
    </div>

    ${sectionTitle('بيانات المركبة', 'Vehicle Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('نوع المركبة:', 'Vehicle')}<span class="value">${data.vehicleType} ${data.model || ''}</span></div>
      <div class="info-row">${lbl('سنة الصنع:', 'Year')}<span class="value">${data.year || '-'}</span></div>
      <div class="info-row">${lbl('رقم اللوحة:', 'Plate')}<span class="value">${data.plateNumber}</span></div>
      <div class="info-row">${lbl('رقم الهيكل:', 'VIN')}<span class="value">${data.vin || '-'}</span></div>
      <div class="info-row">${lbl('اللون:', 'Color')}<span class="value">${data.color || '-'}</span></div>
      <div class="info-row">${lbl('قراءة العداد عند التسليم:', 'Mileage Out')}<span class="value">${data.mileageOut || '-'}</span></div>
    </div>

    ${sectionTitle('بيانات العميل/المستلم', 'Customer / Receiver')}
    <div class="info-grid">
      <div class="info-row">${lbl('اسم العميل:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      <div class="info-row">${lbl('هاتف العميل:', 'Phone')}<span class="value">${data.customerPhone || '-'}</span></div>
      <div class="info-row">${lbl('رقم هوية العميل:', 'Customer ID')}<span class="value">${data.customerIdNumber || '-'}</span></div>
      <div class="info-row">${lbl('اسم المستلم:', 'Receiver')}<span class="value">${data.receiverName || data.customerName}</span></div>
      <div class="info-row">${lbl('رقم هوية المستلم:', 'Receiver ID')}<span class="value">${data.receiverIdNumber || '-'}</span></div>
      <div class="info-row">${lbl('تاريخ التسليم:', 'Delivery Date')}<span class="value">${data.date}</span></div>
    </div>

    ${data.workSummary ? `${sectionTitle('ملخص الأعمال المنفذة', 'Work Summary')}
    <div class="notes-box" style="white-space:pre-wrap;">${data.workSummary}</div>` : ''}

    ${data.partsReplaced ? `${sectionTitle('القطع المستبدلة', 'Parts Replaced')}
    <div class="notes-box" style="white-space:pre-wrap;">${data.partsReplaced}</div>` : ''}

    ${data.warrantyNotes ? `${sectionTitle('الضمان والملاحظات', 'Warranty & Notes')}
    <div class="notes-box" style="background:#fef3c7;border-color:#f59e0b;white-space:pre-wrap;">${data.warrantyNotes}</div>` : ''}

    ${data.satisfactionNotes ? `<div class="notes-box" style="background:#eff6ff;border-color:#3b82f6;white-space:pre-wrap;"><strong>ملاحظات العميل عن الرضا:</strong> ${data.satisfactionNotes}</div>` : ''}

    ${data.idPhotoDataUrl ? `
      ${sectionTitle('صورة هوية المستلم', 'Receiver ID')}
      <div style="text-align:center;margin:10px 0;">
        <img src="${data.idPhotoDataUrl}" alt="id" style="max-width:60%;max-height:280px;border:1px solid #ddd;border-radius:8px;" />
      </div>
    ` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;gap:20px;">
      <div style="text-align:center;flex:1;">
        ${data.signatureDataUrl ? `<img src="${data.signatureDataUrl}" alt="sig" style="max-height:70px;display:block;margin:0 auto 4px;" />` : ''}
        <div style="border-top:1px solid #444;padding-top:6px;font-size:11px;color:#444;font-weight:600;">
          توقيع المستلم<br/><span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;">Receiver Signature</span>
        </div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="border-top:1px solid #444;padding-top:6px;font-size:11px;color:#444;font-weight:600;margin-top:30px;">
          مندوب الورشة<br/><span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;">Workshop Representative</span>
        </div>
      </div>
    </div>

    ${stampSignatureHtml(s, "voucher")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Delivery Receipt ${data.receiptNumber}`, getBaseStyles(s), body);
}
