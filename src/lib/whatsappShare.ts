// Unified helper: upload a PDF blob to Storage, then send/share via WhatsApp.
// All sending is performed by the whatsapp-meta-send Edge Function.

import { supabase } from "@/integrations/supabase/client";
import { generatePdfFromHtml, DEFAULT_MARGINS } from "@/lib/htmlToPdf";
import { normalizePhone } from "@/lib/phoneUtils";

const BUCKET = "invoices-pdf";
const SIGNED_TTL = 60 * 60 * 24 * 30; // 30 days

export interface UploadPdfResult {
  url: string;
  path: string;
  fileName: string;
}

/** Upload an existing Blob to invoices-pdf bucket (tenant-scoped path) and get a signed URL. */
export async function uploadPdfBlob(blob: Blob, fileBaseName: string, subFolder = "shared"): Promise<UploadPdfResult | null> {
  try {
    const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
    if (!tenantId) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = fileBaseName.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${tenantId}/${subFolder}/${stamp}-${safeName}.pdf`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      upsert: false, contentType: "application/pdf",
    });
    if (error) { console.warn("upload pdf failed", error); return null; }
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
    return { url: signed?.signedUrl || "", path, fileName: `${safeName}.pdf` };
  } catch (e) {
    console.warn("uploadPdfBlob exception", e);
    return null;
  }
}

/** Convert HTML string → real PDF Blob (uses html2canvas+jsPDF). */
export async function htmlToPdfBlob(htmlContent: string, fileBaseName: string): Promise<Blob> {
  return generatePdfFromHtml({
    htmlContent,
    fileName: fileBaseName,
    download: false,
    margins: DEFAULT_MARGINS,
  });
}

/** Check if Meta WhatsApp Cloud integration is enabled for the tenant. */
export async function isMetaWhatsAppEnabled(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("tenant_integrations")
      .select("enabled")
      .eq("provider", "meta_whatsapp")
      .maybeSingle();
    return !!data?.enabled;
  } catch { return false; }
}

/** Send PDF document via Meta WhatsApp Cloud (link-based — file must be publicly reachable). */
export async function sendPdfViaMetaCloud(args: {
  to: string;            // phone, any format
  pdfUrl: string;        // public/signed URL
  fileName: string;
  caption?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to = normalizePhone(args.to);
  if (!to) return { ok: false, error: "invalid_phone" };
  try {
    const { data, error } = await supabase.functions.invoke("whatsapp-meta-send", {
      body: {
        to,
        type: "document",
        mediaUrl: args.pdfUrl,
        filename: args.fileName,
        caption: args.caption,
      },
    });
    if (error) return { ok: false, error: error.message };
    if (!data?.ok) return { ok: false, error: data?.error || "send_failed" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network_error" };
  }
}

/** Open wa.me composer with caption + signed URL appended. */
export function openWhatsAppShareLink(args: { phone?: string; caption?: string; pdfUrl: string }) {
  if (!args.phone) throw new Error("رقم الهاتف مطلوب للإرسال الآمن");
  return sendPdfViaMetaCloud({
    to: args.phone,
    pdfUrl: args.pdfUrl,
    fileName: "document.pdf",
    caption: args.caption,
  });
}

/** End-to-end: upload PDF then send through Meta Cloud Edge Function only. */
export async function shareBlobViaWhatsApp(args: {
  blob: Blob;
  fileBaseName: string;
  subFolder?: string;
  phone?: string;
  caption?: string;
  preferMeta?: boolean;
}): Promise<{ ok: boolean; channel: "meta" | "wa.me" | "none"; url?: string; error?: string }> {
  const uploaded = await uploadPdfBlob(args.blob, args.fileBaseName, args.subFolder || "shared");
  if (!uploaded?.url) return { ok: false, channel: "none", error: "upload_failed" };

  if (!args.phone) return { ok: false, channel: "none", error: "phone_required" };
  const r = await sendPdfViaMetaCloud({
    to: args.phone, pdfUrl: uploaded.url, fileName: uploaded.fileName, caption: args.caption,
  });
  if (r.ok) return { ok: true, channel: "meta", url: uploaded.url };
  return { ok: false, channel: "none", url: uploaded.url, error: r.error };
}
