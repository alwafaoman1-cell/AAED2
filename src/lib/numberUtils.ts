// تحويل الأرقام والحروف العربية الهندية إلى أرقام إنجليزية ASCII
// يُستخدم في كل المخرجات والقوائم لضمان توحيد العرض

const ARABIC_INDIC_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  // Persian/Eastern variant
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** يحول كل الأرقام العربية الهندية في النص إلى أرقام إنجليزية. آمن مع null/undefined. */
export function toEnglishDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return "";
  const s = String(input);
  return s.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_INDIC_MAP[d] ?? d);
}

/** ينسق رقم لوحة: يحول أرقامه إلى إنجليزي ويجعل الحروف اللاتينية uppercase. */
export function formatPlateLatin(plate?: string | null): string {
  if (!plate) return "—";
  return toEnglishDigits(plate)
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

/** ينسق العملة بالأرقام الإنجليزية مع ٣ خانات عشرية لـ OMR. */
export function formatOmr(n: number | null | undefined, withSuffix = true): string {
  const num = Number(n) || 0;
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return withSuffix ? `${formatted} OMR` : formatted;
}

/** Date as DD/MM/YYYY ASCII numerals. */
export function formatDateLatin(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return toEnglishDigits(String(d));
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = date.getFullYear();
  return `${dd}/${mm}/${yy}`;
}
