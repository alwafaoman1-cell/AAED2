import {
  localeWithLatinDigits,
  normalizeNumericInput,
  toEnglishDigits,
} from "@/lib/formatters/numberFormat";

let installed = false;

function isEditable(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function normalizeEditableValue(el: HTMLInputElement | HTMLTextAreaElement) {
  const before = el.value;
  if (!before) return;

  const type = el instanceof HTMLInputElement ? el.type : "";
  const normalized =
    ["number", "range"].includes(type)
      ? normalizeNumericInput(before)
      : toEnglishDigits(before);

  if (before === normalized) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  el.value = normalized;
  try {
    if (typeof start === "number" && typeof end === "number") el.setSelectionRange(start, end);
  } catch {
    // Some input types do not support selection ranges.
  }
}

function normalizeTextNode(node: Node) {
  if (node.nodeType !== Node.TEXT_NODE) return;
  const value = node.nodeValue || "";
  const normalized = toEnglishDigits(value);
  if (value !== normalized) node.nodeValue = normalized;
}

function normalizeDomTree(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    normalizeTextNode(node);
    node = walker.nextNode();
  }
}

export function installEnglishDigitGuards() {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;

  const originalNumberToLocaleString = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function patchedNumberToLocaleString(
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return toEnglishDigits(originalNumberToLocaleString.call(this, localeWithLatinDigits(locales as string | string[] | undefined) as Intl.LocalesArgument, {
      numberingSystem: "latn",
      ...options,
    }));
  };

  const patchDateMethod = <K extends "toLocaleString" | "toLocaleDateString" | "toLocaleTimeString">(method: K) => {
    const original = Date.prototype[method] as (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) => string;
    Date.prototype[method] = function patchedDateLocale(
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return toEnglishDigits(original.call(this, localeWithLatinDigits(locales as string | string[] | undefined) as Intl.LocalesArgument, {
        numberingSystem: "latn",
        ...options,
      }));
    } as Date[K];
  };

  patchDateMethod("toLocaleString");
  patchDateMethod("toLocaleDateString");
  patchDateMethod("toLocaleTimeString");

  document.addEventListener("input", (event) => {
    if (isEditable(event.target)) normalizeEditableValue(event.target);
  }, true);
  document.addEventListener("change", (event) => {
    if (isEditable(event.target)) normalizeEditableValue(event.target);
  }, true);

  normalizeDomTree(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) normalizeTextNode(node);
        else if (node instanceof Element) normalizeDomTree(node);
      });
      if (record.type === "characterData") normalizeTextNode(record.target);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

