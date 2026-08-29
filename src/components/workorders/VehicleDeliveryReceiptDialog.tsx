import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Printer, FileSignature, Trash2, Eraser, FileCheck2, Save, Loader2, CheckCircle2, LockKeyhole } from "lucide-react";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { getVehicleDeliveryReceiptHtml } from "@/lib/pdfGenerator";
import {
  buildDeliveryReceiptData,
  DEFAULT_HANDOVER_DECLARATION_AR,
  DEFAULT_HANDOVER_DECLARATION_EN,
  finalizeVehicleDeliveryReceipt,
  getDefaultDeliveryWarrantyNotes,
  getDeliveredDateInputValue,
  listVehicleHandoverHistory,
  loadVehicleDeliveryReceiptDraft,
  saveVehicleDeliveryReceiptDraft,
  type VehicleDeliveryReceiptDraft,
  type VehicleHandoverRecipientType,
} from "@/lib/vehicleDeliveryReceipt";
import { syncWorkOrderInvoiceFromExpenses, isInsuranceWorkOrder } from "@/lib/workOrderInvoiceSync";
import { salesStore } from "@/lib/salesStore";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: WorkOrder;
  deliveryDraft?: VehicleDeliveryReceiptDraft;
  onFinalized?: (record: VehicleDeliveryReceiptDraft) => void;
}

