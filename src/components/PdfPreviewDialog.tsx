import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, CloudUpload, Download, Loader2, Maximize2, Minimize2, Printer, X } from "lucide-react";
import { toast } from "sonner";
import WhatsAppShareButton from "@/components/whatsapp/WhatsAppShareButton";
import { buildPdfV2Html, downloadPdfV2, printPdfV2, inferPdfV2Layout, type PdfV2BuildInput, type PdfV2Layout } from "@/lib/pdf-v2";

interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  htmlContent: string;
  title: string;
  fileName?: string;
  autoSave?: () => Promise<{ url: string; path: string } | null>;
  onSaved?: (info: { url: string; path: string }) => void;
  recipientPhone?: string;
  recipientName?: string;
}

const layoutFrameSize: Record<PdfV2Layout, { width: number; minHeight: number }> = {
  "a4-portrait": { width: 794, minHeight: 1123 },
  "a4-landscape": { width: 1123, minHeight: 794 },
  "qr-label": { width: 378, minHeight: 265 },
};

function safeFileName(value: string) {
  return (value || "document").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._\-\u0600-\u06FF]/g, "_");
}

export default function PdfPreviewDialog({
  open,
  onOpenChange,
  htmlContent,
  title,
  fileName,
  autoSave,
  onSaved,
  recipientPhone,
  recipientName,
}: PdfPreviewDialogProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameHeight, setFrameHeight] = useState(1123);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const savedKeyRef = useRef("");

  const layout = useMemo(() => inferPdfV2Layout(htmlContent), [htmlContent]);
  const frameSize = layoutFrameSize[layout];
  const safeName = safeFileName(fileName || title);
  const input = useMemo<PdfV2BuildInput>(
    () => ({
      html: htmlContent,
      meta: {
        documentType: layout === "qr-label" ? "qr-label" : "generic",
        title,
        layout,
      },
    }),
    [htmlContent, layout, title],
  );
  const previewHtml = useMemo(() => buildPdfV2Html(input), [input]);

  useEffect(() => {
    if (!open) return;
    setFrameHeight(frameSize.minHeight);
    setSavedUrl(null);
  }, [open, frameSize.minHeight, htmlContent]);

  useEffect(() => {
    if (!open || !autoSave) return;
    const key = `${title}::${htmlContent.length}`;
    if (savedKeyRef.current === key) return;
    savedKeyRef.current = key;
    setSaving(true);
    autoSave()
      .then((res) => {
        if (res?.url) {
          setSavedUrl(res.url);
          onSaved?.(res);
          toast.success("تم حفظ المستند في الأرشيف");
        }
      })
      .catch((e) => {
        console.warn("PDF autoSave failed", e);
        toast.error("تعذر حفظ المستند في الأرشيف");
      })
      .finally(() => setSaving(false));
  }, [open, htmlContent, title, autoSave, onSaved]);

  const resizeFrame = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const height = Math.max(
      doc.body?.scrollHeight || 0,
      doc.documentElement?.scrollHeight || 0,
      frameSize.minHeight,
    );
    setFrameHeight(Math.ceil(height));
  };

  const handlePrint = async () => {
    setBusy(true);
    try {
      await printPdfV2(input);
    } catch (e: any) {
      toast.error(e?.message || "تعذرت الطباعة");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    setBusy(true);
    try {
      await downloadPdfV2(input, safeName, true);
    } catch (e: any) {
      toast.error(e?.message || "تعذر تنزيل PDF");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`bg-card border-border p-0 gap-0 flex flex-col ${
          fullscreen ? "max-w-[100vw] w-[100vw] h-[100vh] rounded-none" : "max-w-6xl w-[95vw] h-[90vh]"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/40 shrink-0 gap-2">
          <DialogHeader className="flex-1 min-w-0 text-start">
            <DialogTitle className="text-foreground text-sm flex items-center gap-2 truncate">
              <span className="truncate">{title}</span>
              <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                PDF v2
              </span>
              {saving && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-medium shrink-0">
                  <CloudUpload size={11} className="animate-pulse" /> جارِ الحفظ…
                </span>
              )}
              {savedUrl && (
                <a
                  href={savedUrl}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-medium hover:bg-emerald-500/25 transition shrink-0"
                >
                  <Check size={11} /> محفوظ
                </a>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">معاينة PDF v2 المركزية</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFullscreen((f) => !f)}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)}>
              <X size={15} />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-end px-3 py-2 border-b border-border bg-background/60 shrink-0 gap-2 flex-wrap">
          <WhatsAppShareButton
            htmlContent={htmlContent}
            fileBaseName={safeName}
            subFolder="shared"
            triggerLabel="واتساب"
            size="sm"
            triggerVariant="outline"
            triggerClassName="h-8"
            title={`مشاركة: ${title}`}
            defaultPhone={recipientPhone}
            recipientName={recipientName}
            defaultMessage={recipientName ? `مرحباً ${recipientName}،\nإليك ${title}.` : ""}
          />
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handlePrint} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            طباعة
          </Button>
          <Button variant="default" size="sm" className="h-8 gap-1.5" onClick={handleDownload} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            تنزيل PDF
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-neutral-200 dark:bg-neutral-900">
          <div className="flex justify-center py-4 px-2">
            <iframe
              key={`${title}-${htmlContent.length}-${layout}`}
              ref={frameRef}
              title={title}
              srcDoc={previewHtml}
              onLoad={() => {
                resizeFrame();
                setTimeout(resizeFrame, 250);
              }}
              className="block bg-white shadow-lg ring-1 ring-black/10 max-w-full"
              style={{ width: frameSize.width, height: frameHeight, border: 0 }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
