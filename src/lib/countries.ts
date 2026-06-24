// قائمة بادئات الدول المعتمدة لاختيار رقم واتساب.
// كل سجل: code = رقم بادئة الدولة (بدون +)، iso = رمز ISO.
export interface CountryDial {
  code: string;
  iso: string;
  nameAr: string;
  nameEn: string;
  flag: string;
}

export const COUNTRY_DIALS: CountryDial[] = [
  { code: "968", iso: "OM", nameAr: "عُمان", nameEn: "Oman", flag: "🇴🇲" },
  { code: "966", iso: "SA", nameAr: "السعودية", nameEn: "Saudi Arabia", flag: "🇸🇦" },
  { code: "971", iso: "AE", nameAr: "الإمارات", nameEn: "UAE", flag: "🇦🇪" },
  { code: "974", iso: "QA", nameAr: "قطر", nameEn: "Qatar", flag: "🇶🇦" },
  { code: "973", iso: "BH", nameAr: "البحرين", nameEn: "Bahrain", flag: "🇧🇭" },
  { code: "965", iso: "KW", nameAr: "الكويت", nameEn: "Kuwait", flag: "🇰🇼" },
  { code: "967", iso: "YE", nameAr: "اليمن", nameEn: "Yemen", flag: "🇾🇪" },
  { code: "20",  iso: "EG", nameAr: "مصر", nameEn: "Egypt", flag: "🇪🇬" },
  { code: "962", iso: "JO", nameAr: "الأردن", nameEn: "Jordan", flag: "🇯🇴" },
  { code: "961", iso: "LB", nameAr: "لبنان", nameEn: "Lebanon", flag: "🇱🇧" },
  { code: "963", iso: "SY", nameAr: "سوريا", nameEn: "Syria", flag: "🇸🇾" },
  { code: "964", iso: "IQ", nameAr: "العراق", nameEn: "Iraq", flag: "🇮🇶" },
  { code: "212", iso: "MA", nameAr: "المغرب", nameEn: "Morocco", flag: "🇲🇦" },
  { code: "216", iso: "TN", nameAr: "تونس", nameEn: "Tunisia", flag: "🇹🇳" },
  { code: "213", iso: "DZ", nameAr: "الجزائر", nameEn: "Algeria", flag: "🇩🇿" },
  { code: "218", iso: "LY", nameAr: "ليبيا", nameEn: "Libya", flag: "🇱🇾" },
  { code: "249", iso: "SD", nameAr: "السودان", nameEn: "Sudan", flag: "🇸🇩" },
  { code: "90",  iso: "TR", nameAr: "تركيا", nameEn: "Türkiye", flag: "🇹🇷" },
  { code: "92",  iso: "PK", nameAr: "باكستان", nameEn: "Pakistan", flag: "🇵🇰" },
  { code: "91",  iso: "IN", nameAr: "الهند", nameEn: "India", flag: "🇮🇳" },
  { code: "880", iso: "BD", nameAr: "بنغلاديش", nameEn: "Bangladesh", flag: "🇧🇩" },
  { code: "63",  iso: "PH", nameAr: "الفلبين", nameEn: "Philippines", flag: "🇵🇭" },
  { code: "1",   iso: "US", nameAr: "أمريكا/كندا", nameEn: "USA/Canada", flag: "🇺🇸" },
  { code: "44",  iso: "GB", nameAr: "بريطانيا", nameEn: "UK", flag: "🇬🇧" },
];

/** قراءة البادئة الافتراضية من إعدادات القالب أو Fallback إلى عُمان. */
export function getDefaultCountryCode(): string {
  return "968";
}

/** يستخرج بادئة الدولة من رقم E.164 معروف، أو يعيد الافتراضية. */
export function detectCountryCode(phone?: string | null): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return getDefaultCountryCode();
  // ابحث عن أطول مطابقة
  const sorted = [...COUNTRY_DIALS].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) if (digits.startsWith(c.code)) return c.code;
  return getDefaultCountryCode();
}

/** يفصل الرقم عن البادئة (للعرض). */
export function splitPhone(phone?: string | null): { country: string; local: string } {
  const digits = (phone || "").replace(/\D/g, "");
  const country = detectCountryCode(digits);
  const local = digits.startsWith(country) ? digits.slice(country.length) : digits;
  return { country, local };
}
