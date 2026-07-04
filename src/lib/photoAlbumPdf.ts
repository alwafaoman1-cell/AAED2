import { downloadPdfV2, escapeHtml } from "./pdf-v2";

export interface PhotoAlbumImage {
  dataUrl: string;
  caption?: string;
  width: number;
  height: number;
}

export interface PhotoAlbumOptions {
  workOrderRef?: string;
  customer?: string;
  vehicle?: string;
  date?: string;
  title?: string;
}

export function loadImageMeta(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

function buildPhotoAlbumHtml(images: PhotoAlbumImage[], opts: PhotoAlbumOptions) {
  const title = opts.title || "Photo Album";
  const meta = [opts.workOrderRef && `WO: ${opts.workOrderRef}`, opts.customer, opts.vehicle, opts.date]
    .filter(Boolean)
    .map((v) => escapeHtml(String(v)))
    .join(" · ");

  const cards = images.map((img, idx) => `
    <figure class="pdf-v2-card" style="display:inline-block;width:86mm;min-height:112mm;margin:2mm;vertical-align:top;text-align:center;break-inside:avoid;page-break-inside:avoid">
      <div style="font-weight:700;margin-bottom:2mm">#${idx + 1}</div>
      <img src="${img.dataUrl}" alt="photo-${idx + 1}" style="max-width:80mm;max-height:90mm;object-fit:contain" />
      ${img.caption ? `<figcaption style="margin-top:2mm;color:#64748b">${escapeHtml(img.caption)}</figcaption>` : ""}
    </figure>
  `).join("");

  return `
    <section class="pdf-v2-card">
      <h2>${escapeHtml(title)}</h2>
      ${meta ? `<p>${meta}</p>` : ""}
      <p>Total photos: ${images.length}</p>
    </section>
    <section>${cards || `<p>No photos</p>`}</section>
  `;
}

export async function generatePhotoAlbumPdf(
  images: PhotoAlbumImage[],
  opts: PhotoAlbumOptions = {},
): Promise<Blob> {
  return downloadPdfV2(
    {
      html: buildPhotoAlbumHtml(images, opts),
      meta: {
        documentType: "report",
        title: opts.title || "Photo Album",
        layout: "a4-portrait",
        documentNumber: opts.workOrderRef,
        documentDate: opts.date,
      },
    },
    opts.title || "photo-album",
    false,
  );
}

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
