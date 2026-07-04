const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toEnglishDigits(value: unknown): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

export function escapeHtml(value: unknown): string {
  return toEnglishDigits(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatOmr(value: unknown, decimals = 3): string {
  const n = Number(String(value ?? 0).replace(/,/g, ""));
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe.toFixed(decimals)} OMR`;
}

export function calculateVatInclusive(totalIncludingVat: number, rate = 5) {
  const total = Number(Number(totalIncludingVat || 0).toFixed(3));
  const subtotal = Number((total / (1 + rate / 100)).toFixed(3));
  const vat = Number((total - subtotal).toFixed(3));
  return { subtotal, vat, total };
}

export function calculateVatExclusive(subtotal: number, rate = 5) {
  const net = Number(Number(subtotal || 0).toFixed(3));
  const vat = Number((net * (rate / 100)).toFixed(3));
  const total = Number((net + vat).toFixed(3));
  return { subtotal: net, vat, total };
}
