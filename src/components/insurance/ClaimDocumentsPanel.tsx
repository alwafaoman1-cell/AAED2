import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Camera, Download, Eye, FileText, FileUp, Loader2, Mail, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ArchivedPdfPreviewDialog from "@/components/ArchivedPdfPreviewDialog";
import { useClaimDocuments, type ClaimGeneratedDoc } from "@/hooks/useClaimDocuments";
import { supabase } from "@/integrations/supabase/client";
import { parseMediaStorageReference } from "@/lib/vehicleMediaUrls";
import { claimDocLabel, type ClaimDocCategory } from "@/lib/uploadHtmlAsPdf";
import { isUuid } from "@/lib/uuid";

const DocumentScanner = lazy(() => import("@/components/documents/DocumentScanner"));

const UPLOAD_CATEGORIES = [
  { value: "police_report", ar: "تقرير الشرطة", en: "Police report" },
  { value: "claim_form", ar: "استمارة مطالبة", en: "Claim form" },
  { value: "quote", ar: "عرض سعر", en: "Quotation" },
  { value: "inspection_report", ar: "تقرير الفحص", en: "Inspection report" },
  { value: "lpo", ar: "أمر الشراء", en: "Repair order" },
  { value: "other", ar: "مستند آخر", en: "Other document" },
] as const;

interface Props {
  claimId: string;
  claimNumber?: string;
  insuranceEmail?: string;
  onUpload: (files: File[], category: string) => Promise<boolean>;
  onDelete: (document: ClaimGeneratedDoc) => Promise<void>;
}

function documentLabel(category: string, english: boolean) {
  const upload = UPLOAD_CATEGORIES.find((item) => item.value === category);
  return upload ? upload[english ? "en" : "ar"] : claimDocLabel(category as ClaimDocCategory, english ? "en" : "ar");
}

