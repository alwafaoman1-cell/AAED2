import type { NeededPart, WorkItem } from "@/lib/workOrdersStore";

export type ClaimApprovalMode = "lump_sum" | "upl" | "unknown";

export interface ClaimApprovalInfo {
  approvedAmount?: number | null;
  estimatedAmount?: number | null;
  estimationType?: string | null;
}

export interface ClassifiedWorkOrderCosts {
  partsCost: number;
  laborCost: number;
  paintMaterialsCost: number;
  totalCost: number;
  insuranceApprovedAmount: number;
  insuranceApprovalMode: ClaimApprovalMode;
  lumpSumNotItemized: boolean;
}

export function roundMoney(value: unknown, decimals = 2): number {
  const numeric = typeof value === "string"
    ? Number(value.replace(/,/g, "").trim())
    : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

export function normalizeInsuranceApprovalAmount(value: unknown): number {
  const rounded = roundMoney(value, 2);
  if (!rounded) return 0;
  const nearestWhole = Math.round(rounded);
  // Legacy VAT/floating calculations sometimes stored entered whole approvals
  // like 1200.00 as 1200.01. Correct only this one-cent whole-number drift.
  if (Math.abs(rounded - nearestWhole) > 0 && Math.abs(rounded - nearestWhole) <= 0.011) {
    return nearestWhole;
  }
  return rounded;
}

function amountsMatch(a: unknown, b: unknown, tolerance = 0.02): boolean {
  const left = roundMoney(a);
  const right = roundMoney(b);
  return left > 0 && right > 0 && Math.abs(left - right) <= tolerance;
}

function isPricedPart(part: NeededPart): boolean {
  return roundMoney(part.estimatedUnitPrice) > 0 && Number(part.quantity || 0) > 0;
}

function isPaintOrMaterial(item: WorkItem | NeededPart): boolean {
  const maybeNote = "name" in item ? item.notes : item.note;
  const text = [
    "title" in item ? item.title : item.name,
    maybeNote,
  ].filter(Boolean).join(" ").toLowerCase();
  return /paint|material|صبغ|دهان|مواد/.test(text);
}

export function classifyWorkOrderCosts(input: {
  laborCost?: unknown;
  partsCost?: unknown;
  finalTotal?: unknown;
  subtotal?: unknown;
  claim?: ClaimApprovalInfo | null;
  partsNeeded?: NeededPart[] | null;
  workItems?: WorkItem[] | null;
}): ClassifiedWorkOrderCosts {
  const rawLabor = roundMoney(input.laborCost);
  const rawParts = roundMoney(input.partsCost);
  const partsNeeded = input.partsNeeded || [];
  const workItems = input.workItems || [];
  const claim = input.claim || null;
  const insuranceApprovedAmount = normalizeInsuranceApprovalAmount(claim?.approvedAmount ?? claim?.estimatedAmount ?? 0);
  const insuranceApprovalMode: ClaimApprovalMode =
    claim?.estimationType === "lump_sum"
      ? "lump_sum"
      : claim?.estimationType === "upl"
        ? "upl"
        : claim
          ? "unknown"
          : "unknown";

  const hasPricedParts = partsNeeded.some(isPricedPart);
  const hasPaintOrMaterials = partsNeeded.some(isPaintOrMaterial) || workItems.some(isPaintOrMaterial);

  // Historical DB trigger stored the claim approved amount in job_orders.parts_cost.
  // In Lump Sum approvals this is not a real parts line, so display/report it
  // separately as the insurance approved amount unless there are explicit priced
  // parts lines.
  const shouldSuppressClaimAsParts =
    insuranceApprovalMode === "lump_sum" &&
    insuranceApprovedAmount > 0 &&
    amountsMatch(rawParts, insuranceApprovedAmount) &&
    !hasPricedParts;

  const partsCost = shouldSuppressClaimAsParts ? 0 : rawParts;
  const laborCost = rawLabor;
  const paintMaterialsCost = hasPaintOrMaterials ? 0 : 0;
  const totalCost = roundMoney(partsCost + laborCost + paintMaterialsCost);

  return {
    partsCost,
    laborCost,
    paintMaterialsCost,
    totalCost,
    insuranceApprovedAmount,
    insuranceApprovalMode,
    lumpSumNotItemized: shouldSuppressClaimAsParts,
  };
}
