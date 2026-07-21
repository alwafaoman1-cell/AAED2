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

  // Do not mutate rendered text nodes globally. Display components and PDFs must
  // use the shared formatters; this guard only normalizes user input plus
  // Number/Date locale output.
}
