// إعدادات التكاليف الثابتة الشهرية (إيجار، فواتير ثابتة...) للتقرير الشهري
export interface FixedMonthlyCost {
  id: string;
  name: string;     // "إيجار المحل"، "اشتراك إنترنت"...
  amount: number;
  active: boolean;
}

export interface MonthlySettings {
  fixedCosts: FixedMonthlyCost[];
  /** رواتب شهرية افتراضية إن لم يكن نظام HR معبأ — اختياري */
  defaultMonthlySalariesTotal?: number;
}

const KEY = "alwafa_monthly_settings_v1";

const DEFAULTS: MonthlySettings = {
  fixedCosts: [
    { id: "FX-1", name: "إيجار المحل", amount: 0, active: true },
  ],
  defaultMonthlySalariesTotal: 0,
};

let cache: MonthlySettings | null = null;
const subs = new Set<() => void>();

function load(): MonthlySettings {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  void readCloudSetting<MonthlySettings>(KEY, DEFAULTS).then((value) => {
    cache = { ...DEFAULTS, ...value };
    subs.forEach((cb) => cb());
  }).catch(() => undefined);
  return cache;
}
function persist() {
  subs.forEach((cb) => cb());
  if (cache) {
    void writeCloudSetting(KEY, cache).catch((error) => {
      console.warn("[monthlySettingsStore] Supabase write failed", error);
    });
  }
}

if (typeof window !== "undefined") {
  subscribeCloudSetting<MonthlySettings>(KEY, (value) => {
    cache = { ...DEFAULTS, ...value };
    subs.forEach((cb) => cb());
  });
}

export const monthlySettingsStore = {
  get(): MonthlySettings { return load(); },
  update(patch: Partial<MonthlySettings>) {
    cache = { ...load(), ...patch };
    persist();
  },
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },
  /** إجمالي التكاليف الثابتة النشطة */
  totalFixed(): number {
    return load().fixedCosts.filter((f) => f.active).reduce((s, f) => s + (f.amount || 0), 0);
  },
};
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";
