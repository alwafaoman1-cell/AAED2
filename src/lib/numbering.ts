// Centralized sequential numbering helpers — produces PREFIX-YYYY-NNNN/NNNNN according to settings.
// Pulls existing IDs from the work-orders store and finds the next number for the current year.
import { getWorkOrders } from "@/lib/workOrdersStore";
import { numberingStore, resolveSeriesByPrefix } from "@/lib/numberingSettings";

/**
 * Generate next sequential work-order number for the current year.
 * Format: WO-YYYY-NNNN  (e.g. WO-2026-0001)
 */
export function nextWorkOrderNumber(): string {
  const year = new Date().getFullYear();
  const cfg = numberingStore.getSeries("WO");
  const re = new RegExp(`^${cfg.prefix}-${year}-(\\d+)$`);
  const max = getWorkOrders().reduce((m, o) => {
    const match = (o.id || "").match(re);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > m) return n;
    }
    return m;
  }, 0);
  const next = Math.max(max + 1, cfg.startFrom);
  return `${cfg.prefix}-${year}-${String(next).padStart(cfg.padding, "0")}`;
}

/**
 * Generic helper: next sequential number for a custom prefix and existing list.
 * Format: PREFIX-YYYY-NNNN/NNNNN according to the configured series.
 */
export function nextSequentialNumber(prefix: string, existing: string[]): string {
  const year = new Date().getFullYear();
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existing.reduce((m, id) => {
    const match = (id || "").match(re);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > m) return n;
    }
    return m;
  }, 0);
  const cfg = resolveSeriesByPrefix(prefix);
  const next = Math.max(max + 1, cfg?.startFrom ?? 1);
  const pad = cfg?.padding ?? 5;
  return `${prefix}-${year}-${String(next).padStart(pad, "0")}`;
}
