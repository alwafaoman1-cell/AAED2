// PDF Generator for Alwafa ERP - Bilingual (Arabic/English) Professional Documents
// Returns HTML strings for inline preview + supports open-in-window
import { toEnglishDigits } from "./numberUtils";
import { renderWithCustomTemplate } from "./printTemplates/resolver";
import type { DocType } from "./printTemplates/schema";
import QRCode from "qrcode";
import { openSanitizedPdfWindow } from "./safePdfWindow";
import { buildPublicUrl } from "./publicAccessSettingsStore";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

/** ط±ط§ط¨ط· طھطھط¨ط¹ ط¹ط§ظ… ط¢ظ…ظ†. ط§ظ„ظ…ظپطھط§ط­ ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† tracking_token ظˆظ„ظٹط³ ط±ظ‚ظ… ط§ظ„ط£ظ…ط± ط£ظˆ UUID ط§ظ„ط¯ط§ط®ظ„ظٹ. */
export function getTrackingUrl(trackingToken?: string): string {
  if (!trackingToken) return "";
  return buildPublicUrl(`/p/${encodeURIComponent(trackingToken)}`);
}

/** ظٹط¨ظ†ظٹ QR ظƒظ€ dataURL ظ…طھط²ط§ظ…ظ†ط§ظ‹ (cache ط¨ط³ظٹط· ظ„طھظپط§ط¯ظٹ ط¥ط¹ط§ط¯ط© ط§ظ„طھظˆظ„ظٹط¯) */
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

/** ظ†ط³ط®ط© sync طھط³طھط®ط¯ظ… ط§ظ„ظ€ cache ظپظ‚ط· â€” ظ„ظ„ظ‚ظˆط§ظ„ط¨ ط§ظ„طھظٹ ظ„ط§ طھط³طھط·ظٹط¹ await */
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
  /** ط´ط±ظˆط· ط§ظ„ط¯ظپط¹ ط§ظ„ظ…ط®طھط§ط±ط© (طھط¸ظ‡ط± طھط­طھ ط¨ط·ط§ظ‚ط© ط§ظ„ط¹ظ…ظٹظ„/ط§ظ„ظ…ط±ظƒط¨ط©) */
  paymentTerms?: string;
  /** ط¹ط¨ط§ط±ط© "طھظ… ط§ظ„ط¯ظپط¹ ط¹ط¨ط± â€¦" طھط¸ظ‡ط± ظپظٹ ط£ط³ظپظ„ ط§ظ„ظپط§طھظˆط±ط© ط¹ظ†ط¯ طھط³ط¬ظٹظ„ ط§ظ„ط¯ظپط¹ط§طھ */
  paidVia?: string;
  /** ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…ط¯ظپظˆط¹ ظˆط§ظ„ظ…طھط¨ظ‚ظٹ ظ„ط¹ط±ط¶ظ‡ظ… ظپظٹ طµظ†ط¯ظˆظ‚ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹط§طھ */
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
  ["طھط­طھ ط§ظ„ظپط­طµ", "Under Inspection"],
  ["ط¨ط§ظ†طھط¸ط§ط± ط§ظ„ظ…ظˆط§ظپظ‚ط©", "Awaiting Approval"],
  ["ط¨ط§ظ†طھط¸ط§ط± ظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط±", "Awaiting Parts"],
  ["طھط­طھ ط§ظ„ط¥طµظ„ط§ط­", "Under Repair"],
  ["ط¶ط¨ط· ط§ظ„ط¬ظˆط¯ط©", "Quality Control"],
  ["ط¬ط§ظ‡ط² ظ„ظ„طھط³ظ„ظٹظ…", "Ready for Delivery"],
  ["طھظ… ط§ظ„طھط³ظ„ظٹظ…", "Delivered"],
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

// Template settings are stored in Supabase tenant_settings.
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
  /** طھظپط¹ظٹظ„/طھط¹ط·ظٹظ„ ط§ظ„ط¶ط±ظٹط¨ط© ط¹ظ„ظ‰ ط§ظ„ظ…ط³طھظ†ط¯ط§طھ ط§ظپطھط±ط§ط¶ظٹط§ظ‹ */
  taxEnabled?: boolean;
  /** ط§ط³ظ… ط§ظ„ط¶ط±ظٹط¨ط© (ظٹط¸ظ‡ط± ظپظٹ ط§ظ„ظپط§طھظˆط±ط©) */
  taxName?: string;
  taxNameEn?: string;
  /** ط¥ط°ط§ true: ط§ظ„ط³ط¹ط± ط´ط§ظ…ظ„ ط§ظ„ط¶ط±ظٹط¨ط© (Inclusive)طŒ ظˆط¥ظ„ط§ ظپط§ظ„ط¶ط±ظٹط¨ط© طھط¶ط§ظپ ظپظˆظ‚ ط§ظ„ط³ط¹ط± */
  taxInclusive?: boolean;
  /** ط¹ظ…ظ„ط© ط§ظ„ط¹ط±ط¶ (ظ…ط«ظ„: ط±.ط¹طŒ SARطŒ AED) */
  currencySymbol?: string;
  /** ظƒظˆط¯ ط§ظ„ط¹ظ…ظ„ط© ط§ظ„ط¯ظˆظ„ظٹ ظ„ظ„ظ…ط³طھظ†ط¯ط§طھ ط§ظ„ط¥ظ†ط¬ظ„ظٹط²ظٹط© */
  currencyCode?: string;
  /** ط¹ط¯ط¯ ط§ظ„ط®ط§ظ†ط§طھ ط§ظ„ط¹ط´ط±ظٹط© (ط§ظ„ط£طµظپط§ط± ط¨ط¹ط¯ ط§ظ„ظپط§طµظ„ط©) */
  decimals?: number;
  /** ط¨ط§ط¯ط¦ط© ط§ظ„ط¯ظˆظ„ط© ط§ظ„ط§ظپطھط±ط§ط¶ظٹط© ظ„ط£ط±ظ‚ط§ظ… ط§ظ„ظ‡ظˆط§طھظپ (ط¨ط¯ظˆظ† +)طŒ ظ…ط«ظ„ 968 */
  defaultCountryCode?: string;
  logoUrl?: string;
  primaryColor: string;
  showWatermark: boolean;
  footerText: string;

  // ===== Stamp & signature =====
  stampUrl?: string;            // ط®طھظ… ط§ظ„ظˆط±ط´ط©
  signatureUrl?: string;        // ط§ظ„طھظˆظ‚ظٹط¹
  responsibleName?: string;     // ط§ط³ظ… ط§ظ„ظ…ط³ط¤ظˆظ„ ط§ظ„ظ†طµظٹ طھط­طھ ط§ظ„طھظˆظ‚ظٹط¹
  stampEnabled: boolean;        // ط§ظ„طھط´ط؛ظٹظ„ ط§ظ„ط¹ط§ظ… ظ„ظ„ط®طھظ…/ط§ظ„طھظˆظ‚ظٹط¹
  stampPosition: StampPosition; // ط§ظ„ظ…ظˆط¶ط¹
  stampSize: StampSize;         // ط§ظ„ط­ط¬ظ…
  // ط§ظ„طھط´ط؛ظٹظ„/ط§ظ„ط¥ظٹظ‚ط§ظپ ظ„ظƒظ„ ظ†ظˆط¹ ظ…ط³طھظ†ط¯
  stampOnInvoice: boolean;
  stampOnQuote: boolean;
  stampOnVoucher: boolean;
  stampOnReport: boolean;
  stampOnWorkOrder: boolean;
  stampOnInspection: boolean;
}