export default function VehicleDeliveryReceiptDialog({ open, onOpenChange, order, deliveryDraft, onFinalized }: Props) {
  const navigate = useNavigate();
  const [date, setDate] = useState(() => getDeliveredDateInputValue(deliveryDraft?.date));
  const [recordId, setRecordId] = useState<string | null>(deliveryDraft?.recordId || null);
  const [receiptNumber, setReceiptNumber] = useState<string | null>(deliveryDraft?.receiptNumber || null);
  const [recordStatus, setRecordStatus] = useState(deliveryDraft?.status || "draft");
  const [cancellationReason, setCancellationReason] = useState(deliveryDraft?.cancellationReason || "");
  const [receiverType, setReceiverType] = useState<VehicleHandoverRecipientType>(deliveryDraft?.receiverType || "customer");
  const [receiverName, setReceiverName] = useState(deliveryDraft?.receiverName || order.customer || "");
  const [receiverPhone, setReceiverPhone] = useState(deliveryDraft?.receiverPhone || order.phone || "");
  const [receiverIdNumber, setReceiverIdNumber] = useState(deliveryDraft?.receiverIdNumber || "");
  const [receiverRelationship, setReceiverRelationship] = useState(deliveryDraft?.receiverRelationship || "");
  const [customerIdNumber, setCustomerIdNumber] = useState(deliveryDraft?.customerIdNumber || "");
  const [mileageOut, setMileageOut] = useState(deliveryDraft?.mileageOut || "");
  const [vehicleCondition, setVehicleCondition] = useState(deliveryDraft?.vehicleCondition || "تمت المعاينة والحالة مطابقة");
  const [workshopRepresentative, setWorkshopRepresentative] = useState(deliveryDraft?.workshopRepresentative || "");
  const [workSummary, setWorkSummary] = useState(deliveryDraft?.workSummary || "");
  const [partsReplaced, setPartsReplaced] = useState(deliveryDraft?.partsReplaced || "");
  const [warrantyNotes, setWarrantyNotes] = useState(deliveryDraft?.warrantyNotes || getDefaultDeliveryWarrantyNotes());
  const [satisfactionNotes, setSatisfactionNotes] = useState(deliveryDraft?.satisfactionNotes || "");
  const [declarationAr, setDeclarationAr] = useState(deliveryDraft?.declarationAr || DEFAULT_HANDOVER_DECLARATION_AR);
  const [declarationEn, setDeclarationEn] = useState(deliveryDraft?.declarationEn || DEFAULT_HANDOVER_DECLARATION_EN);
  const [deliveryPhotoUrls, setDeliveryPhotoUrls] = useState<string[]>(deliveryDraft?.deliveryPhotoUrls || []);
  const [idPhoto, setIdPhoto] = useState<string | null>(deliveryDraft?.idPhotoDataUrl || null);
  const [signature, setSignature] = useState<string | null>(deliveryDraft?.signatureDataUrl || null);

  const [pdfOpen, setPdfOpen] = useState(false);
  const [html, setHtml] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [history, setHistory] = useState<VehicleDeliveryReceiptDraft[]>([]);
  const isReadOnly = recordStatus !== "draft";

  function applyDraft(draft?: VehicleDeliveryReceiptDraft | null) {
    setRecordId(draft?.recordId || null);
    setReceiptNumber(draft?.receiptNumber || null);
    setRecordStatus(draft?.status || "draft");
    setCancellationReason(draft?.cancellationReason || "");
    setDate(getDeliveredDateInputValue(draft?.date));
    setReceiverType(draft?.receiverType || "customer");
    setReceiverName(draft?.receiverName || order.customer || "");
    setReceiverPhone(draft?.receiverPhone || order.phone || "");
    setReceiverIdNumber(draft?.receiverIdNumber || "");
    setReceiverRelationship(draft?.receiverRelationship || "");
    setCustomerIdNumber(draft?.customerIdNumber || "");
    setMileageOut(draft?.mileageOut || "");
    setVehicleCondition(draft?.vehicleCondition || "تمت المعاينة والحالة مطابقة");
    setWorkshopRepresentative(draft?.workshopRepresentative || "");
    setWorkSummary(draft?.workSummary || "");
    setPartsReplaced(draft?.partsReplaced || "");
    setWarrantyNotes(draft?.warrantyNotes || getDefaultDeliveryWarrantyNotes());
    setSatisfactionNotes(draft?.satisfactionNotes || "");
    setDeclarationAr(draft?.declarationAr || DEFAULT_HANDOVER_DECLARATION_AR);
    setDeclarationEn(draft?.declarationEn || DEFAULT_HANDOVER_DECLARATION_EN);
    setDeliveryPhotoUrls(draft?.deliveryPhotoUrls || []);
    setIdPhoto(draft?.idPhotoDataUrl || null);
    setSignature(draft?.signatureDataUrl || null);
  }

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingDraft(true);
    void Promise.all([
      loadVehicleDeliveryReceiptDraft({ id: order.id, orderNumber: order.displayNumber }),
      listVehicleHandoverHistory({ id: order.id, orderNumber: order.displayNumber }),
    ])
      .then(([saved, savedHistory]) => {
        if (!active) return;
        setHistory(savedHistory);
        applyDraft(saved ? { ...deliveryDraft, ...saved } : deliveryDraft);
      })
      .catch((error: any) => {
        if (!active) return;
        applyDraft(deliveryDraft);
        toast.error(error?.message || "تعذر تحميل بيانات إقرار التسليم المحفوظة");
      })
      .finally(() => {
        if (active) setLoadingDraft(false);
      });
    return () => { active = false; };
  }, [open, order.id, order.displayNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill parts replaced from work order parts
  useEffect(() => {
    if (open && !partsReplaced && (order.partsNeeded || []).length) {
      const lines = (order.partsNeeded || [])
        .filter((p) => p.fulfilled !== false)
        .map((p) => `• ${p.name}${p.quantity > 1 ? ` ×${p.quantity}` : ""}`)
        .join("\n");
      if (lines) setPartsReplaced(lines);
    }
    if (open && !workSummary && order.diagnosis) {
      setWorkSummary(order.diagnosis);
    }
    if (open && !mileageOut && order.mileage) setMileageOut(order.mileage);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderDisplay = order.displayNumber || order.id;
  // ====== Signature pad ======
  const sigCanvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  function startDraw(e: React.PointerEvent) {
    const canvas = sigCanvas.current!;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    drawing.current = true;
  }
  function moveDraw(e: React.PointerEvent) {
    if (!drawing.current) return;
    const canvas = sigCanvas.current!;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d")!;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  }
  function endDraw() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = sigCanvas.current!;
    setSignature(canvas.toDataURL("image/png"));
  }
  function clearSig() {
    const canvas = sigCanvas.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignature(null);
  }

  useEffect(() => {
    if (!open || !signature || !sigCanvas.current) return;
    const canvas = sigCanvas.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = signature;
  }, [open, signature]);

  async function handleIdPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    setIdPhoto(await fileToWebpDataUrl(file));
  }

  function buildHtml() {
    return getVehicleDeliveryReceiptHtml(buildDeliveryReceiptData(order, {
      date,
      recordId,
      receiptNumber,
      status: recordStatus,
      receiverType,
      customerIdNumber,
      receiverName,
      receiverPhone,
      receiverIdNumber,
      receiverRelationship,
      mileageOut,
      vehicleCondition,
      workshopRepresentative,
      workSummary,
      partsReplaced,
      warrantyNotes,
      satisfactionNotes,
      declarationAr,
      declarationEn,
      deliveryPhotoUrls,
      signatureDataUrl: signature,
      idPhotoDataUrl: idPhoto,
    }));
  }

  function currentDraft(): VehicleDeliveryReceiptDraft {
    return {
      recordId,
      receiptNumber,
      status: recordStatus,
      date,
      receiverType,
      customerIdNumber,
      receiverName,
      receiverPhone,
      receiverIdNumber,
      receiverRelationship,
      mileageOut,
      vehicleCondition,
      workshopRepresentative,
      workSummary,
      partsReplaced,
      warrantyNotes,
      satisfactionNotes,
      declarationAr,
      declarationEn,
      deliveryPhotoUrls,
      signatureDataUrl: signature,
      idPhotoDataUrl: idPhoto,
    };
  }

  async function handleSave(showSuccess = true): Promise<boolean> {
    if (isReadOnly) {
      if (showSuccess) toast.info("المستند نهائي ومحفوظ للقراءة فقط");
      return true;
    }
    setSavingDraft(true);
    try {
      const saved = await saveVehicleDeliveryReceiptDraft(
        { id: order.id, orderNumber: order.displayNumber },
        currentDraft(),
      );
      applyDraft(saved);
      if (showSuccess) toast.success("تم حفظ مسودة خروج وتسليم المركبة");
      return true;
    } catch (error: any) {
      toast.error(error?.message || "فشل حفظ بيانات إقرار استلام السيارة");
      return false;
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleFinalize() {
    if (!receiverName.trim()) {
      toast.error("اسم المستلم مطلوب قبل اعتماد التسليم");
      return;
    }
    if (!signature) {
      toast.error("توقيع المستلم مطلوب قبل اعتماد التسليم");
      return;
    }
    setFinalizing(true);
    try {
      const finalized = await finalizeVehicleDeliveryReceipt(
        { id: order.id, orderNumber: order.displayNumber },
        currentDraft(),
      );
      applyDraft(finalized);
      toast.success(`تم اعتماد خروج وتسليم المركبة${finalized.receiptNumber ? ` — ${finalized.receiptNumber}` : ""}`);
      onFinalized?.(finalized);
    } catch (error: any) {
      toast.error(error?.message || "تعذر اعتماد خروج وتسليم المركبة");
    } finally {
      setFinalizing(false);
    }
  }

  async function handlePreview() {
    if (!(await handleSave(false))) return;
    setHtml(buildHtml());
    setPdfOpen(true);
  }

  /**
   * إصدار الفاتورة الضريبية مباشرة من صفحة التسليم.
   * - يجمّع قطع غيار سندات الصرف للأمر + يُنشئ/يحدّث فاتورة مبيعات
   * - يربط الفاتورة تلقائياً بـ (العميل، اللوحة، الـVIN، شركة التأمين عبر notes)
   * - يُرحّل القيد المحاسبي فوراً
   */
  async function handleIssueInvoice() {
    try {
      const result = syncWorkOrderInvoiceFromExpenses(order);
      if (!result.invoice) {
        toast.error("لا توجد قطع غيار بسعر بيع لإصدار فاتورة. أضف بنوداً يدوياً من شاشة الفاتورة.");
        return;
      }
      let inv = result.invoice;
      // ربط شركة التأمين في الملاحظات (إن وُجدت)
      if (order.insurance && order.insurance !== "-") {
        const tag = `#INS:${order.insurance}`;
        if (!(inv.notes || "").includes(tag)) {
          inv.notes = `${inv.notes || ""} ${tag}`.trim();
        }
      }
      inv = await salesStore.issueInvoice(inv);
      toast.success(
        result.created
          ? `تم إصدار الفاتورة الضريبية ${inv.number} (${result.partsCount} بند)`
          : `تم تحديث الفاتورة ${inv.number} (${result.partsCount} بند)`
      );
      onOpenChange(false);
      navigate(`/sales/invoices/${inv.id}`);
    } catch (err: any) {
      toast.error(err?.message || "فشل إصدار الفاتورة");
    }
  }

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="max-w-3xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <FileSignature size={18} className="text-success" />
              نموذج خروج وتسليم المركبة
              {recordStatus === "finalized" && <Badge className="gap-1 bg-emerald-600"><LockKeyhole size={11} /> نهائي</Badge>}
              {recordStatus === "cancelled" && <Badge variant="destructive" className="gap-1"><LockKeyhole size={11} /> ملغي ومحفوظ</Badge>}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            {loadingDraft && (
              <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> تحميل بيانات الإقرار المحفوظة…
              </div>
            )}
            {history.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold">سجل مستندات الخروج السابقة</div>
                  {recordStatus === "cancelled" && (
                    <Button type="button" size="sm" variant="outline" onClick={() => applyDraft(deliveryDraft)}>
                      إنشاء مسودة تسليم جديدة
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {history.map((item) => (
                    <Button key={item.recordId || item.receiptNumber} type="button" size="sm" variant={item.recordId === recordId ? "default" : "outline"} onClick={() => applyDraft(item)}>
                      {item.receiptNumber || "مستند سابق"} · {item.status === "cancelled" ? "ملغي" : "نهائي"}
                    </Button>
                  ))}
                </div>
                {recordStatus === "cancelled" && cancellationReason && <p className="mt-2 text-xs text-destructive">سبب الإلغاء: {cancellationReason}</p>}
              </div>
            )}
            {/* Header summary */}
            <div className="bg-success/5 border border-success/30 rounded-lg p-3 text-xs space-y-1">
              <div><strong>أمر العمل:</strong> {orderDisplay}</div>
              <div><strong>العميل:</strong> {order.customer} — {order.phone}</div>
              <div><strong>المركبة:</strong> {order.vehicleType} {order.model} {order.year} · {order.plate}</div>
              {receiptNumber && <div><strong>رقم مستند التسليم:</strong> <span dir="ltr" className="font-mono">{receiptNumber}</span></div>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">تاريخ التسليم</Label>
                <Input disabled={isReadOnly} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">قراءة العداد عند الخروج</Label>
                <Input disabled={isReadOnly} value={mileageOut} onChange={(e) => setMileageOut(e.target.value)} placeholder="مثال: 45,500 كم" />
              </div>
              <div>
                <Label className="text-xs">صفة المستلم</Label>
                <Select disabled={isReadOnly} value={receiverType} onValueChange={(value) => {
                  const next = value as VehicleHandoverRecipientType;
                  setReceiverType(next);
                  if (next === "customer" || next === "owner") {
                    setReceiverName(order.customer || "");
                    setReceiverPhone(order.phone || "");
                    setReceiverRelationship(next === "owner" ? "المالك" : "العميل");
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">العميل</SelectItem>
                    <SelectItem value="owner">مالك المركبة</SelectItem>
                    <SelectItem value="representative">مندوب عن العميل</SelectItem>
                    <SelectItem value="driver">سائق</SelectItem>
                    <SelectItem value="tow_truck">سائق رافعة</SelectItem>
                    <SelectItem value="insurance_representative">مندوب شركة التأمين</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">اسم المستلم *</Label>
                <Input disabled={isReadOnly} value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder={order.customer} />
              </div>
              <div>
                <Label className="text-xs">رقم هاتف المستلم</Label>
                <Input disabled={isReadOnly} dir="ltr" value={receiverPhone} onChange={(e) => setReceiverPhone(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">رقم هوية المستلم</Label>
                <Input disabled={isReadOnly} value={receiverIdNumber} onChange={(e) => setReceiverIdNumber(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">العلاقة أو الصفة</Label>
                <Input disabled={isReadOnly} value={receiverRelationship} onChange={(e) => setReceiverRelationship(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">موظف الورشة المسؤول عن الخروج</Label>
                <Input disabled={isReadOnly} value={workshopRepresentative} onChange={(e) => setWorkshopRepresentative(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">حالة المركبة عند الخروج</Label>
                <Input disabled={isReadOnly} value={vehicleCondition} onChange={(e) => setVehicleCondition(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">ملخص الأعمال المنفذة</Label>
              <Textarea disabled={isReadOnly} rows={3} value={workSummary} onChange={(e) => setWorkSummary(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">القطع المستبدلة</Label>
              <Textarea disabled={isReadOnly} rows={3} value={partsReplaced} onChange={(e) => setPartsReplaced(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">شروط الضمان والملاحظات</Label>
              <Textarea disabled={isReadOnly} rows={2} value={warrantyNotes} onChange={(e) => setWarrantyNotes(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">ملاحظات العميل عن الرضا (اختياري)</Label>
              <Textarea disabled={isReadOnly} rows={2} value={satisfactionNotes} onChange={(e) => setSatisfactionNotes(e.target.value)} />
            </div>

            <div className="grid gap-3 rounded-lg border border-border p-3">
              <div><Label className="text-xs">نص الإقرار بالعربية</Label><Textarea disabled={isReadOnly} rows={3} value={declarationAr} onChange={(e) => setDeclarationAr(e.target.value)} /></div>
              <div><Label className="text-xs">Declaration in English</Label><Textarea disabled={isReadOnly} dir="ltr" rows={3} value={declarationEn} onChange={(e) => setDeclarationEn(e.target.value)} /></div>
            </div>

            <div>
              <Label className="text-xs">صورة هوية المستلم (اختياري)</Label>
              <Input disabled={isReadOnly} type="file" accept="image/*" capture="environment" onChange={handleIdPhoto} />
              {idPhoto && (
                <div className="mt-2 relative inline-block">
                  <img src={idPhoto} alt="id" className="max-h-32 rounded border border-border" />
                  <Button disabled={isReadOnly} size="icon" variant="destructive" className="absolute -top-2 -left-2 h-6 w-6" onClick={() => setIdPhoto(null)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              )}
            </div>

            {/* Signature pad */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">توقيع المستلم</Label>
                <Button disabled={isReadOnly} type="button" variant="ghost" size="sm" onClick={clearSig} className="h-7 gap-1">
                  <Eraser size={12} /> مسح
                </Button>
              </div>
              <canvas
                ref={sigCanvas}
                aria-disabled={isReadOnly}
                width={600}
                height={140}
                onPointerDown={(event) => { if (!isReadOnly) startDraw(event); }}
                onPointerMove={moveDraw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
                className="w-full bg-background border-2 border-dashed border-border rounded-md touch-none cursor-crosshair"
                style={{ height: 140 }}
              />
              <p className="text-[10px] text-muted-foreground mt-1">ارسم التوقيع بالإصبع أو الفأرة</p>
            </div>
          </div>

          <ResponsiveDialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="sm:flex-1">إلغاء</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSave(true)}
              disabled={savingDraft || loadingDraft || isReadOnly}
              className="sm:flex-1 gap-2"
            >
              {savingDraft ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              حفظ المسودة
            </Button>
            {!isReadOnly && (
              <Button disabled={savingDraft || loadingDraft || finalizing} onClick={() => void handleFinalize()} className="sm:flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                {finalizing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                اعتماد الخروج والتسليم
              </Button>
            )}
            {isInsuranceWorkOrder(order) ? (
              <Button
                onClick={async () => {
                  try {
                    const { data } = await supabase
                      .from("insurance_claims")
                      .select("id")
                      .or(`auto_job_order_id.eq.${order.id},job_order_id.eq.${order.id},claim_number.eq.${order.claimNumber}`)
                      .limit(1)
                      .maybeSingle();
                    if (data?.id) {
                      navigate(`/insurance/${data.id}`);
                    } else {
                      toast.info("افتح المطالبة من قائمة التأمين لإصدار الفاتورة الضريبية");
                      navigate("/insurance/list");
                    }
                  } catch {
                    navigate("/insurance/list");
                  }
                }}
                variant="default"
                className="sm:flex-1 gap-2"
              >
                <ShieldCheck size={16} /> فتح المطالبة لإصدار الفاتورة
              </Button>
            ) : (
              <Button onClick={handleIssueInvoice} variant="default" className="sm:flex-1 gap-2">
                <FileCheck2 size={16} /> إصدار فاتورة ضريبية
              </Button>
            )}
            <Button disabled={savingDraft || loadingDraft} onClick={() => void handlePreview()} className="sm:flex-1 gap-2 bg-success hover:bg-success/90 text-white">
              <Printer size={16} /> معاينة وطباعة الإقرار
            </Button>
          </ResponsiveDialogFooter>
      </ResponsiveDialog>

      <PdfPreviewDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        htmlContent={html}
        title={`خروج وتسليم المركبة ${order.plate}`}
        fileName={`vehicle-handover-${receiptNumber || orderDisplay}-${date}`}
      />
    </>
  );
}
