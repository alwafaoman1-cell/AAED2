import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

// Unified PDF / Print page margin settings.
// Every PDF generator and print window in the app wraps its content inside a `.page` div.
// This module stores the horizontal/vertical padding (mm) for that wrapper and
// exposes a CSS string + DOM injection helpers used by `htmlToPdf.ts` and `safePdfWindow.ts`
// so every document (invoices, work orders, vouchers, estimates, delivery receipts…) prints
// with the exact same margins.

const KEY = "pdf_layout_settings_v2";

export type PdfPageSize = "a4-portrait" | "a4-landscape";
export type PdfLogoPosition = "right-of-company" | "left-of-company" | "above-company";
export type PdfTextAlign = "start" | "center" | "end";
export type PdfCompactStrength = "low" | "medium" | "high";
export type PdfSignatureLayout = "side-by-side" | "stacked";
export type PdfQrPosition = "right-totals-box" | "bottom-left" | "bottom-right";
export type PdfVehicleDisplayMode = "make-only-if-model-empty" | "make-model-year";

export interface PdfLayoutSettings {
  /** Vertical padding inside .page in mm (top + bottom). */
  verticalMm: number;
  /** Horizontal padding inside .page in mm (left + right). */
  horizontalMm: number;
  /** Whether to force the margins on every print/PDF (default true). */
  enforce: boolean;
  pageSize: PdfPageSize;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  footerReservedHeightMm: number;
  headerReservedHeightMm: number;
  compactMode: boolean;
  compactStrength: PdfCompactStrength;
  showLogo: boolean;
  logoPosition: PdfLogoPosition;
  logoWidthMm: number;
  logoHeightMm: number;
  logoTopOffsetMm: number;
  logoInlineOffsetMm: number;
  logoCompanyGapMm: number;
  companyNameFontSize: number;
  companyEnglishNameFontSize: number;
  companyMetaFontSize: number;
  companyBlockTopOffsetMm: number;
  companyBlockAlignment: PdfTextAlign;
  companyLineSpacing: number;
  showCr: boolean;
  showVat: boolean;
  showEmail: boolean;
  showPhone: boolean;
  showAddress: boolean;
  documentTitleFontSize: number;
  sectionTitleFontSize: number;
  bodyFontSize: number;
  tableHeaderFontSize: number;
  tableBodyFontSize: number;
  footerFontSize: number;
  qrLabelFontSize: number;
  headerHeightMm: number;
  spaceAfterHeaderMm: number;
  spaceBetweenSectionsMm: number;
  spaceBeforeTotalsMm: number;
  spaceBeforeSignatureMm: number;
  spaceBeforeFooterMm: number;
  tableRowHeightMm: number;
  cardPaddingMm: number;
  vehicleBoxPaddingMm: number;
  totalsBoxPaddingMm: number;
  showVehicleBox: boolean;
  vehicleBoxHeightMm: number;
  plateBoxWidthMm: number;
  plateBoxHeightMm: number;
  plateNumberFontSize: number;
  vehicleTitleFontSize: number;
  vinFontSize: number;
  showColorField: boolean;
  vehicleDisplayMode: PdfVehicleDisplayMode;
  showSignatureSection: boolean;
  signatureBoxWidthMm: number;
  signatureBoxHeightMm: number;
  signatureLineWidthMm: number;
  stampBoxWidthMm: number;
  stampBoxHeightMm: number;
  signatureLayout: PdfSignatureLayout;
  spaceBelowSignatureMm: number;
  stampPlaceholderEnabled: boolean;
  qrSizeMm: number;
  qrPosition: PdfQrPosition;
  qrLabelVisible: boolean;
  qrMarginMm: number;
  qrBorderVisible: boolean;
}

