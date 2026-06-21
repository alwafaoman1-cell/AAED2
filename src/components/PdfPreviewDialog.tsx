import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Maximize2,
  Minimize2,
  CloudUpload,
  Check,
  Loader2,
  X,
  Printer,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize,
  ChevronUp,
  ChevronDown,
  FileCode2,
} from "lucide-react";
import { toast } from "sonner";
import { generatePdfFromHtml, DEFAULT_MARGINS } from "@/lib/htmlToPdf";
import WhatsAppShareButton from "@/components/whatsapp/WhatsAppShareButton";
import { buildHtmlWithPageMarginStyle, injectPageMarginStyle, detectOrientation } from "@/lib/pdfLayoutSettings";
import { getPdfPageDiagnostics, preparePagedPdfDocument, waitForPdfAssets } from "@/lib/pdfDocumentRenderer";

interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  htmlContent: string;
  title: string;
  fileName?: string;
  autoSave?: () => Promise<{ url: string; path: string } | null>;
  onSaved?: (info: { url: string; path: string }) => void;
  /** رقم هاتف المستلم لأزرار المشاركة (يُستخرج تلقائياً للبادئة) */
  recipientPhone?: string;
  /** اسم المستلم لعرضه في حوار واتساب */
  recipientName?: string;
}

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const FIT_ZOOM = -1; // sentinel for "fit width"
const A4_PORTRAIT_W = 794; // A4 @ 96dpi
const A4_PORTRAIT_H = 1123;
const A4_LANDSCAPE_W = 1123;
const A4_LANDSCAPE_H = 794;

