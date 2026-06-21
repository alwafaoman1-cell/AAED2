// معاينة inline لملف PDF محفوظ على Storage
// على الديسكتوب: نعرض الـ PDF داخل iframe (object URL) لتجاوز Content-Disposition
// على الموبايل: متصفحات iOS/Android لا تدعم تضمين PDF داخل iframe بشكل موثوق،
// لذا نعرض شاشة تحوي زر "فتح في تبويب" + "تنزيل" مع جلب الملف كـ Blob لضمان نجاح التنزيل cross-origin.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, X, Loader2, AlertTriangle, FileText, MessageCircle, Printer } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { openWhatsAppShareLink } from "@/lib/whatsappShare";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  url: string;
  fileName: string;
  title?: string;
}

export default function ArchivedPdfPreviewDialog({ open, onOpenChange, url, fileName, title }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const isPdf = /\.pdf(\?|$)/i.test(url) || fileName.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    if (!open || !url) return;
    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);

    (async () => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) {
          // 400 = signed URL expired/invalid · 404 = not found
          if (res.status === 400 || res.status === 401 || res.status === 403) {
            throw new Error("انتهت صلاحية الرابط — أعد فتح الصفحة لتحديثه");
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const typedBlob = isPdf
          ? new Blob([blob], { type: "application/pdf" })
          : blob;
        createdUrl = URL.createObjectURL(typedBlob);
        if (active) setBlobUrl(createdUrl);
      } catch (e: any) {
        if (active) setError(e?.message || "تعذّر تحميل الملف");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (createdUrl) setTimeout(() => URL.revokeObjectURL(createdUrl!), 1500);
    };
  }, [open, url, isPdf]);

  const handleDownload = () => {
    // نستخدم blobUrl إن توفّر — لتفادي مشاكل cross-origin مع a.download
    const href = blobUrl || url;
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    a.rel = "noopener";
    // على الموبايل بعض المتصفحات تحتاج target=_blank
    if (isMobile) a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleOpenInNewTab = () => {
    // افتح الـ blob URL إن أمكن (يتجاوز رؤوس attachment)، وإلا الرابط الأصلي
    window.open(blobUrl || url, "_blank", "noopener,noreferrer");
  };

  const handlePrint = () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.onload = () => {
      setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          handleOpenInNewTab();
        }
      }, 250);
    };
    frame.src = blobUrl || url;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 60_000);
  };

  const embedUrl = blobUrl
    ? (isPdf ? `${blobUrl}#toolbar=1&navpanes=0&view=FitH` : blobUrl)
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "max-w-full w-screen h-[100dvh] p-0 flex flex-col bg-background gap-0 rounded-none"
            : "max-w-6xl w-[95vw] h-[92vh] p-0 flex flex-col bg-background"
        }
      >
        <DialogHeader className="px-3 py-2.5 border-b border-border flex flex-row items-center justify-between gap-2 space-y-0 shrink-0">
          <DialogTitle className="text-sm font-semibold truncate flex-1 min-w-0">
            {title || fileName}
          </DialogTitle>
          <DialogDescription className="sr-only">معاينة المستند المحفوظ</DialogDescription>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-600 border-emerald-500/40 hover:bg-emerald-500/10"
              onClick={() => openWhatsAppShareLink({ pdfUrl: url, caption: fileName })}
              title="مشاركة عبر واتساب"
            >
              <MessageCircle size={14} className="ml-1" />
              واتساب
            </Button>
            {!isMobile && (
              <Button size="sm" variant="outline" onClick={handleOpenInNewTab} disabled={loading}>
                <ExternalLink size={14} className="ml-1" />
                فتح في تبويب
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handlePrint} disabled={loading || !blobUrl}>
              <Printer size={14} className="ml-1" />
              طباعة
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={loading}>
              <Download size={14} className="ml-1" />
              تنزيل
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onOpenChange(false)} className="h-8 w-8">
              <X size={16} />
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 bg-muted/20 overflow-hidden relative min-h-0">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" />
              جارٍ تحميل المستند…
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 p-6">
              <AlertTriangle className="text-destructive" size={32} />
              <div className="text-sm text-foreground">تعذّرت المعاينة</div>
              <div className="text-xs text-muted-foreground">{error}</div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => window.open(url, "_blank")}>
                <ExternalLink size={14} className="ml-1" /> افتح في تبويب جديد
              </Button>
            </div>
          )}
          {/* على الموبايل لا نعرض iframe لـ PDF (متصفحات الجوال لا تدعمه inline)
              نعرض شاشة بأزرار واضحة */}
          {!loading && !error && blobUrl && isMobile && isPdf && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <FileText size={40} />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-foreground">المستند جاهز</div>
                <div className="text-xs text-muted-foreground break-all px-2">{fileName}</div>
                <div className="text-[11px] text-muted-foreground">
                  متصفحات الجوال لا تدعم معاينة PDF داخل التطبيق.
                  افتح المستند في تبويب جديد أو نزّله.
                </div>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                <Button onClick={handleOpenInNewTab} className="w-full gap-2">
                  <ExternalLink size={16} />
                  فتح في تبويب جديد
                </Button>
                <Button onClick={handleDownload} variant="outline" className="w-full gap-2">
                  <Download size={16} />
                  تنزيل المستند
                </Button>
              </div>
            </div>
          )}
          {!loading && !error && blobUrl && !(isMobile && isPdf) && (
            <iframe
              src={embedUrl}
              title={title || fileName}
              className="w-full h-full border-0 bg-white"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
