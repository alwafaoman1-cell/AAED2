// مساعد موحّد لتطبيع أرقام الهاتف لصيغة دولية (E.164) — البادئة الافتراضية تُقرأ من الإعدادات.
import { getDefaultCountryCode } from "./countries";

export function normalizePhone(input?: string | null, defaultCountry?: string): string {
  if (!input) return "";
  const dc = (defaultCountry || getDefaultCountryCode()).replace(/\D/g, "") || "968";
  const raw = String(input).trim();
  const hadPlus = raw.startsWith("+");
  let n = raw.replace(/\D/g, "");
  if (!n) return "";
  if (hadPlus) return n;
  if (n.startsWith("00")) n = n.slice(2);
  else if (n.startsWith("0")) n = dc + n.replace(/^0+/, "");
  else if (n.length <= 9) n = dc + n;
  return n;
}

/** صيغة E.164 الكاملة مع + */
export function toE164(input?: string | null, defaultCountry?: string): string {
  const n = normalizePhone(input, defaultCountry);
  return n ? `+${n}` : "";
}

/** التحقق من صحة E.164 */
export function isValidE164(e164: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(e164);
}

/** بناء رابط واتساب — إن لم يُمرَّر رقم يفتح اختيار جهة الاتصال */
export function buildWhatsAppUrl(message: string, phone?: string | null): string {
  const encoded = encodeURIComponent(message || "");
  const cleaned = normalizePhone(phone);
  return cleaned ? `https://wa.me/${cleaned}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

/** فتح واتساب مباشرة */
export function openWhatsApp(message: string, phone?: string | null) {
  window.open(buildWhatsAppUrl(message, phone), "_blank", "noopener,noreferrer");
}
