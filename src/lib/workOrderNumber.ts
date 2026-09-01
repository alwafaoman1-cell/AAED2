export const WORK_ORDER_NUMBER_DIGITS = 5;

const CURRENT_WORK_ORDER_NUMBER_RE = /^WO-(\d{5})$/i;
const LEGACY_WORK_ORDER_NUMBER_RE = /^WO-(\d{4})-(\d+)$/i;
const WORK_ORDER_NUMBER_IN_TEXT_RE = /WO-(?:\d{4}-)?\d+/i;

export function normalizeWorkOrderNumber(value: string): string {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isCurrentWorkOrderNumber(value: string): boolean {
  return CURRENT_WORK_ORDER_NUMBER_RE.test(normalizeWorkOrderNumber(value));
}

/**
 * Legacy numbers remain accepted only for backward-compatible links while the
 * database audit table resolves them to the immutable job-order UUID.
 */
export function isSupportedWorkOrderNumber(value: string): boolean {
  const normalized = normalizeWorkOrderNumber(value);
  return CURRENT_WORK_ORDER_NUMBER_RE.test(normalized) || LEGACY_WORK_ORDER_NUMBER_RE.test(normalized);
}

export function extractWorkOrderNumber(value: string): string | null {
  const match = String(value || "").match(WORK_ORDER_NUMBER_IN_TEXT_RE);
  return match ? normalizeWorkOrderNumber(match[0]) : null;
}

export function formatWorkOrderNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99_999) {
    throw new Error("Work order sequence must be between 1 and 99999");
  }
  return `WO-${String(sequence).padStart(WORK_ORDER_NUMBER_DIGITS, "0")}`;
}

export function workOrderSequence(value: string): number | null {
  const match = normalizeWorkOrderNumber(value).match(CURRENT_WORK_ORDER_NUMBER_RE);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}
