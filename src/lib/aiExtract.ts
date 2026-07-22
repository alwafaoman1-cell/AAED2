// AI extraction helper: reads an image or PDF file and returns structured data
// extracted by the `ai-extract-data` Edge Function.
// PDFs are rendered to JPEG pages client-side using pdfjs-dist.
import { supabase } from "@/integrations/supabase/client";
import * as pdfjsLib from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - worker is loaded as URL by Vite.
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min?url";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfjsWorker;

export type ExtractSchema =
  | "vehicle_customer"
  | "insurance_claim"
  | "estimate_document"
  | "expense_receipt"
  | "spare_part"
  | "delivery_receipt"
  | "diagnostic_report";

const MAX_PDF_PAGES = 8;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

const INSURANCE_CLAIM_FIELDS = [
  "insurance_company",
  "claim_number",
  "owner_name",
  "owner_phone",
  "plate",
  "plate_number",
  "plate_letters",
  "plate_country",
  "make",
  "model",
  "year",
  "color",
  "vin",
  "incident_date",
  "damage_description",
  "estimated_cost",
] as const;

function validateExtractedData(schema: ExtractSchema, data: unknown): Record<string, string> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("استجابة الذكاء الاصطناعي غير صالحة. لم يتم حفظ أي بيانات.");
  }

  const raw = data as Record<string, unknown>;
  if (schema !== "insurance_claim") {
    return Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, value == null ? "" : String(value)])
    );
  }

  const out: Record<string, string> = {};
  for (const key of INSURANCE_CLAIM_FIELDS) {
    const value = raw[key];
    out[key] = value == null ? "" : String(value).trim();
  }

  if (!INSURANCE_CLAIM_FIELDS.some((key) => out[key])) {
    throw new Error("لم يتم استخراج بيانات مطالبة واضحة. جرّب صورة أوضح أو أدخل البيانات يدويًا.");
  }

  return out;
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : String(error || "فشل الاستخراج");
  const context = (error as any)?.context;

  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      const msg = body?.message || body?.error || body?.details || body?.code;
      if (msg) return String(msg);
    } catch {
      // Response may have already been consumed or may not be JSON.
    }
  }

  if (context && typeof context.text === "function") {
    try {
      const body = await context.text();
      if (body) return body;
    } catch {
      // noop
    }
  }

  return fallback;
}

function normalizeAiExtractError(message: string) {
  const raw = String(message || "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("gemini_free_tier_unavailable") || lower.includes("gemini free") || lower.includes("free tier")) {
    return "تعذر التحليل باستخدام الحصة المجانية لـ Gemini. يرجى المحاولة لاحقًا أو إدخال البيانات يدويًا.";
  }

  if (!raw) return "فشل الاستخراج بالذكاء الاصطناعي.";
  if (lower.includes("edge function returned a non-2xx")) {
    return "فشل طلب الذكاء الاصطناعي. افتح إعدادات مفاتيح الذكاء الاصطناعي وتأكد من تفعيل مزود صحيح.";
  }
  if (lower.includes("ai provider is not configured") || lower.includes("ai_api_key_required")) {
    return "مزود الذكاء الاصطناعي غير مهيأ. أضف مفتاح OpenAI/Gemini من الإعدادات ثم أعد المحاولة.";
  }
  if (lower.includes("credits exhausted") || lower.includes("insufficient_quota") || lower.includes("quota")) {
    return "رصيد أو حصة مزود الذكاء الاصطناعي غير كافية.";
  }
  if (lower.includes("rate limit")) {
    return "تم تجاوز حد استخدام الذكاء الاصطناعي. حاول بعد قليل.";
  }
  if (lower.includes("unauthorized")) {
    return "انتهت جلسة الدخول أو لا توجد صلاحية. سجل الدخول ثم أعد المحاولة.";
  }

  if (lower.includes("model not found")) return "Ollama model not found. Check the Vision Model name in Settings → AI Keys.";
  if (lower.includes("invalid api key")) return "Invalid AI provider API key.";
  if (lower.includes("request timeout")) return "AI provider request timed out. Increase timeout or check server availability.";
  if (lower.includes("ollama server unavailable")) return "Ollama server is unavailable from the backend/Edge Function.";

  return raw;
}

async function invokeAiExtract(body: Record<string, unknown>): Promise<Record<string, string>> {
  const { data, error } = await supabase.functions.invoke("ai-extract-data", { body });

  if (error) {
    throw new Error(normalizeAiExtractError(await getFunctionErrorMessage(error)));
  }

  if ((data as any)?.ok === false || (data as any)?.error) {
    throw new Error(normalizeAiExtractError((data as any)?.message || (data as any)?.error || "فشل الاستخراج"));
  }

  return validateExtractedData(String(body.schema || "") as ExtractSchema, (data as any)?.data || {});
}

async function fileToBase64(file: Blob): Promise<{ b64: string; mime: string }> {
  if ((file as File).type?.startsWith("image/")) {
    return imageFileToJpeg(file);
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { b64: btoa(bin), mime: (file as File).type || "image/jpeg" };
}

async function imageFileToJpeg(file: Blob): Promise<{ b64: string; mime: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("image_read_failed"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_decode_failed"));
    image.src = dataUrl;
  });

  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("image_canvas_unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const resized = canvas.toDataURL("image/jpeg", 0.78);
  return { b64: resized.split(",")[1] || "", mime: "image/jpeg" };
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
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new Error("PDF exceeds the free Gemini extraction limit. Maximum allowed: 8 pages.");
  }
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

  if (file.size > MAX_FILE_BYTES) {
    throw new Error("الملف كبير جدًا. الحد الأقصى 12MB.");
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    images = await pdfAllPagesToJpegs(file);
  } else if (file.type.startsWith("image/")) {
    images = [await fileToBase64(file)];
  } else {
    throw new Error("صيغة غير مدعومة. ارفع صورة أو PDF.");
  }

  if (images.length === 0) throw new Error("لم يتم العثور على أي صفحة في الملف");

  return invokeAiExtract({
    imageBase64: images[0].b64,
    mimeType: images[0].mime,
    images: images.map((p) => ({ b64: p.b64, mime: p.mime })),
    schema,
  });
}

// Allow extracting from multiple files (e.g. front+back of ID card) in one call.
export async function extractFromFiles(
  files: File[],
  schema: ExtractSchema,
): Promise<Record<string, string>> {
  const all: { b64: string; mime: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("أحد الملفات كبير جدًا. الحد الأقصى 12MB.");
    }
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const pages = await pdfAllPagesToJpegs(file);
      all.push(...pages);
    } else if (file.type.startsWith("image/")) {
      all.push(await fileToBase64(file));
    }
    if (all.length >= MAX_PDF_PAGES) break;
  }

  if (all.length === 0) throw new Error("لا توجد صور صالحة");

  return invokeAiExtract({
    imageBase64: all[0].b64,
    mimeType: all[0].mime,
    images: all.slice(0, MAX_PDF_PAGES),
    schema,
  });
}
