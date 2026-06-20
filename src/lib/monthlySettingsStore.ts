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
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      cache = { ...DEFAULTS, ...JSON.parse(raw) };
      return cache!;
    }
  } catch {}
  cache = { ...DEFAULTS };
  return cache;
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  subs.forEach((cb) => cb());
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
