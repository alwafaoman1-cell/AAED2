import type { StagePhoto } from "@/lib/workOrdersStore";
import { parseMediaStorageReference, resolveVehicleMediaUrls } from "@/lib/vehicleMediaUrls";
import { generatePhotoAlbumPdf, type PhotoAlbumImage } from "@/lib/photoAlbumPdf";

const PDF_IMAGE_MAX_DIMENSION = 1200;
const PDF_JPEG_QUALITY = 0.68;

async function imageToCompactJpeg(url: string): Promise<PhotoAlbumImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PHOTO_FETCH_FAILED:${response.status}`);
  const source = await response.blob();
  const objectUrl = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("PHOTO_DECODE_FAILED"));
      element.src = objectUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("PHOTO_DIMENSIONS_MISSING");
    const scale = Math.min(1, PDF_IMAGE_MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PHOTO_CANVAS_UNAVAILABLE");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY);
    if (!/^data:image\/jpeg(?:;[^,]*)?,/i.test(dataUrl)) throw new Error("PHOTO_JPEG_UNAVAILABLE");
    return { dataUrl, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Generate from the existing gallery references only; no second Storage copy is created. */
export async function generateWorkOrderPhotosPdf(
  photos: StagePhoto[],
  orderNumber: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<Blob> {
  if (!photos.length) throw new Error("NO_WORK_ORDER_PHOTOS");
  const references = photos.map((photo) => {
    const parsed = parseMediaStorageReference(photo.dataUrl);
    return {
      storage_bucket: parsed?.bucket || "work-order-photos",
      storage_path: parsed?.path || photo.storagePath || "",
      public_url: photo.dataUrl,
    };
  });
  const resolved = await resolveVehicleMediaUrls(references);
  const images: PhotoAlbumImage[] = [];
  for (let index = 0; index < photos.length; index++) {
    const url = resolved[index]?.url || photos[index].dataUrl;
    if (!url) throw new Error(`PHOTO_URL_MISSING:${index + 1}`);
    try {
      images.push(await imageToCompactJpeg(url));
    } catch (error) {
      console.warn("[work order photos] PDF image failed", { index: index + 1, error });
      throw new Error(`PHOTO_PDF_IMAGE_FAILED:${index + 1}`);
    }
    onProgress?.(index + 1, photos.length);
  }
  return generatePhotoAlbumPdf(images, { workOrderRef: orderNumber, title: orderNumber });
}
