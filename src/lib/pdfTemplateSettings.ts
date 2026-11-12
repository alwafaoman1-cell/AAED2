// Lightweight settings singleton. Keep PDF renderers out of the auth/startup graph.
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

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

export const DEFAULT_PDF_TEMPLATE_SETTINGS: PdfTemplateSettings = { ...DEFAULT_SETTINGS };

export const STAMP_SIZE_PX: Record<StampSize, number> = { sm: 100, md: 150, lg: 200 };

// In-memory cache + listeners so async cloud loads can notify open screens.
const CLOUD_KEY = "company_template_settings_v1";
let templateCache: PdfTemplateSettings | null = null;
let templateSettingsLoadedFromCloud = false;
const templateListeners = new Set<() => void>();
type TemplateAssetField = "logoUrl" | "stampUrl" | "signatureUrl";
type TemplateIdentityField =
  | "companyName"
  | "companyNameEn"
  | "commercialReg"
  | "vatNumber"
  | "phone"
  | "email"
  | "address";

interface SaveTemplateSettingsOptions {
  clearAssetFields?: TemplateAssetField[];
}

export function getTemplateSettings(): PdfTemplateSettings {
  if (templateCache) return templateCache;
  templateCache = { ...DEFAULT_SETTINGS };
  void loadTemplateSettingsFromCloud();
  return templateCache;
}

export async function getTemplateSettingsAsync(): Promise<PdfTemplateSettings> {
  await loadTemplateSettingsFromCloud();
  return getTemplateSettings();
}

export function subscribeTemplateSettings(cb: () => void): () => void {
  templateListeners.add(cb);
  return () => { templateListeners.delete(cb); };
}

function mergeTemplateSettingsForSave(
  incoming: PdfTemplateSettings,
  existing?: Partial<PdfTemplateSettings> | null,
  options: SaveTemplateSettingsOptions = {},
): PdfTemplateSettings {
  const clearAssets = new Set(options.clearAssetFields || []);
  const next = { ...DEFAULT_SETTINGS, ...(existing || {}), ...incoming } as PdfTemplateSettings;
  for (const field of ["companyName", "companyNameEn", "commercialReg", "vatNumber", "phone", "email", "address"] as TemplateIdentityField[]) {
    const value = incoming[field];
    if ((value === undefined || value === "" || value === DEFAULT_SETTINGS[field]) && existing?.[field]) {
      next[field] = existing[field] as string;
    }
  }
  for (const field of ["logoUrl", "stampUrl", "signatureUrl"] as const) {
    if (clearAssets.has(field)) {
      delete next[field];
      continue;
    }
    if (!incoming[field] && existing?.[field]) next[field] = existing[field];
  }
  return next;
}

export async function saveTemplateSettings(
  settings: PdfTemplateSettings,
  options: SaveTemplateSettingsOptions = {},
): Promise<PdfTemplateSettings> {
  const existing = await readCloudSetting<Partial<PdfTemplateSettings> | null>(CLOUD_KEY, null).catch(() => null);
  const incomingUsesDefaultIdentity =
    settings.companyName === DEFAULT_SETTINGS.companyName &&
    settings.companyNameEn === DEFAULT_SETTINGS.companyNameEn &&
    settings.commercialReg === DEFAULT_SETTINGS.commercialReg &&
    settings.vatNumber === DEFAULT_SETTINGS.vatNumber &&
    settings.phone === DEFAULT_SETTINGS.phone &&
    settings.email === DEFAULT_SETTINGS.email &&
    settings.address === DEFAULT_SETTINGS.address;
  if (!existing && !templateSettingsLoadedFromCloud && incomingUsesDefaultIdentity) {
    throw new Error("company_settings_not_loaded_refusing_default_overwrite");
  }
  const next = mergeTemplateSettingsForSave(settings, existing, options);
  templateCache = { ...next };
  templateListeners.forEach((cb) => { try { cb(); } catch (_error) { void _error; } });
  await writeCloudSetting(CLOUD_KEY, next).catch((error) => {
    console.warn("[pdfGenerator] Supabase template write failed", error);
    throw error;
  });
  return next;
}

/** Load company/template settings from cloud and merge into local cache.
 *  Call after sign-in and once at app startup. Safe to call multiple times. */
export async function loadTemplateSettingsFromCloud(): Promise<void> {
  try {
    const cloud = await readCloudSetting<Partial<PdfTemplateSettings> | null>(CLOUD_KEY, null);
    if (cloud && typeof cloud === "object") {
      const merged = { ...DEFAULT_SETTINGS, ...cloud } as PdfTemplateSettings;
      templateCache = merged;
      templateSettingsLoadedFromCloud = true;
      templateListeners.forEach((cb) => { try { cb(); } catch (_error) { void _error; } });
    } else {
      return;
    }
  } catch { /* offline / not signed in — keep local */ }
}


if (typeof window !== "undefined") {
  subscribeCloudSetting<Partial<PdfTemplateSettings>>(CLOUD_KEY, (value) => {
    templateCache = { ...DEFAULT_SETTINGS, ...value } as PdfTemplateSettings;
    templateSettingsLoadedFromCloud = true;
    templateListeners.forEach((cb) => { try { cb(); } catch (_error) { void _error; } });
  });
}