export const DEFAULT_PDF_LAYOUT: PdfLayoutSettings = {
  verticalMm: 15,
  horizontalMm: 18,
  enforce: true,
  pageSize: "a4-portrait",
  marginTopMm: 12,
  marginRightMm: 12,
  marginBottomMm: 15,
  marginLeftMm: 12,
  footerReservedHeightMm: 12,
  headerReservedHeightMm: 28,
  compactMode: false,
  compactStrength: "medium",
  showLogo: true,
  logoPosition: "right-of-company",
  logoWidthMm: 24,
  logoHeightMm: 28,
  logoTopOffsetMm: 0,
  logoInlineOffsetMm: 0,
  logoCompanyGapMm: 7,
  companyNameFontSize: 20,
  companyEnglishNameFontSize: 13,
  companyMetaFontSize: 11,
  companyBlockTopOffsetMm: 1,
  companyBlockAlignment: "end",
  companyLineSpacing: 1.55,
  showCr: true,
  showVat: true,
  showEmail: true,
  showPhone: true,
  showAddress: true,
  documentTitleFontSize: 13,
  sectionTitleFontSize: 11,
  bodyFontSize: 10.5,
  tableHeaderFontSize: 10,
  tableBodyFontSize: 10.5,
  footerFontSize: 8,
  qrLabelFontSize: 10,
  headerHeightMm: 28,
  spaceAfterHeaderMm: 3,
  spaceBetweenSectionsMm: 3,
  spaceBeforeTotalsMm: 4,
  spaceBeforeSignatureMm: 6,
  spaceBeforeFooterMm: 4,
  tableRowHeightMm: 8,
  cardPaddingMm: 2.5,
  vehicleBoxPaddingMm: 2.5,
  totalsBoxPaddingMm: 3,
  showVehicleBox: true,
  vehicleBoxHeightMm: 24,
  plateBoxWidthMm: 38,
  plateBoxHeightMm: 24,
  plateNumberFontSize: 19,
  vehicleTitleFontSize: 13,
  vinFontSize: 11,
  showColorField: true,
  vehicleDisplayMode: "make-model-year",
  showSignatureSection: true,
  signatureBoxWidthMm: 48,
  signatureBoxHeightMm: 20,
  signatureLineWidthMm: 48,
  stampBoxWidthMm: 62,
  stampBoxHeightMm: 19,
  signatureLayout: "side-by-side",
  spaceBelowSignatureMm: 0,
  stampPlaceholderEnabled: true,
  qrSizeMm: 33,
  qrPosition: "right-totals-box",
  qrLabelVisible: true,
  qrMarginMm: 3,
  qrBorderVisible: true,
};

const listeners = new Set<() => void>();
let cache: PdfLayoutSettings | null = null;

function load(): PdfLayoutSettings {
  if (cache) return cache;
  cache = { ...DEFAULT_PDF_LAYOUT };
  void readCloudSetting<PdfLayoutSettings>(KEY, DEFAULT_PDF_LAYOUT).then((value) => {
    cache = { ...DEFAULT_PDF_LAYOUT, ...value };
    listeners.forEach((cb) => cb());
  }).catch(() => undefined);
  return cache;
}

function persist() {
  listeners.forEach((cb) => cb());
  if (cache) {
    void writeCloudSetting(KEY, cache).catch((error) => {
      console.warn("[pdfLayoutStore] Supabase write failed", error);
    });
  }
}

if (typeof window !== "undefined") {
  subscribeCloudSetting<PdfLayoutSettings>(KEY, (value) => {
    cache = { ...DEFAULT_PDF_LAYOUT, ...value };
    listeners.forEach((cb) => cb());
  });
}

