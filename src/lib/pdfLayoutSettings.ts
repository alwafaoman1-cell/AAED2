import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

// Unified PDF / Print page margin settings.
// Every PDF generator and print window in the app wraps its content inside a `.page` div.
// This module stores the horizontal/vertical padding (mm) for that wrapper and
// exposes a CSS string + DOM injection helpers used by `htmlToPdf.ts` and `safePdfWindow.ts`
// so every document (invoices, work orders, vouchers, estimates, delivery receipts…) prints
// with the exact same margins.

const KEY = "alwafa_pdf_layout_v1";

export interface PdfLayoutSettings {
  /** Vertical padding inside .page in mm (top + bottom). */
  verticalMm: number;
  /** Horizontal padding inside .page in mm (left + right). */
  horizontalMm: number;
  /** Whether to force the margins on every print/PDF (default true). */
  enforce: boolean;
}

export const DEFAULT_PDF_LAYOUT: PdfLayoutSettings = {
  verticalMm: 15,
  horizontalMm: 18,
  enforce: true,
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

/** CSS rule that forces every `.page` element to use the configured padding. */
export function buildPageMarginCss(
  s: PdfLayoutSettings = load(),
  orientation: "portrait" | "landscape" = "portrait",
): string {
  if (!s.enforce) return "";
  const v = Math.max(0, Math.min(40, s.verticalMm));
  const h = Math.max(0, Math.min(40, s.horizontalMm));
  const pageW = orientation === "landscape" ? "297mm" : "210mm";
  const pageH = orientation === "landscape" ? "210mm" : "297mm";
  const sizeRule = orientation === "landscape" ? "A4 landscape" : "A4";
  return `
    @page{size:${sizeRule};margin:0}
    html,body{margin:0!important;padding:0!important}
    .page{padding:${v}mm ${h}mm !important;box-sizing:border-box !important}
    @media print{
      html,body{margin:0!important;padding:0!important;background:#fff!important}
      .page{width:${pageW}!important;min-height:${pageH}!important;padding:${v}mm ${h}mm !important;margin:0!important;box-shadow:none!important;box-sizing:border-box!important}
    }
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
