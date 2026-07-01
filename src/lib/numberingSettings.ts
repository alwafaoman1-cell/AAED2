// Configurable starting numbers for every auto-generated document series.
// The numbering helpers (`nextWorkOrderNumber`, `nextSequentialNumber`,
// `salesStore.nextNumber`) consult this store before returning the next number,
// so the operator can decide whether numbering starts from 1, 10, 1000…
//
// Note: actual server-side sequences (Postgres) are not modified — this store
// controls the *client-side* counter for stores that live in localStorage and
// influences the minimum value returned by the helpers regardless.

const KEY = "alwafa_numbering_settings_v1";

export type NumberSeries =
  | "WO"        // Work orders
  | "INV"       // Sales invoices
  | "QT"        // Sales quotes
  | "CN"        // Credit notes
  | "RET"       // Returns
  | "REC"       // Recurring invoices
  | "RCV"       // Receipt voucher
  | "PAY"       // Payment voucher
  | "EXP"       // Expenses
  | "PO"        // Purchase orders / Parts requests
  | "INS-EST"   // Insurance estimates
  | "INS-INV"   // Insurance invoices
  | "DR";       // Delivery receipts

export interface NumberSeriesConfig {
  /** Display label (Arabic). */
  label: string;
  /** Prefix appearing in the final number. */
  prefix: string;
  /** Minimum number to start from (inclusive). */
  startFrom: number;
  /** Zero-padding width. */
  padding: number;
}

export const DEFAULT_NUMBERING: Record<NumberSeries, NumberSeriesConfig> = {
  WO:        { label: "أوامر العمل",            prefix: "WO",      startFrom: 1, padding: 5 },
  INV:       { label: "فواتير البيع",            prefix: "INV",     startFrom: 1, padding: 5 },
  QT:        { label: "عروض الأسعار",            prefix: "QT",      startFrom: 1, padding: 5 },
  CN:        { label: "إشعارات دائنة",           prefix: "CN",      startFrom: 1, padding: 5 },
  RET:       { label: "الفواتير المرتجعة",       prefix: "RET",     startFrom: 1, padding: 5 },
  REC:       { label: "الفواتير الدورية",        prefix: "REC",     startFrom: 1, padding: 5 },
  RCV:       { label: "سندات القبض",             prefix: "RCV",     startFrom: 1, padding: 4 },
  PAY:       { label: "سندات الصرف",             prefix: "PAY",     startFrom: 1, padding: 4 },
  EXP:       { label: "المصروفات",               prefix: "EXP",     startFrom: 1, padding: 5 },
  PO:        { label: "طلبات الشراء/القطع",      prefix: "PO",      startFrom: 1, padding: 5 },
  "INS-EST": { label: "تقديرات التأمين",         prefix: "INS-EST", startFrom: 1, padding: 5 },
  "INS-INV": { label: "فواتير التأمين",          prefix: "INS-INV", startFrom: 1, padding: 5 },
  DR:        { label: "إيصالات تسليم السيارة",   prefix: "DR",      startFrom: 1, padding: 5 },
};

const listeners = new Set<() => void>();
let cache: Record<NumberSeries, NumberSeriesConfig> | null = null;

function load(): Record<NumberSeries, NumberSeriesConfig> {
  if (cache) return cache;
  cache = { ...DEFAULT_NUMBERING };
  void readCloudSetting<Record<NumberSeries, NumberSeriesConfig>>(KEY, DEFAULT_NUMBERING)
    .then((value) => {
      cache = { ...DEFAULT_NUMBERING };
      for (const k of Object.keys(DEFAULT_NUMBERING) as NumberSeries[]) {
        cache[k] = { ...DEFAULT_NUMBERING[k], ...(value?.[k] || {}) };
      }
      listeners.forEach((cb) => cb());
    })
    .catch(() => undefined);
  return cache;
}

function persist() {
  listeners.forEach((cb) => cb());
  if (cache) {
    void writeCloudSetting(KEY, cache).catch((error) => {
      console.warn("[numberingStore] Supabase write failed", error);
    });
  }
}

if (typeof window !== "undefined") {
  subscribeCloudSetting<Record<NumberSeries, NumberSeriesConfig>>(KEY, (value) => {
    cache = { ...DEFAULT_NUMBERING };
    for (const k of Object.keys(DEFAULT_NUMBERING) as NumberSeries[]) {
      cache[k] = { ...DEFAULT_NUMBERING[k], ...(value?.[k] || {}) };
    }
    listeners.forEach((cb) => cb());
  });
}

export const numberingStore = {
  get(): Record<NumberSeries, NumberSeriesConfig> {
    return load();
  },
  getSeries(series: NumberSeries): NumberSeriesConfig {
    return load()[series] || DEFAULT_NUMBERING[series];
  },
  update(series: NumberSeries, patch: Partial<NumberSeriesConfig>) {
    const all = load();
    cache = { ...all, [series]: { ...all[series], ...patch } };
    persist();
  },
  reset() {
    cache = { ...DEFAULT_NUMBERING };
    persist();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

/** Resolve the configured minimum and padding for any prefix. */
export function resolveSeriesByPrefix(prefix: string): NumberSeriesConfig | null {
  const all = load();
  for (const k of Object.keys(all) as NumberSeries[]) {
    if (all[k].prefix === prefix) return all[k];
  }
  return null;
}
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";
