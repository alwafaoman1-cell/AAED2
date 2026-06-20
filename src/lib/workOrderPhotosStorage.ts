// Storage layer for work-order photos.
// - Compresses to WebP (via existing imageToWebp helper)
// - Uploads to private bucket `work-order-photos` under `<tenant>/<orderId>/<photoId>.webp`
// - Returns a signed URL (long TTL) stored inside StagePhoto.dataUrl for backward compatibility
// - Also exposes a background migrator that converts legacy base64 data URLs to storage URLs

import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import type { StagePhoto } from "@/lib/workOrdersStore";

const BUCKET = "work-order-photos";
const SIGNED_TTL_SEC = 60 * 60 * 24 * 365; // 1 year — refreshed on each load

/** Upload a compressed WebP for a stage photo. Returns the storage path + signed URL. */
export async function uploadStagePhoto(opts: {
  orderId: string;
  photoId: string;
  file: Blob;
}): Promise<{ path: string; url: string } | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;
  const safeOrderId = opts.orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = `${tenantId}/${safeOrderId}/${opts.photoId}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) {
    console.warn("[workOrderPhotosStorage] upload failed", error);
    return null;
  }
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SEC);
  return { path, url: signed?.signedUrl || "" };
}

/** Convert a base64 data URL string → Blob */
function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const [meta, b64] = dataUrl.split(",");
    if (!b64) return null;
    const mime = /data:([^;]+);/.exec(meta || "")?.[1] || "image/webp";
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch { return null; }
}

/** True if a StagePhoto still holds a base64 data URL (legacy) and needs migration. */
export function isLegacyDataUrl(p: StagePhoto): boolean {
  return !!p?.dataUrl && p.dataUrl.startsWith("data:");
}

/** Migrate all legacy data-URL photos for a single work order to Storage.
 *  Returns the new photos array if anything changed, else null. */
export async function migrateOrderPhotos(orderId: string, photos: StagePhoto[]): Promise<StagePhoto[] | null> {
  if (!photos || photos.length === 0) return null;
  const legacy = photos.filter(isLegacyDataUrl);
  if (legacy.length === 0) return null;

  const updated: StagePhoto[] = [];
  let changed = false;
  for (const p of photos) {
    if (!isLegacyDataUrl(p)) { updated.push(p); continue; }
    const blob = dataUrlToBlob(p.dataUrl);
    if (!blob) { updated.push(p); continue; }
    const res = await uploadStagePhoto({ orderId, photoId: p.id, file: blob });
    if (!res?.url) { updated.push(p); continue; }
    updated.push({ ...p, dataUrl: res.url, storagePath: res.path } as any);
    changed = true;
  }
  return changed ? updated : null;
}

/** Refresh signed URLs for non-legacy photos (in case they expired). */
export async function refreshSignedPhotoUrls(photos: StagePhoto[]): Promise<StagePhoto[] | null> {
  const stalePaths: { idx: number; path: string }[] = [];
  photos.forEach((p, idx) => {
    const path = (p as any).storagePath as string | undefined;
    if (path && !p.dataUrl?.includes("token=")) stalePaths.push({ idx, path });
  });
  if (stalePaths.length === 0) return null;
  const out = photos.slice();
  for (const { idx, path } of stalePaths) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SEC);
    if (data?.signedUrl) out[idx] = { ...out[idx], dataUrl: data.signedUrl };
  }
  return out;
}
