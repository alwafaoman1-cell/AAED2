// إعدادات الوصول العام: كلمة مرور رئيسية إضافية تصلح لكل صفحات التتبع/مشاركة المركبات.
// تُخزّن محلياً في localStorage لكل جهاز.

const KEY = "alwafa_public_access_settings_v1";

export interface PublicAccessSettings {
  masterPassword: string; // فارغة = غير مفعّلة
  publicBaseUrl: string;  // الدومين المعتمد لأرابط QR (مثال: https://temo.live). فارغ = استخدم origin الحالي.
}

const DEFAULTS: PublicAccessSettings = { masterPassword: "", publicBaseUrl: "" };

type Listener = (s: PublicAccessSettings) => void;
const listeners = new Set<Listener>();

export function getPublicAccessSettings(): PublicAccessSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePublicAccessSettings(s: Partial<PublicAccessSettings>) {
  const merged = { ...getPublicAccessSettings(), ...s };
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch {}
  listeners.forEach((l) => l(merged));
}

export function subscribePublicAccessSettings(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** يطبّع كلمة السر (أرقام فقط لو الإدخال هاتف، وإلا lowercase trimmed) */
export function normalizeAccessPwd(v: string): string {
  const s = (v || "").trim();
  if (/[\d\s+()-]+/.test(s) && /\d/.test(s)) return s.replace(/\D/g, "");
  return s.toLowerCase();
}

/** يعيد كلمة السر الرئيسية المطبّعة، أو "" إن لم تكن مفعّلة. */
export function getMasterPasswordNormalized(): string {
  return normalizeAccessPwd(getPublicAccessSettings().masterPassword);
}

/**
 * يعيد الدومين الأساسي للروابط العامة (QR / مشاركة).
 * يفضّل الإعداد المخصّص من /settings/public-access، ثم يسقط إلى origin الحالي.
 * يضمن إزالة الـ trailing slash.
 */
export function getPublicBaseUrl(): string {
  const cfg = (getPublicAccessSettings().publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (cfg) return cfg;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "";
}

/** يبني رابطاً عاماً مستنداً للدومين المعتمد. */
export function buildPublicUrl(path: string): string {
  const base = getPublicBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
