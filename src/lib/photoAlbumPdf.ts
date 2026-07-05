// Photo Album PDF Generator
// يولّد PDF بحجم A4 بترتيب 4 صور (شبكة 2×2) لكل صفحة + رأس صفحة موحّد.
// تستخدمه أداة "ألبوم صور PDF" في صفحة الفحص والمعاينة.

import jsPDF from "jspdf";
import { getTemplateSettings } from "./pdfGenerator";

export interface PhotoAlbumImage {
  /** dataURL (image/jpeg, image/png, image/webp) */
  dataUrl: string;
  /** نص اختياري يظهر تحت الصورة */
  caption?: string;
  /** width/height بالبكسل بعد التحميل (لحساب نسبة العرض/الارتفاع) */
  width: number;
  height: number;
}

export interface PhotoAlbumOptions {
  workOrderRef?: string;
  customer?: string;
  vehicle?: string;
  date?: string; // YYYY-MM-DD
  /** عنوان الألبوم */
  title?: string;
}

const A4_W = 210;
const A4_H = 297;
const MARGIN = 8; // mm
const HEADER_H = 22; // mm
const FOOTER_H = 8; // mm
const GUTTER = 4; // mm

/** يحوّل dataUrl صورة → {width, height} */
export function loadImageMeta(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

function detectFormat(dataUrl: string): "JPEG" | "PNG" | "WEBP" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

/** يرسم رأس الصفحة الموحّد على صفحة pdf الحالية */
function drawHeader(
  doc: jsPDF,
  s: ReturnType<typeof getTemplateSettings>,
  opts: PhotoAlbumOptions,
  pageNum: number,
  totalPages: number,
) {
  const primary = s.primaryColor || "#d4a537";
  // شريط علوي بلون الهوية
  doc.setFillColor(primary);
  doc.rect(0, 0, A4_W, 4, "F");

  // الشعار
  let logoRight = A4_W - MARGIN;
  if (s.logoUrl) {
    try {
      const fmt = detectFormat(s.logoUrl);
      doc.addImage(s.logoUrl, fmt, MARGIN, 6, 20, 14, undefined, "FAST");
    } catch {
      /* ignore */
    }
  }

  // اسم الورشة (يمين)
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const titleText = opts.title || "Photo Album";
  doc.text(titleText, logoRight, 10, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(s.companyNameEn || "Workshop", logoRight, 14, { align: "right" });

  // شريط البيانات
  const meta: string[] = [];
  if (opts.workOrderRef) meta.push(`WO: ${opts.workOrderRef}`);
  if (opts.customer) meta.push(opts.customer);
  if (opts.vehicle) meta.push(opts.vehicle);
  if (opts.date) meta.push(opts.date);
  meta.push(`Page ${pageNum}/${totalPages}`);

  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  doc.text(meta.join("  •  "), MARGIN + 24, 18);

  // خط فاصل
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, HEADER_H, A4_W - MARGIN, HEADER_H);
}

function drawFooter(doc: jsPDF, s: ReturnType<typeof getTemplateSettings>) {
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, A4_H - FOOTER_H, A4_W - MARGIN, A4_H - FOOTER_H);
  doc.setFontSize(7);
  doc.setTextColor(130, 130, 130);
  doc.text(s.companyNameEn || "", A4_W / 2, A4_H - 3, { align: "center" });
}

/** يرسم صورة داخل خلية محافظاً على نسبة العرض/الارتفاع (contain) */
function drawImageContain(
  doc: jsPDF,
  img: PhotoAlbumImage,
  x: number,
  y: number,
  w: number,
  h: number,
  index: number,
) {
  // خلفية رمادية فاتحة + إطار خفيف
  doc.setFillColor(248, 248, 248);
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h, "FD");

  const ratio = img.width / img.height;
  const cellRatio = w / h;
  let drawW = w - 2;
  let drawH = h - 2;
  if (ratio > cellRatio) {
    drawH = drawW / ratio;
  } else {
    drawW = drawH * ratio;
  }
  const dx = x + (w - drawW) / 2;
  const dy = y + (h - drawH) / 2;
  try {
    doc.addImage(img.dataUrl, detectFormat(img.dataUrl), dx, dy, drawW, drawH, undefined, "FAST");
  } catch (e) {
    console.warn("addImage failed", e);
  }

  // رقم تسلسلي أعلى اليسار
  doc.setFillColor(0, 0, 0);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  const badge = `${index}`;
  doc.roundedRect(x + 1.5, y + 1.5, 6, 5, 1, 1, "F");
  doc.text(badge, x + 4.5, y + 5.2, { align: "center" });

  // تسمية أسفل الصورة
  if (img.caption && img.caption.trim()) {
    doc.setFillColor(0, 0, 0, 0.6 as any);
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const text = img.caption.length > 60 ? img.caption.slice(0, 57) + "…" : img.caption;
    doc.text(text, x + w / 2, y + h - 2, { align: "center", maxWidth: w - 4 });
  }
}

/** يولّد PDF ألبوم صور ويُعيد Blob */
export async function generatePhotoAlbumPdf(
  images: PhotoAlbumImage[],
  opts: PhotoAlbumOptions = {},
): Promise<Blob> {
  const s = getTemplateSettings();
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });

  const perPage = 4;
  const totalPages = Math.max(1, Math.ceil(images.length / perPage));

  const contentTop = HEADER_H + 4;
  const contentBottom = A4_H - FOOTER_H - 2;
  const contentH = contentBottom - contentTop;
  const contentW = A4_W - 2 * MARGIN;

  const cellW = (contentW - GUTTER) / 2;
  const cellH = (contentH - GUTTER) / 2;

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) doc.addPage();
    drawHeader(doc, s, opts, p + 1, totalPages);
    drawFooter(doc, s);

    const slice = images.slice(p * perPage, p * perPage + perPage);
    for (let i = 0; i < slice.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = MARGIN + col * (cellW + GUTTER);
      const y = contentTop + row * (cellH + GUTTER);
      drawImageContain(doc, slice[i], x, y, cellW, cellH, p * perPage + i + 1);
    }
  }

  doc.setProperties({
    title: opts.title || "Photo Album",
    subject: opts.workOrderRef || "",
    author: s.companyNameEn || "Workshop",
    creator: s.companyNameEn || "Workshop",
  });

  return doc.output("blob");
}

/** ينزّل PDF مباشرة */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/[^\w.\- ]+/g, "_") + (fileName.endsWith(".pdf") ? "" : ".pdf");
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}
