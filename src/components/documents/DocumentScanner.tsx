import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Download, Flashlight, GripVertical, ImagePlus, Loader2, RotateCcw, ScanLine, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validateDocumentFile } from "@/lib/documentExtraction/fileSafety";
import { FULL_SCAN_QUAD, type ScanFilter, type ScanPoint, type ScanQuad, type ScanQuality } from "@/lib/documentExtraction/scannerCore";

interface ScanPage {
  id: string;
  capture: Blob;
  original: Blob;
  originalUrl: string;
  processed?: Blob;
  processedUrl?: string;
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
    cropped_edge: ["قد تكون حافة المستند مقصوصة", "A document edge may be cropped"],
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
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [liveQuad, setLiveQuad] = useState<ScanQuad | null>(null);
  const [dragCorner, setDragCorner] = useState<number | null>(null);
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
      if (open) setCameraError(english ? "Camera is unavailable. Import photos instead." : "الكاميرا غير متاحة؛ استورد الصور بدلًا منها.");
      return;
    }
    let cancelled = false;
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => setCameraError("Camera preview unavailable")); }
        setCameraError(""); setCameraReady(true);
      }).catch(() => setCameraError(english ? "Camera permission denied or unavailable. Import photos instead." : "تعذر فتح الكاميرا أو لم تُمنح الصلاحية. يمكنك استيراد الصور."));
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  }, [open, english]);

  // Editing a captured page unmounts the video element. Reattach the retained
  // stream when the camera view returns instead of requesting permission again.
  useEffect(() => {
    const video = videoRef.current;
    if (!open || selectedId || !cameraReady || !video || !streamRef.current) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    void video.play().catch(() => setCameraError(english ? "Camera preview unavailable" : "تعذرت معاينة الكاميرا"));
  }, [open, selectedId, cameraReady, english]);

  useEffect(() => {
    if (!open || !cameraReady || !streamRef.current || selectedId || busy) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (cancelled || !video?.videoWidth || !video.videoHeight || !workerRef.current) return;
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const found = await askWorker<{ quad: ScanQuad; confidence: number }>("detect", context.getImageData(0, 0, canvas.width, canvas.height));
        if (!cancelled) setLiveQuad(found.confidence >= 0.35 ? found.quad : null);
      } catch { if (!cancelled) setLiveQuad(null); }
    }, 1000);
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
      setPages((current) => [...current, page]); setSelectedId(page.id);
    } finally { setBusy(false); }
  }, [askWorker, makeUrl]);

  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.96));
    if (blob) await importPage(blob).catch(() => toast.error(english ? "Capture could not be processed" : "تعذرت معالجة الصورة"));
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
  async function keepPage() {
    if (!selected) return;
    setBusy(true);
    try {
      const corrected = await askWorker<ImageData>("process", await imageDataFor(selected.original), selected.quad, selected.filter);
      const processed = await imageBlob(corrected, qualityProfile === "standard" ? 0.87 : qualityProfile === "archive" ? 0.98 : 0.94);
      releaseUrl(selected.processedUrl);
      const processedUrl = makeUrl(processed);
      setPages((current) => current.map((page) => page.id === selected.id ? { ...page, processed, processedUrl } : page));
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
        ...entry, original: rotated, originalUrl, quad: FULL_SCAN_QUAD, processed: undefined, processedUrl: undefined,
      } : entry));
      releaseUrl(page.originalUrl); releaseUrl(page.processedUrl);
    } catch { toast.error(english ? "Could not rotate this page" : "تعذر تدوير الصفحة"); }
    finally { setBusy(false); }
  }

  function restoreCapture(page: ScanPage) {
    const originalUrl = makeUrl(page.capture);
    setPages((current) => current.map((entry) => entry.id === page.id ? {
      ...entry, original: page.capture, originalUrl, quad: FULL_SCAN_QUAD,
      filter: "original", processed: undefined, processedUrl: undefined,
    } : entry));
    releaseUrl(page.originalUrl); releaseUrl(page.processedUrl);
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
    releaseUrl(selected.processedUrl);
    setPages((current) => current.map((page) => page.id === selected.id ? { ...page, quad: page.quad.map((old, i) => i === index ? point : old) as ScanQuad, processed: undefined, processedUrl: undefined } : page));
  }

  function removePage(id: string) {
    const page = pages.find((entry) => entry.id === id);
    releaseUrl(page?.originalUrl); releaseUrl(page?.processedUrl);
    setPages((current) => current.filter((entry) => entry.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
    <DialogContent className="flex h-[95dvh] max-h-[95dvh] w-[min(98vw,1050px)] max-w-none flex-col overflow-hidden p-3 sm:p-5" dir={english ? "ltr" : "rtl"}>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><ScanLine size={20} />{english ? "TEMO Document Scanner" : "ماسح المستندات TEMO"}</DialogTitle></DialogHeader>
      <input ref={galleryRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={async (event) => {
        for (const file of Array.from(event.target.files || [])) {
          try { await importPage(file); } catch { toast.error(english ? "Use JPG, PNG or WebP images up to 12 MB and 8 pages" : "استخدم صور JPG أو PNG أو WebP حتى 12 ميغابايت و8 صفحات"); break; }
        }
        event.target.value = "";
      }} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {selected ? <>
          <div className="relative mx-auto max-h-[55vh] max-w-full touch-none overflow-hidden rounded-lg bg-slate-900" ref={previewRef}
            onPointerMove={(event) => { if (dragCorner !== null) updateCorner(dragCorner, event.clientX, event.clientY); }}
            onPointerUp={() => setDragCorner(null)} onPointerCancel={() => setDragCorner(null)}>
            <img src={selected.originalUrl} className="block max-h-[55vh] max-w-full object-contain" alt={english ? "Original capture" : "الصورة الأصلية"} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon points={selected.quad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(217,164,35,.13)" stroke="#eab308" strokeWidth=".5" />
            </svg>
            {selected.quad.map((point, index) => <button key={index} type="button" aria-label={`${english ? "Corner" : "الزاوية"} ${index + 1}`}
              className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-amber-500 shadow-lg"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragCorner(index); }}
              onPointerMove={(event) => { if (event.buttons) updateCorner(index, event.clientX, event.clientY); }}
              onPointerUp={() => setDragCorner(null)} />)}
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">{FILTERS.map((filter) => <Button key={filter.key} type="button" size="sm" variant={selected.filter === filter.key ? "default" : "outline"}
            onClick={() => { releaseUrl(selected.processedUrl); setPages((current) => current.map((page) => page.id === selected.id ? { ...page, filter: filter.key, processed: undefined, processedUrl: undefined } : page)); }}>{english ? filter.en : filter.ar}</Button>)}</div>
          {selected.confidence < 0.35 && <p role="status" className="text-center text-xs text-amber-700">{english ? "Automatic edges were uncertain; adjust corners or keep the full image." : "كشف الحواف غير مؤكد؛ عدّل الزوايا أو احتفظ بالصورة كاملة."}</p>}
          {qualityWarnings(selected.quality, english).map((warning) => <p key={warning} className="text-center text-xs text-amber-700">{warning}</p>)}
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => restoreCapture(selected)}>{english ? "Use original" : "استخدام الأصل"}</Button>
            <Button type="button" variant="outline" onClick={() => { removePage(selected.id); }}>{english ? "Retake" : "إعادة التصوير"}</Button>
            <Button type="button" disabled={busy} onClick={() => void keepPage()}>{busy && <Loader2 className="me-1 animate-spin" size={16} />}{english ? "Keep page" : "اعتماد الصفحة"}</Button>
          </div>
        </> : <>
          <div className="relative mx-auto flex min-h-[250px] max-h-[52vh] w-full max-w-2xl items-center justify-center overflow-hidden rounded-xl bg-slate-900">
            <video ref={videoRef} autoPlay muted playsInline className="h-full max-h-[52vh] w-full object-contain" />
            {liveQuad && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={liveQuad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(217,164,35,.10)" stroke="#eab308" strokeWidth=".7" /></svg>}
            {cameraError && <div className="absolute inset-0 flex items-center justify-center p-5 text-center text-sm text-white">{cameraError}</div>}
          </div>
          <div className="flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()}><ImagePlus size={16} className="me-1" />{english ? "Import images" : "استيراد صور"}</Button>
            <Button type="button" variant="outline" onClick={() => void toggleTorch()}><Flashlight size={16} className="me-1" />{torch ? (english ? "Flash off" : "إيقاف الفلاش") : (english ? "Flash" : "فلاش")}</Button>
            <Button type="button" disabled={busy || !!cameraError || pages.length >= 8} onClick={() => void capture()}><Camera size={16} className="me-1" />{english ? "Capture" : "التقاط"}</Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">{english ? "Manual capture is always available. No video frames are uploaded." : "التصوير اليدوي متاح دائمًا. لا تُرفع إطارات الفيديو."}</p>
        </>}
        {!!pages.length && <div className="flex gap-2 overflow-x-auto rounded-lg border p-2">{pages.map((page, index) => <div key={page.id} className="flex w-24 shrink-0 flex-col gap-1">
          <button type="button" className={`relative overflow-hidden rounded border ${selectedId === page.id ? "border-amber-500" : "border-slate-300"}`} onClick={() => setSelectedId(page.id)}>
            <img src={page.processedUrl || page.originalUrl} alt={`${english ? "Page" : "صفحة"} ${index + 1}`} className="h-24 w-24 object-cover" /><span className="absolute bottom-0 right-0 bg-black/60 px-1 text-xs text-white">{index + 1}</span>
          </button><div className="flex justify-between"><button type="button" aria-label="Move left" disabled={index === 0} onClick={() => setPages((current) => { const copy = [...current]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}><GripVertical size={15} /></button>
          <button type="button" aria-label="Rotate" disabled={busy} onClick={() => void rotatePage(page)}><RotateCcw size={15} /></button>
          <button type="button" aria-label="Delete" onClick={() => removePage(page.id)}><Trash2 size={15} /></button></div>
        </div>)}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <select aria-label={english ? "PDF quality" : "جودة PDF"} className="rounded border bg-background p-2 text-sm" value={qualityProfile} onChange={(event) => setQualityProfile(event.target.value as typeof qualityProfile)}>
          <option value="standard">{english ? "Standard" : "عادي"}</option><option value="high">{english ? "High quality" : "جودة عالية"}</option><option value="archive">{english ? "Archive quality" : "جودة أرشيف"}</option>
        </select>
        <span className="me-auto text-xs text-muted-foreground">{pages.length}/8 {english ? "pages" : "صفحات"}</span>
        <Button type="button" variant="outline" disabled={busy || !pages.length || pages.some((p) => !p.processed)} onClick={() => void finish(false)}><Download size={16} className="me-1" />{english ? "Download PDF" : "تنزيل PDF"}</Button>
        <Button type="button" disabled={busy || !pages.length || pages.some((p) => !p.processed)} onClick={() => void finish(true)}>{busy ? <Loader2 size={16} className="me-1 animate-spin" /> : <ScanLine size={16} className="me-1" />}{submitLabel ? submitLabel[english ? "en" : "ar"] : (english ? "Extract to form" : "استخراج إلى النموذج")}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}><X size={16} className="me-1" />{english ? "Close" : "إغلاق"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
