import { useMemo, useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Printer, FileSignature, Trash2, Eraser, FileCheck2 } from "lucide-react";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { getVehicleDeliveryReceiptHtml } from "@/lib/pdfGenerator";
import { syncWorkOrderInvoiceFromExpenses, isInsuranceWorkOrder } from "@/lib/workOrderInvoiceSync";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";
import { postSalesInvoice } from "@/lib/salesAccounting";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: WorkOrder;
}

export default function VehicleDeliveryReceiptDialog({ open, onOpenChange, order }: Props) {
  const navigate = useNavigate();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiverName, setReceiverName] = useState("");
  const [receiverIdNumber, setReceiverIdNumber] = useState("");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [mileageOut, setMileageOut] = useState("");
  const [workSummary, setWorkSummary] = useState("");
  const [partsReplaced, setPartsReplaced] = useState("");
  const [warrantyNotes, setWarrantyNotes] = useState("ضمان لمدة 7 أيام أو 500 كم على الأعمال المنفذة فقط — لا يشمل الأعطال غير المرتبطة بالإصلاح.");
  const [satisfactionNotes, setSatisfactionNotes] = useState("");
  const [idPhoto, setIdPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const [pdfOpen, setPdfOpen] = useState(false);
  const [html, setHtml] = useState("");

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
  const receiptNumber = useMemo(
    () => `DR-${orderDisplay}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    [orderDisplay]
  );

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

  async function handleIdPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    setIdPhoto(await fileToWebpDataUrl(file));
  }

  function buildHtml() {
    return getVehicleDeliveryReceiptHtml({
      receiptNumber,
      date,
      workOrderNumber: orderDisplay,
      customerName: order.customer,
      customerPhone: order.phone,
      customerIdNumber: customerIdNumber || undefined,
      receiverName: receiverName || undefined,
      receiverIdNumber: receiverIdNumber || undefined,
      vehicleType: order.vehicleType,
      model: order.model,
      year: order.year,
      plateNumber: order.plate,
      vin: order.vin,
      color: order.color,
      mileageOut: mileageOut || undefined,
      workSummary: workSummary || undefined,
      partsReplaced: partsReplaced || undefined,
      warrantyNotes: warrantyNotes || undefined,
      satisfactionNotes: satisfactionNotes || undefined,
      signatureDataUrl: signature || undefined,
      idPhotoDataUrl: idPhoto || undefined,
    });
  }

  function handlePreview() {
    setHtml(buildHtml());
    setPdfOpen(true);
  }

  /**
   * إصدار الفاتورة الضريبية مباشرة من صفحة التسليم.
   * - يجمّع قطع غيار سندات الصرف للأمر + يُنشئ/يحدّث فاتورة مبيعات
   * - يربط الفاتورة تلقائياً بـ (العميل، اللوحة، الـVIN، شركة التأمين عبر notes)
   * - يُرحّل القيد المحاسبي فوراً
   */
  function handleIssueInvoice() {
    try {
      const result = syncWorkOrderInvoiceFromExpenses(order);
      if (!result.invoice) {
        toast.error("لا توجد قطع غيار بسعر بيع لإصدار فاتورة. أضف بنوداً يدوياً من شاشة الفاتورة.");
        return;
      }
      const inv = result.invoice;
      // ربط شركة التأمين في الملاحظات (إن وُجدت)
      if (order.insurance && order.insurance !== "-") {
        const tag = `#INS:${order.insurance}`;
        if (!(inv.notes || "").includes(tag)) {
          inv.notes = `${inv.notes || ""} ${tag}`.trim();
        }
      }
      // ترحيل القيد المحاسبي تلقائياً
      postSalesInvoice({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        date: inv.date,
        customerName: inv.customerName,
        subtotal: inv.subtotal,
        vat: inv.taxTotal,
        total: inv.total,
        source: "work_order_invoice",
      });
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
              إقرار استلام السيارة من الورشة
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            {/* Header summary */}
            <div className="bg-success/5 border border-success/30 rounded-lg p-3 text-xs space-y-1">
              <div><strong>أمر العمل:</strong> {orderDisplay}</div>
              <div><strong>العميل:</strong> {order.customer} — {order.phone}</div>
              <div><strong>المركبة:</strong> {order.vehicleType} {order.model} {order.year} · {order.plate}</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">تاريخ التسليم</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">قراءة العداد عند الخروج</Label>
                <Input value={mileageOut} onChange={(e) => setMileageOut(e.target.value)} placeholder="مثال: 45,500 كم" />
              </div>
              <div>
                <Label className="text-xs">رقم هوية العميل</Label>
                <Input value={customerIdNumber} onChange={(e) => setCustomerIdNumber(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">اسم المستلم (إذا كان غير العميل)</Label>
                <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder={order.customer} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">رقم هوية المستلم</Label>
                <Input value={receiverIdNumber} onChange={(e) => setReceiverIdNumber(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">ملخص الأعمال المنفذة</Label>
              <Textarea rows={3} value={workSummary} onChange={(e) => setWorkSummary(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">القطع المستبدلة</Label>
              <Textarea rows={3} value={partsReplaced} onChange={(e) => setPartsReplaced(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">شروط الضمان والملاحظات</Label>
              <Textarea rows={2} value={warrantyNotes} onChange={(e) => setWarrantyNotes(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">ملاحظات العميل عن الرضا (اختياري)</Label>
              <Textarea rows={2} value={satisfactionNotes} onChange={(e) => setSatisfactionNotes(e.target.value)} />
            </div>

            <div>
              <Label className="text-xs">صورة هوية المستلم (اختياري)</Label>
              <Input type="file" accept="image/*" capture="environment" onChange={handleIdPhoto} />
              {idPhoto && (
                <div className="mt-2 relative inline-block">
                  <img src={idPhoto} alt="id" className="max-h-32 rounded border border-border" />
                  <Button size="icon" variant="destructive" className="absolute -top-2 -left-2 h-6 w-6" onClick={() => setIdPhoto(null)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              )}
            </div>

            {/* Signature pad */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">توقيع المستلم</Label>
                <Button type="button" variant="ghost" size="sm" onClick={clearSig} className="h-7 gap-1">
                  <Eraser size={12} /> مسح
                </Button>
              </div>
              <canvas
                ref={sigCanvas}
                width={600}
                height={140}
                onPointerDown={startDraw}
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
                      navigate("/insurance/claims");
                    }
                  } catch {
                    navigate("/insurance/claims");
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
            <Button onClick={handlePreview} className="sm:flex-1 gap-2 bg-success hover:bg-success/90 text-white">
              <Printer size={16} /> معاينة وطباعة الإقرار
            </Button>
          </ResponsiveDialogFooter>
      </ResponsiveDialog>

      <PdfPreviewDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        htmlContent={html}
        title={`إقرار استلام ${order.plate}`}
        fileName={`delivery-receipt-${orderDisplay}-${date}`}
      />
    </>
  );
}
