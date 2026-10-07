import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { canonicalMediaReference, resolveImageReferences } from "@/lib/vehicleMediaUrls";
import { isUuid } from "@/lib/uuid";
import type { StagePhoto } from "@/lib/workOrdersStore";

/** References from receipt/supplements use the existing damage-photos objects. No copy is uploaded. */
export async function fetchWorkOrderAttachedPhotos(jobOrderId: string): Promise<StagePhoto[]> {
  if (!isUuid(jobOrderId)) return [];
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return [];
  const [order, supplements] = await Promise.all([
    supabase.from("job_orders").select("reception_photos").eq("tenant_id", tenantId).eq("id", jobOrderId).maybeSingle(),
    supabase.from("work_order_supplements").select("id,photos,created_at").eq("tenant_id", tenantId).eq("job_order_id", jobOrderId),
  ]);
  const candidates: Array<{ reference: string; phase: StagePhoto["phase"]; id: string; uploadedAt: string }> = [];
  const receipt = Array.isArray(order.data?.reception_photos) ? order.data.reception_photos : [];
  receipt.forEach((reference, index) => {
    if (typeof reference === "string") candidates.push({ reference, phase: "received", id: `receipt-${index}`, uploadedAt: "" });
  });
  for (const supplement of supplements.data || []) {
    const photos = Array.isArray(supplement.photos) ? supplement.photos : [];
    photos.forEach((reference, index) => {
      if (typeof reference === "string") candidates.push({ reference, phase: "in_progress", id: `supplement-${supplement.id}-${index}`, uploadedAt: supplement.created_at || "" });
    });
  }
  if (!candidates.length) return [];
  const paths = candidates.map((candidate) => canonicalMediaReference(candidate.reference, "damage-photos"));
  const urls = await resolveImageReferences(paths, "damage-photos");
  return candidates.flatMap((candidate, index) => urls[index] ? [{
    id: candidate.id,
    phase: candidate.phase,
    dataUrl: urls[index],
    storagePath: paths[index],
    uploadedAt: candidate.uploadedAt,
  }] : []);
}
