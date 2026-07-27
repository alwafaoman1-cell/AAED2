import { useEffect } from "react";
import i18n from "i18next";
import { translateAr } from "./autoDictionary";

// Regex matches any string containing Arabic characters
const AR_REGEX = /[\u0600-\u06FF]/;
const EMAIL_OR_URL_REGEX = /(?:https?:\/\/|www\.|mailto:|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i;
const DOCUMENT_NUMBER_REGEX =
  /(?:\b(?:VIN|WO|INV|EST|DR|ENT|LPO|CUST)[-:/\w]*\d|\b[A-HJ-NPR-Z0-9]{17}\b)/i;
const FILE_NAME_REGEX = /\.[a-z0-9]{2,8}(?:[?#].*)?$/i;

/**
 * Walks the DOM and translates Arabic text nodes/attributes to English using the dictionary.
 * Uses MutationObserver to handle dynamic content.
 *
 * Activated only when language is "en". It translates text values only and
 * never inserts/replaces DOM elements, which keeps React's DOM ownership intact.
 *
 * WeakMaps are intentional: removed route/dialog nodes must not be retained in
 * memory. When switching back to Arabic, the live DOM is walked and restored.
 */

const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;
const SKIP_SELECTOR = [
  "[data-no-auto-translate]",
  "[data-no-translate]",
  "[data-pdf-layout]",
  "[data-print-content]",
  ".pdf-v2-page",
  ".pdf-page",
  ".print-page",
  "script",
  "style",
  "code",
  "pre",
  "canvas",
  "svg",
  "iframe",
  "textarea",
  "[contenteditable='true']",
].join(", ");
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<HTMLElement, Map<string, string>>();

function shouldSkip(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  if (!element) return false;
  if (element.closest(SKIP_SELECTOR)) return true;

  // The application deliberately marks <html translate="no"> to disable
  // browser translation, and applies the same marker to #root. Those global
  // guards must not disable our controlled UI translator; component-level
  // translate="no" markers still opt out.
  const noTranslate = element.closest('[translate="no"]');
  const isGlobalBrowserGuard =
    noTranslate === document.documentElement || noTranslate?.id === "root";
  return Boolean(noTranslate && !isGlobalBrowserGuard);
}

function looksLikeBusinessData(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return (
    EMAIL_OR_URL_REGEX.test(text)
    || DOCUMENT_NUMBER_REGEX.test(text)
    || FILE_NAME_REGEX.test(text)
  );
}

function translateAttributes(el: HTMLElement) {
  if (shouldSkip(el)) return;
  TRANSLATABLE_ATTRIBUTES.forEach((attr) => {
    const value = el.getAttribute(attr);
    if (!value || !AR_REGEX.test(value) || looksLikeBusinessData(value)) return;
    const translated = translateAr(value.trim());
    if (translated === value.trim()) return;
    let attrs = originalAttributes.get(el);
    if (!attrs) {
      attrs = new Map();
      originalAttributes.set(el, attrs);
    }
    if (!attrs.has(attr)) attrs.set(attr, value);
    el.setAttribute(attr, translated);
  });
}

function translateNode(node: Node) {
  if (shouldSkip(node)) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue || "";
    if (!AR_REGEX.test(text)) return;
    const trimmed = text.trim();
    if (!trimmed || looksLikeBusinessData(trimmed)) return;
    const translated = translateAr(trimmed);
    if (translated !== trimmed) {
      if (!originalText.has(node as Text)) originalText.set(node as Text, text);
      node.nodeValue = text.replace(trimmed, translated);
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    translateAttributes(el);
    el.childNodes.forEach(translateNode);
  }
}

let observer: MutationObserver | null = null;
let frameId: number | null = null;
const pendingNodes = new Set<Node>();

function flushPendingNodes() {
  frameId = null;
  const nodes = [...pendingNodes];
  pendingNodes.clear();
  nodes.forEach((node) => {
    if (node.isConnected) translateNode(node);
  });
}

function queueTranslation(node: Node) {
  pendingNodes.add(node);
  if (frameId === null) frameId = window.requestAnimationFrame(flushPendingNodes);
}

export function startAutoTranslate() {
  if (observer) return;
  // Initial pass
  if (document.body) translateNode(document.body);
  // Watch DOM mutations
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(queueTranslation);
      if (m.type === "characterData" && m.target) queueTranslation(m.target);
      if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) {
        // Attribute changes never require walking the element's full subtree.
        translateAttributes(m.target as HTMLElement);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
  });
}

export function stopAutoTranslate(restore = false) {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (frameId !== null) {
    window.cancelAnimationFrame(frameId);
    frameId = null;
  }
  pendingNodes.clear();
  if (!restore) return;

  if (!document.body) return;
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const original = originalText.get(textNode);
      if (original !== undefined) {
        node.nodeValue = original;
        originalText.delete(textNode);
      }
    } else {
      const el = node as HTMLElement;
      const attrs = originalAttributes.get(el);
      if (attrs) {
        attrs.forEach((value, attr) => el.setAttribute(attr, value));
        originalAttributes.delete(el);
      }
    }
    node = walker.nextNode();
  }
}

/**
 * React hook — auto-starts/stops translator based on i18n language.
 * Mount once in <App /> root.
 */
export function useAutoTranslate() {
  useEffect(() => {
    const apply = (lng: string) => {
      if (lng.startsWith("en")) {
        startAutoTranslate();
      } else {
        stopAutoTranslate(true);
      }
    };
    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
      stopAutoTranslate(true);
    };
  }, []);
}
