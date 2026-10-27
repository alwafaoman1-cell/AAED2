import { convertImageToWebp } from "@/lib/imageToWebp";

const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/** Shared policy for every work-order photo entry point. Keeps the smaller original when needed. */
export async function optimizeWorkOrderPhoto(file: File): Promise<{ file: File; extension: string } | null> {
  const optimized = await convertImageToWebp(file, { quality: 0.78, maxDimension: 1800, reencodeWebp: true });
  const extension = PHOTO_EXTENSIONS[optimized.type];
  if (!extension || !optimized.size || optimized.size > MAX_UPLOAD_BYTES) {
    console.warn("[work order photos] unsupported or oversized image", { type: optimized.type, size: optimized.size });
    return null;
  }
  return { file: optimized, extension };
}
