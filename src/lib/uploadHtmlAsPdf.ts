// رفع مستند المطالبة إلى Storage كـ PDF حقيقي (وليس HTML خام)
// + تسجيله في claim_audit_logs كـ "document_generated"
// PDF يفتح مباشرة في المتصفح والجوال — يدعم المعاينة inline والتنزيل والمشاركة عبر واتساب.

import { supabase } from "@/integrations/supabase/client";
import { generatePdfFromHtml } from "./htmlToPdf";
import { isUuid } from "@/lib/uuid";

export type ClaimDocCategory =
  | "claim_estimate"   // تقدير المطالبة
  | "tax_invoice"      // فاتورة ضريبية
  | "delivery_proof"   // محضر تسليم
  | "inspection"       // تقرير فحص
  | "claim_summary";   // ملخص المطالبة

export interface SaveClaimDocOpts {
  claimId: string;
  category: ClaimDocCategory;
  fileBaseName: string;          // مثلاً: "TaxInvoice-INS-INV-00001"
  htmlContent: string;
  meta?: Record<string, any>;    // إضافات تُحفظ في details
}

/**
 * يحوّل HTML المستند إلى PDF حقيقي عبر html2canvas، يرفعه إلى bucket: insurance-docs
 * يُنشئ سجل في claim_audit_logs مع category + file_path + details + mime_type
 * يعيد public URL للوصول السريع (يفتح مباشرة في المتصفح/الجوال).
 */
export async function saveClaimDocument(opts: SaveClaimDocOpts): Promise<{
  url: string;
  path: string;
} | null> {
  try {
    const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
    if (!tenantId) return null;
    if (!isUuid(opts.claimId)) return null;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = opts.fileBaseName.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${tenantId}/${opts.claimId}/${opts.category}/${stamp}-${safeName}.pdf`;

    // توليد PDF حقيقي من HTML (بدون تنزيل تلقائي)
    let blob: Blob;
    try {
      blob = await generatePdfFromHtml({
        htmlContent: opts.htmlContent,
        fileName: safeName,
        download: false,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    } catch (pdfErr) {
      // fallback: ارفع HTML الأصلي إذا تعذّر تحويل PDF
      console.warn("PDF generation failed, falling back to HTML:", pdfErr);
      const htmlBlob = new Blob([opts.htmlContent], { type: "text/html;charset=utf-8" });
      const fallbackPath = path.replace(/\.pdf$/i, ".html");
      const { error: upErr } = await supabase.storage
        .from("insurance-docs")
        .upload(fallbackPath, htmlBlob, { upsert: false, contentType: "text/html" });
      if (upErr) {
        console.warn("upload fallback HTML failed", upErr);
        return null;
      }
      const { data: signed } = await supabase.storage.from("insurance-docs").createSignedUrl(fallbackPath, 60 * 60 * 24 * 7);
      const pub = { publicUrl: signed?.signedUrl ?? "" };
      const url = pub?.publicUrl ?? "";
      const { data: userRes } = await supabase.auth.getUser();
      await supabase.from("claim_audit_logs").insert({
        tenant_id: tenantId as string,
        claim_id: opts.claimId,
        user_id: userRes?.user?.id ?? null,
        action: "document_generated",
        category: opts.category,
        file_path: fallbackPath,
        details: {
          url,
          file_name: `${safeName}.html`,
          mime_type: "text/html",
          ...(opts.meta || {}),
        },
      } as any);
      return { url, path: fallbackPath };
    }

    const { error: upErr } = await supabase.storage
      .from("insurance-docs")
      .upload(path, blob, { upsert: false, contentType: "application/pdf" });

    if (upErr) {
      console.warn("upload claim doc failed", upErr);
      return null;
    }

    const { data: signed } = await supabase.storage.from("insurance-docs").createSignedUrl(path, 60 * 60 * 24 * 7);
    const pub = { publicUrl: signed?.signedUrl ?? "" };
    const url = pub?.publicUrl ?? "";

    // سجل تدقيق
    const { data: userRes } = await supabase.auth.getUser();
    await supabase.from("claim_audit_logs").insert({
      tenant_id: tenantId as string,
      claim_id: opts.claimId,
      user_id: userRes?.user?.id ?? null,
      action: "document_generated",
      category: opts.category,
      file_path: path,
      details: {
        url,
        file_name: `${safeName}.pdf`,
        mime_type: "application/pdf",
        ...(opts.meta || {}),
      },
    } as any);

    return { url, path };
  } catch (e) {
    console.warn("saveClaimDocument exception", e);
    return null;
  }
}

const CAT_LABELS_AR: Record<ClaimDocCategory, string> = {
  claim_estimate: "تقدير المطالبة",
  tax_invoice: "فاتورة ضريبية",
  delivery_proof: "محضر تسليم",
  inspection: "تقرير فحص",
  claim_summary: "ملخص المطالبة",
};
const CAT_LABELS_EN: Record<ClaimDocCategory, string> = {
  claim_estimate: "Claim Estimate",
  tax_invoice: "Tax Invoice",
  delivery_proof: "Delivery Proof",
  inspection: "Inspection Report",
  claim_summary: "Claim Summary",
};
export const claimDocLabel = (c: ClaimDocCategory, lang: "ar" | "en" = "ar") =>
  (lang === "ar" ? CAT_LABELS_AR : CAT_LABELS_EN)[c] || c;
