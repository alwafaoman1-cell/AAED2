import {
  formatCurrencyEnglish,
  formatDateEnglish,
  toEnglishDigits,
} from "@/lib/formatters/numberFormat";

export { toEnglishDigits } from "@/lib/formatters/numberFormat";

export function formatPlateLatin(plate?: string | null): string {
  if (!plate) return "—";
  return toEnglishDigits(plate)
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

export function formatOmr(n: number | null | undefined, withSuffix = true): string {
  return formatCurrencyEnglish(n, {}, withSuffix ? "OMR" : "");
}

export function formatDateLatin(d: Date | string | null | undefined): string {
  return formatDateEnglish(d);
}
