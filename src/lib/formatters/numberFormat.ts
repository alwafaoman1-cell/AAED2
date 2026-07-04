const ARABIC_INDIC_ZERO = 0x0660;
const EASTERN_ARABIC_ZERO = 0x06f0;

const ARABIC_INDIC_RE = /[\u0660-\u0669\u06f0-\u06f9]/g;
const ARABIC_DECIMAL_RE = /[\u066b]/g;
const ARABIC_GROUP_RE = /[\u066c]/g;

function digitToEnglish(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - ARABIC_INDIC_ZERO);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - EASTERN_ARABIC_ZERO);
  return ch;
}

export function toEnglishDigits(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(ARABIC_INDIC_RE, digitToEnglish)
    .replace(ARABIC_DECIMAL_RE, ".")
    .replace(ARABIC_GROUP_RE, ",");
}

export function normalizeNumericInput(value: unknown): string {
  return toEnglishDigits(value)
    .replace(/[^\d.,+-]/g, "")
    .replace(/,/g, "");
}

export function parseMoneyInput(value: unknown): number {
  const normalized = normalizeNumericInput(value);
  if (!normalized || normalized === "-" || normalized === "+" || normalized === ".") return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePhoneInput(value: unknown): string {
  return toEnglishDigits(value).replace(/[^\d+]/g, "");
}

export function normalizePlateInput(value: unknown): string {
  return toEnglishDigits(value).trim().toUpperCase();
}

export function formatNumberEnglish(
  value: unknown,
  options: Intl.NumberFormatOptions = {},
): string {
  const n = Number(normalizeNumericInput(value));
  const safe = Number.isFinite(n) ? n : 0;
  return toEnglishDigits(new Intl.NumberFormat("en-US", {
    numberingSystem: "latn",
    ...options,
  }).format(safe));
}

export function formatCurrencyEnglish(
  value: unknown,
  options: Intl.NumberFormatOptions = {},
  suffix = "OMR",
): string {
  return `${formatNumberEnglish(value, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
    ...options,
  })}${suffix ? ` ${suffix}` : ""}`;
}

export function formatDateEnglish(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toEnglishDigits(value);
  return toEnglishDigits(new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    numberingSystem: "latn",
    ...options,
  }).format(date));
}

export function formatDateTimeEnglish(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toEnglishDigits(value);
  return toEnglishDigits(new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
    ...options,
  }).format(date));
}

export function localeWithLatinDigits(locale?: string | string[]): string | string[] | undefined {
  if (!locale) return locale;
  const addLatn = (item: string) => {
    if (!item || item.includes("-u-")) return item;
    return `${item}-u-nu-latn`;
  };
  return Array.isArray(locale) ? locale.map(addLatn) : addLatn(locale);
}
