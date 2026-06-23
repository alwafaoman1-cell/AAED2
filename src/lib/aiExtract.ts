// AI extraction helper: reads an image or PDF file and returns structured data
// extracted by Lovable AI via the `ai-extract-data` edge function.
// PDFs are rendered to PNGs client-side using pdfjs-dist — ALL pages (capped)
// are sent so the model can find the receiver name / ID anywhere in the doc.
import { supabase } from "@/integrations/supabase/client";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore — worker is loaded as URL
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min?url";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfjsWorker;

export type ExtractSchema =
  | "vehicle_customer"
  | "insurance_claim"
  | "expense_receipt"
  | "spare_part"
  | "delivery_receipt"
  | "diagnostic_report";

const MAX_PDF_PAGES = 8;

async function fileToBase64(file: Blob): Promise<{ b64: string; mime: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { b64: btoa(bin), mime: (file as File).type || "image/jpeg" };
}

async function renderPdfPageToJpeg(pdf: any, pageNum: number): Promise<{ b64: string; mime: string }> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  const MAX = 2200;
  let finalCanvas: HTMLCanvasElement = canvas;
  if (canvas.width > MAX || canvas.height > MAX) {
    const scale = MAX / Math.max(canvas.width, canvas.height);
    const c2 = document.createElement("canvas");
    c2.width = Math.round(canvas.width * scale);
    c2.height = Math.round(canvas.height * scale);
    c2.getContext("2d")!.drawImage(canvas, 0, 0, c2.width, c2.height);
    finalCanvas = c2;
  }

  const dataUrl = finalCanvas.toDataURL("image/jpeg", 0.82);
  return { b64: dataUrl.split(",")[1], mime: "image/jpeg" };
}

async function pdfAllPagesToJpegs(file: File): Promise<{ b64: string; mime: string }[]> {
  const buf = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;
  const total = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const out: { b64: string; mime: string }[] = [];
  for (let i = 1; i <= total; i++) {
    out.push(await renderPdfPageToJpeg(pdf, i));
  }
  return out;
}

export async function extractFromFile(
  file: File,
  schema: ExtractSchema,
): Promise<Record<string, string>> {
  let images: { b64: string; mime: string }[];
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    images = await pdfAllPagesToJpegs(file);
  } else if (file.type.startsWith("image/")) {
    images = [await fileToBase64(file)];
  } else {
    throw new Error("صيغة غير مدعومة. ارفع صورة أو PDF.");
  }

  if (images.length === 0) throw new Error("لم يتم العثور على أي صفحة في الملف");

  const { data, error } = await supabase.functions.invoke("ai-extract-data", {
    body: {
      // Backwards-compatible single image fields:
      imageBase64: images[0].b64,
      mimeType: images[0].mime,
      // Multi-page payload (edge function reads this when present):
      images: images.map((p) => ({ b64: p.b64, mime: p.mime })),
      schema,
    },
  });
  if (error) throw new Error(error.message || "فشل الاستخراج");
  if ((data as any)?.error) throw new Error((data as any).error);
  return ((data as any)?.data || {}) as Record<string, string>;
}

// Allow extracting from multiple files (e.g. front+back of ID card) in one call.
export async function extractFromFiles(
  files: File[],
  schema: ExtractSchema,
): Promise<Record<string, string>> {
  const all: { b64: string; mime: string }[] = [];
  for (const file of files) {
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const pages = await pdfAllPagesToJpegs(file);
      all.push(...pages);
    } else if (file.type.startsWith("image/")) {
      all.push(await fileToBase64(file));
    }
    if (all.length >= MAX_PDF_PAGES) break;
  }
  if (all.length === 0) throw new Error("لا توجد صور صالحة");

  const { data, error } = await supabase.functions.invoke("ai-extract-data", {
    body: {
      imageBase64: all[0].b64,
      mimeType: all[0].mime,
      images: all.slice(0, MAX_PDF_PAGES),
      schema,
    },
  });
  if (error) throw new Error(error.message || "فشل الاستخراج");
  if ((data as any)?.error) throw new Error((data as any).error);
  return ((data as any)?.data || {}) as Record<string, string>;
}
