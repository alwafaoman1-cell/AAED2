import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Download, Flashlight, GripVertical, ImagePlus, Loader2, RotateCcw, ScanLine, SwitchCamera, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validateDocumentFile } from "@/lib/documentExtraction/fileSafety";
import { FULL_SCAN_QUAD, isValidScanQuad, type ScanFilter, type ScanPoint, type ScanQuad, type ScanQuality } from "@/lib/documentExtraction/scannerCore";

interface ScanPage {
  id: string;
  capture: Blob;
  original: Blob;
  originalUrl: string;
  processed?: Blob;
  processedUrl?: string;
  previewUrl?: string;
  quad: ScanQuad;
  filter: ScanFilter;
  quality: ScanQuality;
  confidence: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onExtract: (file: File) => boolean | void | Promise<boolean | void>;
  submitLabel?: { ar: string; en: string };
}

const FILTERS: Array<{ key: ScanFilter; ar: string; en: string }> = [
  { key: "original", ar: "الأصلي", en: "Original" }, { key: "auto", ar: "تلقائي", en: "Auto" },
  { key: "document", ar: "مستند", en: "Document" }, { key: "color", ar: "ألوان محسنة", en: "Enhanced color" },
  { key: "gray", ar: "رمادي", en: "Grayscale" }, { key: "bw", ar: "أبيض وأسود", en: "Black & white" },
];

async function imageDataFor(blob: Blob, maximum = 2400): Promise<ImageData> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("SCAN_CANVAS_UNAVAILABLE");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally { URL.revokeObjectURL(url); }
}

async function imageBlob(data: ImageData, quality = 0.94): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = data.width; canvas.height = data.height;
  canvas.getContext("2d")?.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("SCAN_IMAGE_ENCODE_FAILED");
  return blob;
}

function qualityWarnings(quality: ScanQuality, english: boolean): string[] {
  const messages = {
    blur: ["الصورة غير واضحة؛ يفضّل إعادة التصوير", "Image may be blurry; retake recommended"],
    low_light: ["الإضاءة منخفضة", "Low light"], glare: ["يوجد انعكاس؛ يفضّل إعادة التصوير", "Glare detected; retake recommended"],
    too_far: ["المستند بعيد عن الكاميرا", "Document is too far"],
    cropped_edge: ["حافة الورقة خارج الإطار؛ أبعد الهاتف قليلًا حتى تظهر الزوايا الأربع، أو اضبطها يدويًا.",
      "A page edge is outside the frame. Move back until all four corners are visible, or adjust them manually."],
  } as const;
  return quality.warnings.map((code) => messages[code][english ? 1 : 0]);
}