/**
 * معاينة فورية للمستند:
 * - تعرض HTML الجاهز للطباعة مباشرة داخل iframe بدل توليد PDF ثم إعادة رسمه كصور
 * - الطباعة تتم من HTML نفسه بجودة نصوص عالية وبدون قيود blob/pdfjs
 * - PDF الحقيقي يُنشأ فقط عند التنزيل لتقليل زمن فتح المعاينة جذرياً
 */
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
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(FIT_ZOOM);
  const [fitScale, setFitScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [frameHeight, setFrameHeight] = useState(A4_PORTRAIT_H);
  const [oversizedPages, setOversizedPages] = useState(0);

  const savedKeyRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const pageOffsetsRef = useRef<number[]>([0]);

  const safeName = (fileName || title).replace(/[^A-Za-z0-9._\u0600-\u06FF-]/g, "_");
  const effectiveZoom = zoom === FIT_ZOOM ? fitScale : zoom;
  const orientation = detectOrientation(htmlContent);
  const PREVIEW_WIDTH = orientation === "landscape" ? A4_LANDSCAPE_W : A4_PORTRAIT_W;
  const PREVIEW_PAGE_HEIGHT = orientation === "landscape" ? A4_LANDSCAPE_H : A4_PORTRAIT_H;
  const previewHtml = buildHtmlWithPageMarginStyle(htmlContent, orientation);

  const measurePreview = useCallback(() => {
    const frame = previewFrameRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;

    requestAnimationFrame(() => {
      const body = doc.body;
      const root = doc.documentElement;
      const height = Math.max(
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
        PREVIEW_PAGE_HEIGHT,
      );

      const pageEls = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
      const offsets = pageEls.length
        ? pageEls.map((el) => el.offsetTop)
        : Array.from({ length: Math.max(1, Math.ceil(height / PREVIEW_PAGE_HEIGHT)) }, (_, i) => i * PREVIEW_PAGE_HEIGHT);

      pageOffsetsRef.current = offsets;
      setPageCount(offsets.length);
      setFrameHeight(Math.ceil(height));
    });
  }, [PREVIEW_PAGE_HEIGHT]);

  const handlePreviewLoad = useCallback(() => {
    const doc = previewFrameRef.current?.contentDocument;
    if (!doc) return;

    const settle = async () => {
      await waitForPdfAssets(doc);
      preparePagedPdfDocument(doc, orientation);
      setOversizedPages(getPdfPageDiagnostics(doc).oversizedPages);
      measurePreview();
      setTimeout(measurePreview, 250);
    };

    void settle();
  }, [measurePreview, orientation]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPdfBlob(null);
    setPdfGenerating(false);
    setZoom(FIT_ZOOM);
    setCurrentPage(1);
    setPageCount(1);
    setOversizedPages(0);
    setFrameHeight(PREVIEW_PAGE_HEIGHT);
    pageOffsetsRef.current = [0];
  }, [open, htmlContent, PREVIEW_PAGE_HEIGHT]);

  useEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    if (!root) return;

    const updateFit = () => {
      const available = Math.max(320, root.clientWidth - 32);
      setFitScale(Math.min(1.25, Math.max(0.35, available / PREVIEW_WIDTH)));
    };

    updateFit();
    const ro = new ResizeObserver(updateFit);
    ro.observe(root);
    return () => ro.disconnect();
  }, [open, PREVIEW_WIDTH]);

  // حفظ تلقائي للأرشيف — مستقل عن توليد PDF حتى لا يبطّئ المعاينة
  useEffect(() => {
    if (!open || !autoSave) return;
    const key = `${title}::${htmlContent.length}`;
    if (savedKeyRef.current === key) return;
    savedKeyRef.current = key;
    setSavedUrl(null);
    setSaving(true);
    autoSave()
      .then((res) => {
        if (res?.url) {
          setSavedUrl(res.url);
          onSaved?.(res);
          toast.success("تم حفظ المستند في الأرشيف");
        }
      })
      .catch((e) => console.warn("autoSave failed", e))
      .finally(() => setSaving(false));
  }, [open, htmlContent, autoSave, title, onSaved]);

  // تتبّع الصفحة الحالية أثناء التمرير
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const onScroll = () => {
      const docTop = root.scrollTop / effectiveZoom + 120;
      let cur = 1;
      pageOffsetsRef.current.forEach((offset, idx) => {
        if (offset <= docTop) cur = idx + 1;
      });
      if (cur !== currentPage) setCurrentPage(cur);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [effectiveZoom, currentPage, pageCount]);

  useEffect(() => {
    if (!open) {
      setPdfBlob(null);
      setZoom(FIT_ZOOM);
      setCurrentPage(1);
      savedKeyRef.current = "";
    }
  }, [open]);

  const zoomIn = () => {
    setZoom((z) => {
      const cur = z === FIT_ZOOM ? 1 : z;
      const next = ZOOM_STEPS.find((s) => s > cur + 0.001);
      return next ?? cur;
    });
  };
  const zoomOut = () => {
    setZoom((z) => {
      const cur = z === FIT_ZOOM ? 1 : z;
      const idx = [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.001);
      return idx ?? cur;
    });
  };
  const fitWidth = () => setZoom(FIT_ZOOM);

  const goPage = useCallback((n: number) => {
    const idx = Math.max(1, Math.min(pageCount, n));
    const offset = pageOffsetsRef.current[idx - 1] ?? 0;
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: Math.max(0, offset * effectiveZoom - 16), behavior: "smooth" });
    }
  }, [pageCount, effectiveZoom]);

  const ensurePdfBlob = useCallback(async () => {
    if (pdfBlob) return pdfBlob;
    setPdfGenerating(true);
    setError(null);
    try {
      const blob = await generatePdfFromHtml({
        htmlContent: previewHtml,
        fileName: safeName,
        download: false,
        margins: DEFAULT_MARGINS,
        orientation,
        footer: { enabled: false },
      });
      setPdfBlob(blob);
      return blob;
    } catch (e: any) {
      console.error("PDF generation failed", e);
      const message = e?.message || "فشل إنشاء ملف PDF";
      setError(message);
      toast.error(message);
      throw e;
    } finally {
      setPdfGenerating(false);
    }
  }, [previewHtml, pdfBlob, safeName, orientation]);

  // طباعة مباشرة من HTML الجاهز للطباعة — أسرع وأعلى جودة من صور canvas
  const handlePrint = async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      toast.error("تعذّرت الطباعة");
      return;
    }

    doc.open();
    doc.write(previewHtml);
    doc.close();
    try { injectPageMarginStyle(doc, orientation); } catch { void 0; }

    const waitUntilReady = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = async () => {
          if (done) return;
          done = true;
          try { await (doc as any).fonts?.ready; } catch {}
          const images = Array.from(doc.images || []);
          await Promise.all(images.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise<void>((res) => {
              img.addEventListener("load", () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            });
          }));
          resolve();
        };

        if (doc.readyState === "complete") setTimeout(finish, 50);
        else iframe.addEventListener("load", () => setTimeout(finish, 50), { once: true });
        setTimeout(finish, 2500);
      });

    try {
      await waitUntilReady();
      preparePagedPdfDocument(doc, orientation);
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error(e);
      toast.error("تعذّرت الطباعة المباشرة");
    } finally {
      setTimeout(() => iframe.remove(), 60_000);
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await ensurePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      // handled in ensurePdfBlob
    }
  };

  const handleExportData = () => {
    const blob = new Blob([previewHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}-data.html`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast.success("تم تصدير بيانات المستند بصيغة HTML");
  };

  const zoomLabel = zoom === FIT_ZOOM ? "ملاءمة" : `${Math.round(zoom * 100)}%`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`bg-card border-border p-0 gap-0 flex flex-col ${
          fullscreen ? "max-w-[100vw] w-[100vw] h-[100vh] rounded-none" : "max-w-5xl w-[95vw] h-[90vh]"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/40 shrink-0 gap-2">
          <DialogHeader className="flex-1 min-w-0 text-start">
            <DialogTitle className="text-foreground text-sm flex items-center gap-2 truncate">
              <span className="truncate">{title}</span>
              {pdfGenerating && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500 font-medium shrink-0">
                  <Loader2 size={11} className="animate-spin" />
                  تحضير PDF…
                </span>
              )}
              {oversizedPages > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-medium shrink-0">
                  {oversizedPages} صفحة تحتوي عنصراً أكبر من A4
                </span>
              )}
              {autoSave &&
                (saving ? (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-medium shrink-0">
                    <CloudUpload size={11} className="animate-pulse" /> جارٍ الحفظ…
                  </span>
                ) : savedUrl ? (
                  <a
                    href={savedUrl}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-medium hover:bg-emerald-500/25 transition shrink-0"
                  >
                    <Check size={11} /> محفوظ
                  </a>
                ) : null)}
            </DialogTitle>
            <DialogDescription className="sr-only">معاينة المستند داخل الصفحة</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFullscreen((f) => !f)} title={fullscreen ? "تصغير" : "ملء الشاشة"}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)} title="إغلاق">
              <X size={15} />
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-background/60 shrink-0 gap-2 flex-wrap">
          {/* Pagination */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goPage(currentPage - 1)} disabled={currentPage <= 1} title="السابقة">
              <ChevronUp size={14} />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[56px] text-center">
              {currentPage} / {pageCount}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goPage(currentPage + 1)} disabled={currentPage >= pageCount} title="التالية">
              <ChevronDown size={14} />
            </Button>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut} title="تصغير">
              <ZoomOut size={14} />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[56px] text-center">{zoomLabel}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn} title="تكبير">
              <ZoomIn size={14} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fitWidth} title="ملاءمة العرض">
              <Maximize size={14} />
            </Button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <WhatsAppShareButton
              htmlContent={htmlContent}
              fileBaseName={safeName}
              subFolder="shared"
              triggerLabel="واتساب"
              size="sm"
              triggerVariant="ghost"
              triggerClassName="h-7"
              title={`مشاركة: ${title}`}
              defaultPhone={recipientPhone}
              recipientName={recipientName}
              defaultMessage={recipientName ? `مرحباً ${recipientName}،\nإليك ${title}.` : ""}
            />
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={handlePrint} title="فتح نافذة الطباعة الخاصة بالمتصفح">
              <Printer size={14} />
              <span className="text-xs">معاينة طباعة المتصفح</span>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={handleDownload} disabled={pdfGenerating}>
              {pdfGenerating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span className="text-xs">تنزيل PDF</span>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={handleExportData} title="تنزيل محتوى المستند كملف HTML دون تحويله إلى صورة PDF">
              <FileCode2 size={14} />
              <span className="text-xs">تصدير البيانات فقط</span>
            </Button>
          </div>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-neutral-200 dark:bg-neutral-900 relative">
          {error && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-2 rounded-md border border-destructive/30 bg-card/95 text-xs text-destructive shadow">
              {error}
            </div>
          )}

          <div className="flex justify-center py-4 px-2">
            <div
              className="relative"
              style={{
                width: PREVIEW_WIDTH * effectiveZoom,
                height: frameHeight * effectiveZoom,
              }}
            >
              <div
                style={{
                  width: PREVIEW_WIDTH,
                  height: frameHeight,
                  transform: `scale(${effectiveZoom})`,
                  transformOrigin: "top center",
                }}
              >
                <iframe
                  key={`${title}-${htmlContent.length}`}
                  ref={previewFrameRef}
                  title={title}
                  srcDoc={previewHtml}
                  onLoad={handlePreviewLoad}
                  className="block bg-white shadow-lg ring-1 ring-black/10"
                  style={{ width: PREVIEW_WIDTH, height: frameHeight, border: 0 }}
                />
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
