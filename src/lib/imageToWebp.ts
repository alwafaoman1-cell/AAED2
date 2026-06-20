// تحويل صور المستخدم إلى WebP قبل الرفع — أصغر حجماً وأخف على السيرفر
// يستخدم Canvas في المتصفح. إذا فشل التحويل أو الملف ليس صورة، يُرجع الملف الأصلي كما هو.

export interface WebpOptions {
  /** الجودة 0..1 — افتراضي 0.85 */
  quality?: number;
  /** أقصى عرض/ارتفاع بالبكسل — افتراضي 2200 */
  maxDimension?: number;
}

const SKIP_TYPES = new Set(["image/gif", "image/svg+xml", "image/webp"]);

/** يحوّل ملف صورة إلى WebP. غير الصور (PDF...) تُعاد كما هي. */
export async function convertImageToWebp(
  file: File,
  opts: WebpOptions = {},
): Promise<File> {
  try {
    if (!file || !file.type?.startsWith("image/")) return file;
    if (SKIP_TYPES.has(file.type)) return file;

    const quality = opts.quality ?? 0.85;
    const maxDim = opts.maxDimension ?? 2200;

    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("image load failed"));
      im.src = dataUrl;
    });

    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) return file;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", quality),
    );
    if (!blob) return file;
    // إن لم يقلّ الحجم، أعد الأصلي (نادراً للصور الصغيرة جداً)
    if (blob.size >= file.size && file.type === "image/webp") return file;

    const baseName = (file.name || "image").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/** يحوّل ملف صورة إلى WebP ثم يعيده كـ dataURL. للملفات غير الصورية يعيد dataURL الأصلي. */
export async function fileToWebpDataUrl(file: File, opts: WebpOptions = {}): Promise<string> {
  const out = await convertImageToWebp(file, opts);
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(out);
  });
}
