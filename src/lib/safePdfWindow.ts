// Sanitizes generated PDF HTML before opening in a new window.
// Mitigates stored XSS from user-controlled fields interpolated into PDF templates.
import DOMPurify from "dompurify";
import { injectPageMarginStyle } from "./pdfLayoutSettings";
import { generatePdfFromHtml, DEFAULT_MARGINS } from "./htmlToPdf";

export async function printPdfBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.src = url;
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        setTimeout(() => {
          URL.revokeObjectURL(url);
          frame.remove();
        }, 60_000);
      }
    }, 300);
  };
  document.body.appendChild(frame);
}

export function openSanitizedPdfWindow(html: string): Window | null {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style", "link", "meta"],
    ADD_ATTR: ["target", "dir", "lang"],
  });
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return null;
  try {
    // Defensive: ensure no opener reference remains
    (win as any).opener = null;
  } catch {
    /* noop */
  }
  win.document.open();
  win.document.write(clean);
  win.document.close();
  // Inject the unified page-margin override so every printed document respects
  // the operator's configured margins from /settings/pdf-layout.
  try { injectPageMarginStyle(win.document); } catch { /* noop */ }
  return win;
}

/**
 * Opens a sanitized HTML window and triggers print() only after the document
 * is fully loaded (images, fonts, layout). Prevents the "blank print preview"
 * race that happens with a fixed setTimeout.
 */
export async function openAndPrintWindow(html: string): Promise<void> {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style", "link", "meta"],
    ADD_ATTR: ["target", "dir", "lang"],
  });
  const blob = await generatePdfFromHtml({
    htmlContent: clean,
    fileName: `print-${Date.now()}`,
    download: false,
    margins: DEFAULT_MARGINS,
  });
  await printPdfBlob(blob);
}

export async function printCurrentPageAsPdf(fileName = "report"): Promise<void> {
  const blob = await generatePdfFromHtml({
    htmlContent: document.documentElement.outerHTML,
    fileName,
    download: false,
    margins: DEFAULT_MARGINS,
  });
  await printPdfBlob(blob);
}