async function downloadDocumentBlob(document: ClaimGeneratedDoc): Promise<Blob> {
  const reference = parseMediaStorageReference(document.file_path, document.storage_bucket);
  if (reference) {
    const { data, error } = await supabase.storage.from(reference.bucket).download(reference.path);
    if (error || !data) throw error || new Error("Document could not be downloaded");
    return data;
  }
  if (!/^https:\/\//i.test(document.url)) throw new Error("Document is not available in cloud storage");
  const response = await fetch(document.url);
  if (!response.ok) throw new Error(`Document download failed (HTTP ${response.status})`);
  return response.blob();
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function ClaimDocumentsPanel({ claimId, claimNumber, insuranceEmail, onUpload, onDelete }: Props) {
  const { i18n } = useTranslation();
  const english = i18n.language?.startsWith("en") || false;
  const { data: docs = [], isLoading, isError, error } = useClaimDocuments(claimId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>("other");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<ClaimGeneratedDoc | null>(null);

  const saveFiles = async (files: File[]) => {
    if (!files.length || uploading) return false;
    setUploading(true);
    try {
      return await onUpload(files, category);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : (english ? "Could not save document" : "تعذر حفظ المستند"));
      return false;
    } finally {
      setUploading(false);
    }
  };

  const downloadOne = async (document: ClaimGeneratedDoc) => {
    setBusyDocument(document.id);
    try {
      saveBlob(await downloadDocumentBlob(document), document.file_name);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : (english ? "Download failed" : "تعذر التنزيل"));
    } finally {
      setBusyDocument(null);
    }
  };

  const downloadAllAsZip = async () => {
    if (!docs.length) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      let added = 0;
      for (const document of docs) {
        try {
          const blob = await downloadDocumentBlob(document);
          zip.folder(document.category)?.file(`${added + 1}-${document.file_name}`, blob);
          added += 1;
        } catch (caught) {
          console.warn("Claim document ZIP item unavailable", document.id, caught);
        }
      }
      if (!added) throw new Error(english ? "No documents could be downloaded" : "تعذر تنزيل أي مستند");
      const safeReference = (claimNumber || claimId.slice(0, 8)).replace(/[^\p{L}\p{N}._-]+/gu, "_");
      saveBlob(await zip.generateAsync({ type: "blob" }), `Claim-Documents-${safeReference}.zip`);
      if (added < docs.length) toast.warning(english ? `Downloaded ${added} of ${docs.length} files; some were unavailable` : `نُزّل ${added} من ${docs.length} ملفات؛ تعذر تنزيل الباقي`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : (english ? "Export failed" : "تعذر التصدير"));
    } finally {
      setZipping(false);
    }
  };

  const shareDocument = async (document: ClaimGeneratedDoc, channel: "whatsapp" | "email") => {
    // Reserve the WhatsApp tab in the click gesture; browsers otherwise block it
    // after the asynchronous private-storage signing request.
    const chatWindow = channel === "whatsapp" ? window.open("about:blank", "_blank") : null;
    if (chatWindow) chatWindow.opener = null;
    setBusyDocument(document.id);
    try {
      const reference = parseMediaStorageReference(document.file_path, document.storage_bucket);
      if (!reference) throw new Error(english ? "This document has no shareable storage path" : "لا يوجد لهذا المستند مسار تخزين قابل للمشاركة");
      // A fresh, short-lived URL is created only on user action. It is never
      // persisted in the claim row or sent to an unspecified external service.
      const { data, error: signError } = await supabase.storage.from(reference.bucket).createSignedUrl(reference.path, 24 * 60 * 60);
      if (signError || !data?.signedUrl) throw signError || new Error("Could not create a private document link");
      const title = `${claimNumber || claimId} — ${document.file_name}`;
      if (channel === "whatsapp") {
        if (!chatWindow) throw new Error(english ? "Allow pop-ups to open WhatsApp" : "اسمح بالنوافذ المنبثقة لفتح واتساب");
        chatWindow.location.replace(`https://wa.me/?text=${encodeURIComponent(`${title}\n${data.signedUrl}`)}`);
      } else {
        const subject = encodeURIComponent(title);
        const body = encodeURIComponent(`${title}\n${data.signedUrl}\n\n${english ? "Private link valid for 24 hours." : "رابط خاص صالح لمدة 24 ساعة."}`);
        window.location.href = `mailto:${encodeURIComponent(insuranceEmail || "")}?subject=${subject}&body=${body}`;
      }
      toast.info(english ? "Composer opened; the document has not been sent. The link expires in 24 hours." : "فُتح تطبيق المشاركة ولم يُرسل المستند بعد. تنتهي صلاحية الرابط خلال 24 ساعة.");
    } catch (caught) {
      chatWindow?.close();
      toast.error(caught instanceof Error ? caught.message : (english ? "Could not prepare sharing" : "تعذر تجهيز المشاركة"));
    } finally {
      setBusyDocument(null);
    }
  };

  return <Card className="space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><FileText size={16} className="text-primary" />{english ? "Claim documents" : "مستندات المطالبة"} ({docs.length})</h3>
        <p className="mt-1 text-xs text-muted-foreground">{english ? "PDF files and scans are saved to this claim without waiting for OCR." : "تُحفظ ملفات PDF والمسح مع المطالبة مباشرة دون انتظار استخراج النص."}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={english ? "Document type" : "نوع المستند"} value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs" disabled={uploading}>
          {UPLOAD_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item[english ? "en" : "ar"]}</option>)}
        </select>
        <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          void saveFiles(files);
        }} />
        <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Loader2 size={14} className="me-1 animate-spin" /> : <FileUp size={14} className="me-1" />}{english ? "Upload PDF / image" : "رفع PDF / صورة"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => setScannerOpen(true)}><Camera size={14} className="me-1" />{english ? "Scan to PDF" : "مسح إلى PDF"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={zipping || !docs.length} onClick={() => void downloadAllAsZip()}>
          {zipping ? <Loader2 size={14} className="me-1 animate-spin" /> : <Archive size={14} className="me-1" />}{english ? "Download all" : "تنزيل الكل"}
        </Button>
      </div>
    </div>
    {isLoading ? <p role="status" className="py-6 text-center text-xs text-muted-foreground">{english ? "Loading documents…" : "جاري تحميل المستندات…"}</p>
      : isError ? <p role="alert" className="py-6 text-center text-xs text-destructive">{english ? "Documents could not be loaded" : "تعذر تحميل المستندات"}: {(error as Error)?.message}</p>
      : !docs.length ? <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">{english ? "No documents saved yet." : "لا توجد مستندات محفوظة بعد."}</p>
      : <div className="max-h-96 space-y-2 overflow-y-auto">
        {docs.map((document) => {
          const busy = busyDocument === document.id;
          const removable = isUuid(document.id) && document.source !== "generated_claim_document" && !["claim_estimate", "tax_invoice", "delivery_proof", "cancelled_delivery_proof", "claim_summary"].includes(document.category);
          return <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={document.file_name}>{document.file_name}</p>
              <p className="text-xs text-muted-foreground">{documentLabel(document.category, english)} · {new Date(document.created_at).toLocaleString(english ? "en-GB" : "ar-OM")}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="outline" disabled={busy || !document.url} onClick={() => setPreviewDoc(document)} title={english ? "Preview" : "معاينة"}><Eye size={14} /></Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void downloadOne(document)} title={english ? "Download" : "تنزيل"}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void shareDocument(document, "whatsapp")} title={english ? "Share private link via WhatsApp" : "مشاركة رابط خاص عبر واتساب"}><MessageCircle size={14} /></Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void shareDocument(document, "email")} title={english ? "Share private link by email" : "مشاركة رابط خاص بالبريد"}><Mail size={14} /></Button>
              {removable && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                if (!window.confirm(english ? "Remove this document from the claim archive?" : "هل تريد إزالة المستند من أرشيف المطالبة؟")) return;
                setBusyDocument(document.id);
                void onDelete(document).catch((caught) => toast.error(caught instanceof Error ? caught.message : (english ? "Removal failed" : "تعذرت الإزالة"))).finally(() => setBusyDocument(null));
              }} title={english ? "Remove" : "إزالة"}><Trash2 size={14} /></Button>}
            </div>
          </div>;
        })}
      </div>}
    <p className="text-[11px] text-muted-foreground">{english ? "WhatsApp and email open a draft containing a private 24-hour link; sending is completed by you in the chosen app." : "واتساب والبريد يفتحان مسودة برابط خاص صالح 24 ساعة؛ تُكمل أنت الإرسال في التطبيق المختار."}</p>
    {scannerOpen && <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">{english ? "Opening scanner…" : "جاري فتح الماسح…"}</p>}>
      <DocumentScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onExtract={(file) => saveFiles([file])} submitLabel={{ ar: "حفظ PDF مع المطالبة", en: "Save PDF to claim" }} />
    </Suspense>}
    {previewDoc && <ArchivedPdfPreviewDialog open onOpenChange={(open) => { if (!open) setPreviewDoc(null); }} url={previewDoc.url} fileName={previewDoc.file_name} title={`${documentLabel(previewDoc.category, english)} — ${previewDoc.file_name}`} />}
  </Card>;
}