export default function DocumentScanner({ open, onClose, onExtract, submitLabel }: Props) {
  const { i18n } = useTranslation();
  const english = i18n.language?.startsWith("en") || false;
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>());
  const workerId = useRef(0);
  const urlsRef = useRef(new Set<string>());
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<"" | "unavailable" | "preview" | "permission">("");
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [liveQuad, setLiveQuad] = useState<ScanQuad | null>(null);
  const [dragCorner, setDragCorner] = useState<number | null>(null);
  const [showCorrected, setShowCorrected] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [qualityProfile, setQualityProfile] = useState<"standard" | "high" | "archive">("high");
  const previewRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<ScanPage[]>([]);
  pagesRef.current = pages;

  const makeUrl = useCallback((blob: Blob) => { const url = URL.createObjectURL(blob); urlsRef.current.add(url); return url; }, []);
  const releaseUrl = useCallback((url?: string) => { if (url) { URL.revokeObjectURL(url); urlsRef.current.delete(url); } }, []);

  useEffect(() => {
    if (!open) return;
    const worker = new Worker(new URL("../../lib/documentExtraction/scannerWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const pending = pendingRef.current.get(event.data.id);
      if (!pending) return;
      pendingRef.current.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve(event.data.result);
    };
    const pending = pendingRef.current;
    const urls = urlsRef.current;
    return () => {
      worker.terminate(); workerRef.current = null;
      for (const request of pending.values()) request.reject(new Error("SCAN_CANCELLED"));
      pending.clear();
      streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      setPages([]); setSelectedId(null); setLiveQuad(null); setCameraReady(false);
    };
  }, [open]);

  const askWorker = useCallback(<T,>(operation: "detect" | "process", image: ImageData, quad?: ScanQuad, filter?: ScanFilter): Promise<T> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error("SCAN_WORKER_UNAVAILABLE"));
    const id = ++workerId.current;
    return new Promise<T>((resolve, reject) => {
      pendingRef.current.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, operation, image, quad, filter }, [image.data.buffer]);
    });
  }, []);

  useEffect(() => {
    if (!open || !navigator.mediaDevices?.getUserMedia) {
      if (open) setCameraError("unavailable");
      return;
    }
    let cancelled = false;
    setCameraReady(false); setLiveQuad(null); setTorch(false);
    const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 900;
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1920 }, height: { ideal: portrait ? 2560 : 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => setCameraError("preview")); }
        setCameraError(""); setCameraReady(true);
      }).catch(() => setCameraError("permission"));
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  }, [open, cameraFacing]);

  // Editing a captured page unmounts the video element. Reattach the retained
  // stream when the camera view returns instead of requesting permission again.
  useEffect(() => {
    const video = videoRef.current;
    if (!open || selectedId || !cameraReady || !video || !streamRef.current) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    void video.play().catch(() => setCameraError("preview"));
  }, [open, selectedId, cameraReady]);

  useEffect(() => {
    if (!open || !cameraReady || !streamRef.current || selectedId || busy) return;
    let cancelled = false;
    let detecting = false;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (cancelled || detecting || !video?.videoWidth || !video.videoHeight || !workerRef.current) return;
      detecting = true;
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { detecting = false; return; }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const found = await askWorker<{ quad: ScanQuad; confidence: number }>("detect", context.getImageData(0, 0, canvas.width, canvas.height));
        if (!cancelled) setLiveQuad(found.confidence >= 0.35 ? found.quad : null);
      } catch { if (!cancelled) setLiveQuad(null); }
      finally { detecting = false; }
    }, 650);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open, cameraReady, selectedId, busy, askWorker]);

  const importPage = useCallback(async (blob: Blob) => {
    if (pagesRef.current.length >= 8) throw new Error("SCAN_PAGE_LIMIT");
    const file = blob instanceof File ? blob : new File([blob], "camera.jpg", { type: "image/jpeg" });
    const mime = await validateDocumentFile(file, 12 * 1024 * 1024);
    if (mime === "application/pdf") throw new Error("SCAN_FILE_INVALID");
    setBusy(true);
    try {
      const detected = await askWorker<{ quad: ScanQuad; confidence: number; quality: ScanQuality }>("detect", await imageDataFor(blob, 1200));
      const page: ScanPage = {
        id: crypto.randomUUID(), capture: blob, original: blob, originalUrl: makeUrl(blob), quad: detected.confidence >= 0.35 ? detected.quad : FULL_SCAN_QUAD,
        filter: "auto", confidence: detected.confidence, quality: detected.quality,
      };
      setPages((current) => [...current, page]); setShowCorrected(page.confidence >= .35); setComparing(false); setSelectedId(page.id);
    } finally { setBusy(false); }
  }, [askWorker, makeUrl]);

  async function capture() {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video?.videoWidth || !track || busy) return;
    setBusy(true);
    try {
      type ImageCaptureFactory = new (source: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
      const StillCapture = (window as Window & { ImageCapture?: ImageCaptureFactory }).ImageCapture;
      let blob: Blob | null = null;
      if (StillCapture) {
        try {
          const still = await new StillCapture(track).takePhoto();
          // Decode orientation metadata and bound memory before processing.
          blob = await imageBlob(await imageDataFor(still, 2400), .96);
        } catch { /* Safari and some cameras only support video frames. */ }
      }
      if (!blob) {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .96));
      }
      if (!blob) throw new Error("SCAN_IMAGE_ENCODE_FAILED");
      await importPage(blob);
    } catch { toast.error(english ? "Capture could not be processed" : "تعذرت معالجة الصورة"); }
    finally { setBusy(false); }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    if (!capabilities?.torch) { toast.info(english ? "Flash is not supported by this browser" : "الفلاش غير مدعوم في هذا المتصفح"); return; }
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); }
    catch { toast.error(english ? "Flash could not be enabled" : "تعذر تشغيل الفلاش"); }
  }

  const selected = pages.find((page) => page.id === selectedId);
  const cameraErrorText = cameraError === "unavailable"
    ? (english ? "Camera is unavailable. Import photos instead." : "الكاميرا غير متاحة؛ استورد الصور بدلًا منها.")
    : cameraError === "preview"
      ? (english ? "Camera preview unavailable" : "تعذرت معاينة الكاميرا")
      : cameraError === "permission"
        ? (english ? "Camera permission denied or unavailable. Import photos instead." : "تعذر فتح الكاميرا أو لم تُمنح الصلاحية. يمكنك استيراد الصور.")
        : "";
  const previewId = selected?.id, previewOriginal = selected?.original;
  const previewQuad = selected?.quad, previewFilter = selected?.filter;
  const finalUrl = selected?.processedUrl, existingPreviewUrl = selected?.previewUrl;
  useEffect(() => {
    if (!open || !previewId || !previewOriginal || !previewQuad || !previewFilter || finalUrl || existingPreviewUrl || !isValidScanQuad(previewQuad)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const preview = await askWorker<ImageData>("process", await imageDataFor(previewOriginal, 900), previewQuad, previewFilter);
        const blob = await imageBlob(preview, .86);
        if (cancelled) return;
        const previewUrl = makeUrl(blob);
        setPages((current) => current.map((page) => page.id === previewId ? { ...page, previewUrl } : page));
      } catch { /* Keep the unmodified photo available for manual adjustment. */ }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, previewId, previewOriginal, previewQuad, previewFilter, finalUrl, existingPreviewUrl, askWorker, makeUrl]);
  async function keepPage() {
    if (!selected || !isValidScanQuad(selected.quad)) return;
    setBusy(true);
    try {
      const corrected = await askWorker<ImageData>("process", await imageDataFor(selected.original), selected.quad, selected.filter);
      const processed = await imageBlob(corrected, qualityProfile === "standard" ? 0.87 : qualityProfile === "archive" ? 0.98 : 0.94);
      releaseUrl(selected.processedUrl); releaseUrl(selected.previewUrl);
      const processedUrl = makeUrl(processed);
      setPages((current) => current.map((page) => page.id === selected.id ? { ...page, processed, processedUrl, previewUrl: undefined } : page));
      setSelectedId(null);
    } catch { toast.error(english ? "Scan could not be processed. Use the original or adjust corners." : "تعذرت معالجة المسح؛ استخدم الأصل أو عدّل الزوايا."); }
    finally { setBusy(false); }
  }

  async function rotatePage(page: ScanPage) {
    setBusy(true);
    try {
      const image = await imageDataFor(page.original);
      const canvas = document.createElement("canvas"); canvas.width = image.height; canvas.height = image.width;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("SCAN_CANVAS_UNAVAILABLE");
      const source = document.createElement("canvas"); source.width = image.width; source.height = image.height;
      source.getContext("2d")?.putImageData(image, 0, 0);
      context.translate(canvas.width, 0); context.rotate(Math.PI / 2);
      context.drawImage(source, 0, 0);
      const rotated = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.96));
      if (!rotated) throw new Error("SCAN_ROTATE_FAILED");
      const originalUrl = makeUrl(rotated);
      setPages((current) => current.map((entry) => entry.id === page.id ? {
        ...entry, original: rotated, originalUrl, quad: FULL_SCAN_QUAD, processed: undefined, processedUrl: undefined, previewUrl: undefined,
      } : entry));
      releaseUrl(page.originalUrl); releaseUrl(page.processedUrl); releaseUrl(page.previewUrl);
    } catch { toast.error(english ? "Could not rotate this page" : "تعذر تدوير الصفحة"); }
    finally { setBusy(false); }
  }

  function restoreCapture(page: ScanPage) {
    const originalUrl = makeUrl(page.capture);
    setPages((current) => current.map((entry) => entry.id === page.id ? {
      ...entry, original: page.capture, originalUrl, quad: FULL_SCAN_QUAD,
      filter: "original", processed: undefined, processedUrl: undefined, previewUrl: undefined,
    } : entry));
    releaseUrl(page.originalUrl); releaseUrl(page.processedUrl); releaseUrl(page.previewUrl);
  }

  async function buildPdf(): Promise<File> {
    if (!pages.length || pages.some((page) => !page.processed)) throw new Error("SCAN_UNFINISHED_PAGES");
    const { jsPDF } = await import("jspdf");
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const page of pages) {
      const image = new Image(); image.src = page.processedUrl!; await image.decode();
      const landscape = image.naturalWidth > image.naturalHeight;
      const width = landscape ? 297 : 210, height = landscape ? 210 : 297;
      const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const renderedWidth = image.naturalWidth * ratio, renderedHeight = image.naturalHeight * ratio;
      if (!pdf) pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4", compress: true });
      else pdf.addPage("a4", landscape ? "landscape" : "portrait");
      const bytes = await page.processed!.arrayBuffer();
      let binary = ""; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
      pdf.addImage(`data:image/jpeg;base64,${btoa(binary)}`, "JPEG", (width - renderedWidth) / 2, (height - renderedHeight) / 2, renderedWidth, renderedHeight, undefined, "MEDIUM");
    }
    const bytes = pdf!.output("blob");
    if (bytes.size > 12 * 1024 * 1024) throw new Error("SCAN_PDF_TOO_LARGE");
    return new File([bytes], `TEMO-scan-${Date.now()}.pdf`, { type: "application/pdf" });
  }

  async function finish(extract: boolean) {
    setBusy(true);
    try {
      const file = await buildPdf();
      if (extract) { const success = await onExtract(file); if (success !== false) onClose(); }
      else {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) { toast.error(error instanceof Error && error.message === "SCAN_PDF_TOO_LARGE" ? (english ? "PDF exceeds the 12 MB limit" : "ملف PDF أكبر من 12 ميغابايت") : (english ? "Complete all pages before generating the PDF" : "أكمل معالجة جميع الصفحات قبل إنشاء PDF")); }
    finally { setBusy(false); }
  }

  function updateCorner(index: number, clientX: number, clientY: number) {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || !selected) return;
    const point: ScanPoint = { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) };
    releaseUrl(selected.processedUrl); releaseUrl(selected.previewUrl);
    setShowCorrected(false);
    setPages((current) => current.map((page) => page.id === selected.id ? { ...page, quad: page.quad.map((old, i) => i === index ? point : old) as ScanQuad, processed: undefined, processedUrl: undefined, previewUrl: undefined } : page));
  }

  function removePage(id: string) {
    const page = pages.find((entry) => entry.id === id);
    releaseUrl(page?.originalUrl); releaseUrl(page?.processedUrl); releaseUrl(page?.previewUrl);
    setPages((current) => current.filter((entry) => entry.id !== id));
    if (selectedId === id) { setSelectedId(null); setShowCorrected(false); }
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
    <DialogContent className={`!fixed !inset-0 !flex !h-[100dvh] !max-h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 !flex-col !gap-2 !overflow-hidden !rounded-none !border-0 !p-2 !pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:!p-4 ${selected ? "bg-background" : "bg-slate-950 text-white"}`} dir={english ? "ltr" : "rtl"}>
      <DialogHeader className="shrink-0 pr-10 text-start"><DialogTitle className="flex items-center gap-2 text-base sm:text-lg"><ScanLine size={20} className="text-teal-500" />{english ? "TEMO Document Scanner" : "ماسح المستندات TEMO"}<span className="text-xs font-normal opacity-70">{pages.length}/8</span></DialogTitle><DialogDescription className="sr-only">{english ? "Capture, straighten, enhance and combine document pages into a PDF." : "صوّر صفحات المستند وصحّح منظورها وحسّنها واجمعها في ملف PDF."}</DialogDescription></DialogHeader>
      <input ref={galleryRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={async (event) => {
        for (const file of Array.from(event.target.files || [])) {
          try { await importPage(file); } catch { toast.error(english ? "Use JPG, PNG or WebP images up to 12 MB and 8 pages" : "استخدم صور JPG أو PNG أو WebP حتى 12 ميغابايت و8 صفحات"); break; }
        }
        event.target.value = "";
      }} />
      <div className={`min-h-0 flex-1 overflow-y-auto px-1 ${selected ? "space-y-3" : "flex flex-col gap-3"}`}>
        {selected ? <>
          <div className="mx-auto flex w-full min-h-[200px] items-center justify-center rounded-xl bg-slate-100 p-2 dark:bg-slate-900">
            <div className="relative max-w-full touch-none" ref={previewRef}>
              <img src={showCorrected && !comparing ? (selected.processedUrl || selected.previewUrl || selected.originalUrl) : selected.originalUrl}
                className="block max-h-[55dvh] max-w-full object-contain sm:max-h-[67dvh]" alt={showCorrected && !comparing ? (english ? "Straightened scan" : "الصفحة بعد تصحيح المنظور") : (english ? "Original capture" : "الصورة الأصلية")} />
              {!showCorrected && !comparing && <>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon points={selected.quad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(20,184,166,.11)" stroke="#14b8a6" strokeWidth=".6" />
                </svg>
                {selected.quad.map((point, index) => <button key={index} type="button" aria-label={`${english ? "Corner" : "الزاوية"} ${index + 1}`}
                  className={`absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-teal-500 shadow-lg ${dragCorner === index ? "ring-4 ring-teal-300/70" : ""}`}
                  style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragCorner(index); }}
                  onPointerMove={(event) => { if (event.buttons) updateCorner(index, event.clientX, event.clientY); }}
                  onPointerUp={() => setDragCorner(null)} onPointerCancel={() => setDragCorner(null)} />)}
              </>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" size="sm" variant={showCorrected ? "outline" : "default"} onClick={() => { setComparing(false); setShowCorrected(false); }}>{english ? "Adjust corners" : "ضبط الزوايا"}</Button>
            <Button type="button" size="sm" variant={showCorrected ? "default" : "outline"} disabled={!selected.processedUrl && !selected.previewUrl} onClick={() => { setComparing(false); setShowCorrected(true); }}>{english ? "Enhanced preview" : "معاينة المحسّنة"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={!selected.processedUrl && !selected.previewUrl} onClick={() => { setShowCorrected(true); setComparing((value) => !value); }}>{comparing ? (english ? "Show scan" : "عرض المسح") : (english ? "Compare original" : "مقارنة بالأصل")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void rotatePage(selected)}><RotateCcw size={15} className="me-1" />{english ? "Rotate" : "تدوير"}</Button>
          </div>
          {!showCorrected && <p className="text-center text-xs text-muted-foreground">{english ? "Drag the four corners to the paper edges. The saved page will be straightened." : "اسحب الزوايا الأربع إلى حدود الورقة؛ تُحفظ الصفحة بعد تصحيح المنظور."}</p>}
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label={english ? "Scan filters" : "مرشحات المسح"}>{FILTERS.map((filter) => <button key={filter.key} type="button" aria-pressed={selected.filter === filter.key}
            className={`min-w-[6rem] shrink-0 rounded-lg border px-3 py-2 text-center text-xs transition-colors ${selected.filter === filter.key ? "border-teal-500 bg-teal-500/10 font-semibold text-teal-700 dark:text-teal-300" : "border-border bg-muted/30"}`}
            onClick={() => { if (selected.filter === filter.key) return; releaseUrl(selected.processedUrl); releaseUrl(selected.previewUrl); setComparing(false); setShowCorrected(true); setPages((current) => current.map((page) => page.id === selected.id ? { ...page, filter: filter.key, processed: undefined, processedUrl: undefined, previewUrl: undefined } : page)); }}>{english ? filter.en : filter.ar}</button>)}</div>
          {selected.confidence < 0.35 && <p role="status" className="text-center text-xs text-amber-700">{english ? "Automatic edges were uncertain; adjust corners or keep the full image." : "كشف الحواف غير مؤكد؛ عدّل الزوايا أو احتفظ بالصورة كاملة."}</p>}
          {!isValidScanQuad(selected.quad) && <p role="alert" className="text-center text-xs text-red-600">{english ? "Corners cross or overlap; move them back around the paper." : "الزوايا متقاطعة أو متداخلة؛ أعد وضعها حول الورقة."}</p>}
          {qualityWarnings(selected.quality, english).map((warning) => <p key={warning} className="text-center text-xs text-amber-700">{warning}</p>)}
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => restoreCapture(selected)}>{english ? "Use original" : "استخدام الأصل"}</Button>
          </div>
        </> : <>
          <div className="relative mx-auto flex min-h-[250px] w-full max-w-4xl flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
            <div className="relative max-h-full max-w-full">
              <video ref={videoRef} autoPlay muted playsInline className="block max-h-[calc(100dvh-19rem)] max-w-full sm:max-h-[calc(100dvh-16rem)]" />
              {liveQuad && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={liveQuad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(20,184,166,.18)" stroke="#2dd4bf" strokeWidth=".65" /></svg>}
            </div>
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              <span className={`h-2 w-2 rounded-full ${liveQuad ? "bg-teal-400" : "bg-amber-400"}`} />
              {liveQuad ? (english ? "Paper detected" : "تم تحديد الورقة") : (english ? "Place the whole page in frame" : "ضع الورقة كاملة داخل الإطار")}
            </div>
            <button type="button" className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white" aria-label={torch ? (english ? "Turn flash off" : "إيقاف الفلاش") : (english ? "Turn flash on" : "تشغيل الفلاش")} onClick={() => void toggleTorch()}><Flashlight size={19} /></button>
            {cameraErrorText && <div className="absolute inset-0 flex items-center justify-center p-5 text-center text-sm text-white">{cameraErrorText}</div>}
          </div>
          <div className="flex shrink-0 items-center justify-center gap-10 py-1">
            <button type="button" className="flex min-w-16 flex-col items-center gap-1 text-xs text-white" onClick={() => galleryRef.current?.click()}><ImagePlus size={23} />{english ? "Import" : "استيراد"}</button>
            <button type="button" aria-label={english ? "Capture document" : "تصوير المستند"} disabled={busy || !cameraReady || !!cameraError || pages.length >= 8}
              className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-[5px] border-teal-400 bg-white shadow-[0_0_0_3px_rgba(255,255,255,.45)] disabled:opacity-40" onClick={() => void capture()}>
              {busy ? <Loader2 className="animate-spin text-teal-700" size={27} /> : <Camera className="text-slate-800" size={27} />}
            </button>
            <button type="button" className="flex min-w-16 flex-col items-center gap-1 text-xs text-white" onClick={() => setCameraFacing((current) => current === "environment" ? "user" : "environment")}><SwitchCamera size={23} />{english ? "Switch" : "تبديل"}</button>
          </div>
          <p className="text-center text-xs text-slate-300">{english ? "Capture, review the crop and filter, then keep the page. Video is never uploaded." : "صوّر، راجع القصّ والتحسين، ثم اعتمد الصفحة. لا يُرفع الفيديو."}</p>
        </>}
        {!!pages.length && <div className={`flex shrink-0 gap-2 overflow-x-auto rounded-lg border p-2 ${selected ? "" : "border-slate-700"}`}>{pages.map((page, index) => <div key={page.id} className="flex w-24 shrink-0 flex-col gap-1">
          <button type="button" className={`relative overflow-hidden rounded border ${selectedId === page.id ? "border-teal-500" : "border-slate-400"}`} onClick={() => { setComparing(false); setShowCorrected(!!page.processedUrl || !!page.previewUrl); setSelectedId(page.id); }}>
            <img src={page.processedUrl || page.originalUrl} alt={`${english ? "Page" : "صفحة"} ${index + 1}`} className="h-24 w-24 object-cover" /><span className="absolute bottom-0 right-0 bg-black/60 px-1 text-xs text-white">{index + 1}</span>
          </button><div className="flex justify-between"><button type="button" aria-label={english ? "Move page earlier" : "تقديم الصفحة"} disabled={index === 0} onClick={() => setPages((current) => { const copy = [...current]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}><GripVertical size={15} /></button>
          <button type="button" aria-label={english ? "Rotate page" : "تدوير الصفحة"} disabled={busy} onClick={() => void rotatePage(page)}><RotateCcw size={15} /></button>
          <button type="button" aria-label={english ? "Delete page" : "حذف الصفحة"} onClick={() => removePage(page.id)}><Trash2 size={15} /></button></div>
        </div>)}</div>}
      </div>
      <div className={`flex shrink-0 flex-wrap items-center gap-2 border-t pt-2 ${selected ? "" : "border-slate-700"}`}>
        {selected ? <>
          <Button type="button" variant="outline" disabled={busy} onClick={() => removePage(selected.id)}>{english ? "Retake" : "إعادة التصوير"}</Button>
          <Button type="button" className="min-w-40 flex-1 bg-teal-600 text-white hover:bg-teal-700" disabled={busy || !isValidScanQuad(selected.quad)} onClick={() => void keepPage()}>{busy ? <Loader2 className="me-1 animate-spin" size={16} /> : <Check className="me-1" size={16} />}{english ? "Keep page" : "اعتماد الصفحة"}</Button>
        </> : <>
        <select aria-label={english ? "PDF quality" : "جودة PDF"} className={`rounded border p-2 text-sm ${selected ? "bg-background" : "border-slate-700 bg-slate-900 text-white"}`} value={qualityProfile} onChange={(event) => setQualityProfile(event.target.value as typeof qualityProfile)}>
          <option value="standard">{english ? "Standard" : "عادي"}</option><option value="high">{english ? "High quality" : "جودة عالية"}</option><option value="archive">{english ? "Archive quality" : "جودة أرشيف"}</option>
        </select>
        <span className={`me-auto text-xs ${selected ? "text-muted-foreground" : "text-slate-300"}`}>{pages.length}/8 {english ? "pages" : "صفحات"}</span>
        <Button type="button" variant="outline" disabled={busy || !pages.length || pages.some((p) => !p.processed)} onClick={() => void finish(false)}><Download size={16} className="me-1" />{english ? "Download PDF" : "تنزيل PDF"}</Button>
        <Button type="button" disabled={busy || !pages.length || pages.some((p) => !p.processed)} onClick={() => void finish(true)}>{busy ? <Loader2 size={16} className="me-1 animate-spin" /> : <ScanLine size={16} className="me-1" />}{submitLabel ? submitLabel[english ? "en" : "ar"] : (english ? "Extract to form" : "استخراج إلى النموذج")}</Button>
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