const DEFAULT_SETTINGS: PdfTemplateSettings = {
  companyName: "ط´ط±ظƒط© ط§ظ„ظˆظپط§ط، ظ„ظ„ط£ط¹ظ…ط§ظ„ ط§ظ„ظ…طھظƒط§ظ…ظ„ط©",
  companyNameEn: "Alwafa Integrated Services",
  commercialReg: "XXXXXXXXXX",
  vatNumber: "OM1XXXXXXXXX",
  phone: "+968 9XXX XXXX",
  email: "info@alwafa.om",
  address: "ظ…ط³ظ‚ط·طŒ ط³ظ„ط·ظ†ط© ط¹ظ…ط§ظ†",
  addressEn: "Muscat, Sultanate of Oman",
  vatRate: 5,
  taxEnabled: true,
  taxName: "ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©",
  taxNameEn: "VAT",
  taxInclusive: false,
  currencySymbol: "ط±.ط¹",
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

export const DEFAULT_PDF_TEMPLATE_SETTINGS: PdfTemplateSettings = { ...DEFAULT_SETTINGS };

export const STAMP_SIZE_PX: Record<StampSize, number> = { sm: 100, md: 150, lg: 200 };

// In-memory cache + listeners so async cloud loads can notify open screens.
const CLOUD_KEY = "company_template_settings_v1";
let templateCache: PdfTemplateSettings | null = null;
const templateListeners = new Set<() => void>();

export function getTemplateSettings(): PdfTemplateSettings {
  if (templateCache) return templateCache;
  templateCache = { ...DEFAULT_SETTINGS };
  void loadTemplateSettingsFromCloud();
  return templateCache;
}

export function subscribeTemplateSettings(cb: () => void): () => void {
  templateListeners.add(cb);
  return () => { templateListeners.delete(cb); };
}

export function saveTemplateSettings(settings: PdfTemplateSettings) {
  templateCache = { ...settings };
  templateListeners.forEach((cb) => { try { cb(); } catch {} });
  void writeCloudSetting(CLOUD_KEY, settings).catch((error) => {
    console.warn("[pdfGenerator] Supabase template write failed", error);
  });
}

/** Load company/template settings from cloud and merge into local cache.
 *  Call after sign-in and once at app startup. Safe to call multiple times. */
export async function loadTemplateSettingsFromCloud(): Promise<void> {
  try {
    const cloud = await readCloudSetting<Partial<PdfTemplateSettings> | null>(CLOUD_KEY, null);
    if (cloud && typeof cloud === "object") {
      const merged = { ...DEFAULT_SETTINGS, ...cloud } as PdfTemplateSettings;
      templateCache = merged;
      templateListeners.forEach((cb) => { try { cb(); } catch {} });
    } else {
      // First time on cloud â€” push current local copy up so it isn't lost on cache clear.
      const local = getTemplateSettings();
      await writeCloudSetting(CLOUD_KEY, local).catch(() => {});
    }
  } catch { /* offline / not signed in â€” keep local */ }
}


if (typeof window !== "undefined") {
  subscribeCloudSetting<Partial<PdfTemplateSettings>>(CLOUD_KEY, (value) => {
    templateCache = { ...DEFAULT_SETTINGS, ...value } as PdfTemplateSettings;
    templateListeners.forEach((cb) => { try { cb(); } catch {} });
  });
}

// Bilingual label helper
const bi = (ar: string, en: string) =>
  `<span class="bi"><span class="ar">${ar}</span><span class="en">${en}</span></span>`;

function getBaseStyles(s: PdfTemplateSettings) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Noto Sans Arabic','Inter','Segoe UI',Tahoma,sans-serif;direction:rtl;color:#1a1a2e;background:#f8f9fa;padding:0}
    .page{width:210mm;min-height:297mm;margin:8mm auto;background:white;padding:12mm 12mm 15mm;box-shadow:0 2px 20px rgba(0,0,0,0.1);position:relative;overflow:visible}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${s.primaryColor};padding-bottom:10px;margin-bottom:14px;break-inside:avoid;page-break-inside:avoid}
    .company-info h1{font-size:17px;font-weight:700;color:#1a1a2e;margin-bottom:2px}
    .company-info .en-name{font-size:11.5px;color:#444;font-weight:600;margin-bottom:4px;font-family:'Inter',sans-serif;letter-spacing:0.3px}
    .company-info .details{font-size:8.8px;color:#888;line-height:1.55}
    .company-info .details .en-line{font-family:'Inter',sans-serif;direction:ltr;text-align:right;display:block}
    .doc-badge{background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor,-15)});color:white;padding:8px 16px;border-radius:7px;text-align:center;min-width:145px}
    .doc-badge .label-ar{font-size:11px;opacity:0.95;font-weight:600}
    .doc-badge .label-en{font-size:9px;opacity:0.85;font-family:'Inter',sans-serif;letter-spacing:0.5px;text-transform:uppercase}
    .doc-badge .number{font-size:17px;font-weight:700;direction:ltr;font-family:'Inter',sans-serif;margin:3px 0}
    .doc-badge .date{font-size:9.5px;opacity:0.85;font-family:'Inter',sans-serif;direction:ltr}

    .section-title{font-size:12.5px;font-weight:600;color:${s.primaryColor};border-right:3px solid ${s.primaryColor};padding-right:9px;margin:14px 0 8px 0;display:flex;align-items:baseline;gap:10px;break-after:avoid;page-break-after:avoid}
    .section-title .en{font-size:10px;color:#888;font-weight:500;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:0.8px}

    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 22px;margin-bottom:12px}
    .info-row{display:flex;gap:8px;font-size:11.5px;padding:3px 0;align-items:baseline}
    .info-row .label{color:#888;min-width:130px;font-weight:500;font-size:11px}
    .info-row .label .en{font-size:9px;color:#aaa;font-family:'Inter',sans-serif;display:block;line-height:1}
    .info-row .value{color:#1a1a2e;font-weight:600;flex:1}

    .bi{display:inline-flex;flex-direction:column;line-height:1.15}
    .bi .ar{font-size:inherit}
    .bi .en{font-size:0.78em;color:#999;font-family:'Inter',sans-serif;font-weight:500;letter-spacing:0.3px}

    table{width:100%;border-collapse:collapse;margin:9px 0;font-size:11px;page-break-inside:auto}
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    tr,td,th{page-break-inside:avoid;break-inside:avoid}
    thead th{background:#1a1a2e;color:white;padding:7px 8px;text-align:right;font-weight:600;font-size:10px;vertical-align:top}
    thead th .en{display:block;font-size:8.5px;color:#bbb;font-family:'Inter',sans-serif;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;margin-top:1px}
    thead th:first-child{border-radius:0 6px 6px 0}
    thead th:last-child{border-radius:6px 0 0 6px}
    tbody td{padding:7px 8px;border-bottom:1px solid #eee}
    tbody tr:hover{background:#fafafa}

    .totals-box{margin-top:12px;margin-right:auto;width:280px;border:2px solid #eee;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
    .totals-row{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;font-size:11.5px;gap:10px}
    .totals-row:not(:last-child){border-bottom:1px solid #eee}
    .totals-row .amount{font-family:'Inter',sans-serif;font-weight:600;direction:ltr}
    .totals-row.total{background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor,-15)});color:white;font-weight:700;font-size:13.5px}

    .notes-box{margin-top:12px;padding:9px 12px;background:#f8f9fa;border-radius:8px;border-right:3px solid ${s.primaryColor};font-size:10.3px;color:#555;line-height:1.55;break-inside:avoid;page-break-inside:avoid}
    .notes-box .label-en{display:block;font-size:9px;color:#999;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px}

    .footer,.pdf-flow-footer{position:static!important;margin-top:7mm;text-align:center;font-size:8.5px;color:#8a94a6;border-top:1px solid #e5e7eb;padding-top:2.5mm;line-height:1.45;break-inside:avoid;page-break-inside:avoid;clear:both}
    .footer .en{display:block;font-family:'Inter',sans-serif;color:#bbb}
    .pdf-signature-stamp{margin-top:7mm;display:grid;grid-template-columns:1fr 1.15fr;gap:10mm;align-items:end;break-inside:avoid;page-break-inside:avoid;clear:both;min-height:24mm}
    .pdf-signature-stamp .pdf-signature-box,.pdf-signature-stamp .pdf-stamp-box{min-height:23mm;text-align:center}
    .pdf-signature-stamp .pdf-stamp-box{border:1px dashed #cbd5e1;border-radius:4px;padding:2mm;color:#64748b;font-weight:700;display:flex;align-items:center;justify-content:center;background:#fff}
    .pdf-signature-stamp .pdf-signature-line{height:18mm;display:flex;align-items:flex-end;justify-content:center}
    .pdf-signature-stamp .pdf-signature-line:after{content:"";display:block;width:48mm;border-bottom:1px solid #10213c}
    .pdf-signature-stamp img{max-height:21mm;max-width:70mm;object-fit:contain}
    .pdf-signature-title,.pdf-stamp-title{font-size:10.5px;font-weight:800;color:#263b57;margin-bottom:2mm}

    .status-badge{display:inline-flex;flex-direction:column;align-items:center;padding:4px 12px;border-radius:14px;font-size:10.5px;font-weight:600;line-height:1.2}
    .status-badge .en{font-size:8.5px;font-weight:500;font-family:'Inter',sans-serif;opacity:0.85}
    .status-completed{background:#d4edda;color:#155724}
    .status-progress{background:#fff3cd;color:#856404}
    .status-pending{background:#cce5ff;color:#004085}

    .watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:70px;font-weight:700;color:rgba(212,165,55,0.05);pointer-events:none;white-space:nowrap;font-family:'Inter',sans-serif}

    .currency{font-family:'Inter',sans-serif;direction:ltr;display:inline-block}

    @media print{body{background:white;padding:0}.page{margin:0;box-shadow:none;width:210mm;min-height:297mm;overflow:visible;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}}
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
  // ط¶ظ…ط§ظ† ط¹ط¯ظ… ط¸ظ‡ظˆط± ط£ط±ظ‚ط§ظ… ط¹ط±ط¨ظٹط© ظ‡ظ†ط¯ظٹط© ظپظٹ ط£ظٹ ظ…ظƒط§ظ† ظ…ظ† ط§ظ„ظ…ط³طھظ†ط¯ ط¨ط¹ط¯ ط§ظ„طھظˆظ„ظٹط¯
  const enforced = toEnglishDigits(body);
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>${toEnglishDigits(title)}</title><style>${styles}</style></head><body>${enforced}</body></html>`;
}

// Currency formatter â€” English digits, OMR-style with configurable decimals + symbol
const omr = (n: number) => {
  const s = getTemplateSettings();
  const d = Math.max(0, Math.min(6, s.decimals ?? 3));
  const v = (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `<span class="currency">${toEnglishDigits(v)} ${s.currencyCode || "OMR"}</span>`;
};

/** Centralized money formatter for UI â€” respects currency + decimals from settings */
export function formatMoney(n: number, opts?: { withSymbol?: boolean }): string {
  const s = getTemplateSettings();
  const d = Math.max(0, Math.min(6, s.decimals ?? 3));
  const v = (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return opts?.withSymbol === false ? v : `${v} ${s.currencySymbol || "ط±.ط¹"}`;
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
          ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ / CR: ${s.commercialReg}<br/>
          ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ / VAT: ${s.vatNumber}<br/>
          ${s.phone} â€¢ ${s.email}<br/>
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
    ${s.companyName} â€¢ ط¬ظ…ظٹط¹ ط§ظ„ط­ظ‚ظˆظ‚ ظ…ط­ظپظˆط¸ط© آ© ${new Date().getFullYear()}
    <span class="en">${s.companyNameEn} â€¢ All Rights Reserved آ© ${new Date().getFullYear()}</span>
  </div>`;
}

export function pdfSignatureStampSectionHtml(options: {
  signatureUrl?: string;
  stampUrl?: string;
  responsibleName?: string;
  companyName?: string;
  companyNameEn?: string;
  commercialReg?: string;
  signatureTitle?: string;
  stampTitle?: string;
}): string {
  const signatureTitle = options.signatureTitle || "ط§ظ„طھظˆظ‚ظٹط¹ / SIGNATURE";
  const stampTitle = options.stampTitle || "ط®طھظ… ط§ظ„ط´ط±ظƒط© / COMPANY STAMP";
  const signature = options.signatureUrl
    ? `<img src="${options.signatureUrl}" alt="signature" />`
    : `<div class="pdf-signature-line"></div>`;
  const responsible = options.responsibleName
    ? `<div style="font-size:10px;color:#555;font-weight:600;margin-top:2mm;text-align:center;">${options.responsibleName}</div>`
    : "";
  const stamp = options.stampUrl
    ? `<img src="${options.stampUrl}" alt="Company Stamp" />`
    : "";
  return `<section class="pdf-signature-stamp pdf-keep no-break">
    <div class="pdf-signature-box">
      <div class="pdf-signature-title">${signatureTitle}</div>
      ${signature}
      ${responsible}
    </div>
    <div>
      <div class="pdf-stamp-title">${stampTitle}</div>
      <div class="pdf-stamp-box">${stamp}</div>
    </div>
  </section>`;
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
  const requestedStampPosition = s.stampPosition;
  if (requestedStampPosition !== "watermark-center") {
    return pdfSignatureStampSectionHtml({
      signatureUrl: s.signatureUrl,
      stampUrl: s.stampUrl,
      responsibleName: s.responsibleName,
      companyName: s.companyName,
      companyNameEn: s.companyNameEn,
      commercialReg: s.commercialReg,
    });
  }
  if (!s.stampUrl && !s.signatureUrl) return "";

  const size = STAMP_SIZE_PX[s.stampSize] || 150;
  const stampImg = s.stampUrl
    ? `<img src="${s.stampUrl}" alt="ط®طھظ…" style="max-width:${size}px;max-height:${size}px;object-fit:contain;display:block;" />`
    : "";
  const sigImg = s.signatureUrl
    ? `<img src="${s.signatureUrl}" alt="طھظˆظ‚ظٹط¹" style="max-width:${size}px;max-height:${Math.round(size * 0.55)}px;object-fit:contain;display:block;" />`
    : "";
  const respName = s.responsibleName
    ? `<div style="font-size:10px;color:#555;font-weight:600;margin-top:4px;text-align:center;">${s.responsibleName}</div>`
    : "";

  // Watermark behind content
  if (s.stampPosition === "watermark-center" && s.stampUrl) {
    return `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-12deg);opacity:0.12;pointer-events:none;z-index:0;">
      <img src="${s.stampUrl}" alt="ط®طھظ…" style="max-width:${size * 1.6}px;max-height:${size * 1.6}px;object-fit:contain;" />
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
    ${headerHtml(s, 'ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط©', 'TAX INVOICE', data.invoiceNumber, data.date)}

    <div style="margin:8px 0 12px;display:flex;gap:10px;">
      <div style="flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;background:#f9fafb;">
        <div style="font-size:9px;color:#6b7280;font-weight:700;letter-spacing:0.4px;margin-bottom:4px;">ط§ظ„ط¹ظ…ظٹظ„ آ· CUSTOMER</div>
        <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:2px;">${data.customerName || 'â€”'}</div>
        <div style="font-size:9.5px;color:#4b5563;direction:ltr;text-align:right;font-family:'Inter',sans-serif;">${data.customerPhone || ''}</div>
      </div>
      <div style="flex:1.2;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;background:#f9fafb;">
        <div style="font-size:9px;color:#6b7280;font-weight:700;letter-spacing:0.4px;margin-bottom:4px;">ط§ظ„ظ…ط±ظƒط¨ط© آ· VEHICLE</div>
        <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:2px;">${data.vehicleInfo || 'â€”'}</div>
        <div style="font-size:9.5px;color:#4b5563;">ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©: <span style="font-family:monospace;font-weight:700;color:#111827;">${data.plateNumber || 'â€”'}</span></div>
      </div>
    </div>

    ${data.paymentTerms ? `
    <div style="margin:0 0 10px;padding:6px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:10px;color:#1e3a8a;">
      <strong>ط´ط±ظˆط· ط§ظ„ط¯ظپط¹ آ· Payment Terms:</strong> ${data.paymentTerms}
    </div>` : ''}

    ${sectionTitle('طھظپط§طµظٹظ„ ط§ظ„ظپط§طھظˆط±ط©', 'Invoice Details')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:40px;text-align:center;')}
      ${th('ط§ظ„ظˆطµظپ', 'Description')}
      ${th('ط§ظ„ظƒظ…ظٹط©', 'Qty', 'width:60px;text-align:center;')}
      ${th('ط§ظ„ط³ط¹ط±', 'Unit Price', 'width:130px;text-align:center;')}
      ${th('ط§ظ„ظ…ط¬ظ…ظˆط¹', 'Total', 'width:140px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      <div class="totals-row"><span>${bi(`ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© (${s.vatRate}%)`, `VAT (${s.vatRate}%)`)}</span><span class="amount">${omr(data.vat)}</span></div>
      <div class="totals-row total"><span>${bi('ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ', 'Grand Total')}</span><span class="amount">${omr(data.total)}</span></div>
      ${(data.paidTotal ?? 0) > 0 ? `
      <div class="totals-row" style="color:#059669;"><span>${bi('ط§ظ„ظ…ط¯ظپظˆط¹', 'Paid')}</span><span class="amount">${omr(data.paidTotal!)}</span></div>
      <div class="totals-row" style="color:#dc2626;font-weight:700;"><span>${bi('ط§ظ„ظ…طھط¨ظ‚ظٹ', 'Balance Due')}</span><span class="amount">${omr(data.balanceDue ?? Math.max(0, data.total - (data.paidTotal || 0)))}</span></div>
      ` : ''}
    </div>

    ${data.paidVia ? `
    <div style="margin-top:14px;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;font-size:11px;color:#065f46;text-align:center;font-weight:700;">
      âœ“ طھظ… ط§ظ„ط¯ظپط¹ ط¹ط¨ط±: ${data.paidVia} &nbsp;آ·&nbsp; Paid via: ${data.paidVia}
    </div>` : ''}

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes</span><strong>ظ…ظ„ط§ط­ط¸ط§طھ:</strong> ${data.notes}</div>` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">طھظˆظ‚ظٹط¹ ط§ظ„ط¹ظ…ظٹظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ط­ط§ط³ط¨ ط§ظ„ظ…ط³ط¤ظˆظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Accountant</span></div></div>
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
  const statusClass = data.status.includes('ط¥طµظ„ط§ط­') || data.status.includes('Repair') ? 'status-progress'
    : data.status.includes('ط¬ط§ظ‡ط²') || data.status.includes('طھظ…') || data.status.includes('Ready') || data.status.includes('Delivered') ? 'status-completed'
    : data.status.includes('ظپط­طµ') || data.status.includes('Inspection') ? 'status-pending'
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
  // Accounting: total = subtotal + VAT. Payments do not reduce revenue.
  const grandTotal = Number((subtotal + vat).toFixed(3));
  const balanceDue = Number(Math.max(0, grandTotal - deposit).toFixed(3));

  const extrasRowsHtml = extras.length === 0 ? '' : extras.map((e) => `
    <tr>
      <td style="padding-right:24px;color:#555;">â†³ ${e.label}${e.notes ? ` <span style="color:#aaa;font-size:9.5px;">(${e.notes})</span>` : ''}</td>
      <td style="text-align:left;font-weight:600;">${omr(Number(e.amount) || 0)}</td>
    </tr>
  `).join('');

  const orderType = data.workOrderType === "insurance" ? "insurance" : "general_customer";
  const typeBadge = orderType === "insurance"
    ? `<span style="display:inline-block;padding:5px 10px;border-radius:999px;background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;font-size:10px;font-weight:700;">ًں›، INSURANCE</span>`
    : `<span style="display:inline-block;padding:5px 10px;border-radius:999px;background:#dcfce7;color:#047857;border:1px solid #86efac;font-size:10px;font-weight:700;">ًںڑ— GENERAL / CASH</span>`;
  const trackUrl = getTrackingUrl(data.trackingToken);
  const qrDataUrl = getTrackingQrFromCache(data.trackingToken);
  const qrCardHtml = qrDataUrl ? `
    <div style="display:flex;align-items:center;gap:14px;padding:10px 14px;margin:0 0 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
      <img src="${qrDataUrl}" alt="QR" style="width:90px;height:90px;flex-shrink:0;border-radius:6px;background:#fff;padding:4px;border:1px solid #e2e8f0;" />
      <div style="flex:1;">
        <div style="font-size:11px;font-weight:700;color:${s.primaryColor};margin-bottom:3px;">طھطھط¨ط¹ ط­ط§ظ„ط© ط§ظ„ط³ظٹط§ط±ط© <span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;font-weight:500;">/ Track Vehicle Status</span></div>
        <div style="font-size:9.5px;color:#555;line-height:1.55;">ط§ظ…ط³ط­ ط§ظ„ط±ظ…ط² ط¨ظƒط§ظ…ظٹط±ط§ ط§ظ„ط¬ظˆط§ظ„ ظ„ظ…طھط§ط¨ط¹ط© ظ…ط±ط§ط­ظ„ ط§ظ„ط¥طµظ„ط§ط­ ظˆط§ظ„طµظˆط± ظ„ط­ط¸ظٹط§ظ‹.<br/><span style="font-family:'Inter',sans-serif;color:#888;">Scan with your phone camera to follow repair stages and photos in real-time.</span></div>
        <div style="font-size:8.5px;color:#888;font-family:monospace;margin-top:3px;direction:ltr;text-align:left;word-break:break-all;">${trackUrl}</div>
      </div>
    </div>` : '';

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'ط£ظ…ط± ط¹ظ…ظ„', 'WORK ORDER', data.orderNumber, data.date)}
    <div style="display:flex;justify-content:flex-end;margin:-4px 0 10px;">${typeBadge}</div>
    ${qrCardHtml}

    ${sectionTitle('ظ…ط³ط§ط± ط­ط§ظ„ط© ط§ظ„ط¥طµظ„ط§ط­', 'Repair Status Timeline')}
    ${timelineHtml}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div style="padding:10px 14px;background:#fafafa;border-right:3px solid ${s.primaryColor};border-radius:6px;">
        <div style="font-size:11px;font-weight:600;color:${s.primaryColor};margin-bottom:6px;">ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط¹ظ…ظٹظ„ <span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;font-weight:500;">/ Customer Info</span></div>
        <div class="info-row">${lbl('ط§ظ„ط§ط³ظ…:', 'Name')}<span class="value">${data.customerName}</span></div>
        <div class="info-row">${lbl('ط§ظ„ظ‡ط§طھظپ:', 'Phone')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;">${data.customerPhone}</span></div>
      </div>
      <div style="padding:10px 14px;background:#fafafa;border-right:3px solid ${s.primaryColor};border-radius:6px;">
        <div style="font-size:11px;font-weight:600;color:${s.primaryColor};margin-bottom:6px;">ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط³ظٹط§ط±ط© <span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;font-weight:500;">/ Vehicle Info</span></div>
        <div class="info-row">${lbl('ط§ظ„ظ†ظˆط¹:', 'Make/Model')}<span class="value">${data.vehicleType} ${data.model} ${data.year}</span></div>
        <div class="info-row">${lbl('ط§ظ„ظ„ظˆط­ط©:', 'Plate')}<span class="value">${data.plateNumber}</span></div>
        ${data.color ? `<div class="info-row">${lbl('ط§ظ„ظ„ظˆظ†:', 'Color')}<span class="value">${data.color}</span></div>` : ''}
        ${data.mileage ? `<div class="info-row">${lbl('ط§ظ„ظƒظٹظ„ظˆظ…طھط±ط§طھ:', 'Mileage')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;">${data.mileage} km</span></div>` : ''}
        <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„:', 'VIN')}<span class="value" style="direction:ltr;text-align:right;font-family:monospace;font-size:10px;">${data.vin}</span></div>
      </div>
    </div>

    ${sectionTitle('طھظپط§طµظٹظ„ ط§ظ„ط¹ظ…ظ„', 'Job Details')}
    <div class="info-grid">
      <div class="info-row">${lbl('ظ†ظˆط¹ ط§ظ„ط®ط¯ظ…ط©:', 'Service Type')}<span class="value">${data.serviceType}</span></div>
      <div class="info-row">${lbl('ط§ظ„ظپظ†ظٹ ط§ظ„ظ…ط³ط¤ظˆظ„:', 'Technician')}<span class="value">${data.technician}</span></div>
      ${orderType === "insurance" ? `
      <div class="info-row">${lbl('ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†:', 'Insurance Co.')}<span class="value">${data.insurance}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط©:', 'Claim No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.claimNumber}</span></div>` : `
      <div class="info-row">${lbl('ظ†ظˆط¹ ط§ظ„ط£ظ…ط±:', 'Order Type')}<span class="value">ط¹ظ…ظٹظ„ ط¹ط§ظ… / General Customer</span></div>`}
      <div class="info-row">${lbl('ط§ظ„ط­ط§ظ„ط© ط§ظ„ط­ط§ظ„ظٹط©:', 'Current Status')}<span class="value"><span class="status-badge ${statusClass}">${data.status}<span class="en">${statusEn}</span></span></span></div>
    </div>

    ${data.description ? `<div class="notes-box"><span class="label-en">Diagnosis / Notes</span><strong>ط§ظ„طھط´ط®ظٹطµ / ظ…ظ„ط§ط­ط¸ط§طھ:</strong> ${data.description}</div>` : ''}

    ${sectionTitle('ط§ظ„طھظƒظ„ظپط©', 'Cost Breakdown')}
    <table>
      <thead><tr>
        ${th('ط§ظ„ط¨ظٹط§ظ†', 'Description', 'width:60%;')}
        ${th('ط§ظ„ظ‚ظٹظ…ط©', 'Amount', 'text-align:left;')}
      </tr></thead>
      <tbody>
        <tr><td>${bi('ط£ط¬ظˆط± ط§ظ„ط¹ظ…ط§ظ„ط©', 'Labor Cost')}</td><td style="text-align:left;font-weight:600;">${omr(laborCost)}</td></tr>
        <tr><td>${bi('ظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط±', 'Parts Cost')}</td><td style="text-align:left;font-weight:600;">${omr(partsCost)}</td></tr>
        ${extras.length > 0 ? `<tr><td>${bi('ظ…طµط±ظˆظپط§طھ ط¥ط¶ط§ظپظٹط©', 'Extra Expenses')}</td><td style="text-align:left;font-weight:600;">${omr(extrasTotal)}</td></tr>${extrasRowsHtml}` : ''}
        <tr><td>${bi('ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ', 'Subtotal')}</td><td style="text-align:left;font-weight:600;">${omr(subtotal)}</td></tr>
        <tr><td>${bi(`ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© (${s.vatRate}%)`, `VAT (${s.vatRate}%)`)}</td><td style="text-align:left;font-weight:600;">${omr(vat)}</td></tr>
      </tbody>
    </table>
    <div class="totals-box">
      <div class="totals-row total"><span>${bi('ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظپط§طھظˆط±ط©', 'Invoice Total')}</span><span class="amount">${omr(grandTotal)}</span></div>
      ${deposit > 0 ? `
      <div class="totals-row" style="color:#2d6a4f;"><span>${bi('ط¯ظپط¹ط© ظ…ط³طھظ„ظ…ط© (ط¯ط®ظ„)', 'Payment Received')}</span><span class="amount">+ ${omr(deposit)}</span></div>
      <div class="totals-row total" style="color:#b45309;"><span>${bi('ط§ظ„ط±طµظٹط¯ ط§ظ„ظ…ط³طھط­ظ‚', 'Balance Due')}</span><span class="amount">${omr(balanceDue)}</span></div>
      ` : ''}
    </div>

    ${(() => {
      const photos = data.photos || [];
      if (photos.length === 0) return '';
      const stageMap: Record<string, [string, string]> = {
        received: ['ط§ط³طھظ„ط§ظ…', 'Received'],
        inspection: ['ظپط­طµ', 'Inspection'],
        in_progress: ['طھط­طھ ط§ظ„ط¥طµظ„ط§ط­', 'In Progress'],
        quality: ['ط¶ط¨ط· ط§ظ„ط¬ظˆط¯ط©', 'Quality Check'],
        delivery: ['طھط³ظ„ظٹظ…', 'Delivery'],
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
        ${sectionTitle('طµظˆط± ظ…ط±ط§ط­ظ„ ط§ظ„ط¹ظ…ظ„', 'Work Stage Photos')}
        <div style="page-break-inside:auto;">${sections}</div>
      `;
    })()}

    <div style="margin-top:40px;display:flex;justify-content:space-between;page-break-inside:avoid;">
      <div style="text-align:center;width:170px;">
        ${data.customerSignatureDataUrl
          ? `<img src="${data.customerSignatureDataUrl}" alt="customer signature" style="max-width:160px;max-height:60px;object-fit:contain;display:block;margin:0 auto 4px;" />`
          : `<div style="height:60px;"></div>`}
        <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">
          طھظˆظ‚ظٹط¹ ط§ظ„ط¹ظ…ظٹظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span>
          ${data.customerSignatureName ? `<div style="font-size:9px;color:#555;margin-top:2px;">${data.customerSignatureName}</div>` : ''}
          ${data.customerSignatureDate ? `<div style="font-size:8.5px;color:#888;font-family:monospace;">${data.customerSignatureDate}</div>` : ''}
        </div>
      </div>
      <div style="text-align:center;width:170px;"><div style="height:60px;"></div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظپظ†ظٹ ط§ظ„ظ…ط³ط¤ظˆظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Technician</span></div></div>
      <div style="text-align:center;width:170px;"><div style="height:60px;"></div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ظ…ط¯ظٹط± ط§ظ„ظˆط±ط´ط©<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Workshop Manager</span></div></div>
    </div>
    ${stampSignatureHtml(s, "workOrder")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Work Order ${data.orderNumber}`, getBaseStyles(s), body);
}

export async function generateWorkOrderPdf(data: WorkOrderData) {
  // ط§ط¨ظ†ظگ QR ط§ظ„طھطھط¨ط¹ ظ…ط³ط¨ظ‚ط§ظ‹ ظ‚ط¨ظ„ طھظˆظ„ظٹط¯ ط§ظ„ظ€ HTML
  await buildTrackingQrDataUrl(data.trackingToken);
  const html = getWorkOrderHtml(data);
  openSanitizedPdfWindow(html);
}

// ===== INSPECTION =====
export function getInspectionHtml(data: InspectionData): string {
  const custom = tryCustomTemplate("inspection", { ...data, ...getTemplateSettings() }, `Inspection ${data.inspectionId}`);
  if (custom) return custom;
  const s = getTemplateSettings();
  const statusEn = data.status === 'ظ…ظƒطھظ…ظ„' ? 'Completed' : data.status === 'ظ‚ظٹط¯ ط§ظ„طھظ†ظپظٹط°' ? 'In Progress' : data.status;
  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'طھظ‚ط±ظٹط± ظپط­طµ ظˆظ…ط¹ط§ظٹظ†ط©', 'INSPECTION REPORT', data.inspectionId, data.date)}

    ${sectionTitle('ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ظپط­طµ', 'Inspection Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط¹ظ…ظ„:', 'Work Order No.')}<span class="value">${data.workOrderId}</span></div>
      <div class="info-row">${lbl('ط§ظ„ط¹ظ…ظٹظ„:', 'Customer')}<span class="value">${data.customerName}</span></div>
      <div class="info-row">${lbl('ط§ظ„ط³ظٹط§ط±ط©:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>
      <div class="info-row">${lbl('ظ†ظˆط¹ ط§ظ„ط¶ط±ط±:', 'Damage Type')}<span class="value">${data.damageType}</span></div>
      <div class="info-row">${lbl('ط¹ط¯ط¯ ط§ظ„طµظˆط±:', 'Photos Count')}<span class="value">${data.photoCount} ${bi('طµظˆط±ط©', 'photos')}</span></div>
      <div class="info-row">${lbl('ط§ظ„ط­ط§ظ„ط©:', 'Status')}<span class="value"><span class="status-badge ${data.status === 'ظ…ظƒطھظ…ظ„' ? 'status-completed' : 'status-progress'}">${data.status}<span class="en">${statusEn}</span></span></span></div>
    </div>

    ${sectionTitle('طھظپط§طµظٹظ„ ط§ظ„ط£ط¶ط±ط§ط±', 'Damage Details')}
    <div style="border:2px dashed #ddd;border-radius:12px;padding:30px;text-align:center;margin:12px 0;min-height:180px;display:flex;align-items:center;justify-content:center;">
      <div style="color:#aaa;font-size:12px;">
        <div style="font-size:40px;margin-bottom:8px;">ًںڑ—</div>
        ظ…ط®ط·ط· ط§ظ„ط£ط¶ط±ط§ط± ط¹ظ„ظ‰ ط§ظ„ط³ظٹط§ط±ط©
        <div style="font-family:'Inter',sans-serif;font-size:10px;margin-top:3px;">Vehicle Damage Diagram</div>
      </div>
    </div>

    ${data.notes
      ? `<div class="notes-box"><span class="label-en">Inspector Notes</span><strong>ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ظپط§ط­طµ:</strong> ${data.notes}</div>`
      : `<div class="notes-box"><span class="label-en">Inspector Notes</span><strong>ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ظپط§ط­طµ:</strong> طھظ… ظپط­طµ ط§ظ„ط³ظٹط§ط±ط© ظˆطھظˆط«ظٹظ‚ ط§ظ„ط£ط¶ط±ط§ط± ط§ظ„ظ…ظˆط¶ط­ط© ط£ط¹ظ„ط§ظ‡. / Vehicle inspected and damages documented above.</div>`}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">طھظˆظ‚ظٹط¹ ط§ظ„ظپط§ط­طµ<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Inspector Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">طھظˆظ‚ظٹط¹ ط§ظ„ظ…ط¯ظٹط±<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Manager Signature</span></div></div>
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
    ${headerHtml(s, 'ط¹ط±ط¶ ط³ط¹ط±', 'PRICE QUOTATION', data.quoteNumber, data.date, 'background:linear-gradient(135deg,#2d6a4f,#1b4332);')}

    ${sectionTitle('ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط¹ظ…ظٹظ„', 'Customer Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      <div class="info-row">${lbl('ط§ظ„ط³ظٹط§ط±ط©:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©:', 'Plate Number')}<span class="value">${data.plateNumber}</span></div>
    </div>

    ${sectionTitle('طھظپط§طµظٹظ„ ط§ظ„ط¹ط±ط¶', 'Quotation Details')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:40px;text-align:center;')}
      ${th('ط§ظ„ظˆطµظپ', 'Description')}
      ${th('ط§ظ„ظƒظ…ظٹط©', 'Qty', 'width:60px;text-align:center;')}
      ${th('ط§ظ„ط³ط¹ط±', 'Unit Price', 'width:130px;text-align:center;')}
      ${th('ط§ظ„ظ…ط¬ظ…ظˆط¹', 'Total', 'width:140px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      <div class="totals-row"><span>${bi(`ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© (${s.vatRate}%)`, `VAT (${s.vatRate}%)`)}</span><span class="amount">${omr(data.vat)}</span></div>
      <div class="totals-row total"><span>${bi('ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ', 'Grand Total')}</span><span class="amount">${omr(data.total)}</span></div>
    </div>

    <div class="notes-box">
      <span class="label-en">Quote Terms &amp; Conditions</span>
      <strong>ط´ط±ظˆط· ط§ظ„ط¹ط±ط¶:</strong><br/>
      â€¢ ظ‡ط°ط§ ط§ظ„ط¹ط±ط¶ ط³ط§ط±ظٹ ط§ظ„ظ…ظپط¹ظˆظ„ ظ„ظ…ط¯ط© 15 ظٹظˆظ…ط§ظ‹ ظ…ظ† طھط§ط±ظٹط® ط§ظ„ط¥طµط¯ط§ط±. <span style="color:#999;font-family:'Inter',sans-serif;">/ This quote is valid for 15 days from the issue date.</span><br/>
      â€¢ ط§ظ„ط£ط³ط¹ط§ط± ط´ط§ظ…ظ„ط© ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©. <span style="color:#999;font-family:'Inter',sans-serif;">/ Prices are inclusive of VAT.</span><br/>
      â€¢ ظٹطھظ… ط§ظ„ط¨ط¯ط، ط¨ط§ظ„ط¹ظ…ظ„ ط¨ط¹ط¯ ط§ط¹طھظ…ط§ط¯ ط§ظ„ط¹ط±ط¶ ظ…ظ† ظ‚ط¨ظ„ ط§ظ„ط¹ظ…ظٹظ„. <span style="color:#999;font-family:'Inter',sans-serif;">/ Work commences upon customer approval.</span>
    </div>

    <div style="margin-top:40px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">طھظˆظ‚ظٹط¹ ط§ظ„ط¹ظ…ظٹظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ط¯ظٹط± ط§ظ„ظ…ط³ط¤ظˆظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Authorized Manager</span></div></div>
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
  const scopeLabel = data.scope === "vehicle" ? "ط¹ط±ط¨ظˆظ† ظ…ط±طھط¨ط· ط¨ط³ظٹط§ط±ط©" : "ط¹ط±ط¨ظˆظ† ط¹ط§ظ… ظ„ظ„ط¹ظ…ظٹظ„";
  const scopeLabelEn = data.scope === "vehicle" ? "Vehicle-linked Deposit" : "General Customer Deposit";

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, 'ط³ظ†ط¯ ظ‚ط¨ط¶ ط¹ط±ط¨ظˆظ†', 'DEPOSIT RECEIPT', data.receiptNumber, data.date, 'background:linear-gradient(135deg,#2d6a4f,#1b4332);')}

    ${sectionTitle('ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ط±ط¨ظˆظ†', 'Deposit Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      ${data.customerPhone ? `<div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ:', 'Phone')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;">${data.customerPhone}</span></div>` : ''}
      ${data.plateNumber ? `<div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©:', 'Plate No.')}<span class="value">${data.plateNumber}</span></div>` : ''}
      ${data.vehicleInfo ? `<div class="info-row">${lbl('ط§ظ„ط³ظٹط§ط±ط©:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>` : ''}
      <div class="info-row">${lbl('ظ†ظˆط¹ ط§ظ„ط¹ط±ط¨ظˆظ†:', 'Deposit Type')}<span class="value">${scopeLabel} <span style="color:#999;font-family:'Inter',sans-serif;font-size:9px;">/ ${scopeLabelEn}</span></span></div>
      <div class="info-row">${lbl('ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹:', 'Payment Method')}<span class="value">${data.paymentMethod}</span></div>
    </div>

    <div style="margin:24px 0;padding:24px;background:linear-gradient(135deg,#2d6a4f,#1b4332);color:white;border-radius:12px;text-align:center;">
      <div style="font-size:11px;opacity:0.85;margin-bottom:6px;">ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…ط³طھظ„ظ… <span style="font-family:'Inter',sans-serif;">/ Amount Received</span></div>
      <div style="font-size:32px;font-weight:700;font-family:'Inter',sans-serif;direction:ltr;">${data.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} OMR</div>
    </div>

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes</span><strong>ظ…ظ„ط§ط­ط¸ط§طھ:</strong> ${data.notes}</div>` : ''}

    <div class="notes-box" style="margin-top:14px;background:#fff8e1;border-right-color:#d4a537;">
      <strong>طھظ†ظˆظٹظ‡:</strong> ظ‡ط°ط§ ط§ظ„ظ…ط¨ظ„ط؛ ظٹظڈط¹طھط¨ط± ط¹ط±ط¨ظˆظ†ط§ظ‹ ${data.scope === "vehicle" ? `ظ…ط±طھط¨ط·ط§ظ‹ ط¨ط§ظ„ط³ظٹط§ط±ط© (${data.plateNumber || ""})` : "ط¹ط§ظ…ط§ظ‹ ظ„ظ„ط¹ظ…ظٹظ„"} ظˆظٹظڈط®طµظ… ظ…ظ† ط§ظ„ظپط§طھظˆط±ط© ط§ظ„ظ†ظ‡ط§ط¦ظٹط© ظ„ط§ط­ظ‚ط§ظ‹.
      <span style="display:block;color:#999;font-family:'Inter',sans-serif;font-size:9px;margin-top:3px;">Notice: This amount is considered a ${data.scope === "vehicle" ? "vehicle-linked" : "general customer"} deposit and will be deducted from the final invoice.</span>
    </div>

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">طھظˆظ‚ظٹط¹ ط§ظ„ط¹ظ…ظٹظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ط­ط§ط³ط¨<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Cashier / Accountant</span></div></div>
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
  const docLabelAr = isInvoice ? "ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط©" : "ط¹ط±ط¶ ط³ط¹ط±";
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
    const lineTotal = afterDisc; // VAT shown separately in totals â€” never add to line
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

    ${sectionTitle('ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط¹ظ…ظٹظ„', 'Customer Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      ${data.dueDate ? `<div class="info-row">${lbl('طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚:', 'Due Date')}<span class="value">${data.dueDate}</span></div>` : ''}
      ${data.paymentTerms ? `<div class="info-row" style="grid-column:1/-1">${lbl('ط´ط±ظˆط· ط§ظ„ط¯ظپط¹:', 'Payment Terms')}<span class="value">${data.paymentTerms}</span></div>` : ''}
      ${customFieldsHtml}
    </div>

    ${sectionTitle(isInvoice ? 'طھظپط§طµظٹظ„ ط§ظ„ظپط§طھظˆط±ط©' : 'طھظپط§طµظٹظ„ ط¹ط±ط¶ ط§ظ„ط³ط¹ط±', isInvoice ? 'Invoice Details' : 'Quote Details')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:36px;text-align:center;')}
      ${th('ط§ظ„ظˆطµظپ', 'Description')}
      ${th('ط§ظ„ظƒظ…ظٹط©', 'Qty', 'width:55px;text-align:center;')}
      ${th('ط§ظ„ط³ط¹ط±', 'Price', 'width:115px;text-align:center;')}
      ${th('ط®طµظ…', 'Disc', 'width:50px;text-align:center;')}
      ${th('ط¶ط±ظٹط¨ط©', 'Tax', 'width:55px;text-align:center;')}
      ${th('ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ', 'Total', 'width:130px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      ${data.discountTotal > 0 ? `<div class="totals-row"><span>${bi('ط§ظ„ط®طµظ…', 'Discount')}</span><span class="amount" style="color:#c33">- ${omr(data.discountTotal)}</span></div>` : ''}
      <div class="totals-row"><span>${bi('ط§ظ„ط¶ط±ظٹط¨ط©', 'VAT')}</span><span class="amount">${omr(data.taxTotal)}</span></div>
      <div class="totals-row total"><span>${bi('ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ', 'Grand Total')}</span><span class="amount">${omr(data.total)}</span></div>
    </div>

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes / ظ…ظ„ط§ط­ط¸ط§طھ</span>${data.notes}</div>` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">طھظˆظ‚ظٹط¹ ط§ظ„ط¹ظ…ظٹظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Customer Signature</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">${isInvoice ? 'ط§ظ„ظ…ط­ط§ط³ط¨ ط§ظ„ظ…ط³ط¤ظˆظ„' : 'ظ…ط¯ظٹط± ط§ظ„ظ…ط¨ظٹط¹ط§طھ'}<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">${isInvoice ? 'Accountant' : 'Sales Manager'}</span></div></div>
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
    ? `<div style="padding:14px;text-align:center;color:#aaa;font-size:11px;background:#fafafa;border-radius:6px;">ظ„ط§ ظٹظˆط¬ط¯ ط³ط¬ظ„ ط¹ظ…ظ„ظٹط§طھ / No work orders</div>`
    : `<table><thead><tr>
        ${th('ط±ظ‚ظ… ط§ظ„ط£ظ…ط±', 'Order #', 'width:90px;')}
        ${th('ط§ظ„طھط§ط±ظٹط®', 'Date', 'width:80px;text-align:center;')}
        ${th('ظ†ظˆط¹ ط§ظ„ط®ط¯ظ…ط©', 'Service')}
        ${th('ط§ظ„ظپظ†ظٹ', 'Technician', 'width:110px;')}
        ${th('ط§ظ„ط­ط§ظ„ط©', 'Status', 'width:90px;text-align:center;')}
        ${th('ط§ظ„طھظƒظ„ظپط©', 'Cost', 'width:110px;text-align:center;')}
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
    ${sectionTitle('طµظˆط± ظ‚ط¨ظ„ / ط¨ط¹ط¯', 'Before / After Photos')}
    <div style="display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:14px;">
      ${data.photoPairs!.map(p => `
        <div style="border:1px solid #eee;border-radius:8px;padding:10px;background:#fafafa;page-break-inside:avoid;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:10.5px;">
            <strong style="color:${s.primaryColor};">${p.caption || 'ظ…ط±ط­ظ„ط© ط§ظ„ط¥طµظ„ط§ط­'}</strong>
            <span style="color:#888;font-family:'Inter',sans-serif;">${p.workOrderId ? p.workOrderId + ' â€¢ ' : ''}${p.date}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <div style="font-size:9.5px;color:#888;margin-bottom:4px;text-align:center;font-weight:600;">ظ‚ط¨ظ„ / Before</div>
              <img src="${p.beforeUrl}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" crossorigin="anonymous"/>
            </div>
            <div>
              <div style="font-size:9.5px;color:${s.primaryColor};margin-bottom:4px;text-align:center;font-weight:600;">ط¨ط¹ط¯ / After</div>
              <img src="${p.afterUrl}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:2px solid ${s.primaryColor};" crossorigin="anonymous"/>
            </div>
          </div>
        </div>
      `).join('')}
    </div>`;

  const claimsHtml = (data.claims || []).length === 0 ? '' : `
    ${sectionTitle('ظ…ط·ط§ظ„ط¨ط§طھ ط§ظ„طھط£ظ…ظٹظ† ط§ظ„ظ…ط±طھط¨ط·ط©', 'Linked Insurance Claims')}
    <table><thead><tr>
      ${th('ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط©', 'Claim #', 'width:110px;')}
      ${th('ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†', 'Insurance Company')}
      ${th('ط§ظ„ظ…ظ‚ط¯ط±', 'Estimated', 'width:110px;text-align:center;')}
      ${th('ط§ظ„ظ…ط¹طھظ…ط¯', 'Approved', 'width:110px;text-align:center;')}
      ${th('ط§ظ„ط­ط§ظ„ط©', 'Status', 'width:90px;text-align:center;')}
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
    ${headerHtml(s, 'ط¨ط·ط§ظ‚ط© ط³ظٹط§ط±ط©', 'VEHICLE CARD', data.plate, today)}

    ${sectionTitle('ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط³ظٹط§ط±ط© ظˆط§ظ„ظ…ط§ظ„ظƒ', 'Vehicle & Owner Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©:', 'Plate Number')}<span class="value">${data.plate}</span></div>
      <div class="info-row">${lbl('ط§ظ„ظ†ظˆط¹/ط§ظ„ظ…ظˆط¯ظٹظ„:', 'Make/Model')}<span class="value">${data.type}</span></div>
      <div class="info-row">${lbl('ط§ظ„ط³ظ†ط©:', 'Year')}<span class="value">${data.year || '-'}</span></div>
      <div class="info-row">${lbl('ط§ظ„ظ„ظˆظ†:', 'Color')}<span class="value">${data.color || '-'}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„:', 'VIN')}<span class="value" style="font-family:'Inter',sans-serif;font-size:10.5px;">${data.vin || '-'}</span></div>
      <div class="info-row">${lbl('ط¹ط¯ط§ط¯ ط§ظ„ظ…ط³ط§ظپط©:', 'Mileage')}<span class="value">${data.mileage || '-'}</span></div>
      <div class="info-row">${lbl('ط§ظ„ظ…ط§ظ„ظƒ:', 'Owner')}<span class="value">${data.owner}</span></div>
      <div class="info-row">${lbl('ط§ظ„ظ‡ط§طھظپ:', 'Phone')}<span class="value" style="direction:ltr;font-family:'Inter',sans-serif;text-align:right;">${data.ownerPhone || '-'}</span></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 18px;">
      <div style="padding:12px;background:linear-gradient(135deg,${s.primaryColor}11,${s.primaryColor}05);border-right:3px solid ${s.primaryColor};border-radius:6px;">
        <div style="font-size:9.5px;color:#888;">ط¹ط¯ط¯ ط§ظ„ط²ظٹط§ط±ط§طھ / Visits</div>
        <div style="font-size:20px;font-weight:700;color:${s.primaryColor};font-family:'Inter',sans-serif;">${data.visits}</div>
      </div>
      <div style="padding:12px;background:#fafafa;border-right:3px solid #4caf50;border-radius:6px;">
        <div style="font-size:9.5px;color:#888;">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ظ†ظپط§ظ‚ / Total Spent</div>
        <div style="font-size:16px;font-weight:700;color:#1a1a2e;">${omr(data.totalSpent)}</div>
      </div>
      <div style="padding:12px;background:#fafafa;border-right:3px solid #2196f3;border-radius:6px;">
        <div style="font-size:9.5px;color:#888;">ط¢ط®ط± ط²ظٹط§ط±ط© / Last Visit</div>
        <div style="font-size:13px;font-weight:600;color:#1a1a2e;font-family:'Inter',sans-serif;">${data.lastVisit}</div>
      </div>
    </div>

    ${sectionTitle('ط³ط¬ظ„ ط£ظˆط§ظ…ط± ط§ظ„ط¹ظ…ظ„', 'Work Orders History')}
    ${ordersHtml}

    ${claimsHtml}

    ${photoPairsHtml}

    ${data.notes ? `<div class="notes-box"><span class="label-en">Notes</span><strong>ظ…ظ„ط§ط­ط¸ط§طھ:</strong> ${data.notes}</div>` : ''}

    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Vehicle ${data.plate}`, getBaseStyles(s), body);
}

// ===== INSURANCE COST ESTIMATE =====
// ظ‚ط§ظ„ط¨ طھظ‚ط¯ظٹط± طھظƒظ„ظپط© ط¥طµظ„ط§ط­ ظ…ظˆط¬ظژظ‘ظ‡ ظ„ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ† â€” ظ†ظپط³ ط¨ظ†ظٹط© ظ…ط­ط±ط± ط§ظ„ظپظˆط§طھظٹط±
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
  /** ط´ط±ظˆط· ظ…ط®طµطµط© ظ‚ط§ط¨ظ„ط© ظ„ظ„طھط¹ط¯ظٹظ„ â€” طھط³طھط¨ط¯ظ„ ط§ظ„ط´ط±ظˆط· ط§ظ„ط§ظپطھط±ط§ط¶ظٹط© */
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
    const lineTotal = afterDisc; // VAT shown separately in totals â€” never add to line
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
    ${headerHtml(s, 'طھظ‚ط¯ظٹط± طھظƒظ„ظپط© ط¥طµظ„ط§ط­', 'REPAIR COST ESTIMATE', data.number, data.issueDate, 'background:linear-gradient(135deg,#1e3a8a,#1e40af);')}

    ${sectionTitle('ط¨ظٹط§ظ†ط§طھ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†', 'Insurance Company Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†:', 'Insurance Company')}<span class="value">${data.insuranceCompany}${data.insuranceBranchCity ? ` â€” ${data.insuranceBranchCity}` : ''}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط©:', 'Claim No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.claimNumber}</span></div>
      ${data.insuranceCommercialRegistration ? `<div class="info-row">${lbl('ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ:', 'CR No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.insuranceCommercialRegistration}</span></div>` : ''}
      ${data.insuranceTaxNumber ? `<div class="info-row">${lbl('ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ:', 'VAT No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.insuranceTaxNumber}</span></div>` : ''}
      ${data.insurancePoBox ? `<div class="info-row">${lbl('طµ.ط¨ / ط§ظ„ط±ظ…ط² ط§ظ„ط¨ط±ظٹط¯ظٹ:', 'P.O. Box')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.insurancePoBox}</span></div>` : ''}
      ${data.insuranceAddress ? `<div class="info-row">${lbl('ط§ظ„ط¹ظ†ظˆط§ظ†:', 'Address')}<span class="value">${data.insuranceAddress}</span></div>` : ''}
      ${data.insurancePhone ? `<div class="info-row">${lbl('ط§ظ„ظ‡ط§طھظپ:', 'Phone')}<span class="value" style="direction:ltr;text-align:right;">${data.insurancePhone}</span></div>` : ''}
      ${data.policyNumber ? `<div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ط¨ظˆظ„ظٹطµط©:', 'Policy No.')}<span class="value" style="font-family:'Inter',sans-serif;direction:ltr;text-align:right;">${data.policyNumber}</span></div>` : ''}
      ${data.incidentDate ? `<div class="info-row">${lbl('طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹط±:', 'Incident Date')}<span class="value">${data.incidentDate}</span></div>` : ''}
    </div>

    ${sectionTitle('ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط¤ظ…ظژظ‘ظ† ظ„ظ‡ ظˆط§ظ„ظ…ط±ظƒط¨ط©', 'Insured & Vehicle Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط§ط³ظ… ط§ظ„ظ…ط¤ظ…ظژظ‘ظ† ظ„ظ‡:', 'Insured Name')}<span class="value">${data.customerName}</span></div>
      ${data.vehicleInfo ? `<div class="info-row">${lbl('ط§ظ„ط³ظٹط§ط±ط©:', 'Vehicle')}<span class="value">${data.vehicleInfo}</span></div>` : ''}
      ${data.vehiclePlate ? `<div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©:', 'Plate No.')}<span class="value">${data.vehiclePlate}</span></div>` : ''}
      ${customFieldsHtml}
    </div>

    ${data.incidentDescription ? `<div class="notes-box"><span class="label-en">Incident Description</span><strong>ظˆطµظپ ط§ظ„ط­ط§ط¯ط«:</strong> ${data.incidentDescription}</div>` : ''}

    ${sectionTitle('طھظپط§طµظٹظ„ ط§ظ„ط¥طµظ„ط§ط­ط§طھ ظˆظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط± ط§ظ„ظ…ط·ظ„ظˆط¨ط©', 'Repair & Parts Breakdown')}
    <table><thead><tr>
      ${th('#', 'No.', 'width:36px;text-align:center;')}
      ${th('ط§ظ„ظˆطµظپ', 'Description')}
      ${th('ط§ظ„ظƒظ…ظٹط©', 'Qty', 'width:55px;text-align:center;')}
      ${th('ط§ظ„ط³ط¹ط±', 'Price', 'width:115px;text-align:center;')}
      ${th('ط®طµظ…', 'Disc', 'width:50px;text-align:center;')}
      ${th('ط¶ط±ظٹط¨ط©', 'Tax', 'width:55px;text-align:center;')}
      ${th('ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ', 'Total', 'width:130px;text-align:center;')}
    </tr></thead><tbody>${itemsHtml}</tbody></table>

    <div class="totals-box">
      <div class="totals-row"><span>${bi('ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ', 'Subtotal')}</span><span class="amount">${omr(data.subtotal)}</span></div>
      ${data.discountTotal > 0 ? `<div class="totals-row"><span>${bi('ط§ظ„ط®طµظ…', 'Discount')}</span><span class="amount" style="color:#c33">- ${omr(data.discountTotal)}</span></div>` : ''}
      <div class="totals-row"><span>${bi('ط§ظ„ط¶ط±ظٹط¨ط©', 'VAT')}</span><span class="amount">${omr(data.taxTotal)}</span></div>
      <div class="totals-row total"><span>${bi('ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„طھظ‚ط¯ظٹط±', 'Estimated Total')}</span><span class="amount">${omr(data.total)}</span></div>
    </div>

    <div class="notes-box">
      <span class="label-en">Estimate Terms</span>
      <strong>ط´ط±ظˆط· ط§ظ„طھظ‚ط¯ظٹط±:</strong><br/>
      ${data.customTerms
        ? data.customTerms.split(/\r?\n/).filter(Boolean).map(l => `â€¢ ${l}`).join('<br/>')
        : `â€¢ ظ‡ط°ط§ ط§ظ„طھظ‚ط¯ظٹط± ط³ط§ط±ظٹ ط§ظ„ظ…ظپط¹ظˆظ„ ظ„ظ…ط¯ط© 30 ظٹظˆظ…ط§ظ‹ ظ…ظ† طھط§ط±ظٹط® ط§ظ„ط¥طµط¯ط§ط±. <span style="color:#999;font-family:'Inter',sans-serif;">/ This estimate is valid for 30 days.</span><br/>
      â€¢ ظ‚ط¯ طھطھط؛ظٹط± ط§ظ„ط£ط³ط¹ط§ط± ط­ط³ط¨ طھظˆظپط± ط§ظ„ظ‚ط·ط¹ ظˆطھط§ط±ظٹط® ط§ظ„ظ…ظˆط§ظپظ‚ط©. <span style="color:#999;font-family:'Inter',sans-serif;">/ Prices may change based on parts availability.</span><br/>
      â€¢ ظٹط¨ط¯ط£ ط§ظ„ط¹ظ…ظ„ ط¨ط¹ط¯ ط§ط¹طھظ…ط§ط¯ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† ط±ط³ظ…ظٹط§ظ‹. <span style="color:#999;font-family:'Inter',sans-serif;">/ Work commences upon official insurance approval.</span>`}
      ${data.notes ? `<br/><br/><strong>ظ…ظ„ط§ط­ط¸ط§طھ ط¥ط¶ط§ظپظٹط©:</strong> ${data.notes}` : ''}
    </div>

    <div style="margin-top:40px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:170px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ظڈظ‚ط¯ظگظ‘ط± / ط§ظ„ظپط§ط­طµ<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Estimator</span></div></div>
      <div style="text-align:center;width:170px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ظ…ط¯ظٹط± ط§ظ„ظˆط±ط´ط©<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Workshop Manager</span></div></div>
      <div style="text-align:center;width:170px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ظ…ظ†ط¯ظˆط¨ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Insurance Representative</span></div></div>
    </div>

    ${stampSignatureHtml(s, "quote")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Insurance Estimate ${data.number}`, getBaseStyles(s), body);
}

// ===== PAYMENT VOUCHER (ط³ظ†ط¯ طµط±ظپ) =====
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
    ${headerHtml(s, 'ط³ظ†ط¯ طµط±ظپ', 'PAYMENT VOUCHER', data.voucherNumber, data.date, 'background:linear-gradient(135deg,#dc2626,#991b1b);')}

    ${sectionTitle('ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظ†ط¯', 'Voucher Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط§ظ„ظ…ط³طھظپظٹط¯:', 'Beneficiary')}<span class="value">${data.beneficiary || '-'}</span></div>
      <div class="info-row">${lbl('ط§ظ„طھطµظ†ظٹظپ:', 'Category')}<span class="value">${data.categoryName}</span></div>
      <div class="info-row">${lbl('ط§ظ„ط®ط²ظٹظ†ط©:', 'Cashbox')}<span class="value">${data.cashboxName}</span></div>
      <div class="info-row">${lbl('ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹:', 'Payment Method')}<span class="value">${data.paymentMethod}</span></div>
      <div class="info-row">${lbl('ط§ظ„طھط§ط±ظٹط®:', 'Date')}<span class="value">${data.date}</span></div>
    </div>

    <div class="totals-box" style="width:100%;margin-top:20px;">
      <div class="totals-row total"><span>${bi('ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…طµط±ظˆظپ', 'Amount Paid')}</span><span class="amount">${omr(data.amount)}</span></div>
    </div>

    ${data.description ? `<div class="notes-box"><span class="label-en">Description</span><strong>ط§ظ„ط¨ظٹط§ظ†:</strong> ${data.description}</div>` : ''}

    ${data.photo ? `
      ${sectionTitle('طµظˆط±ط© ط§ظ„ط¥ظٹطµط§ظ„', 'Receipt Photo')}
      <div style="text-align:center;margin:15px 0;">
        <img src="${data.photo}" alt="receipt" style="max-width:100%;max-height:400px;border:1px solid #ddd;border-radius:8px;" />
      </div>
    ` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ط³طھظ„ظ…<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Recipient</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ط­ط§ط³ط¨<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Accountant</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ط¯ظٹط± ط§ظ„ظ…ط¹طھظ…ط¯<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Authorized Manager</span></div></div>
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
            ${g.serviceType ? ` <span style="opacity:0.85;font-size:10px;">â€¢ ${g.serviceType}</span>` : ''}
          </div>
          <div style="font-size:10px;opacity:0.9;font-family:'Inter',sans-serif;direction:ltr;">${g.orderDate} â€¢ ${g.photos.length} photos</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
          ${photosHtml}
        </div>
      </div>
    `;
  }).join('');

  const body = `<div class="page">
    ${s.showWatermark ? `<div class="watermark">${s.companyNameEn}</div>` : ''}
    ${headerHtml(s, "ط£ظ„ط¨ظˆظ… طµظˆط± ط§ظ„ظ…ط±ط§ط­ظ„", "STAGE PHOTOS ALBUM", data.vehiclePlate, today)}

    <div style="background:#f8f9fa;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:11px;">
      <div><span style="color:#888;">ط§ظ„ط³ظٹط§ط±ط© / Vehicle:</span> <strong>${data.vehicleType || data.vehiclePlate}</strong></div>
      <div><span style="color:#888;">ط§ظ„ظ…ط§ظ„ظƒ / Owner:</span> <strong>${data.owner || '-'}</strong></div>
      <div><span style="color:#888;">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„طµظˆط± / Total:</span> <strong>${totalPhotos}</strong> (${data.groups.length} ${data.groups.length === 1 ? 'order' : 'orders'})</div>
    </div>

    ${data.groups.length === 0
      ? `<div style="text-align:center;padding:60px;color:#999;font-size:12px;">ظ„ط§ طھظˆط¬ط¯ طµظˆط± ظ…ط±ط§ط­ظ„ / No stage photos available</div>`
      : groupsHtml}

    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Stage Photos ${data.vehiclePlate}`, getBaseStyles(s), body);
}

// ===== NEEDED PARTS (ط·ظ„ط¨ ظ‚ط·ط¹ ط؛ظٹط§ط±) =====
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
        <td style="text-align:center;width:60px;">${p.fulfilled ? 'âœ“' : 'âکگ'}</td>
      </tr>
    `).join('');
    return `
      <div style="margin-bottom:18px;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">
        <div style="background:#f8f9fa;padding:8px 12px;border-bottom:1px solid #e5e5e5;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;font-size:11px;">
          <div><strong>ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ / WO:</strong> <span style="font-family:monospace;color:#0070f3;">${r.workOrderId}</span></div>
          <div><strong>ط§ظ„ط¹ظ…ظٹظ„ / Customer:</strong> ${r.customer}</div>
          <div><strong>ط§ظ„ظ†ظˆط¹ / Make-Model:</strong> ${r.vehicleType || r.vehicle || '-'}${r.year ? ` â€” ${r.year}` : ''}</div>
          <div><strong>ط§ظ„ظ„ظˆط­ط© / Plate:</strong> <span style="font-family:monospace;">${r.plate}</span></div>
          <div style="grid-column:1 / -1;"><strong>ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„ / VIN:</strong> <span style="font-family:monospace;letter-spacing:0.5px;">${r.vin || '-'}</span></div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="background:#fafafa;border-bottom:1px solid #eee;">
              ${th('#', '#', 'text-align:center;')}
              ${th('ط§ط³ظ… ط§ظ„ظ‚ط·ط¹ط©', 'Part Name')}
              ${th('ط§ظ„ظƒظ…ظٹط©', 'Qty', 'text-align:center;')}
              ${th('ظ…ظ„ط§ط­ط¸ط§طھ', 'Notes')}
              ${th('ظ…ط¤ظ…ظ‘ظ†ط©', 'Done', 'text-align:center;')}
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
    ${headerHtml(s, 'ط·ظ„ط¨ ظ‚ط·ط¹ ط؛ظٹط§ط±', 'PARTS REQUEST', data.requestNumber, data.date)}

    ${sectionTitle('ط§ظ„ط³ظٹط§ط±ط§طھ ط§ظ„طھظٹ طھط­طھط§ط¬ ظ‚ط·ط¹ ط؛ظٹط§ط±', 'Vehicles Awaiting Parts')}
    ${data.rows.length === 0
      ? `<div style="text-align:center;padding:40px;color:#999;font-size:12px;">ظ„ط§ طھظˆط¬ط¯ ظ‚ط·ط¹ ظ…ط·ظ„ظˆط¨ط©</div>`
      : groupsHtml}

    <div style="margin-top:14px;padding:10px 14px;background:#f0f7ff;border:1px solid #cfe3ff;border-radius:8px;font-size:11.5px;display:flex;justify-content:space-between;">
      <span><strong>ط¹ط¯ط¯ ط§ظ„ط³ظٹط§ط±ط§طھ:</strong> ${data.rows.length}</span>
      <span><strong>ط¹ط¯ط¯ ط§ظ„ط¨ظ†ظˆط¯:</strong> ${totalLines}</span>
      <span><strong>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ‚ط·ط¹:</strong> ${totalParts}</span>
    </div>

    <div style="margin-top:50px;display:flex;justify-content:space-between;">
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط·ط§ظ„ط¨ ط§ظ„ط·ظ„ط¨<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Requested By</span></div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#888;">ط§ظ„ظ…ظˆط±ط¯ / ط§ظ„ظ…ط³ط¤ظˆظ„<span style="display:block;font-size:9px;color:#bbb;font-family:'Inter',sans-serif;">Supplier / Manager</span></div></div>
    </div>
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Parts Request ${data.requestNumber}`, getBaseStyles(s), body);
}

// ===== INSURANCE TAX INVOICE (ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط© ط±ط³ظ…ظٹط© ظ„ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† ظ…ط¹ QR) =====
export interface InsuranceTaxInvoiceData extends InsuranceEstimateData {
  invoiceNumber: string;          // ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط© ط§ظ„ط±ط³ظ…ظٹ
  qrDataUrl?: string;             // Data-URL ظ„ط±ظ…ط² ZATCA TLV
  paymentDueDate?: string;        // طھط§ط±ظٹط® ط§ط³طھط­ظ‚ط§ظ‚ ط§ظ„ط³ط¯ط§ط¯
  lpoNumber?: string;             // ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط´ط±ط§ط، ط§ظ„طµط§ط¯ط± ظ…ظ† ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† (LPO)
}

function invoiceRefEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  return toEnglishDigits(String(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function invoiceRefMoney(value: number): string {
  return (Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function invoiceRefCustom(data: InsuranceTaxInvoiceData, labels: string[]): string {
  const fields = Array.isArray(data.customFields) ? data.customFields : [];
  const found = fields.find((f) => labels.some((label) => String(f.label || "").toLowerCase().includes(label.toLowerCase())));
  return found?.value || "";
}

function renderInsuranceTaxInvoiceReference(data: InsuranceTaxInvoiceData): string {
  const s = getTemplateSettings();
  const subtotal = Number(data.subtotal) || 0;
  const vatAmount = Number(data.taxTotal) || Number((subtotal * ((s.vatRate || 5) / 100)).toFixed(3));
  const total = Number(data.total) || Number((subtotal + vatAmount).toFixed(3));
  const vatRate = subtotal > 0 ? Number(((vatAmount / subtotal) * 100).toFixed(3)) : (Number(s.vatRate) || 5);
  const vehicleParts = String(data.vehicleInfo || "").split(" - ");
  const vehicle = vehicleParts[0] || data.vehicleInfo || "â€”";
  const year = vehicleParts[1] || "";
  const vin = invoiceRefCustom(data, ["vin", "chassis", "ظ‡ظٹظƒظ„"]) || "â€”";
  const color = invoiceRefCustom(data, ["color", "ظ„ظˆظ†"]) || "â€”";
  const billToContact = invoiceRefCustom(data, ["contact", "ظ…ط³ط¤ظˆظ„", "employee"]) || data.customerName || "";
  const logo = s.logoUrl ? `<img src="${invoiceRefEscape(s.logoUrl)}" alt="logo"/>` : `<span class="logo-fallback"></span>`;
  const insuranceLogo = invoiceRefCustom(data, ["insurance logo", "logo url"]) || "";
  const insuranceLogoHtml = insuranceLogo ? `<img src="${invoiceRefEscape(insuranceLogo)}" alt="insurance logo"/>` : "âˆ؟";
  const stamp = s.stampEnabled && s.stampOnInvoice && s.stampUrl
    ? `<img src="${invoiceRefEscape(s.stampUrl)}" alt="stamp"/>`
    : "";
  const signature = s.signatureUrl
    ? `<img src="${invoiceRefEscape(s.signatureUrl)}" alt="signature"/>`
    : "";
  const itemRows = (data.items || []).filter((item) => String(item.description || "").trim()).map((item, index) => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.unitPrice) || 0;
    const line = Number((qty * rate).toFixed(3));
    return `<tr>
      <td class="c mono">${index + 1}</td>
      <td class="desc">${invoiceRefEscape(item.description)}<small>${invoiceRefEscape(data.claimNumber)}</small></td>
      <td class="c mono">${invoiceRefMoney(qty)}</td>
      <td class="l mono">${invoiceRefMoney(rate)}</td>
      <td class="l mono">${invoiceRefMoney(line)}</td>
    </tr>`;
  }).join("") || `<tr>
      <td class="c mono">1</td>
      <td class="desc">ط¥طµظ„ط§ط­ ط£ط¶ط±ط§ط± ط§ظ„ظ…ط±ظƒط¨ط© - ظ…ط·ط§ظ„ط¨ط©<small>${invoiceRefEscape(data.claimNumber)}</small></td>
      <td class="c mono">1.000</td>
      <td class="l mono">${invoiceRefMoney(subtotal)}</td>
      <td class="l mono">${invoiceRefMoney(subtotal)}</td>
    </tr>`;
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap');
    *{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff;color:#10213c}
    body{font-family:'Noto Sans Arabic','Inter','Segoe UI',Tahoma,sans-serif;font-size:11px}
    .page{width:210mm;min-height:297mm;margin:0 auto;padding:12mm 12mm 15mm;background:#fff;position:relative;overflow:visible}
    .mono,.money{font-family:'Inter','Noto Sans Arabic',sans-serif;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:embed}
    .top{display:grid;grid-template-columns:64mm 1fr;gap:18mm;align-items:start;direction:ltr}.invoice-card{width:54mm;background:#0f243e;color:#fff;border-radius:3px;text-align:center;padding:7mm 5mm 4mm;box-shadow:0 2px 5px rgba(15,36,62,.18)}
    .invoice-card .ar{font-size:13px;font-weight:700;margin-bottom:2mm}.invoice-card .en{font-family:'Inter',sans-serif;font-size:10px;font-weight:700;letter-spacing:.5px;margin-bottom:2mm}.invoice-card .no{font-family:'Inter',sans-serif;font-size:25px;font-weight:800;line-height:1}
    .invoice-date{width:54mm;text-align:center;margin-top:4mm;color:#53657f;font-family:'Inter',sans-serif;font-size:12px}
    .company{display:flex;align-items:flex-start;justify-content:flex-end;gap:8mm;text-align:right;padding-top:1mm;direction:rtl}.company-text h1{font-size:20px;line-height:1.25;margin:0 0 1mm;font-weight:800;color:#10213c}.company-text .en{font-family:'Inter',sans-serif;font-size:13px;font-weight:700;margin-bottom:5mm}.company-text .meta{font-family:'Inter','Noto Sans Arabic',sans-serif;color:#52647f;font-size:11px;line-height:1.7}
    .logo-box{width:26mm;height:32mm;display:flex;align-items:flex-start;justify-content:center;border-inline-start:1px solid #cdd6e3;padding-inline-start:5mm}.logo-box img{max-width:23mm;max-height:30mm;object-fit:contain}.logo-fallback{width:20mm;height:25mm;background:#0f243e;border:2px solid #d9a11e;clip-path:polygon(50% 0,95% 45%,50% 100%,5% 45%)}
    .rule{height:1px;background:#d8dee8;margin:10mm 0 4.5mm}.claim-box{border:1px solid #cfd8e6;border-radius:2px;min-height:19mm;display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:3mm 5mm;margin-bottom:4mm;direction:ltr}.claim-box .claim{text-align:left;direction:ltr}
    .label{font-family:'Inter','Noto Sans Arabic',sans-serif;text-transform:uppercase;font-size:9px;color:#475b76;font-weight:800;letter-spacing:.25px;margin-bottom:2mm}.big-val{font-family:'Inter','Noto Sans Arabic',sans-serif;font-size:15px;font-weight:800;color:#10213c}
    .insurance-side{display:flex;align-items:center;justify-content:flex-end;gap:4mm;text-align:center;direction:rtl}.insurance-logo{width:18mm;height:18mm;border:1px solid #d8dee8;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;color:#0f766e;font-weight:800}.insurance-logo img{max-width:16mm;max-height:16mm;object-fit:contain}
    .vehicle-box{border:1px solid #cfd8e6;border-radius:2px;display:grid;grid-template-columns:1fr 1fr 38mm;min-height:25mm;overflow:hidden;margin-bottom:3mm;direction:ltr;break-inside:avoid;page-break-inside:avoid}.vehicle-cell{padding:4.5mm 4mm 3mm;text-align:center}.vehicle-cell.color{text-align:left}.vehicle-cell .v{font-size:13px;font-weight:800;color:#10213c}.vehicle-cell .sub{font-family:'Inter',sans-serif;font-size:9px;color:#61728a;margin-top:2mm}
    .plate-box{background:#0f243e;color:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:5mm}.plate-no{border:1px solid rgba(255,255,255,.8);min-width:22mm;text-align:center;padding:4mm 5mm;font-family:'Inter',sans-serif;font-size:19px;font-weight:800;margin-bottom:3mm}.plate-label{font-family:'Inter','Noto Sans Arabic',sans-serif;font-size:9px;font-weight:800;color:#fff}
    .bill-row{border-top:1px solid #d8dee8;border-bottom:1px solid #d8dee8;display:grid;grid-template-columns:1fr 1fr 1fr 1.25fr;gap:7mm;padding:5mm 0;margin:4mm 0 5mm;text-align:center;direction:ltr}.bill-row .cell:last-child{text-align:right}.bill-row .v{font-size:12px;font-weight:800;color:#10213c}.bill-row .sub{font-size:9px;color:#64748b;margin-top:1.5mm}
    table.items{width:100%;border-collapse:collapse;margin-top:1mm;font-size:11px}.items thead th{border-bottom:1px solid #d8dee8;padding:0 3mm 3mm;color:#475b76;font-family:'Inter','Noto Sans Arabic',sans-serif;font-weight:800;text-align:right}.items thead th.c,.items tbody td.c{text-align:center}.items thead th.l,.items tbody td.l{text-align:left}.items tbody td{padding:7mm 3mm;border-bottom:1px solid #e3e8f0;vertical-align:top;color:#10213c}.items .desc{font-size:13px;font-weight:800;line-height:1.7}.items .desc small{display:block;font-family:'Inter',sans-serif;font-size:11px;margin-top:1mm}
    .summary-box{border:1px solid #cfd8e6;border-radius:2px;margin-top:4mm;display:grid;grid-template-columns:1fr 43mm;gap:7mm;padding:3mm 5mm;align-items:center;direction:ltr;break-inside:avoid;page-break-inside:avoid}.total-line{display:grid;grid-template-columns:24mm 1fr 26mm;gap:3mm;align-items:center;padding:1.5mm 0;color:#31445f}.total-line .cur{font-family:'Inter',sans-serif;font-size:9px;font-weight:700}.total-line .lbl{text-align:right;font-weight:700;color:#475b76}.total-line .amount{font-family:'Inter',sans-serif;text-align:left;font-weight:800;color:#10213c}.payable{margin-top:2mm;background:#0f243e;color:#fff;border-radius:2px;display:grid;grid-template-columns:1fr 36mm;align-items:center;padding:4mm 6mm}.payable .p-label{text-align:right;font-size:13px;font-weight:800}.payable .p-label span{display:block;font-family:'Inter',sans-serif;font-size:9px;margin-top:1mm;font-weight:700}.payable .p-amount{font-family:'Inter',sans-serif;font-size:22px;font-weight:800;text-align:left}.payable .cur-small{font-size:8px;font-weight:500;margin-top:1mm}
    .qr-box{text-align:center;justify-self:end}.qr-frame{border:1px solid #cfd8e6;padding:3mm;background:#fff;width:39mm;height:39mm;display:flex;align-items:center;justify-content:center}.qr-frame img{width:33mm;height:33mm;object-fit:contain}.qr-caption{font-family:'Inter',sans-serif;color:#66758d;margin-top:2mm;font-size:10px}
    .signatures{display:grid;grid-template-columns:1fr 1.3fr;gap:12mm;align-items:end;margin:6mm 9mm 0;direction:ltr;break-inside:avoid;page-break-inside:avoid}.sig-title,.stamp-title{font-size:10.5px;font-weight:800;color:#263b57;margin-bottom:2mm}.signature-line{height:19mm;display:flex;align-items:end}.signature-line:after{content:"";display:block;width:48mm;border-bottom:1px solid #10213c}.signature-line img{max-height:16mm;max-width:48mm;object-fit:contain}.stamp-placeholder{border:1px dashed #cbd5e1;border-radius:4px;height:19mm;display:flex;align-items:center;justify-content:center;color:#64748b;font-weight:700;text-align:center;font-size:9.5px;padding:2mm;background:#fff}.stamp-placeholder img{max-height:17mm;max-width:62mm;object-fit:contain}
    .legal{text-align:center;color:#42536c;font-size:9px;line-height:1.45;margin:5mm 8mm 0;break-inside:avoid;page-break-inside:avoid}.footer{position:static!important;margin-top:4mm;border-top:2px solid #d9a11e;text-align:center;color:#53657f;font-size:9px;padding-top:2mm;font-family:'Inter','Noto Sans Arabic',sans-serif;break-inside:avoid;page-break-inside:avoid}@media print{body{background:#fff}.page{margin:0;box-shadow:none;overflow:visible}.footer{position:static!important}}
  `;
  const body = `<div class="page">
    <div class="top"><div><div class="invoice-card"><div class="ar">ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط©</div><div class="en">TAX INVOICE</div><div class="no">${invoiceRefEscape(data.invoiceNumber)}</div></div><div class="invoice-date">${invoiceRefEscape(data.issueDate)}</div></div>
    <div class="company"><div class="company-text"><h1>${invoiceRefEscape(s.companyName)}</h1><div class="en">${invoiceRefEscape(s.companyNameEn)}</div><div class="meta">CR: ${invoiceRefEscape(s.commercialReg)} : ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ<br/>VAT: ${invoiceRefEscape(s.vatNumber)} : ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ<br/>${invoiceRefEscape(s.email)} â€¢ ${invoiceRefEscape(s.phone)}<br/>${invoiceRefEscape(s.address)}</div></div><div class="logo-box">${logo}</div></div></div>
    <div class="rule"></div>
    <div class="claim-box"><div class="claim"><div class="label"># CLAIM</div><div class="big-val">${invoiceRefEscape(data.claimNumber)}</div></div><div class="insurance-side"><div><div class="label">INSURANCE PROVIDER / ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†</div><div class="big-val">${invoiceRefEscape(data.insuranceCompany)}</div></div><div class="insurance-logo">${insuranceLogoHtml}</div></div></div>
    <div class="vehicle-box"><div class="vehicle-cell color"><div class="label">ط§ظ„ظ„ظˆظ† / COLOR</div><div class="v">${invoiceRefEscape(color)}</div><div class="sub">${invoiceRefEscape(data.lpoNumber || "â€”")}</div></div><div class="vehicle-cell"><div class="label">ط§ظ„ظ…ط±ظƒط¨ط© / VEHICLE</div><div class="v">${invoiceRefEscape([vehicle, year].filter(Boolean).join(" - ") || "â€”")}</div><div class="sub">VIN / ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„</div><div class="v mono" style="font-size:12px">${invoiceRefEscape(vin)}</div></div><div class="plate-box"><div class="plate-no">${invoiceRefEscape(data.vehiclePlate || "â€”")}</div><div class="plate-label">PLATE / ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©</div></div></div>
    <div class="bill-row"><div class="cell"><div class="label">طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ / طھط§ط±ظٹط® ط§ظ„ط­ظ‚ط§ظ‚</div><div class="label">DUE DATE</div><div class="v mono">${invoiceRefEscape(data.paymentDueDate || data.dueDate || "â€”")}</div></div><div class="cell"><div class="label">ط§ظ„ط±ظ‚ظ… ط§ظ„طھط¬ط§ط±ظٹ</div><div class="label">COMMERCIAL ID</div><div class="v mono">${invoiceRefEscape(data.insuranceCommercialRegistration || "â€”")}</div></div><div class="cell"><div class="label">ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ</div><div class="label">VAT REG / VAT</div><div class="v mono">${invoiceRefEscape(data.insuranceTaxNumber || "â€”")}</div></div><div class="cell"><div class="label">ط¥ظ„ظ‰ / BILL TO</div><div class="v">${invoiceRefEscape(data.insuranceCompany)}</div>${billToContact ? `<div class="sub">${invoiceRefEscape(billToContact)}</div>` : ""}</div></div>
    <table class="items"><thead><tr><th class="c">#</th><th>ط§ظ„ظˆطµظپ / DESCRIPTION</th><th class="c">ط§ظ„ظƒظ…ظٹط© / QTY</th><th class="l">ط§ظ„ظˆط­ط¯ط© / RATE</th><th class="l">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ / TOTAL</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="summary-box"><div class="totals"><div class="total-line"><span class="cur">OMR</span><span class="amount">${invoiceRefMoney(subtotal)}</span><span class="lbl">Subtotal / ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ</span></div><div class="total-line"><span class="cur">OMR</span><span class="amount">${invoiceRefMoney(vatAmount)}</span><span class="lbl">VAT ${invoiceRefMoney(vatRate).replace(".000", "")}% / ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©</span></div><div class="payable"><div class="p-amount">${invoiceRefMoney(total)}<div class="cur-small">OMR / ط±ظٹط§ظ„ ط¹ظ…ط§ظ†ظٹ</div></div><div class="p-label">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط³طھط­ظ‚<span>TOTAL PAYABLE</span></div></div></div><div class="qr-box"><div class="qr-frame">${data.qrDataUrl ? `<img src="${invoiceRefEscape(data.qrDataUrl)}" alt="QR"/>` : "QR"}</div><div class="qr-caption">ZATCA TLV QR</div></div></div>
    <div class="signatures"><div><div class="sig-title">ط§ظ„طھظˆظ‚ظٹط¹ / SIGNATURE</div><div class="signature-line">${signature}</div></div><div><div class="stamp-title">ط®طھظ… ط§ظ„ط´ط±ظƒط© / COMPANY STAMP</div><div class="stamp-placeholder">${stamp}</div></div></div>
    <div class="legal"><strong>ط¥ظپط§ط¯ط© ظ‚ط§ظ†ظˆظ†ظٹط©:</strong> ظ‡ط°ظ‡ ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط© طµط§ط¯ط±ط© ظˆظپظ‚ظ‹ط§ ظ„ط£ظ†ط¸ظ…ط© ط§ظ„ط¶ط±ط§ط¦ط¨ ط§ظ„ظ…ط¹ظ…ظˆظ„ ط¨ظ‡ط§ ظپظٹ ط³ظ„ط·ظ†ط© ط¹ظ…ط§ظ† ظˆط؛ظٹط± ظ…طµط±ط­ ط±ط¯ ط¶ط±ظٹط¨ط© QR.</div><div class="footer">${invoiceRefEscape(s.companyNameEn)} â€¢ آ© ${new Date().getFullYear()} â€¢ ${invoiceRefEscape(s.companyName)}</div>
  </div>`;
  return wrapHtml(`Tax Invoice ${data.invoiceNumber}`, styles, body);
}

function renderInsuranceTaxInvoiceReferenceClean(data: InsuranceTaxInvoiceData): string {
  const s = getTemplateSettings();
  const total = Number(data.total || 0);
  const subtotal = Number(data.subtotal || 0);
  const vatAmount = Number(data.taxTotal ?? Math.max(0, total - subtotal));
  const vatRate = subtotal > 0 ? (vatAmount / subtotal) * 100 : 5;
  const custom = {
    vin: invoiceRefCustom(data, ["vin", "chassis", "ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„"]),
    color: invoiceRefCustom(data, ["color", "ط§ظ„ظ„ظˆظ†"]),
    billToContact: invoiceRefCustom(data, ["contact", "ظ…ط³ط¤ظˆظ„", "employee"]),
    insuranceLogoUrl: invoiceRefCustom(data, ["insurance logo", "logo url"]),
  };
  const [vehicleRaw = "", yearRaw = ""] = String(data.vehicleInfo || "").split(" - ");
  const vehicle = vehicleRaw || "â€”";
  const year = yearRaw || "";
  const vin = custom.vin || "â€”";
  const color = custom.color || "â€”";
  const billToContact = custom.billToContact || "";
  const logo = s.logoUrl ? `<img src="${invoiceRefEscape(s.logoUrl)}" alt="Logo"/>` : `<span class="logo-fallback"></span>`;
  const insuranceLogoHtml = custom.insuranceLogoUrl
    ? `<img src="${invoiceRefEscape(String(custom.insuranceLogoUrl))}" alt="Insurance"/>`
    : invoiceRefEscape(String(data.insuranceCompany || "INS").slice(0, 3).toUpperCase());
  const signature = s.signatureUrl ? `<img src="${invoiceRefEscape(s.signatureUrl)}" alt="Signature"/>` : "";
  const stamp = s.stampEnabled && s.stampOnInvoice && s.stampUrl
    ? `<img src="${invoiceRefEscape(s.stampUrl)}" alt="Stamp"/>`
    : "";
  const itemDescription = `ط¥طµظ„ط§ط­ ط£ط¶ط±ط§ط± ط§ظ„ظ…ط±ظƒط¨ط© - ظ…ط·ط§ظ„ط¨ط©<br/><small>${invoiceRefEscape(data.claimNumber)}</small>`;
  const itemRows = `<tr><td class="c">1</td><td><div class="desc">${itemDescription}</div></td><td class="c mono">1.000</td><td class="l money">${invoiceRefMoney(subtotal)}</td><td class="l money">${invoiceRefMoney(subtotal)}</td></tr>`;
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap');
    *{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff;color:#10213c}
    body{font-family:'Noto Sans Arabic','Inter','Segoe UI',Tahoma,sans-serif;font-size:11px}
    .page{width:210mm;min-height:297mm;margin:0 auto;padding:12mm 12mm 15mm;background:#fff;position:relative;overflow:visible}
    .mono,.money{font-family:'Inter','Noto Sans Arabic',sans-serif;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:embed}
    .top{display:grid;grid-template-columns:64mm 1fr;gap:18mm;align-items:start;direction:ltr}.invoice-card{width:54mm;background:#0f243e;color:#fff;border-radius:3px;text-align:center;padding:7mm 5mm 4mm;box-shadow:0 2px 5px rgba(15,36,62,.18)}
    .invoice-card .ar{font-size:13px;font-weight:700;margin-bottom:2mm}.invoice-card .en{font-family:'Inter',sans-serif;font-size:10px;font-weight:700;letter-spacing:.5px;margin-bottom:2mm}.invoice-card .no{font-family:'Inter',sans-serif;font-size:25px;font-weight:800;line-height:1}
    .invoice-date{width:54mm;text-align:center;margin-top:4mm;color:#53657f;font-family:'Inter',sans-serif;font-size:12px}
    .company{display:flex;align-items:flex-start;justify-content:flex-end;gap:8mm;text-align:right;padding-top:1mm;direction:rtl}.company-text h1{font-size:20px;line-height:1.25;margin:0 0 1mm;font-weight:800;color:#10213c}.company-text .en{font-family:'Inter',sans-serif;font-size:13px;font-weight:700;margin-bottom:5mm}.company-text .meta{font-family:'Inter','Noto Sans Arabic',sans-serif;color:#52647f;font-size:11px;line-height:1.7}
    .logo-box{width:26mm;height:32mm;display:flex;align-items:flex-start;justify-content:center;border-inline-start:1px solid #cdd6e3;padding-inline-start:5mm}.logo-box img{max-width:23mm;max-height:30mm;object-fit:contain}.logo-fallback{width:20mm;height:25mm;background:#0f243e;border:2px solid #d9a11e;clip-path:polygon(50% 0,95% 45%,50% 100%,5% 45%)}
    .rule{height:1px;background:#d8dee8;margin:10mm 0 4.5mm}.claim-box{border:1px solid #cfd8e6;border-radius:2px;min-height:19mm;display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:3mm 5mm;margin-bottom:4mm;direction:ltr}.claim-box .claim{text-align:left;direction:ltr}
    .label{font-family:'Inter','Noto Sans Arabic',sans-serif;text-transform:uppercase;font-size:9px;color:#475b76;font-weight:800;letter-spacing:.25px;margin-bottom:2mm}.big-val{font-family:'Inter','Noto Sans Arabic',sans-serif;font-size:15px;font-weight:800;color:#10213c}
    .insurance-side{display:flex;align-items:center;justify-content:flex-end;gap:4mm;text-align:center;direction:rtl}.insurance-logo{width:18mm;height:18mm;border:1px solid #d8dee8;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;color:#0f766e;font-weight:800}.insurance-logo img{max-width:16mm;max-height:16mm;object-fit:contain}
    .vehicle-box{border:1px solid #cfd8e6;border-radius:2px;display:grid;grid-template-columns:1fr 1fr 38mm;min-height:25mm;overflow:hidden;margin-bottom:3mm;direction:ltr;break-inside:avoid;page-break-inside:avoid}.vehicle-cell{padding:4.5mm 4mm 3mm;text-align:center}.vehicle-cell.color{text-align:left}.vehicle-cell .v{font-size:13px;font-weight:800;color:#10213c}.vehicle-cell .sub{font-family:'Inter',sans-serif;font-size:9px;color:#61728a;margin-top:2mm}
    .plate-box{background:#0f243e;color:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:5mm}.plate-no{border:1px solid rgba(255,255,255,.8);min-width:22mm;text-align:center;padding:4mm 5mm;font-family:'Inter',sans-serif;font-size:19px;font-weight:800;margin-bottom:3mm}.plate-label{font-family:'Inter','Noto Sans Arabic',sans-serif;font-size:9px;font-weight:800;color:#fff}
    .bill-row{border-top:1px solid #d8dee8;border-bottom:1px solid #d8dee8;display:grid;grid-template-columns:1fr 1fr 1fr 1.25fr;gap:7mm;padding:5mm 0;margin:4mm 0 5mm;text-align:center;direction:ltr}.bill-row .cell:last-child{text-align:right}.bill-row .v{font-size:12px;font-weight:800;color:#10213c}.bill-row .sub{font-size:9px;color:#64748b;margin-top:1.5mm}
    table.items{width:100%;border-collapse:collapse;margin-top:1mm;font-size:11px}.items thead th{border-bottom:1px solid #d8dee8;padding:0 3mm 3mm;color:#475b76;font-family:'Inter','Noto Sans Arabic',sans-serif;font-weight:800;text-align:right}.items thead th.c,.items tbody td.c{text-align:center}.items thead th.l,.items tbody td.l{text-align:left}.items tbody td{padding:7mm 3mm;border-bottom:1px solid #e3e8f0;vertical-align:top;color:#10213c}.items .desc{font-size:13px;font-weight:800;line-height:1.7}.items .desc small{display:block;font-family:'Inter',sans-serif;font-size:11px;margin-top:1mm}
    .summary-box{border:1px solid #cfd8e6;border-radius:2px;margin-top:4mm;display:grid;grid-template-columns:1fr 43mm;gap:7mm;padding:3mm 5mm;align-items:center;direction:ltr;break-inside:avoid;page-break-inside:avoid}.total-line{display:grid;grid-template-columns:24mm 1fr 26mm;gap:3mm;align-items:center;padding:1.5mm 0;color:#31445f}.total-line .cur{font-family:'Inter',sans-serif;font-size:9px;font-weight:700}.total-line .lbl{text-align:right;font-weight:700;color:#475b76}.total-line .amount{font-family:'Inter',sans-serif;text-align:left;font-weight:800;color:#10213c}.payable{margin-top:2mm;background:#0f243e;color:#fff;border-radius:2px;display:grid;grid-template-columns:1fr 36mm;align-items:center;padding:4mm 6mm}.payable .p-label{text-align:right;font-size:13px;font-weight:800}.payable .p-label span{display:block;font-family:'Inter',sans-serif;font-size:9px;margin-top:1mm;font-weight:700}.payable .p-amount{font-family:'Inter',sans-serif;font-size:22px;font-weight:800;text-align:left}.payable .cur-small{font-size:8px;font-weight:500;margin-top:1mm}
    .qr-box{text-align:center;justify-self:end}.qr-frame{border:1px solid #cfd8e6;padding:3mm;background:#fff;width:39mm;height:39mm;display:flex;align-items:center;justify-content:center}.qr-frame img{width:33mm;height:33mm;object-fit:contain}.qr-caption{font-family:'Inter',sans-serif;color:#66758d;margin-top:2mm;font-size:10px}
    .signatures{display:grid;grid-template-columns:1fr 1.3fr;gap:12mm;align-items:end;margin:6mm 9mm 0;direction:ltr;break-inside:avoid;page-break-inside:avoid}.sig-title,.stamp-title{font-size:10.5px;font-weight:800;color:#263b57;margin-bottom:2mm}.signature-line{height:19mm;display:flex;align-items:end}.signature-line:after{content:"";display:block;width:48mm;border-bottom:1px solid #10213c}.signature-line img{max-height:16mm;max-width:48mm;object-fit:contain}.stamp-placeholder{border:1px dashed #cbd5e1;border-radius:4px;height:19mm;display:flex;align-items:center;justify-content:center;color:#64748b;font-weight:700;text-align:center;font-size:9.5px;padding:2mm;background:#fff}.stamp-placeholder img{max-height:17mm;max-width:62mm;object-fit:contain}
    .legal{text-align:center;color:#42536c;font-size:9px;line-height:1.45;margin:5mm 8mm 0;break-inside:avoid;page-break-inside:avoid}.footer{position:static!important;margin-top:4mm;border-top:2px solid #d9a11e;text-align:center;color:#53657f;font-size:9px;padding-top:2mm;font-family:'Inter','Noto Sans Arabic',sans-serif;break-inside:avoid;page-break-inside:avoid}@media print{body{background:#fff}.page{margin:0;box-shadow:none;overflow:visible}.footer{position:static!important}}
  `;
  const body = `<div class="page">
    <div class="top"><div><div class="invoice-card"><div class="ar">ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط©</div><div class="en">TAX INVOICE</div><div class="no">${invoiceRefEscape(data.invoiceNumber)}</div></div><div class="invoice-date">${invoiceRefEscape(data.issueDate)}</div></div>
    <div class="company"><div class="company-text"><h1>${invoiceRefEscape(s.companyName)}</h1><div class="en">${invoiceRefEscape(s.companyNameEn)}</div><div class="meta">CR: ${invoiceRefEscape(s.commercialReg)} : ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ<br/>VAT: ${invoiceRefEscape(s.vatNumber)} : ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ<br/>${invoiceRefEscape(s.email)} â€¢ ${invoiceRefEscape(s.phone)}<br/>${invoiceRefEscape(s.address)}</div></div><div class="logo-box">${logo}</div></div></div>
    <div class="rule"></div>
    <div class="claim-box"><div class="claim"><div class="label"># CLAIM</div><div class="big-val">${invoiceRefEscape(data.claimNumber)}</div></div><div class="insurance-side"><div><div class="label">INSURANCE PROVIDER / ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†</div><div class="big-val">${invoiceRefEscape(data.insuranceCompany)}</div></div><div class="insurance-logo">${insuranceLogoHtml}</div></div></div>
    <div class="vehicle-box"><div class="vehicle-cell color"><div class="label">ط§ظ„ظ„ظˆظ† / COLOR</div><div class="v">${invoiceRefEscape(color)}</div><div class="sub">${invoiceRefEscape(data.lpoNumber || "â€”")}</div></div><div class="vehicle-cell"><div class="label">ط§ظ„ظ…ط±ظƒط¨ط© / VEHICLE</div><div class="v">${invoiceRefEscape([vehicle, year].filter(Boolean).join(" - ") || "â€”")}</div><div class="sub">VIN / ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„</div><div class="v mono" style="font-size:12px">${invoiceRefEscape(vin)}</div></div><div class="plate-box"><div class="plate-no">${invoiceRefEscape(data.vehiclePlate || "â€”")}</div><div class="plate-label">PLATE / ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©</div></div></div>
    <div class="bill-row"><div class="cell"><div class="label">طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ / طھط§ط±ظٹط® ط§ظ„ط­ظ‚ط§ظ‚</div><div class="label">DUE DATE</div><div class="v mono">${invoiceRefEscape(data.paymentDueDate || data.dueDate || "â€”")}</div></div><div class="cell"><div class="label">ط§ظ„ط±ظ‚ظ… ط§ظ„طھط¬ط§ط±ظٹ</div><div class="label">COMMERCIAL ID</div><div class="v mono">${invoiceRefEscape(data.insuranceCommercialRegistration || "â€”")}</div></div><div class="cell"><div class="label">ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ</div><div class="label">VAT REG / VAT</div><div class="v mono">${invoiceRefEscape(data.insuranceTaxNumber || "â€”")}</div></div><div class="cell"><div class="label">ط¥ظ„ظ‰ / BILL TO</div><div class="v">${invoiceRefEscape(data.insuranceCompany)}</div>${billToContact ? `<div class="sub">${invoiceRefEscape(billToContact)}</div>` : ""}</div></div>
    <table class="items"><thead><tr><th class="c">#</th><th>ط§ظ„ظˆطµظپ / DESCRIPTION</th><th class="c">ط§ظ„ظƒظ…ظٹط© / QTY</th><th class="l">ط§ظ„ظˆط­ط¯ط© / RATE</th><th class="l">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ / TOTAL</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="summary-box"><div class="totals"><div class="total-line"><span class="cur">OMR</span><span class="amount">${invoiceRefMoney(subtotal)}</span><span class="lbl">Subtotal / ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ</span></div><div class="total-line"><span class="cur">OMR</span><span class="amount">${invoiceRefMoney(vatAmount)}</span><span class="lbl">VAT ${invoiceRefMoney(vatRate).replace(".000", "")}% / ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©</span></div><div class="payable"><div class="p-amount">${invoiceRefMoney(total)}<div class="cur-small">OMR / ط±ظٹط§ظ„ ط¹ظ…ط§ظ†ظٹ</div></div><div class="p-label">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط³طھط­ظ‚<span>TOTAL PAYABLE</span></div></div></div><div class="qr-box"><div class="qr-frame">${data.qrDataUrl ? `<img src="${invoiceRefEscape(data.qrDataUrl)}" alt="QR"/>` : "QR"}</div><div class="qr-caption">ZATCA TLV QR</div></div></div>
    <div class="signatures"><div><div class="sig-title">ط§ظ„طھظˆظ‚ظٹط¹ / SIGNATURE</div><div class="signature-line">${signature}</div></div><div><div class="stamp-title">ط®طھظ… ط§ظ„ط´ط±ظƒط© / COMPANY STAMP</div><div class="stamp-placeholder">${stamp}</div></div></div>
    <div class="legal"><strong>ط¥ظپط§ط¯ط© ظ‚ط§ظ†ظˆظ†ظٹط©:</strong> ظ‡ط°ظ‡ ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط© طµط§ط¯ط±ط© ظˆظپظ‚ظ‹ط§ ظ„ط£ظ†ط¸ظ…ط© ط§ظ„ط¶ط±ط§ط¦ط¨ ط§ظ„ظ…ط¹ظ…ظˆظ„ ط¨ظ‡ط§ ظپظٹ ط³ظ„ط·ظ†ط© ط¹ظ…ط§ظ† ظˆط؛ظٹط± ظ…طµط±ط­ ط±ط¯ ط¶ط±ظٹط¨ط© QR.</div><div class="footer">${invoiceRefEscape(s.companyNameEn)} â€¢ آ© ${new Date().getFullYear()} â€¢ ${invoiceRefEscape(s.companyName)}</div>
  </div>`;
  return wrapHtml(`Tax Invoice ${data.invoiceNumber}`, styles, body);
}

export function getInsuranceTaxInvoiceHtml(data: InsuranceTaxInvoiceData): string {
  return renderInsuranceTaxInvoiceReferenceClean(data);
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

    /* Header â€” logo + bilingual company name + Tax Invoice title */
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

    /* Totals â€” same minimal style as the screenshot */
    .totals{margin-top:0;border-collapse:collapse;width:100%;font-size:11.5px}
    .totals td{padding:6px 10px;border:1px solid #ccc}
    .totals tr.subtotal td{background:#fafafa}
    .totals tr.grand td{background:#1a1a1a;color:#fff;font-weight:700;font-size:13px}
    .totals tr.grand td.label{letter-spacing:0.5px}
    .totals .lbl{font-weight:600;width:60%}
    .totals .lbl .ar{font-family:'Noto Sans Arabic',sans-serif;color:#888;font-size:10px;font-weight:500;display:inline-block;margin-right:6px}
    .totals .val{text-align:left;font-family:'Inter',sans-serif;direction:ltr}

    /* Footer area â€” QR + bank + signatures */
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

  // â”€â”€â”€ Items rows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€â”€ Bank block â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const bankBlock = (data.insuranceBankName || data.insuranceIban) ? `
    <div class="bank">
      <div class="h">Bank Transfer Details <span class="ar">ط¨ظٹط§ظ†ط§طھ ط§ظ„طھط­ظˆظٹظ„ ط§ظ„ط¨ظ†ظƒظٹ</span></div>
      ${data.insuranceBankName ? `<div class="row"><span class="k">Bank / ط§ظ„ط¨ظ†ظƒ</span><span>${data.insuranceBankName}</span></div>` : ''}
      ${data.insuranceBankAccountName ? `<div class="row"><span class="k">Account Name / ط§ط³ظ… ط§ظ„ط­ط³ط§ط¨</span><span>${data.insuranceBankAccountName}</span></div>` : ''}
      ${data.insuranceIban ? `<div class="row"><span class="k">IBAN</span><span style="letter-spacing:1px;font-weight:700">${data.insuranceIban}</span></div>` : ''}
    </div>` : '';

  // â”€â”€â”€ Vehicle / claim metadata extraction (from data.vehicleInfo + customFields) â”€â”€â”€
  // vehicleInfo is usually "Make Model - Year"
  const vehMake = (data.vehicleInfo || "").split(/\s+/)[0] || "â€”";
  const vehModelParts = (data.vehicleInfo || "").split(/\s+/).slice(1).join(" ").split("-")[0].trim() || "â€”";

  const body = `<div class="page">
    <!-- Top header -->
    <div class="top">
      <div class="left">
        ${s.logoUrl ? `<img src="${s.logoUrl}" alt="logo"/>` : ''}
        <div class="name-en">${s.companyNameEn}</div>
        <div class="name-ar">${s.companyName}</div>
        <div class="meta">
          ${s.address}<br/>
          ${s.phone} آ· ${s.email}
        </div>
      </div>
      <div class="right">
        <div class="title">Tax Invoice</div>
        <div class="title-ar">ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط©</div>
      </div>
    </div>

    <!-- Two-column key-value summary (matches reference) -->
    <div class="summary">
      <div class="col">
        <div class="row"><span class="k">Invoice number <span class="ar">ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©</span></span><span class="v">${data.invoiceNumber}</span></div>
        <div class="row"><span class="k">Invoice date <span class="ar">طھط§ط±ظٹط® ط§ظ„ظپط§طھظˆط±ط©</span></span><span class="v">${data.issueDate}</span></div>
        <div class="row"><span class="k">Vehicle Make <span class="ar">طµظ†ط¹ ط§ظ„ظ…ط±ظƒط¨ط©</span></span><span class="v">${vehMake}</span></div>
        <div class="row"><span class="k">Model <span class="ar">ط§ظ„ظ…ظˆط¯ظٹظ„</span></span><span class="v">${vehModelParts}</span></div>
        <div class="row"><span class="k">Reg. No. <span class="ar">ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©</span></span><span class="v">${data.vehiclePlate || 'â€”'}</span></div>
        <div class="row"><span class="k">Claim No. <span class="ar">ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط©</span></span><span class="v">${data.claimNumber}</span></div>
        ${data.lpoNumber ? `<div class="row lpo-row"><span class="k"><span class="lpo-tag">LPO</span> <span class="ar">ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط´ط±ط§ط،</span></span><span class="v" style="color:#0284c7;font-weight:800">${data.lpoNumber}</span></div>` : ''}
      </div>
      <div class="col">
        <div class="row"><span class="k">Invoice to <span class="ar">ط¥ظ„ظ‰</span></span><span class="v">${data.insuranceCompany}</span></div>
        ${data.insuranceAddress ? `<div class="row"><span class="k">Address <span class="ar">ط§ظ„ط¹ظ†ظˆط§ظ†</span></span><span class="v" style="font-weight:500;font-size:10.5px;text-align:left">${data.insuranceAddress}</span></div>` : ''}
        ${data.insurancePoBox ? `<div class="row"><span class="k">P.O. Box <span class="ar">طµ.ط¨</span></span><span class="v">${data.insurancePoBox}</span></div>` : ''}
        ${data.insuranceTaxNumber ? `<div class="row"><span class="k"><span class="tax-tag">TAX</span></span><span class="v">${data.insuranceTaxNumber}</span></div>` : ''}
        ${data.insuranceCommercialRegistration ? `<div class="row"><span class="k">CR No. <span class="ar">ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ</span></span><span class="v">${data.insuranceCommercialRegistration}</span></div>` : ''}
        ${data.paymentDueDate ? `<div class="row"><span class="k">Due Date <span class="ar">ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚</span></span><span class="v">${data.paymentDueDate}</span></div>` : ''}
      </div>
    </div>

    <!-- Items -->
    <table class="items">
      <thead>
        <tr>
          <th style="width:50px;text-align:center">Item <span class="ar">ط§ظ„ط¨ظ†ط¯</span></th>
          <th>Description <span class="ar">ط§ظ„ظˆطµظپ</span></th>
          <th style="width:130px;text-align:left">Total <span class="ar">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</span></th>
        </tr>
      </thead>
      <tbody>${itemsRows || `<tr><td class="idx">1</td><td>The vehicle has been repaired in accordance with the report.</td><td class="num">${omr(data.subtotal)}</td></tr>`}</tbody>
    </table>

    <!-- Totals -->
    <table class="totals">
      <tr class="subtotal"><td class="lbl">Subtotal <span class="ar">ط§ظ„ظ…ط¬ظ…ظˆط¹ ط§ظ„ظپط±ط¹ظٹ</span></td><td class="val">${omr(data.subtotal)}</td></tr>
      ${data.discountTotal > 0 ? `<tr><td class="lbl">Discount <span class="ar">ط§ظ„ط®طµظ…</span></td><td class="val" style="color:#c33">- ${omr(data.discountTotal)}</td></tr>` : ''}
      <tr><td class="lbl">VAT 5% <span class="ar">ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©</span></td><td class="val">${omr(data.taxTotal)}</td></tr>
      <tr class="grand"><td class="lbl label">Total <span class="ar" style="color:#bbb">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</span></td><td class="val">${omr(data.total)}</td></tr>
      <tr><td class="lbl">Paid <span class="ar">ظ…ط¯ظپظˆط¹</span></td><td class="val">${omr(0)}</td></tr>
      <tr><td class="lbl">Amount Due <span class="ar">ط§ظ„ط±طµظٹط¯ ط§ظ„ظ…ط³طھط­ظ‚</span></td><td class="val" style="font-weight:700">${omr(data.total)}</td></tr>
    </table>

    ${bankBlock}

    <!-- Footer area: QR + legal -->
    <div class="footer-area">
      <div class="left">
        <strong>Notice <span class="ar">ط¥ط´ط¹ط§ط±</span>:</strong> This is an official tax invoice issued under the VAT regulations of the Sultanate of Oman.
        <span class="ar">ظ‡ط°ظ‡ ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط© ط±ط³ظ…ظٹط© طµط§ط¯ط±ط© ظˆظپظ‚ ظ†ط¸ط§ظ… ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© ظپظٹ ط³ظ„ط·ظ†ط© ط¹ظ…ط§ظ†.</span>
        ${data.notes ? `<br/><strong>Notes <span class="ar">ظ…ظ„ط§ط­ط¸ط§طھ</span>:</strong> ${data.notes}` : ''}
      </div>
      ${data.qrDataUrl ? `
        <div class="qr-box">
          <img src="${data.qrDataUrl}" alt="QR"/>
          <div class="lbl">ZATCA / TLV QR</div>
        </div>` : ''}
    </div>

    <!-- Signatures -->
    <div class="stamp-row">
      <div class="col">Accountant <span class="ar">ط§ظ„ظ…ط­ط§ط³ط¨</span></div>
      <div class="col">Workshop Manager <span class="ar">ظ…ط¯ظٹط± ط§ظ„ظˆط±ط´ط©</span></div>
      <div class="col">Insurer Stamp & Sign <span class="ar">ط®طھظ… ظˆطھظˆظ‚ظٹط¹ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†</span></div>
    </div>

    ${stampSignatureHtml(s, "invoice")}

    <div class="doc-footer">${s.companyNameEn} آ· ${s.companyName} آ· آ© ${new Date().getFullYear()}</div>
  </div>`;

  return wrapHtml(`Tax Invoice ${data.invoiceNumber}`, styles, body);
}

// ===== VEHICLE DELIVERY RECEIPT (ط¥ظ‚ط±ط§ط± ط§ط³طھظ„ط§ظ… ط³ظٹط§ط±ط© ظ…ظ† ط§ظ„ظˆط±ط´ط©) =====
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
    ${headerHtml(s, 'ط¥ظ‚ط±ط§ط± ط§ط³طھظ„ط§ظ… ط³ظٹط§ط±ط©', 'VEHICLE DELIVERY RECEIPT', data.receiptNumber, data.date, 'background:linear-gradient(135deg,#059669,#047857);')}

    <div style="background:#f0fdf4;border:2px solid #10b981;border-radius:10px;padding:14px 16px;margin:14px 0;font-size:13px;line-height:1.9;">
      <strong style="color:#047857;">ط¥ظ‚ط±ط§ط± ط§ط³طھظ„ط§ظ…:</strong>
      ط£ظ‚ط±ظ‘ ط£ظ†ط§ ط§ظ„ظ…ظˆظ‚ظ‘ط¹ ط£ط¯ظ†ط§ظ‡ ط¨ط£ظ†ظ†ظٹ ط§ط³طھظ„ظ…طھ ط³ظٹط§ط±طھظٹ ط§ظ„ظ…ظˆطµظˆظپط© ط¨ظٹط§ظ†ط§طھظ‡ط§ ط£ط¯ظ†ط§ظ‡ ظ…ظ†
      <strong>${s.companyName}</strong> ط¨ط­ط§ظ„ط© ط¬ظٹط¯ط© ظˆط³ظ„ظٹظ…ط© ظˆظ‚ظ…طھ ط¨ظ…ط¹ط§ظٹظ†طھظ‡ط§ ظ…ط¹ط§ظٹظ†ط© ظƒط§ظ…ظ„ط©طŒ
      ظˆط£ظ†ظ‡ طھظ… طھظ†ظپظٹط° ط§ظ„ط£ط¹ظ…ط§ظ„ ط§ظ„ظ…ط·ظ„ظˆط¨ط© ط¹ظ„ظ‰ ط£ظƒظ…ظ„ ظˆط¬ظ‡طŒ ظˆظ„ط§ ظٹط­ظ‚ ظ„ظٹ ظ…ط·ط§ظ„ط¨ط© ط§ظ„ظˆط±ط´ط© ط¨ط£ظٹ ظ…ط·ط§ظ„ط¨ط§طھ ظ„ط§ط­ظ‚ط© ط¨ط®طµظˆطµ ط§ظ„ط£ط¹ظ…ط§ظ„ ط§ظ„ظ…ظ†ظپط°ط©
      ط¹ط¯ط§ ظ…ط§ ظ‡ظˆ ظ…ط´ظ…ظˆظ„ ط¨ط§ظ„ط¶ظ…ط§ظ† ط§ظ„ظ…ظˆط¶ط­ ط£ط¯ظ†ط§ظ‡.
      ${data.workOrderNumber ? `<br/>ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ط§ظ„ظ…ط±ط¬ط¹ظٹ: <strong>${data.workOrderNumber}</strong>` : ''}
    </div>

    ${sectionTitle('ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط±ظƒط¨ط©', 'Vehicle Information')}
    <div class="info-grid">
      <div class="info-row">${lbl('ظ†ظˆط¹ ط§ظ„ظ…ط±ظƒط¨ط©:', 'Vehicle')}<span class="value">${data.vehicleType} ${data.model || ''}</span></div>
      <div class="info-row">${lbl('ط³ظ†ط© ط§ظ„طµظ†ط¹:', 'Year')}<span class="value">${data.year || '-'}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©:', 'Plate')}<span class="value">${data.plateNumber}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„:', 'VIN')}<span class="value">${data.vin || '-'}</span></div>
      <div class="info-row">${lbl('ط§ظ„ظ„ظˆظ†:', 'Color')}<span class="value">${data.color || '-'}</span></div>
      <div class="info-row">${lbl('ظ‚ط±ط§ط،ط© ط§ظ„ط¹ط¯ط§ط¯ ط¹ظ†ط¯ ط§ظ„طھط³ظ„ظٹظ…:', 'Mileage Out')}<span class="value">${data.mileageOut || '-'}</span></div>
    </div>

    ${sectionTitle('ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظٹظ„/ط§ظ„ظ…ط³طھظ„ظ…', 'Customer / Receiver')}
    <div class="info-grid">
      <div class="info-row">${lbl('ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„:', 'Customer Name')}<span class="value">${data.customerName}</span></div>
      <div class="info-row">${lbl('ظ‡ط§طھظپ ط§ظ„ط¹ظ…ظٹظ„:', 'Phone')}<span class="value">${data.customerPhone || '-'}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ظ‡ظˆظٹط© ط§ظ„ط¹ظ…ظٹظ„:', 'Customer ID')}<span class="value">${data.customerIdNumber || '-'}</span></div>
      <div class="info-row">${lbl('ط§ط³ظ… ط§ظ„ظ…ط³طھظ„ظ…:', 'Receiver')}<span class="value">${data.receiverName || data.customerName}</span></div>
      <div class="info-row">${lbl('ط±ظ‚ظ… ظ‡ظˆظٹط© ط§ظ„ظ…ط³طھظ„ظ…:', 'Receiver ID')}<span class="value">${data.receiverIdNumber || '-'}</span></div>
      <div class="info-row">${lbl('طھط§ط±ظٹط® ط§ظ„طھط³ظ„ظٹظ…:', 'Delivery Date')}<span class="value">${data.date}</span></div>
    </div>

    ${data.workSummary ? `${sectionTitle('ظ…ظ„ط®طµ ط§ظ„ط£ط¹ظ…ط§ظ„ ط§ظ„ظ…ظ†ظپط°ط©', 'Work Summary')}
    <div class="notes-box" style="white-space:pre-wrap;">${data.workSummary}</div>` : ''}

    ${data.partsReplaced ? `${sectionTitle('ط§ظ„ظ‚ط·ط¹ ط§ظ„ظ…ط³طھط¨ط¯ظ„ط©', 'Parts Replaced')}
    <div class="notes-box" style="white-space:pre-wrap;">${data.partsReplaced}</div>` : ''}

    ${data.warrantyNotes ? `${sectionTitle('ط§ظ„ط¶ظ…ط§ظ† ظˆط§ظ„ظ…ظ„ط§ط­ط¸ط§طھ', 'Warranty & Notes')}
    <div class="notes-box" style="background:#fef3c7;border-color:#f59e0b;white-space:pre-wrap;">${data.warrantyNotes}</div>` : ''}

    ${data.satisfactionNotes ? `<div class="notes-box" style="background:#eff6ff;border-color:#3b82f6;white-space:pre-wrap;"><strong>ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ط¹ظ…ظٹظ„ ط¹ظ† ط§ظ„ط±ط¶ط§:</strong> ${data.satisfactionNotes}</div>` : ''}

    ${data.idPhotoDataUrl ? `
      ${sectionTitle('طµظˆط±ط© ظ‡ظˆظٹط© ط§ظ„ظ…ط³طھظ„ظ…', 'Receiver ID')}
      <div style="text-align:center;margin:10px 0;">
        <img src="${data.idPhotoDataUrl}" alt="id" style="max-width:60%;max-height:280px;border:1px solid #ddd;border-radius:8px;" />
      </div>
    ` : ''}

    <div style="margin-top:50px;display:flex;justify-content:space-between;gap:20px;">
      <div style="text-align:center;flex:1;">
        ${data.signatureDataUrl ? `<img src="${data.signatureDataUrl}" alt="sig" style="max-height:70px;display:block;margin:0 auto 4px;" />` : ''}
        <div style="border-top:1px solid #444;padding-top:6px;font-size:11px;color:#444;font-weight:600;">
          طھظˆظ‚ظٹط¹ ط§ظ„ظ…ط³طھظ„ظ…<br/><span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;">Receiver Signature</span>
        </div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="border-top:1px solid #444;padding-top:6px;font-size:11px;color:#444;font-weight:600;margin-top:30px;">
          ظ…ظ†ط¯ظˆط¨ ط§ظ„ظˆط±ط´ط©<br/><span style="font-size:9px;color:#888;font-family:'Inter',sans-serif;">Workshop Representative</span>
        </div>
      </div>
    </div>

    ${stampSignatureHtml(s, "voucher")}
    ${footerHtml(s)}
  </div>`;
  return wrapHtml(`Delivery Receipt ${data.receiptNumber}`, getBaseStyles(s), body);
}
