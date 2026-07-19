import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronLeft, Camera, Image as ImageIcon, Send, Save, Trash2, Loader2 } from "lucide-react";
import { WORK_ORDER_STATUSES, normalizeWorkOrderStatus, updateWorkOrderInCloud, type WorkOrder, type StagePhase, type StagePhoto } from "@/lib/workOrdersStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";
import WorkOrderClosingReview, { isClosingStatus } from "@/components/workorders/WorkOrderClosingReview";

interface Props {
  order: WorkOrder | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cloudJobOrderId?: string | null;
  onUpdated?: () => void;
}

const statusColor: Record<string, string> = {
  "تحت الفحص": "bg-primary/15 text-primary border-primary/30",
  "بانتظار الموافقة": "bg-info/15 text-info border-info/30",
  "بانتظار قطع الغيار": "bg-warning/15 text-warning border-warning/30",
  "تحت الإصلاح": "bg-warning/15 text-warning border-warning/30",
  "ضبط الجودة": "bg-info/15 text-info border-info/30",
  "جاهز للتسليم": "bg-success/15 text-success border-success/30",
  "تم التسليم": "bg-success/25 text-success border-success/40",
  "مغلق": "bg-muted text-muted-foreground border-border",
};

const STATUS_TO_PHASE: Record<string, StagePhase> = {
  "تحت الفحص": "inspection",
  "بانتظار الموافقة": "inspection",
  "بانتظار قطع الغيار": "in_progress",
  "تحت الإصلاح": "in_progress",
  "ضبط الجودة": "quality",
  "جاهز للتسليم": "delivery",
  "تم التسليم": "delivery",
  "مغلق": "delivery",
};

function getStatusColor(status: string): string {
  const normalized = normalizeWorkOrderStatus(status);
  const colors: Record<string, string> = {
    "تحت الفحص": "bg-primary/15 text-primary border-primary/30",
    "بانتظار الموافقة": "bg-info/15 text-info border-info/30",
    "بانتظار قطع الغيار": "bg-warning/15 text-warning border-warning/30",
    "تحت الإصلاح": "bg-warning/15 text-warning border-warning/30",
    "ضبط الجودة": "bg-info/15 text-info border-info/30",
    "جاهز للتسليم": "bg-success/15 text-success border-success/30",
    "تم التسليم": "bg-success/25 text-success border-success/40",
    "مغلق": "bg-muted text-muted-foreground border-border",
  };
  return colors[normalized] || statusColor[status] || "bg-primary/15 text-primary border-primary";
}

function getStatusPhase(status: string): StagePhase {
  const normalized = normalizeWorkOrderStatus(status);
  const phases: Record<string, StagePhase> = {
    "تحت الفحص": "inspection",
    "بانتظار الموافقة": "inspection",
    "بانتظار قطع الغيار": "in_progress",
    "تحت الإصلاح": "in_progress",
    "ضبط الجودة": "quality",
    "جاهز للتسليم": "delivery",
    "تم التسليم": "delivery",
    "مغلق": "delivery",
  };
  return phases[normalized] || STATUS_TO_PHASE[status] || "in_progress";
}

function defaultMessage(status: string, customer: string, orderNo: string): string {
  const normalizedStatus = normalizeWorkOrderStatus(status);
  const readableMessages: Record<string, string> = {
    "تحت الفحص": "نود إعلامكم أن مركبتكم حالياً تحت الفحص في الورشة.",
    "بانتظار الموافقة": "مركبتكم بانتظار اعتماد التقدير من شركة التأمين.",
    "بانتظار قطع الغيار": "مركبتكم بانتظار وصول قطع الغيار المطلوبة.",
    "تحت الإصلاح": "مركبتكم حالياً قيد الإصلاح.",
    "ضبط الجودة": "مركبتكم في مرحلة فحص الجودة النهائي.",
    "جاهز للتسليم": "مركبتكم جاهزة للاستلام. يسعدنا استقبالكم في الورشة.",
    "تم التسليم": "تم تسليم مركبتكم. شكراً لثقتكم بنا.",
    "مغلق": "تم إغلاق أمر العمل الخاص بكم.",
  };
  if (WORK_ORDER_STATUSES.includes(normalizedStatus)) {
    const greet = customer ? `مرحباً ${customer}،\n` : "";
    return `${greet}${readableMessages[normalizedStatus] || `تم تحديث حالة أمر العمل إلى: ${normalizedStatus}`}\nرقم أمر العمل: ${orderNo}`;
  }
  const greet = customer ? `مرحباً ${customer}،\n` : "";
  const tail = `\nرقم أمر العمل: ${orderNo}`;
  const map: Record<string, string> = {
    "تحت الفحص": "نود إعلامكم أن مركبتكم حالياً تحت الفحص في الورشة.",
    "بانتظار الموافقة": "مركبتكم بانتظار اعتماد التقدير من شركة التأمين.",
    "بانتظار قطع الغيار": "مركبتكم بانتظار وصول قطع الغيار المطلوبة.",
    "تحت الإصلاح": "مركبتكم حالياً قيد الإصلاح.",
    "ضبط الجودة": "مركبتكم في مرحلة فحص الجودة النهائي.",
    "جاهز للتسليم": "مركبتكم جاهزة للاستلام. يسعدنا استقبالكم في الورشة.",
    "تم التسليم": "تم تسليم مركبتكم. شكراً لثقتكم بنا.",
    "مغلق": "تم إغلاق أمر العمل الخاص بكم.",
  };
  return greet + (map[status] || `تم تحديث حالة أمر العمل إلى: ${status}`) + tail;
}

