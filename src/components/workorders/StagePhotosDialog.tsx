import { useRef, useState, useEffect } from "react";
import { Trash2, Camera, Save, ImageIcon, Check, Repeat, AlertCircle, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { STAGE_LABELS, StagePhase, StagePhoto, WorkOrder, getWorkOrderById, updateWorkOrder } from "@/lib/workOrdersStore";
import { toast } from "sonner";
import PhotoLightbox, { type LightboxPhoto } from "@/components/vehicles/PhotoLightbox";

interface Props {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
}

const PHASES: StagePhase[] = ["received", "inspection", "in_progress", "quality", "delivery"];
const MAX_PHOTOS_PER_PHASE = 9;

// خريطة المرحلة → حالة أمر العمل (تُحدَّث تلقائياً عند رفع/حفظ صور المرحلة)
const PHASE_TO_STATUS: Record<StagePhase, string> = {
  received: "تحت الفحص",
  inspection: "تحت الفحص",
  in_progress: "تحت الإصلاح",
  quality: "ضبط الجودة",
  delivery: "جاهز للتسليم",
};

// ترتيب المراحل لتحديد "الأحدث"
const PHASE_ORDER: StagePhase[] = ["received", "inspection", "in_progress", "quality", "delivery"];

function deriveStatusFromPhotos(photos: StagePhoto[]): string | null {
  if (!photos || photos.length === 0) return null;
  // أعلى مرحلة فيها صور = الحالة الحالية
  for (let i = PHASE_ORDER.length - 1; i >= 0; i--) {
    const ph = PHASE_ORDER[i];
    if (photos.some(p => p.phase === ph)) return PHASE_TO_STATUS[ph];
  }
  return null;
}

export default function StagePhotosDialog({ orderId, open, onClose }: Props) {
  const [order, setOrder] = useState<WorkOrder | undefined>();
  const [activePhase, setActivePhase] = useState<StagePhase>("received");
  const [caption, setCaption] = useState("");
  const [pending, setPending] = useState<StagePhoto[]>([]);
  const [dirty, setDirty] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);
  const [lightboxPhotos, setLightboxPhotos] = useState<LightboxPhoto[]>([]);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (orderId && open) {
      setOrder(getWorkOrderById(orderId));
      setPending([]);
      setDirty(false);
    }
  }, [orderId, open]);

  if (!order) return null;

  const allPhotos = [...(order.photos || []), ...pending];
  const photos = allPhotos.filter((p) => p.phase === activePhase);
  const phaseCount = photos.length;
  const remaining = Math.max(0, MAX_PHOTOS_PER_PHASE - phaseCount);
  const atLimit = remaining === 0;

  function readFiles(files: FileList | null, fromCamera: boolean) {
    if (!files || files.length === 0) return;
    if (atLimit) {
      toast.error(`تم بلوغ الحد الأقصى ${MAX_PHOTOS_PER_PHASE} صور لهذه المرحلة`);
      return;
    }
    const allowed = Array.from(files).slice(0, remaining);
    const dropped = files.length - allowed.length;
    const tasks: Promise<StagePhoto | null>[] = [];
    allowed.forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      tasks.push((async () => {
        const { convertImageToWebp } = await import("@/lib/imageToWebp");
        const { uploadStagePhoto } = await import("@/lib/workOrderPhotosStorage");
        const optimized = await convertImageToWebp(file);
        const photoId = Math.random().toString(36).slice(2, 9);
        const uploaded = await uploadStagePhoto({ orderId: order!.id, photoId, file: optimized });
        if (!uploaded) {
          // Cloud upload failed → fall back to local data URL so the photo isn't lost.
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(optimized);
          });
          return {
            id: photoId, phase: activePhase, dataUrl,
            caption: caption.trim() || undefined,
            uploadedAt: new Date().toISOString(),
          } satisfies StagePhoto;
        }
        return {
          id: photoId,
          phase: activePhase,
          dataUrl: uploaded.url,
          storagePath: uploaded.path,
          caption: caption.trim() || undefined,
          uploadedAt: new Date().toISOString(),
        } satisfies StagePhoto;
      })());
    });
    Promise.all(tasks).then((results) => {
      const newPhotos = results.filter((p): p is StagePhoto => !!p);
      setPending((prev) => [...prev, ...newPhotos]);
      setDirty(true);
      setCaption("");
      const msg = `تمت إضافة ${newPhotos.length} صورة` + (dropped > 0 ? ` — تم تجاهل ${dropped} لتجاوز الحد` : "");
      toast.success(msg);

      // التقاط متتابع: إعادة فتح الكاميرا تلقائياً إذا لم نصل للحد
      if (fromCamera && continuousMode) {
        const willRemain = remaining - newPhotos.length;
        if (willRemain > 0) {
          setTimeout(() => cameraInput.current?.click(), 350);
        } else {
          toast.info("اكتمل الحد الأقصى للمرحلة");
        }
      }
    });
  }

  function removePhoto(id: string, isPending: boolean) {
    if (isPending) {
      setPending((prev) => prev.filter((p) => p.id !== id));
    } else {
      const updated = (order!.photos || []).filter((p) => p.id !== id);
      setOrder({ ...order!, photos: updated });
      setDirty(true);
    }
  }

  function handleSave() {
    const finalPhotos = [...(order!.photos || []), ...pending];
    const derivedStatus = deriveStatusFromPhotos(finalPhotos);
    const patch: Partial<WorkOrder> = { photos: finalPhotos };
    let statusChanged = false;
    if (derivedStatus && derivedStatus !== order!.status) {
      patch.status = derivedStatus;
      statusChanged = true;
    }
    updateWorkOrder(order!.id, patch);
    setOrder({ ...order!, ...patch });
    setPending([]);
    setDirty(false);
    if (statusChanged) {
      toast.success(`تم الحفظ ✓ — وتم تحديث الحالة تلقائياً إلى "${derivedStatus}"`);
    } else {
      toast.success("تم حفظ الصور بنجاح ✓");
    }
    onClose();
  }

  function handleClose() {
    if (dirty && !confirm("لديك تغييرات غير محفوظة. هل تريد الإغلاق دون حفظ؟")) return;
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-4xl w-[98vw] sm:w-[95vw] bg-card border-border max-h-[95vh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2 text-sm sm:text-base">
            <Camera size={16} className="text-primary shrink-0" />
            <span className="truncate">صور أمر العمل — <span className="font-mono text-primary">{order.id}</span></span>
          </DialogTitle>
        </DialogHeader>

        {/* Phase tabs — scrollable on mobile */}
        <div className="-mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto border-b border-border pb-3">
          <div className="flex gap-1.5 min-w-max">
            {PHASES.map((p) => {
              const count = allPhotos.filter((ph) => ph.phase === p).length;
              const active = activePhase === p;
              return (
                <button
                  key={p}
                  onClick={() => setActivePhase(p)}
                  className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium border transition-all flex items-center gap-1 ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                >
                  {STAGE_LABELS[p].ar}
                  {count > 0 && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${active ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                      {count}/{MAX_PHOTOS_PER_PHASE}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status auto-update info */}
        <div className="flex items-start gap-2 text-[11px] bg-primary/5 border border-primary/20 rounded-lg p-2">
          <AlertCircle size={13} className="text-primary shrink-0 mt-0.5" />
          <span className="text-muted-foreground leading-relaxed">
            رفع الصور لهذه المرحلة سيحدّث حالة أمر العمل تلقائياً إلى:{" "}
            <span className="text-primary font-semibold">{PHASE_TO_STATUS[activePhase]}</span>
          </span>
        </div>

        {/* Upload controls */}
        <div className="bg-secondary/30 border border-dashed border-border rounded-lg p-3 space-y-3">
          <Input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="وصف اختياري للصور (يطبق على الرفع التالي)"
            className="text-xs h-9"
          />

          {/* Continuous mode toggle */}
          <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={continuousMode}
              onChange={(e) => setContinuousMode(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <Repeat size={12} className="text-primary" />
            <span className="text-foreground">التقاط متتابع — يفتح الكاميرا تلقائياً بعد كل صورة</span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => cameraInput.current?.click()}
              disabled={atLimit}
              className="gradient-gold text-primary-foreground gap-1.5 hover:opacity-90 h-10 text-xs sm:text-sm disabled:opacity-50"
            >
              <Camera size={14} /> كاميرا
            </Button>
            <Button
              onClick={() => galleryInput.current?.click()}
              disabled={atLimit}
              variant="outline"
              className="gap-1.5 h-10 text-xs sm:text-sm disabled:opacity-50"
            >
              <ImageIcon size={14} /> المعرض
            </Button>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { readFiles(e.target.files, true); e.target.value = ""; }}
            />
            <input
              ref={galleryInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { readFiles(e.target.files, false); e.target.value = ""; }}
            />
          </div>
          <p className="text-[10px] sm:text-[11px] text-muted-foreground text-center">
            مرحلة <span className="text-primary font-semibold">{STAGE_LABELS[activePhase].ar}</span> —
            متبقي <span className={`font-bold ${atLimit ? "text-destructive" : "text-primary"}`}>{remaining}</span> من {MAX_PHOTOS_PER_PHASE}
          </p>
        </div>

        {/* Gallery */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs sm:text-sm font-semibold text-foreground flex items-center gap-1.5">
              <ImageIcon size={13} className="text-primary" />
              صور المرحلة ({photos.length})
            </h4>
            {pending.filter(p => p.phase === activePhase).length > 0 && (
              <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full bg-warning/20 text-warning border border-warning/30">
                {pending.filter(p => p.phase === activePhase).length} غير محفوظة
              </span>
            )}
          </div>
          {photos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs sm:text-sm border border-dashed border-border rounded-lg bg-secondary/20">
              <ImageIcon size={28} className="mx-auto mb-2 opacity-40" />
              لا توجد صور بعد لهذه المرحلة
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {photos.map((p, idx) => {
                const isPending = pending.some(pp => pp.id === p.id);
                return (
                  <div key={p.id} className={`relative group rounded-lg overflow-hidden border bg-secondary/30 ${isPending ? "border-warning/60 ring-2 ring-warning/20" : "border-border"}`}>
                    <button
                      type="button"
                      onClick={() => {
                        const lb: LightboxPhoto[] = photos.map((ph) => ({
                          id: ph.id,
                          dataUrl: ph.dataUrl,
                          caption: ph.caption,
                          phase: ph.phase,
                          phaseLabel: STAGE_LABELS[ph.phase as StagePhase]?.ar,
                          orderId: order!.id,
                          date: ph.uploadedAt?.slice(0, 10),
                        }));
                        setLightboxPhotos(lb);
                        setLightboxStart(idx);
                        setLightboxOpen(true);
                      }}
                      className="block w-full"
                      title="عرض بحجم كامل"
                    >
                      <img src={p.dataUrl} alt={p.caption || ""} className="w-full aspect-square object-cover hover:opacity-90 transition cursor-zoom-in" />
                    </button>
                    <span className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" title="انقر للتكبير">
                      <Maximize2 size={10} />
                    </span>
                    {isPending && (
                      <div className="absolute top-1 right-8 px-1.5 py-0.5 rounded text-[8px] bg-warning text-warning-foreground font-bold pointer-events-none">
                        جديد
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); removePhoto(p.id, isPending); }}
                      className="absolute top-1 left-1 p-1.5 rounded-full bg-destructive/90 text-destructive-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                      aria-label="حذف"
                    >
                      <Trash2 size={11} />
                    </button>
                    {p.caption && (
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[9px] p-1 truncate pointer-events-none">
                        {p.caption}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer actions — sticky on mobile */}
        <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-border sticky bottom-0 bg-card -mx-3 sm:mx-0 px-3 sm:px-0 pb-1">
          <Button
            onClick={handleSave}
            disabled={!dirty}
            className="gradient-gold text-primary-foreground flex-1 gap-2 hover:opacity-90 disabled:opacity-50 h-11"
          >
            {dirty ? <><Save size={15} /> حفظ التغييرات</> : <><Check size={15} /> محفوظ</>}
          </Button>
          <Button onClick={handleClose} variant="outline" className="sm:w-auto h-11">
            إغلاق
          </Button>
        </div>
      </DialogContent>

      <PhotoLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        photos={lightboxPhotos}
        startIndex={lightboxStart}
      />
    </Dialog>
  );
}
