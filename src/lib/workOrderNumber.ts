import type { WorkOrderType } from "@/lib/workOrderType";

export const WORK_ORDER_NUMBER_DIGITS = 4;

export type WorkOrderNumberChannel = "cash" | "insurance";

const CURRENT_WORK_ORDER_NUMBER_RE = /^WO-([CI])-(\d{2})-(\d{4})$/i;
const GLOBAL_WORK_ORDER_NUMBER_RE = /^WO-(\d{5})$/i;
const LEGACY_WORK_ORDER_NUMBER_RE = /^WO-(\d{4})-(\d+)$/i;
const WORK_ORDER_NUMBER_IN_TEXT_RE = /WO-(?:[CI]-\d{2}-\d{4}|\d{4}-\d+|\d{5})/i;

export function normalizeWorkOrderNumber(value: string): string {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isCurrentWorkOrderNumber(value: string): boolean {
  return CURRENT_WORK_ORDER_NUMBER_RE.test(normalizeWorkOrderNumber(value));
}

/**
 * Previous WO-NNNNN and WO-YYYY-NNNN numbers remain accepted as immutable
 * aliases so bookmarks and historical documents continue resolving by UUID.
 */
export function isSupportedWorkOrderNumber(value: string): boolean {
  const normalized = normalizeWorkOrderNumber(value);
  return CURRENT_WORK_ORDER_NUMBER_RE.test(normalized)
    || GLOBAL_WORK_ORDER_NUMBER_RE.test(normalized)
    || LEGACY_WORK_ORDER_NUMBER_RE.test(normalized);
}

export function extractWorkOrderNumber(value: string): string | null {
  const match = String(value || "").match(WORK_ORDER_NUMBER_IN_TEXT_RE);
  return match ? normalizeWorkOrderNumber(match[0]) : null;
}

function resolveYear(value: Date | string | number): number {
  if (typeof value === "number") return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
}

export function workOrderNumberChannel(type: WorkOrderType | WorkOrderNumberChannel): WorkOrderNumberChannel {
  return type === "insurance" ? "insurance" : "cash";
}

export function formatWorkOrderNumber(
  sequence: number,
  type: WorkOrderType | WorkOrderNumberChannel = "cash",
  year: Date | string | number = new Date(),
): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9_999) {
    throw new Error("Work order sequence must be between 1 and 9999");
  }
  const fullYear = resolveYear(year);
  if (fullYear < 2000 || fullYear > 2099) throw new Error("Work order year must be between 2000 and 2099");
  const channel = workOrderNumberChannel(type) === "insurance" ? "I" : "C";
  return `WO-${channel}-${String(fullYear).slice(-2)}-${String(sequence).padStart(WORK_ORDER_NUMBER_DIGITS, "0")}`;
}

export function workOrderSequence(value: string): number | null {
  const match = normalizeWorkOrderNumber(value).match(CURRENT_WORK_ORDER_NUMBER_RE);
  if (!match) return null;
  const sequence = Number(match[3]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

export function workOrderNumberYear(value: string): number | null {
  const match = normalizeWorkOrderNumber(value).match(CURRENT_WORK_ORDER_NUMBER_RE);
  return match ? 2000 + Number(match[2]) : null;
}

export function parsedWorkOrderNumberChannel(value: string): WorkOrderNumberChannel | null {
  const match = normalizeWorkOrderNumber(value).match(CURRENT_WORK_ORDER_NUMBER_RE);
  if (!match) return null;
  return match[1].toUpperCase() === "I" ? "insurance" : "cash";
}
