import type { UnifiedOperationalPatch } from "@/lib/claimWorkOrderUnified";

export type ReopenDeliveredVehicleInput = {
  reason: string;
  changedAt: string;
  changedBy?: string | null;
};

export function buildReopenDeliveredVehiclePatch({
  reason,
  changedAt,
  changedBy,
}: ReopenDeliveredVehicleInput): UnifiedOperationalPatch {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error("سبب إلغاء التسليم مطلوب");
  }

  return {
    vehicle_delivered_at: null,
    operational_status: "completed",
    vehicle_presence_status: "in_workshop",
    repair_stage: "ready",
    vehicle_location_note: `إلغاء التسليم: ${normalizedReason}`,
    vehicle_location_updated_at: changedAt,
    vehicle_location_updated_by: changedBy || null,
  };
}
