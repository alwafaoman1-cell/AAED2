// إعدادات تفعيل/إيقاف التطبيقات والوحدات الكبرى
// يُحفظ في localStorage لكل جهاز.

import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

export type ModuleKey =
  | "tech"
  | "supervisor"
  | "manager"
  | "accountant"
  | "install"
  | "insurance";

export interface ModulesSettings {
  enabled: Record<ModuleKey, boolean>;
}

const KEY = "alwafa_modules_v1";

export const ALL_MODULES: {
  key: ModuleKey;
  labelAr: string;
  labelEn: string;
  descAr: string;
  descEn: string;
  path: string;
  group: "apps" | "core";
}[] = [
  { key: "tech",        group: "apps", path: "/technician",     labelAr: "تطبيق الفنيين",  labelEn: "Technician App", descAr: "واجهة الموبايل للفنيين لتحديث أوامر العمل ورفع الصور.", descEn: "Mobile interface for technicians to update work orders & upload photos." },
  { key: "supervisor",  group: "apps", path: "/supervisor",     labelAr: "تطبيق المشرف",   labelEn: "Supervisor App", descAr: "إضافة سندات الصرف بسرعة من الجوال.",                 descEn: "Quickly record expenses from the phone." },
  { key: "manager",     group: "apps", path: "/manager-app",    labelAr: "تطبيق المدير",   labelEn: "Manager App",    descAr: "لوحة KPI تنفيذية على الجوال.",                       descEn: "Executive KPI dashboard on mobile." },
  { key: "accountant",  group: "apps", path: "/accountant",     labelAr: "تطبيق المحاسب",  labelEn: "Accountant App", descAr: "لوحة محاسبية يومية ومراقبة الإيرادات.",               descEn: "Daily accounting board & revenue monitor." },
  { key: "install",     group: "apps", path: "/install",        labelAr: "صفحة التثبيت",   labelEn: "Install Page",   descAr: "صفحة عامة لتثبيت التطبيق على الهاتف عبر QR.",         descEn: "Public install page with QR code." },
  { key: "insurance",   group: "core", path: "/insurance",      labelAr: "وحدة التأمين",   labelEn: "Insurance Module", descAr: "مطالبات التأمين، التقديرات، الفواتير، والدفعات.",   descEn: "Insurance claims, estimates, invoices, and payments." },
];

export const DEFAULT_MODULES: ModulesSettings = {
  enabled: {
    tech: true,
    supervisor: true,
    manager: true,
    accountant: true,
    install: true,
    insurance: true,
  },
};

type Listener = (s: ModulesSettings) => void;
const listeners = new Set<Listener>();
let cache: ModulesSettings = { ...DEFAULT_MODULES, enabled: { ...DEFAULT_MODULES.enabled } };
let bootstrapped = false;

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  void readCloudSetting<ModulesSettings>(KEY, DEFAULT_MODULES).then((value) => {
    cache = { enabled: { ...DEFAULT_MODULES.enabled, ...(value?.enabled || {}) } };
    listeners.forEach((listener) => listener(cache));
  }).catch(() => undefined);
  subscribeCloudSetting<ModulesSettings>(KEY, (value) => {
    cache = { enabled: { ...DEFAULT_MODULES.enabled, ...(value?.enabled || {}) } };
    listeners.forEach((listener) => listener(cache));
  });
}

export function getModulesSettings(): ModulesSettings {
  bootstrap();
  return { enabled: { ...cache.enabled } };
}

export function isModuleEnabled(key: ModuleKey): boolean {
  return getModulesSettings().enabled[key] !== false;
}

export function saveModulesSettings(s: ModulesSettings) {
  cache = { enabled: { ...DEFAULT_MODULES.enabled, ...s.enabled } };
  listeners.forEach((l) => l(cache));
  void writeCloudSetting(KEY, cache).catch((error) => console.warn("[modulesStore] Supabase write failed", error));
  try {
    window.dispatchEvent(new CustomEvent("alwafa:modules-changed", { detail: cache }));
  } catch {
    /* ignore */
  }
}

export function setModuleEnabled(key: ModuleKey, value: boolean) {
  const cur = getModulesSettings();
  saveModulesSettings({ enabled: { ...cur.enabled, [key]: value } });
}

export function subscribeModulesSettings(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetModulesSettings() {
  saveModulesSettings({ enabled: { ...DEFAULT_MODULES.enabled } });
}