export default function WorkOrderStatusDialog({ order, open, onOpenChange, cloudJobOrderId, onUpdated }: Props) {
  const [selected, setSelected] = useState<string>(order?.status || "");
  const [message, setMessage] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<StagePhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState<null | "save" | "send">(null);
  const [closingReview, setClosingReview] = useState<WorkOrder["closingReview"] | null>(null);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [isSigned, setIsSigned] = useState<boolean>(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !cloudJobOrderId) { setPortalToken(null); setIsSigned(false); return; }
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("customer_portal_tokens")
        .select("token, signed_at")
        .eq("job_order_id", cloudJobOrderId)
        .maybeSingle();
      if (!mounted) return;
      setPortalToken((data as any)?.token || null);
      setIsSigned(!!(data as any)?.signed_at);
    })();
    return () => { mounted = false; };
  }, [open, cloudJobOrderId]);

  useEffect(() => {
    if (open && order) {
      const normalizedStatus = normalizeWorkOrderStatus(order.status);
      setSelected(normalizedStatus);
      setMessage(defaultMessage(normalizedStatus, order.customer || "", order.id));
      setPendingPhotos([]);
      setClosingReview(null);
    }
  }, [open, order?.id]);

  useEffect(() => {
    if (open && order) {
      setMessage(defaultMessage(selected || order.status, order.customer || "", order.id));
      setClosingReview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!order) return null;

  const normalizedOrderStatus = normalizeWorkOrderStatus(order.status);
  const currentIdx = WORK_ORDER_STATUSES.indexOf(normalizedOrderStatus);
  const statusChanged = selected && selected !== normalizedOrderStatus;
  const hasPhotos = pendingPhotos.length > 0;
  const requiresClosingReview = !!statusChanged && isClosingStatus(selected);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const { convertImageToWebp } = await import("@/lib/imageToWebp");
      const { uploadStagePhoto } = await import("@/lib/workOrderPhotosStorage");
      const phase = getStatusPhase(selected || order!.status);
      const newOnes: StagePhoto[] = [];
      for (const f of Array.from(files).slice(0, 6)) {
        if (!f.type.startsWith("image/")) continue;
        const opt = await convertImageToWebp(f);
        const photoId = Math.random().toString(36).slice(2, 9);
        const uploaded = await uploadStagePhoto({ orderId: order!.id, photoId, file: opt });
        if (uploaded) {
          newOnes.push({
            id: photoId, phase, dataUrl: uploaded.url, storagePath: uploaded.path,
            uploadedAt: new Date().toISOString(),
          } as StagePhoto);
        } else {
          const dataUrl: string = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(opt); });
          newOnes.push({ id: photoId, phase, dataUrl, uploadedAt: new Date().toISOString() } as StagePhoto);
        }
      }
      setPendingPhotos((p) => [...p, ...newOnes]);
      if (newOnes.length) toast.success(`تمت إضافة ${newOnes.length} صورة`);
    } catch (e: any) {
      toast.error(e.message || "فشل رفع الصور");
    } finally {
      setUploading(false);
    }
  }

  async function persist(): Promise<boolean> {
    const patch: Partial<WorkOrder> = {};
    if (statusChanged) patch.status = normalizeWorkOrderStatus(selected);
    if (requiresClosingReview) {
      if (!closingReview) {
        toast.error("يجب اعتماد Work Order Closing Review قبل حفظ الحالة النهائية.");
        return false;
      }
      patch.closingReview = closingReview;
    }
    if (hasPhotos) patch.photos = [...(order!.photos || []), ...pendingPhotos];
    if (Object.keys(patch).length === 0) return true;
    await updateWorkOrderInCloud(order!.id, patch);
    return true;
  }

  async function handleSave() {
    if (!statusChanged && !hasPhotos) { onOpenChange(false); return; }
    setSaving("save");
    try {
      const saved = await persist();
      if (!saved) return;
      toast.success("تم الحفظ ✓");
      onUpdated?.();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ حالة أمر العمل في Supabase");
    } finally { setSaving(null); }
  }

  async function handleSaveAndSend() {
    const phone = (order!.phone || "").replace(/\D/g, "");
    if (!phone) { toast.error("لا يوجد رقم هاتف للعميل"); return; }
    if (!isSigned) {
      toast.error("لا يمكن إرسال رابط المتابعة قبل توقيع العميل على بطاقة أمر العمل");
      return;
    }
    setSaving("send");
    try {
      const saved = await persist();
      if (!saved) return;
      let text = message.trim();
      if (portalToken) {
        text += `\n\n🔗 تابع حالة الإصلاح: ${window.location.origin}/p/${portalToken}`;
      }
      await sendWhatsAppMessage({
        message: text,
        phone,
        workOrderId: cloudJobOrderId || order!.id,
        kind: "custom",
        recipientName: order!.customer,
        recipientType: "customer",
      });
      toast.success("تم الحفظ والإرسال عبر واتساب ✓");
      onUpdated?.();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ/إرسال تحديث الحالة");
    } finally { setSaving(null); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-border max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            تحديث أمر العمل <span className="text-primary font-mono text-sm">{order.id}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            العميل: <span className="text-foreground">{order.customer}</span> — السيارة: <span className="text-foreground">{order.vehicleType} {order.model}</span>
          </div>

          {/* 1) Status picker */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">1) اختر الحالة الجديدة:</p>
            <div className="space-y-1.5">
              {WORK_ORDER_STATUSES.map((s, i) => {
                const isSelected = normalizeWorkOrderStatus(selected || normalizedOrderStatus) === s;
                const isPast = i < currentIdx;
                const isCurrent = i === currentIdx;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelected(s)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-all text-right ${
                      isSelected
                        ? `${getStatusColor(s)} ring-2 ring-primary/40`
                        : isPast
                        ? "bg-success/5 border-border text-muted-foreground hover:bg-secondary"
                        : "bg-secondary/40 border-border text-foreground hover:bg-secondary"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                        isPast || isCurrent ? "bg-success border-success text-success-foreground" : "border-border"
                      }`}>
                        {(isPast || isCurrent) ? <Check size={10} /> : i + 1}
                      </span>
                      <span className="text-sm font-medium">{s}</span>
                    </span>
                    {isCurrent && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary">الحالية</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {requiresClosingReview && (
            <WorkOrderClosingReview
              order={order}
              targetStatus={selected}
              onCancel={() => setSelected(normalizedOrderStatus)}
              onConfirm={(review) => {
                setClosingReview(review);
                toast.success("تم اعتماد مراجعة الإغلاق. اضغط حفظ لإتمام تغيير الحالة.");
              }}
            />
          )}

          {/* 2) Optional photos */}
          <div className="border border-dashed border-border rounded-lg p-3 bg-secondary/20 space-y-2">
            <p className="text-xs text-foreground flex items-center gap-1.5">
              <Camera size={13} className="text-primary" />
              2) إرفاق صور <span className="text-muted-foreground">(اختياري)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => cameraInput.current?.click()} className="h-9 gap-1.5 text-xs">
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} كاميرا
              </Button>
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => galleryInput.current?.click()} className="h-9 gap-1.5 text-xs">
                <ImageIcon size={13} /> المعرض
              </Button>
              <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
              <input ref={galleryInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {pendingPhotos.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {pendingPhotos.map((p) => (
                  <div key={p.id} className="relative group rounded overflow-hidden border border-warning/40 ring-1 ring-warning/20">
                    <img src={p.dataUrl} alt="" className="w-full aspect-square object-cover" />
                    <button
                      onClick={() => setPendingPhotos((arr) => arr.filter(x => x.id !== p.id))}
                      className="absolute top-0.5 left-0.5 p-1 rounded-full bg-destructive/90 text-destructive-foreground"
                      aria-label="حذف"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3) Customer message + signature gate */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">3) رسالة العميل (تُرسل عند الضغط على «حفظ وإرسال»):</p>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="text-sm"
              placeholder="نص الرسالة..."
            />
            <div className={`mt-2 rounded-md border px-2.5 py-2 text-[11px] flex items-start gap-2 ${
              isSigned ? "bg-success/10 border-success/30 text-success" : "bg-warning/10 border-warning/30 text-warning"
            }`}>
              <span className="font-bold">{isSigned ? "✓" : "⚠"}</span>
              <div className="leading-relaxed">
                {isSigned ? (
                  <>تم توقيع العميل على البطاقة — سيُرفق <b>رابط متابعة الإصلاح</b> تلقائياً في الرسالة.</>
                ) : (
                  <>لم يوقّع العميل بعد على بطاقة أمر العمل. <b>رابط المتابعة لن يُرسل</b> حتى يتم التوقيع. الصور تُحفظ داخل النظام فقط ولا تُرسل عبر واتساب.</>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {order.phone ? `سيتم إرسالها للعميل عبر واتساب على: ${order.phone}` : "⚠ لا يوجد رقم هاتف للعميل — زر الإرسال معطّل"}
            </p>
          </div>

          {/* Footer */}
          <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-border sticky bottom-0 bg-card">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border sm:w-auto">إلغاء</Button>
            <Button
              onClick={handleSave}
              disabled={saving !== null}
              variant="secondary"
              className="flex-1 gap-1.5 h-11"
            >
              {saving === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              حفظ
            </Button>
            <Button
              onClick={handleSaveAndSend}
              disabled={saving !== null || !order.phone || !isSigned}
              title={!isSigned ? "بانتظار توقيع العميل على البطاقة" : ""}
              className="flex-1 gradient-gold text-primary-foreground gap-1.5 h-11"
            >
              {saving === "send" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              حفظ وإرسال للعميل
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


