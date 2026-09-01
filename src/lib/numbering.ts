// Centralized sequential numbering helpers — produces PREFIX-YYYY-NNNN/NNNNN according to settings.
// Pulls existing IDs from the work-orders store and finds the next number for the current year.
import { getWorkOrders } from "@/lib/workOrdersStore";
import { numberingStore, resolveSeriesByPrefix } from "@/lib/numberingSettings";
import { formatWorkOrderNumber, workOrderSequence } from "@/lib/workOrderNumber";

/**
 * Optimistic display number used before the server confirms the insert.
 * PostgreSQL is the authoritative allocator and prevents concurrent duplicates.
 * Format: WO-NNNNN (e.g. WO-00001)
 */
export function nextWorkOrderNumber(): string {
  const cfg = numberingStore.getSeries("WO");
  const max = getWorkOrders().reduce((m, o) => {
    const n = workOrderSequence(o.displayNumber || o.id || "");
    if (n !== null && n > m) return n;
    return m;
  }, 0);
  const next = Math.max(max + 1, cfg.startFrom);
  return formatWorkOrderNumber(next);
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
