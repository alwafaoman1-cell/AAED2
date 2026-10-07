import type { UnifiedMediaRecord } from "@/lib/claimWorkOrderUnified";
import type { StagePhase, StagePhoto } from "@/lib/workOrdersStore";
import { mediaStorageKey, parseMediaStorageReference } from "@/lib/vehicleMediaUrls";

const phases: StagePhase[] = ["received", "inspection", "in_progress", "quality", "delivery"];

function mediaPhase(stage?: string | null, category?: string | null): StagePhase {
  if (phases.includes(stage as StagePhase)) return stage as StagePhase;
  if (phases.includes(category as StagePhase)) return category as StagePhase;
  if (category === "vehicle_receipt") return "received";
  if (category === "repair_progress") return "in_progress";
  if (category === "delivery") return "delivery";
  return "inspection";
}

/** One gallery entry per stored file, regardless of how many pages reference it. */
export function mergeWorkOrderMedia(media: UnifiedMediaRecord[], legacyPhotos: StagePhoto[]): StagePhoto[] {
  const byStorageKey = new Map<string, StagePhoto>();
  for (const row of media) {
    if (row.media_type !== "image") continue;
    const url = row.url || row.public_url || "";
    if (!url) continue;
    byStorageKey.set(mediaStorageKey(row.storage_bucket, row.storage_path), {
      id: row.id,
      phase: mediaPhase(row.stage, row.category),
      dataUrl: url,
      storagePath: row.storage_path,
      caption: row.caption || undefined,
      uploadedAt: row.uploaded_at,
    });
  }
  for (const photo of legacyPhotos) {
    const reference = parseMediaStorageReference(photo.dataUrl) ? photo.dataUrl : (photo.storagePath || photo.dataUrl);
    if (!reference) continue;
    const key = mediaStorageKey("work-order-photos", reference);
    if (!byStorageKey.has(key)) byStorageKey.set(key, photo);
  }
  return Array.from(byStorageKey.values());
}