export const pdfLayoutStore = {
  get(): PdfLayoutSettings {
    return load();
  },
  update(patch: Partial<PdfLayoutSettings>) {
    cache = { ...load(), ...patch };
    persist();
  },
  reset() {
    cache = { ...DEFAULT_PDF_LAYOUT };
    persist();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function getPdfLayoutSettings(): PdfLayoutSettings {
  return { ...DEFAULT_PDF_LAYOUT, ...load() };
}

/** CSS rule that forces every `.page` element to use the configured padding. */
export function buildPageMarginCss(
  s: PdfLayoutSettings = load(),
  orientation: "portrait" | "landscape" = "portrait",
): string {
  if (!s.enforce) return "";
  const layout = { ...DEFAULT_PDF_LAYOUT, ...s };
  const landscape = layout.pageSize === "a4-landscape" || orientation === "landscape";
  const pageW = landscape ? "297mm" : "210mm";
  const pageH = landscape ? "210mm" : "297mm";
  const sizeRule = landscape ? "A4 landscape" : "A4";
  const top = clampMm(layout.marginTopMm ?? layout.verticalMm, 0, 40);
  const right = clampMm(layout.marginRightMm ?? layout.horizontalMm, 0, 40);
  const bottom = clampMm(layout.marginBottomMm ?? layout.verticalMm, 0, 45);
  const left = clampMm(layout.marginLeftMm ?? layout.horizontalMm, 0, 40);
  return `
    @page{size:${sizeRule};margin:0}
    html,body{margin:0!important;padding:0!important}
    .page,.pdf-v2-page{padding:${top}mm ${right}mm ${bottom}mm ${left}mm !important;box-sizing:border-box !important}
    ${buildPdfLayoutRuntimeCss(layout)}
    @media print{
      html,body{margin:0!important;padding:0!important;background:#fff!important}
      .page,.pdf-v2-page{width:${pageW}!important;min-height:${pageH}!important;padding:${top}mm ${right}mm ${bottom}mm ${left}mm !important;margin:0!important;box-shadow:none!important;box-sizing:border-box!important}
    }
  `;
}

function clampMm(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function clampFont(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function compactFactor(s: PdfLayoutSettings): number {
  if (!s.compactMode) return 1;
  if (s.compactStrength === "high") return 0.78;
  if (s.compactStrength === "low") return 0.92;
  return 0.86;
}

export function buildPdfLayoutRuntimeCss(settings: PdfLayoutSettings = load()): string {
  const s = { ...DEFAULT_PDF_LAYOUT, ...settings };
  const compact = compactFactor(s);
  const logoFlex = s.logoPosition === "above-company" ? "column" : s.logoPosition === "left-of-company" ? "row" : "row-reverse";
  const align = s.companyBlockAlignment === "center" ? "center" : s.companyBlockAlignment === "start" ? "start" : "end";
  const signatureGrid = s.signatureLayout === "stacked" ? "1fr" : "1fr 1fr";
  const signatureDisplay = s.showSignatureSection ? "grid" : "none";
  const vehicleDisplay = s.showVehicleBox ? "grid" : "none";
  const logoDisplay = s.showLogo ? "flex" : "none";
  const qrBorder = s.qrBorderVisible ? "1px solid #cfd8e6" : "0";
  const qrLabelDisplay = s.qrLabelVisible ? "block" : "none";
  const stampBorder = s.stampPlaceholderEnabled ? "1px dashed #cbd5e1" : "0";
  const qrJustify = s.qrPosition === "bottom-left" ? "flex-start" : "flex-end";
  const qrAlign = s.qrPosition === "bottom-left" ? "start" : "end";

  return `
    :root{
      --pdf-company-name-size:${clampFont(s.companyNameFontSize, 10, 28)}px;
      --pdf-company-en-size:${clampFont(s.companyEnglishNameFontSize, 8, 22)}px;
      --pdf-company-meta-size:${clampFont(s.companyMetaFontSize, 7, 16)}px;
      --pdf-doc-title-size:${clampFont(s.documentTitleFontSize, 8, 24)}px;
      --pdf-section-title-size:${clampFont(s.sectionTitleFontSize, 8, 20)}px;
      --pdf-body-size:${clampFont(s.bodyFontSize, 7, 16)}px;
      --pdf-table-head-size:${clampFont(s.tableHeaderFontSize, 7, 15)}px;
      --pdf-table-body-size:${clampFont(s.tableBodyFontSize, 7, 15)}px;
      --pdf-footer-size:${clampFont(s.footerFontSize, 6, 13)}px;
    }
    body{font-size:calc(var(--pdf-body-size) * ${compact})!important}
    .pdf-v2-header,.header,.top{min-height:${clampMm(s.headerHeightMm, 0, 60)}mm!important;margin-bottom:${clampMm(s.spaceAfterHeaderMm * compact, 0, 20)}mm!important}
    .pdf-v2-brand,.company{display:flex!important;flex-direction:${logoFlex}!important;align-items:flex-start!important;gap:${clampMm(s.logoCompanyGapMm, 0, 20)}mm!important;text-align:${align}!important;padding-top:${clampMm(s.companyBlockTopOffsetMm, -10, 20)}mm!important}
    .pdf-v2-logo,.logo-box{display:${logoDisplay}!important;width:${clampMm(s.logoWidthMm, 6, 60)}mm!important;height:${clampMm(s.logoHeightMm, 6, 60)}mm!important;margin-top:${clampMm(s.logoTopOffsetMm, -20, 30)}mm!important;margin-inline-start:${clampMm(s.logoInlineOffsetMm, -30, 30)}mm!important}
    .pdf-v2-logo img,.logo-box img{max-width:${clampMm(s.logoWidthMm, 6, 60)}mm!important;max-height:${clampMm(s.logoHeightMm, 6, 60)}mm!important}
    .pdf-v2-company,.company-text h1,.company-info h1{font-size:calc(var(--pdf-company-name-size) * ${compact})!important}
    .pdf-v2-company-line,.company-text .en,.en-name{font-size:calc(var(--pdf-company-en-size) * ${compact})!important}
    .company-text .meta,.details{font-size:calc(var(--pdf-company-meta-size) * ${compact})!important;line-height:${Math.max(1, Math.min(2.2, s.companyLineSpacing))}!important}
    .pdf-v2-doc-title,.doc-badge .label-ar,.invoice-card .ar{font-size:calc(var(--pdf-doc-title-size) * ${compact})!important}
    h1,h2,h3,h4,.label,.sig-title,.stamp-title{font-size:calc(var(--pdf-section-title-size) * ${compact})!important}
    th{font-size:calc(var(--pdf-table-head-size) * ${compact})!important}
    td{font-size:calc(var(--pdf-table-body-size) * ${compact})!important;min-height:${clampMm(s.tableRowHeightMm * compact, 3, 24)}mm}
    .footer,.pdf-v2-footer{font-size:calc(var(--pdf-footer-size) * ${compact})!important;margin-top:${clampMm(s.spaceBeforeFooterMm, 0, 24)}mm!important;min-height:${clampMm(s.footerReservedHeightMm, 0, 35)}mm!important}
    .pdf-v2-title-band,.section-title,.rule{margin-bottom:${clampMm(s.spaceBetweenSectionsMm * compact, 0, 18)}mm!important}
    .pdf-v2-card,.pdf-card,.card,.claim-box,.bill-row{padding:${clampMm(s.cardPaddingMm * compact, 0.5, 10)}mm!important;margin-bottom:${clampMm(s.spaceBetweenSectionsMm * compact, 0, 18)}mm!important}
    .pdf-v2-vehicle-strip,.vehicle-box{display:${vehicleDisplay}!important;min-height:${clampMm(s.vehicleBoxHeightMm * compact, 6, 60)}mm!important;padding:${clampMm(s.vehicleBoxPaddingMm * compact, 0.5, 10)}mm!important}
    .plate-box{width:${clampMm(s.plateBoxWidthMm, 18, 70)}mm!important;min-height:${clampMm(s.plateBoxHeightMm * compact, 10, 60)}mm!important}
    .plate-no,.plate-number{font-size:calc(${clampFont(s.plateNumberFontSize, 9, 36)}px * ${compact})!important}
    .vehicle-cell .v,.vehicle-title{font-size:calc(${clampFont(s.vehicleTitleFontSize, 8, 22)}px * ${compact})!important}
    .vehicle-cell .sub,.vin,.vehicle-vin{font-size:calc(${clampFont(s.vinFontSize, 7, 16)}px * ${compact})!important}
    .summary-box,.pdf-v2-totals,.totals{padding:${clampMm(s.totalsBoxPaddingMm * compact, 1, 12)}mm!important;margin-top:${clampMm(s.spaceBeforeTotalsMm * compact, 0, 20)}mm!important}
    .pdf-v2-signature-stamp,.pdf-signature-stamp,.signatures,.signature-area{display:${signatureDisplay}!important;grid-template-columns:${signatureGrid}!important;gap:8mm!important;margin-top:${clampMm(s.spaceBeforeSignatureMm * compact, 0, 30)}mm!important;margin-bottom:${clampMm(s.spaceBelowSignatureMm * compact, 0, 20)}mm!important}
    .pdf-signature-box,.signature-line,.signature-area .sig{min-height:${clampMm(s.signatureBoxHeightMm * compact, 8, 60)}mm!important;width:${clampMm(s.signatureBoxWidthMm, 18, 100)}mm!important;max-width:100%!important}
    .pdf-signature-line:after,.signature-line:after{width:${clampMm(s.signatureLineWidthMm, 15, 90)}mm!important}
    .pdf-stamp-box,.stamp-placeholder,.signature-area .sig .area{min-height:${clampMm(s.stampBoxHeightMm * compact, 8, 60)}mm!important;width:${clampMm(s.stampBoxWidthMm, 18, 100)}mm!important;max-width:100%!important;border:${stampBorder}!important}
    .pdf-v2-qr,.qr-box{margin:${clampMm(s.qrMarginMm, 0, 20)}mm!important;justify-content:${qrJustify}!important;text-align:${qrAlign}!important}
    .qr-frame{width:${clampMm(s.qrSizeMm + 6, 12, 80)}mm!important;height:${clampMm(s.qrSizeMm + 6, 12, 80)}mm!important;border:${qrBorder}!important}
    .qr-frame img{width:${clampMm(s.qrSizeMm, 10, 70)}mm!important;height:${clampMm(s.qrSizeMm, 10, 70)}mm!important}
    .qr-caption{display:${qrLabelDisplay}!important;font-size:${clampFont(s.qrLabelFontSize, 6, 16)}px!important}
  `;
}

/** Detect landscape orientation from an existing @page rule inside the HTML. */
export function detectOrientation(html: string): "portrait" | "landscape" {
  return /@page[^}]*size\s*:\s*[^;}]*landscape/i.test(html) ? "landscape" : "portrait";
}

/** Returns the same document HTML with the unified print/page CSS embedded in <head>. */
export function buildHtmlWithPageMarginStyle(
  html: string,
  orientation: "portrait" | "landscape" = detectOrientation(html),
): string {
  const css = buildPageMarginCss(load(), orientation);
  if (!css) return html;
  const style = `<style data-pdf-margins="1">${css}</style>`;
  if (/<style[^>]*data-pdf-margins=["']1["'][^>]*>/i.test(html)) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8" />${style}</head><body>${html}</body></html>`;
}

/** Inject the margin override into a window or iframe document. */
export function injectPageMarginStyle(
  doc: Document | null | undefined,
  orientation: "portrait" | "landscape" = "portrait",
) {
  if (!doc) return;
  const css = buildPageMarginCss(load(), orientation);
  if (!css) return;
  try {
    const style = doc.createElement("style");
    style.setAttribute("data-pdf-margins", "1");
    style.textContent = css;
    doc.head?.querySelector('style[data-pdf-margins="1"]')?.remove();
    doc.head?.appendChild(style);
  } catch {
    /* noop */
  }
}
