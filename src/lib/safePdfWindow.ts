// Sanitizes generated PDF HTML before opening in a new window.
// Mitigates stored XSS from user-controlled fields interpolated into PDF templates.
import DOMPurify from "dompurify";
import { injectPageMarginStyle } from "./pdfLayoutSettings";

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
export function openAndPrintWindow(html: string): Window | null {
  const win = openSanitizedPdfWindow(html);
  if (!win) return null;

  const tryPrint = () => {
    try {
      // Wait for web fonts to load (Arial/Tahoma fallback if not loaded)
      const fontsReady: Promise<unknown> =
        (win.document as any).fonts?.ready ?? Promise.resolve();
      fontsReady
        .catch(() => undefined)
        .finally(() => {
          // Microtask delay so the browser paints first
          setTimeout(() => {
            try {
              win.focus();
              win.print();
            } catch {
              /* user closed window */
            }
          }, 100);
        });
    } catch {
      /* noop */
    }
  };

  if (win.document.readyState === "complete") {
    tryPrint();
  } else {
    win.addEventListener("load", tryPrint, { once: true });
    // Hard fallback in case 'load' never fires (e.g., long-failing image)
    setTimeout(tryPrint, 2500);
  }
  return win;
}
