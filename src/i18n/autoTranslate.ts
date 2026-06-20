import { useEffect } from "react";
import i18n from "i18next";
import { AR_TO_EN, translateAr } from "./autoDictionary";

// Regex matches any string containing Arabic characters
const AR_REGEX = /[\u0600-\u06FF]/;

/**
 * Walks the DOM and translates Arabic text nodes/attributes to English using the dictionary.
 * Uses MutationObserver to handle dynamic content.
 *
 * Activated only when language is "en". Restoring to "ar" requires page reload (we set originals).
 */

const ORIGINAL_ATTR = "data-ar-original";

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue || "";
    if (!AR_REGEX.test(text)) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const translated = translateAr(trimmed);
    if (translated !== trimmed) {
      // Save original on parent for restore
      const parent = node.parentElement;
      if (parent && !parent.hasAttribute(ORIGINAL_ATTR)) {
        parent.setAttribute(ORIGINAL_ATTR, "1");
      }
      node.nodeValue = text.replace(trimmed, translated);
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    // Translate placeholder, title, aria-label
    ["placeholder", "title", "aria-label"].forEach((attr) => {
      const v = el.getAttribute(attr);
      if (v && AR_REGEX.test(v)) {
        const t = translateAr(v.trim());
        if (t !== v.trim()) el.setAttribute(attr, t);
      }
    });
    // Recurse children
    el.childNodes.forEach(translateNode);
  }
}

let observer: MutationObserver | null = null;

export function startAutoTranslate() {
  if (observer) return;
  // Initial pass
  if (document.body) translateNode(document.body);
  // Watch DOM mutations
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(translateNode);
      if (m.type === "characterData" && m.target) translateNode(m.target);
      if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) {
        translateNode(m.target);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label"],
  });
}

export function stopAutoTranslate() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

/**
 * React hook — auto-starts/stops translator based on i18n language.
 * Mount once in <App /> root.
 */
export function useAutoTranslate() {
  useEffect(() => {
    const apply = (lng: string) => {
      if (lng === "en") {
        startAutoTranslate();
      } else {
        stopAutoTranslate();
        // Reload to restore original Arabic (simpler than tracking every change)
        // Only reload if previously translated
        if (document.querySelector(`[${ORIGINAL_ATTR}]`)) {
          window.location.reload();
        }
      }
    };
    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
      stopAutoTranslate();
    };
  }, []);
}
