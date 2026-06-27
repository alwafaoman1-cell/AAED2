import { useEffect, useMemo, useRef, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Edit,
  Workflow,
  Camera,
  QrCode,
  Receipt,
  FileText,
  Trash2,
  Search as SearchIcon,
  FilePlus2,
  Package,
  Printer,
  Car,
  User,
  Wrench,
  ShieldCheck,
  Image as ImageIcon,
  MessageCircle,
  Eye,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import {
  getWorkOrderById,
  subscribeWorkOrders,
  WORK_ORDER_STATUSES,
  STAGE_LABELS,
  deleteWorkOrder,
  updateNeededPartInOrder,
  type WorkOrder,
  type NeededPart,
  type StagePhase,
  refreshWorkOrdersFromCloud,
  isPartStillNeeded,
} from "@/lib/workOrdersStore";
import { supabase } from "@/integrations/supabase/client";
import { inspectionsStore } from "@/lib/inspectionsStore";
import { getExpensesForWorkOrder, expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import { Checkbox } from "@/components/ui/checkbox";
import { canDelete, canEdit } from "@/lib/permissions";
import { moveToTrash } from "@/lib/trashStore";
import { logActivity } from "@/lib/auditLogStore";
import { getNeededPartsRequestHtml, getWorkOrderHtml } from "@/lib/pdfGenerator";
import { buildPartsRequestMessage } from "@/lib/partsWhatsApp";

import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import WorkOrderForm from "@/components/workorders/WorkOrderForm";
import WorkOrderStatusDialog from "@/components/workorders/WorkOrderStatusDialog";
import WorkOrderBulkExpenseDialog from "@/components/workorders/WorkOrderBulkExpenseDialog";
import WorkOrderExpenseDialog from "@/components/workorders/WorkOrderExpenseDialog";
import ExpensePreviewDialog from "@/components/workorders/ExpensePreviewDialog";
import StagePhotosDialog from "@/components/workorders/StagePhotosDialog";
import QrLabel from "@/components/workorders/QrLabel";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import NeededPartsManager from "@/components/workorders/NeededPartsManager";
import SupplementsSection from "@/components/workorders/SupplementsSection";
import ApprovalHistoryTab from "@/components/workorders/ApprovalHistoryTab";
import CustomerPortalLink from "@/components/workorders/CustomerPortalLink";
import SendStageNotificationButton from "@/components/workorders/SendStageNotificationButton";
import SmartCustomerSendBar from "@/components/workorders/SmartCustomerSendBar";
// PortalNotesPending moved to /messages
import VehicleDeliveryReceiptDialog from "@/components/workorders/VehicleDeliveryReceiptDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import WhatsAppCenter from "@/components/workorders/WhatsAppCenter";
import QuickEmailButton from "@/components/QuickEmailButton";
import { salesStore, statusLabel, type SalesDoc } from "@/lib/salesStore";
import WorkOrderTypeBadge from "@/components/workorders/WorkOrderTypeBadge";
import { resolveWorkOrderType } from "@/lib/workOrderType";
import { archiveWorkOrder } from "@/lib/deletePolicy";
import VehicleAvatar from "@/components/vehicles/VehicleAvatar";

const PHASES: StagePhase[] = ["received", "inspection", "in_progress", "quality", "delivery"];

const statusColors: Record<string, string> = {
  "تحت الفحص": "bg-primary/15 text-primary",
  "بانتظار الموافقة": "bg-info/15 text-info",
  "بانتظار قطع الغيار": "bg-warning/15 text-warning",
  "تحت الإصلاح": "bg-warning/15 text-warning",
  "ضبط الجودة": "bg-info/15 text-info",
  "جاهز للتسليم": "bg-success/15 text-success",
  "تم التسليم": "bg-success/25 text-success",
  "مغلق": "bg-muted text-muted-foreground",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPA_STATUS_TO_AR: Record<string, string> = {
  received: "تحت الفحص",
  diagnosing: "تحت الفحص",
  awaiting_parts: "بانتظار قطع الغيار",
  in_progress: "تحت الإصلاح",
  quality_check: "ضبط الجودة",
  ready: "جاهز للتسليم",
  delivered: "تم التسليم",
  closed: "مغلق",
};

export default function WorkOrderDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<WorkOrder | undefined>(() => getWorkOrderById(id));
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [cloudJobOrderId, setCloudJobOrderId] = useState<string | null>(null);

  // Resolve cloud UUID for job_orders (used by Supplements/Reception/Approval sections)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const candidate = order?.id || id;
      if (candidate && UUID_RE.test(candidate)) { setCloudJobOrderId(candidate); return; }
      const woNo = (order?.displayNumber || id || "").match(/WO-\d{4}-\d+/i)?.[0];
      if (!woNo) { setCloudJobOrderId(null); return; }
      const { data } = await supabase.from("job_orders").select("id").ilike("order_number", woNo).maybeSingle();
      if (!cancelled) setCloudJobOrderId((data as any)?.id || null);
    })();
    return () => { cancelled = true; };
  }, [id, order?.id, order?.displayNumber]);

  // Detect status/photos changes triggered by the top buttons and prompt auto-send
  useEffect(() => {
    if (!order) return;
    const curStatus = order.status;
    const curLen = (order.photos || []).length;
    if (prevStatusRef.current === null) { prevStatusRef.current = curStatus; prevPhotosLenRef.current = curLen; return; }
    const statusChanged = statusDirtyRef.current && curStatus !== prevStatusRef.current;
    const photoChanged = photoDirtyRef.current && curLen !== prevPhotosLenRef.current;
    if (statusChanged && photoChanged) setPendingSend("both");
    else if (statusChanged) setPendingSend("status");
    else if (photoChanged) setPendingSend("photo");
    if (statusChanged) statusDirtyRef.current = false;
    if (photoChanged) photoDirtyRef.current = false;
    prevStatusRef.current = curStatus;
    prevPhotosLenRef.current = curLen;
  }, [order?.status, order?.photos?.length]);

  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [previewExpense, setPreviewExpense] = useState<ExpenseRecord | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [waTab, setWaTab] = useState<"templates" | "suppliers" | "history">("templates");
  // Auto-prompt for sending after status/photo changes via the top buttons
  const [pendingSend, setPendingSend] = useState<null | "status" | "photo" | "both">(null);
  const prevStatusRef = useRef<string | null>(null);
  const prevPhotosLenRef = useRef<number | null>(null);
  const statusDirtyRef = useRef(false);
  const photoDirtyRef = useRef(false);
  const [partsRequestDate, setPartsRequestDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [deliveryReceiptOpen, setDeliveryReceiptOpen] = useState(false);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [convertPart, setConvertPart] = useState<NeededPart | null>(null);

  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => {
    const local = getWorkOrderById(id);
    setOrder(local);
    const unsub = subscribeWorkOrders(() => setOrder((prev) => getWorkOrderById(id) || prev));

    // Fallback: if not found locally, fetch from Supabase job_orders by UUID or by order_number (WO-YYYY-NNNN)
    const isUuid = UUID_RE.test(id);
    const woMatch = id.match(/WO-\d{4}-\d+/i);
    if (!local && id && (isUuid || woMatch)) {
      setLoadingRemote(true);
      (async () => {
        const q = supabase
          .from("job_orders")
          .select(`
            id, order_number, status, description, diagnosis,
            labor_cost, parts_cost, final_total, created_at,
            insurance_claim_number, insurance_company, insurance_approved,
            work_order_type, claim_id, tracking_token, tracking_expires_at, archived_at,
            customer:customers(name, phone),
            vehicle:vehicles(brand, model, plate_number, year, color, vin_number)
          `);
        const { data, error } = isUuid
          ? await q.eq("id", id).maybeSingle()
          : await q.ilike("order_number", woMatch![0]).maybeSingle();
        if (!error && data) {
          const labor = Number((data as any).labor_cost) || 0;
          const parts = Number((data as any).parts_cost) || 0;
          const total = Number((data as any).final_total) || labor + parts;
          const v: any = (data as any).vehicle || {};
          const c: any = (data as any).customer || {};
          const adapted: WorkOrder = {
            id: (data as any).order_number || (data as any).id,
            cloudId: (data as any).id,
            displayNumber: (data as any).order_number || undefined,
            workOrderType: (data as any).work_order_type || ((data as any).claim_id ? "insurance" : "general_customer"),
            claimId: (data as any).claim_id || undefined,
            trackingToken: (data as any).tracking_token || undefined,
            trackingExpiresAt: (data as any).tracking_expires_at || undefined,
            archivedAt: (data as any).archived_at || undefined,
            customer: c.name || "—",
            phone: c.phone || "",
            plate: v.plate_number || "—",
            vehicleType: v.brand || "",
            model: v.model || "",
            year: v.year ? String(v.year) : "",
            vin: v.vin_number || "",
            color: v.color || "",
            mileage: "",
            insurance: (data as any).insurance_company || ((data as any).insurance_approved ? "تأمين" : "-"),
            claimNumber: (data as any).insurance_claim_number || "-",
            entryDate: ((data as any).created_at || "").slice(0, 10),
            technician: "",
            serviceType: (data as any).insurance_claim_number ? "حادث" : "صيانة",
            status: SUPA_STATUS_TO_AR[(data as any).status] || "تحت الفحص",
            totalCost: total,
            laborCost: labor,
            partsCost: parts,
            diagnosis: (data as any).diagnosis || (data as any).description || "",
            description: (data as any).description || "",
            photos: [],
            partsNeeded: [],
          };
          void refreshWorkOrdersFromCloud().catch(() => {});
          setOrder(adapted);
        }
        setLoadingRemote(false);
      })();
    }
    return () => unsub();
  }, [id]);

  const inspections = useMemo(
    () => (order ? inspectionsStore.getAll().filter((i) => i.workOrder === order.id) : []),
    [order]
  );

  const linkedVouchers = useMemo(
    () => (order ? getExpensesForWorkOrder(order.id) : []),
    [order]
  );
  const vouchersTotal = linkedVouchers.reduce((s, v) => s + (Number(v.amount) || 0), 0);

  // كشف الفاتورة المرتبطة بأمر العمل (إن وجدت)
  const [salesTick, setSalesTick] = useState(0);
  useEffect(() => {
    const unsub = salesStore.subscribe(() => setSalesTick((t) => t + 1));
    return () => { unsub(); };
  }, []);
  const linkedInvoice = useMemo<SalesDoc | undefined>(() => {
    if (!order) return undefined;
    const tag = `#WO:${order.id}`;
    const key = `WO-${order.id}`;
    return salesStore
      .list({ type: "invoice", includeDeleted: false })
      .find((d) => d.fromDocId === key || (d.notes || "").includes(tag));
  }, [order, salesTick]);
  const linkedQuote = useMemo<SalesDoc | undefined>(() => {
    if (!order) return undefined;
    const tag = `#WO:${order.id}`;
    const key = `WO-${order.id}`;
    return salesStore
      .list({ type: "quote", includeDeleted: false })
      .find((d) => d.fromDocId === key || (d.notes || "").includes(tag));
  }, [order, salesTick]);

  // ابحث عن مطالبة تأمين مرتبطة بهذا الأمر (عبر رقم المطالبة أو job_order_id)
  const [linkedClaim, setLinkedClaim] = useState<{ id: string; claim_number: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLinkedClaim(null);
    if (!order) return;
    (async () => {
      try {
        let row: any = null;
        const cn = (order.claimNumber || "").trim();
        if (cn && cn !== "-") {
          const { data } = await supabase
            .from("insurance_claims")
            .select("id, claim_number")
            .eq("claim_number", cn)
            .maybeSingle();
          row = data;
        }
        if (!row && UUID_RE.test(order.id)) {
          const { data } = await supabase
            .from("insurance_claims")
            .select("id, claim_number")
            .or(`auto_job_order_id.eq.${order.id},job_order_id.eq.${order.id}`)
            .maybeSingle();
          row = data;
        }
        if (!cancelled && row) setLinkedClaim(row);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [order?.id, order?.claimNumber]);




  if (!order) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => smartBack(navigate, "/work-orders")} className="gap-1">
          <ArrowRight size={16} /> عودة لأوامر العمل
        </Button>
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <Car size={40} className="mx-auto mb-3 opacity-40" />
          <p>{loadingRemote ? "جاري تحميل أمر العمل..." : "لم يتم العثور على أمر العمل"}</p>
          <p className="text-xs font-mono mt-1">{id}</p>
        </div>
      </div>
    );
  }

  const currentIdx = WORK_ORDER_STATUSES.indexOf(order.status);
  const partsNeeded = order.partsNeeded || [];
  const photos = order.photos || [];
  // رقم العرض الاحترافي للأمر (WO-YYYY-NNNNN). يُستخدم في كل الواجهات والـPDF بدل الـUUID.
  const displayNo = order.displayNumber || (UUID_RE.test(order.id) ? `WO-${order.id.slice(0, 8).toUpperCase()}` : order.id);

  async function handlePrintWorkOrder() {
    // Pre-build tracking QR into the cache before sync HTML render
    const { buildTrackingQrDataUrl } = await import("@/lib/pdfGenerator");
    if (order!.trackingToken) await buildTrackingQrDataUrl(order!.trackingToken);

    // Fetch customer signature if available (from portal token)
    let customerSignatureDataUrl: string | undefined;
    let customerSignatureName: string | undefined;
    let customerSignatureDate: string | undefined;
    if (cloudJobOrderId) {
      const { data: tok } = await supabase
        .from("customer_portal_tokens")
        .select("signature_data_url, signer_name, signed_at")
        .eq("job_order_id", cloudJobOrderId)
        .maybeSingle();
      const t: any = tok;
      if (t?.signature_data_url) {
        customerSignatureDataUrl = t.signature_data_url;
        customerSignatureName = t.signer_name || undefined;
        customerSignatureDate = t.signed_at ? new Date(t.signed_at).toLocaleString("en-GB") : undefined;
      }
    }

    const html = getWorkOrderHtml({
      orderNumber: order!.displayNumber || (UUID_RE.test(order!.id) ? `WO-${order!.id.slice(0, 8).toUpperCase()}` : order!.id),
      workOrderType: resolveWorkOrderType(order!),
      trackingToken: order!.trackingToken,
      date: order!.entryDate,
      customerName: order!.customer,
      customerPhone: order!.phone,
      vehicleType: order!.vehicleType,
      model: order!.model,
      year: order!.year,
      plateNumber: order!.plate,
      vin: order!.vin,
      insurance: order!.insurance,
      claimNumber: order!.claimNumber,
      serviceType: order!.serviceType,
      technician: order!.technician,
      status: order!.status,
      totalCost: order!.totalCost,
      description: order!.diagnosis,
      color: order!.color,
      mileage: order!.mileage,
      laborCost: order!.laborCost,
      partsCost: order!.partsCost,
      extraExpenses: order!.extraExpenses,
      depositApplied: order!.depositApplied,
      photos: photos.map((p) => ({ phase: p.phase, dataUrl: p.dataUrl, caption: p.caption })),
      customerSignatureDataUrl,
      customerSignatureName,
      customerSignatureDate,
    });
    setPreviewHtml(html);
    setPreviewTitle(`أمر عمل ${order!.displayNumber || order!.id}`);
    setPreviewOpen(true);
  }

  function handlePrintNeededParts() {
    if (partsNeeded.length === 0) {
      toast.error("لا توجد قطع غيار مطلوبة لهذا الأمر");
      return;
    }
    const html = getNeededPartsRequestHtml({
      requestNumber: `PR-${order!.displayNumber || order!.id}`,
      date: partsRequestDate || new Date().toISOString().slice(0, 10),
      rows: [
        {
          workOrderId: order!.id,
          customer: order!.customer,
          vehicle: `${order!.vehicleType} ${order!.model} ${order!.year}`.trim(),
          vehicleType: `${order!.vehicleType} ${order!.model}`.trim(),
          year: order!.year,
          vin: order!.vin,
          plate: order!.plate,
          parts: partsNeeded.map((p) => ({
            name: p.name,
            quantity: p.quantity,
            notes: p.notes,
            fulfilled: p.fulfilled,
          })),
        },
      ],
    });
    setPreviewHtml(html);
    setPreviewTitle(`طلب قطع غيار — ${order!.displayNumber || order!.id}`);
    setPreviewOpen(true);
  }

  function openNewInspection() {
    sessionStorage.setItem("inspection_link_order", order!.id);
    navigate("/inspection?new=1");
  }

  return (
    <div className="space-y-5">
      <div className={`rounded-xl border p-4 ${
        resolveWorkOrderType(order) === "insurance"
          ? "border-sky-500/35 bg-gradient-to-l from-sky-500/15 to-card"
          : "border-emerald-500/35 bg-gradient-to-l from-emerald-500/15 to-card"
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <VehicleAvatar
            size="md"
            imageUrl={order.vehicleThumbnailUrl || order.vehicleImageUrl}
            fallbackPhotos={(order.photos || []).map((photo) => photo.dataUrl)}
            label={`${order.vehicleType} ${order.model}`.trim() || order.plate}
            className="hidden sm:flex"
          />
          <div>
            <p className="text-sm font-bold text-foreground">
              {resolveWorkOrderType(order) === "insurance" ? "🛡 Insurance Work Order" : "🚗 General Customer Work Order"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {resolveWorkOrderType(order) === "insurance"
                ? `مرتبط بمسار التأمين${order.claimNumber && order.claimNumber !== "-" ? ` — مطالبة ${order.claimNumber}` : ""}`
                : "أمر عميل عام / كاش — لا ينشئ مطالبة تأمين"}
            </p>
          </div>
          <WorkOrderTypeBadge
            workOrderType={order.workOrderType}
            claimId={order.claimId}
            claimNumber={order.claimNumber}
            insurance={order.insurance}
          />
        </div>
      </div>

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => smartBack(navigate, "/work-orders")} className="gap-1 -mr-2">
            <ArrowRight size={16} /> عودة
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              تفاصيل أمر العمل
              <span className="font-mono text-primary text-sm">{displayNo}</span>
              <span
                className={`text-[10px] px-2 py-1 rounded-full font-medium ${statusColors[order.status] || ""}`}
              >
                {order.status}
              </span>
            </h1>
            <p className="text-xs text-muted-foreground">
              {order.customer} — {order.vehicleType} {order.model} {order.year} · {order.plate}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* المجموعة 1: العمليات الأساسية */}
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5 h-9">
            {allowEdit && (
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)} className="h-8 gap-1.5 text-xs">
                <Edit size={14} className="text-info" /> تعديل
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { statusDirtyRef.current = true; setStatusOpen(true); }} className="h-8 gap-1.5 text-xs">
              <Workflow size={14} className="text-info" /> الحالة
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { photoDirtyRef.current = true; setPhotosOpen(true); }} className="h-8 gap-1.5 text-xs">
              <Camera size={14} className="text-primary" /> الصور
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpenseOpen(true)} className="h-8 gap-1.5 text-xs">
              <Receipt size={14} className="text-warning" /> مصروف
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setQrOpen(true)} className="h-8 gap-1.5 text-xs">
              <QrCode size={14} className="text-primary" /> QR
            </Button>
          </div>

          {/* المجموعة 2: التواصل */}
          <div className="flex items-center gap-0.5 rounded-md border border-success/30 bg-success/5 p-0.5 h-9">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setWaTab("templates"); setWaOpen(true); }}
              className="h-8 gap-1.5 text-xs text-success hover:bg-success/10"
            >
              <MessageCircle size={14} /> واتساب
            </Button>
            <QuickEmailButton
              ctx={{
                docType: "work_order",
                vehicleMake: order.vehicleType,
                vehicleModel: order.model,
                plateNumber: order.plate,
                claimNumber: order.claimNumber,
                documentNumber: displayNo,
                customerName: order.customer,
                insuranceCompany: order.insurance,
              }}
              buttonLabel="إيميل"
              buttonSize="sm"
              buttonClassName="h-8 gap-1.5 text-xs text-info hover:bg-info/10 border-0"
            />
          </div>

          {/* المطالبة المرتبطة */}
          {linkedClaim && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/insurance/${linkedClaim.id}`)}
              className="h-9 gap-1.5 border-info/40 text-info hover:bg-info/10"
              title="فتح مطالبة التأمين المرتبطة"
            >
              <ShieldCheck size={14} />
              المطالبة <span className="font-mono text-[11px]">{linkedClaim.claim_number}</span>
            </Button>
          )}

          {/* المجموعة 3: الفواتير والطباعة */}
          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={
                    linkedInvoice
                      ? "h-9 gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                      : "h-9 gap-1.5 border-success/40 text-success hover:bg-success/10"
                  }
                >
                  {linkedInvoice ? <Receipt size={14} /> : <FilePlus2 size={14} />}
                  {linkedInvoice ? `الفاتورة ${linkedInvoice.number}` : "فاتورة"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {linkedInvoice && (
                  <>
                    <DropdownMenuLabel className="text-xs flex items-center justify-between">
                      <span>الفاتورة المرتبطة</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusLabel(linkedInvoice.status).cls}`}>
                        {statusLabel(linkedInvoice.status).ar}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/invoices/${linkedInvoice.id}`)}
                      className="gap-2"
                    >
                      <Eye size={14} className="text-info" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">عرض الفاتورة</span>
                        <span className="text-[10px] text-muted-foreground">
                          إجمالي: {linkedInvoice.total.toFixed(3)} — متبقي: {linkedInvoice.balanceDue.toFixed(3)}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/invoices/${linkedInvoice.id}/edit`)}
                      className="gap-2"
                    >
                      <Edit size={14} className="text-warning" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">تعديل الفاتورة</span>
                        <span className="text-[10px] text-muted-foreground">
                          تعديل البنود والمدفوعات والإعدادات
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuLabel className="text-xs">
                  {linkedInvoice ? "إنشاء فاتورة إضافية" : "اختر نوع الفاتورة"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => navigate(`/sales/invoices/new?fromWorkOrder=${order.id}`)}
                  className="gap-2"
                >
                  <User size={14} className="text-primary" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">فاتورة عميل {linkedInvoice ? "جديدة" : ""}</span>
                    <span className="text-[10px] text-muted-foreground">فاتورة بيع للزبون مباشرة</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!order.claimNumber || order.claimNumber === "-"}
                  onClick={() => {
                    if (!order.claimNumber || order.claimNumber === "-") {
                      toast.error("لا توجد مطالبة تأمين مرتبطة بهذا الأمر");
                      return;
                    }
                    navigate(`/insurance/list?q=${encodeURIComponent(order.claimNumber)}`);
                    toast.info("افتح المطالبة ثم اضغط 'فاتورة ضريبية للتأمين' لإصدارها بالقالب الرسمي");
                  }}
                  className="gap-2"
                >
                  <ShieldCheck size={14} className="text-info" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">فاتورة تأمينية</span>
                    <span className="text-[10px] text-muted-foreground">
                      {order.claimNumber && order.claimNumber !== "-"
                        ? `بقالب التأمين الرسمي + رقم المطالبة + LPO`
                        : "يحتاج ربط أمر العمل بمطالبة تأمين"}
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* عرض السعر */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={
                    linkedQuote
                      ? "h-9 gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                      : "h-9 gap-1.5 border-info/40 text-info hover:bg-info/10"
                  }
                >
                  <FileText size={14} />
                  {linkedQuote ? `العرض ${linkedQuote.number}` : "عرض سعر"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {linkedQuote && (
                  <>
                    <DropdownMenuLabel className="text-xs flex items-center justify-between">
                      <span>عرض السعر المرتبط</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusLabel(linkedQuote.status).cls}`}>
                        {statusLabel(linkedQuote.status).ar}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/quotes/${linkedQuote.id}`)}
                      className="gap-2"
                    >
                      <Eye size={14} className="text-info" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">عرض</span>
                        <span className="text-[10px] text-muted-foreground">
                          إجمالي: {linkedQuote.total.toFixed(3)}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/quotes/${linkedQuote.id}/edit`)}
                      className="gap-2"
                    >
                      <Edit size={14} className="text-warning" /> <span className="text-sm font-semibold">تعديل</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={linkedQuote.status === "converted"}
                      onClick={() => {
                        const inv = salesStore.convertToInvoice(linkedQuote.id);
                        if (inv) {
                          toast.success(`تم التحويل إلى فاتورة ${inv.number}`);
                          navigate(`/sales/invoices/${inv.id}`);
                        } else {
                          toast.error("تعذّر التحويل");
                        }
                      }}
                      className="gap-2"
                    >
                      <Receipt size={14} className="text-success" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">تحويل إلى فاتورة</span>
                        <span className="text-[10px] text-muted-foreground">
                          {linkedQuote.status === "converted" ? "تم التحويل مسبقاً" : "إنشاء فاتورة من بنود العرض"}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={() => navigate(`/sales/quotes/new?fromWorkOrder=${order.id}`)}
                  className="gap-2"
                >
                  <FilePlus2 size={14} className="text-primary" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{linkedQuote ? "عرض سعر إضافي" : "إنشاء عرض سعر"}</span>
                    <span className="text-[10px] text-muted-foreground">يجلب بيانات أمر العمل تلقائياً</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>


            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 gap-1.5 border-warning/40 text-warning hover:bg-warning/10">
                  <Package size={14} /> طلب شراء
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 space-y-3" align="end">
                <div>
                  <Label className="text-xs">تاريخ الطلب</Label>
                  <Input
                    type="date"
                    value={partsRequestDate}
                    onChange={(e) => setPartsRequestDate(e.target.value)}
                    className="h-9 mt-1"
                  />
                </div>
                <Button
                  onClick={handlePrintNeededParts}
                  className="w-full gradient-gold text-primary-foreground gap-1"
                  size="sm"
                >
                  <Printer size={14} /> معاينة وطباعة
                </Button>
              </PopoverContent>
            </Popover>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeliveryReceiptOpen(true)}
              className="h-9 gap-1.5 border-success/40 text-success hover:bg-success/10"
            >
              <FileText size={14} /> إقرار استلام
            </Button>

            <Button
              size="sm"
              onClick={handlePrintWorkOrder}
              className="h-9 gap-1.5 gradient-gold text-primary-foreground shadow-sm"
            >
              <Printer size={14} /> طباعة الأمر
            </Button>
          </div>

          {/* المجموعة 4: الإجراء الخطر */}
          {allowDelete && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={14} /> حذف
            </Button>
          )}
        </div>
      </div>

      {/* (دُمج زر الإرسال داخل نافذة تحديث الحالة) */}



      <div
        data-testid="work-order-control-center"
        className="rounded-2xl border border-border bg-card/95 shadow-sm overflow-hidden"
      >
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-4 sm:p-5 border-b lg:border-b-0 lg:border-l border-border bg-gradient-to-br from-primary/10 via-card to-secondary/40">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    {resolveWorkOrderType(order) === "insurance" ? <ShieldCheck size={20} /> : <Car size={20} />}
                  </span>
                  <div>
                    <p className="text-[11px] text-muted-foreground">مركز تحكم أمر العمل</p>
                    <h2 className="text-lg sm:text-xl font-bold text-foreground font-mono">{displayNo}</h2>
                  </div>
                  <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${statusColors[order.status] || "bg-muted text-muted-foreground"}`}>
                    {order.status}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {order.customer} · {order.vehicleType} {order.model} · <span className="font-mono">{order.plate}</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 min-w-[180px]">
                <div className="rounded-xl border border-border bg-card/75 p-3">
                  <p className="text-[10px] text-muted-foreground">التكلفة</p>
                  <p className="text-sm font-bold text-primary">{order.totalCost.toLocaleString()} ر.ع</p>
                </div>
                <div className="rounded-xl border border-border bg-card/75 p-3">
                  <p className="text-[10px] text-muted-foreground">القطع المفتوحة</p>
                  <p className="text-sm font-bold text-warning">{(order.partsNeeded || []).filter(isPartStillNeeded).length}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Button onClick={() => { setWaTab("templates"); setWaOpen(true); }} className="h-11 gap-2 bg-success text-success-foreground hover:bg-success/90">
                <MessageCircle size={16} /> واتساب
              </Button>
              <Button variant="outline" onClick={() => { statusDirtyRef.current = true; setStatusOpen(true); }} className="h-11 gap-2">
                <Workflow size={16} /> الحالة
              </Button>
              <Button variant="outline" onClick={() => { photoDirtyRef.current = true; setPhotosOpen(true); }} className="h-11 gap-2">
                <Camera size={16} /> الصور
              </Button>
              <Button onClick={handlePrintWorkOrder} className="h-11 gap-2 gradient-gold text-primary-foreground">
                <Printer size={16} /> PDF / طباعة
              </Button>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setQrOpen(true)} className="rounded-xl border border-border bg-secondary/25 p-3 text-right hover:border-primary/40 transition-colors">
                <QrCode size={16} className="text-primary mb-2" />
                <p className="text-xs font-semibold text-foreground">QR العميل</p>
                <p className="text-[10px] text-muted-foreground">متابعة وتوقيع</p>
              </button>
              <button type="button" onClick={() => setExpenseOpen(true)} className="rounded-xl border border-border bg-secondary/25 p-3 text-right hover:border-warning/40 transition-colors">
                <Receipt size={16} className="text-warning mb-2" />
                <p className="text-xs font-semibold text-foreground">مصروف</p>
                <p className="text-[10px] text-muted-foreground">سحب / نقل / خارجي</p>
              </button>
              <button type="button" onClick={() => navigate(`/sales/invoices/new?fromWorkOrder=${order.id}`)} className="rounded-xl border border-border bg-secondary/25 p-3 text-right hover:border-success/40 transition-colors">
                <FilePlus2 size={16} className="text-success mb-2" />
                <p className="text-xs font-semibold text-foreground">فاتورة</p>
                <p className="text-[10px] text-muted-foreground">{linkedInvoice ? linkedInvoice.number : "إنشاء جديدة"}</p>
              </button>
              <button type="button" onClick={() => navigate(`/sales/quotes/new?fromWorkOrder=${order.id}`)} className="rounded-xl border border-border bg-secondary/25 p-3 text-right hover:border-info/40 transition-colors">
                <FileText size={16} className="text-info mb-2" />
                <p className="text-xs font-semibold text-foreground">عرض سعر</p>
                <p className="text-[10px] text-muted-foreground">{linkedQuote ? linkedQuote.number : "إنشاء / متابعة"}</p>
              </button>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
                <span>تقدم العمل</span>
                <span>{Math.max(currentIdx + 1, 1)} / {WORK_ORDER_STATUSES.length}</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.max(((currentIdx + 1) / WORK_ORDER_STATUSES.length) * 100, 8)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status timeline */}
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground mb-3">مسار الإصلاح</p>
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
          {WORK_ORDER_STATUSES.map((s, i) => (
            <div key={s} className="flex items-center gap-1 min-w-fit">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  i <= currentIdx ? "gradient-gold text-primary-foreground" : "bg-secondary text-muted-foreground"
                }`}
              >
                {i + 1}
              </div>
              <span
                className={`text-[11px] whitespace-nowrap ${
                  i === currentIdx ? "text-primary font-semibold" : "text-muted-foreground"
                }`}
              >
                {s}
              </span>
              {i < WORK_ORDER_STATUSES.length - 1 && (
                <div className={`w-5 h-0.5 ${i < currentIdx ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Section icon={<User size={14} />} title="العميل">
          <Row label="الاسم" value={order.customer} />
          <Row label="الهاتف" value={order.phone} mono />
        </Section>
        <Section icon={<Car size={14} />} title="السيارة">
          <Row label="النوع" value={`${order.vehicleType} ${order.model} ${order.year}`} />
          <Row label="اللوحة" value={order.plate} mono />
          <Row label="رقم الهيكل" value={order.vin || "-"} mono />
          <Row label="اللون" value={order.color || "-"} />
          <Row label="الكيلومترات" value={order.mileage ? `${order.mileage} كم` : "-"} />
        </Section>
        <Section icon={<Wrench size={14} />} title="العمل">
          <Row label="نوع الخدمة" value={order.serviceType} />
          <Row label="الفني" value={order.technician || "-"} />
          <Row label="تاريخ الدخول" value={order.entryDate} />
        </Section>
        <Section icon={<ShieldCheck size={14} />} title="التأمين والتكلفة">
          <Row label="شركة التأمين" value={order.insurance} />
          <Row label="رقم المطالبة" value={order.claimNumber} mono />
          <Row label="أجور العمالة" value={`${(order.laborCost ?? 0).toLocaleString()} ر.ع`} amount />
          <Row label="قطع الغيار" value={`${(order.partsCost ?? 0).toLocaleString()} ر.ع`} amount />
          <Row label="الإجمالي" value={`${order.totalCost.toLocaleString()} ر.ع`} highlight amount />
        </Section>
      </div>

      {order.diagnosis && (
        <div className="bg-secondary/30 border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">التشخيص / ملاحظات</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{order.diagnosis}</p>
        </div>
      )}

      {/* Needed parts — standalone manager (independent additions) */}
      <NeededPartsManager
        order={order}
        onPrintRequest={handlePrintNeededParts}
        onSendWhatsApp={() => { setWaTab("templates"); setWaOpen(true); }}
        onSendToSuppliers={() => { setWaTab("suppliers"); setWaOpen(true); }}
        onConvertToExpense={(part) => {
          if (part.convertedToExpense) {
            toast.error("هذه القطعة محولة إلى مصروف مسبقاً");
            return;
          }
          setConvertPart(part);
        }}
        onOpenExpense={(expenseId) => {
          const rec = expensesStore.getById(expenseId);
          if (rec) setPreviewExpense(rec);
          else toast.error("لم يتم العثور على المصروف المرتبط");
        }}
        allowEdit={allowEdit}
      />

      {/* Customer-facing tracking portal link (safe — no financials) */}
      {cloudJobOrderId && (
        <div className="space-y-2">
          <CustomerPortalLink
            jobOrderId={cloudJobOrderId}
            customerPhone={order.phone}
            orderNumber={order.id}
            localOrderId={order.id}
            customerName={order.customer}
          />
          <SmartCustomerSendBar
            jobOrderId={cloudJobOrderId}
            orderNumber={displayNo}
            status={order.status}
            customerName={order.customer}
            customerPhone={order.phone}
          />
          <div className="flex justify-end">
            <SendStageNotificationButton jobOrderId={cloudJobOrderId} status={order.status} />
          </div>
        </div>
      )}

      {/* ملاحظات العملاء من بوابة QR تظهر الآن في صفحة /messages "المراسلات" */}

      {/* Supplements — additional work requiring customer approval (placed directly under needed parts) */}
      {cloudJobOrderId ? (
        <SupplementsSection
          jobOrderId={cloudJobOrderId}
          customerName={order.customer}
          customerPhone={order.phone}
        />
      ) : (
        <div className="bg-card border border-dashed border-border rounded-xl p-4 text-center text-xs text-muted-foreground">
          الأعمال الإضافية ورابط موافقة العميل غير متاحة — هذا الأمر غير مزامن مع السحابة بعد.
        </div>
      )}

      {/* Approval history (customer signature log) */}
      {cloudJobOrderId && <ApprovalHistoryTab jobOrderId={cloudJobOrderId} />}

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ImageIcon size={16} className="text-primary" />
            صور المراحل
            <span className="text-[10px] text-muted-foreground font-normal">({photos.length} صورة)</span>
          </h2>
          <Button size="sm" variant="outline" onClick={() => setPhotosOpen(true)} className="gap-1 h-8">
            <Camera size={12} /> إدارة الصور
          </Button>
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">لا توجد صور</p>
        ) : (
          <div className="space-y-4">
            {PHASES.map((phase) => {
              const phasePhotos = photos.filter((p) => p.phase === phase);
              if (phasePhotos.length === 0) return null;
              return (
                <div key={phase}>
                  <p className="text-xs font-semibold text-primary mb-2 border-r-2 border-primary pr-2">
                    {STAGE_LABELS[phase].ar} · {STAGE_LABELS[phase].en}
                    <span className="text-[10px] text-muted-foreground font-normal mr-2">
                      ({phasePhotos.length})
                    </span>
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {phasePhotos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setLightboxUrl(p.dataUrl)}
                        className="relative group rounded-lg overflow-hidden border border-border bg-secondary/30 hover:border-primary/40 transition-all"
                      >
                        <img
                          src={p.dataUrl}
                          alt={p.caption || ""}
                          className="w-full aspect-square object-cover group-hover:scale-105 transition-transform bg-muted"
                          loading="lazy"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = "none";
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = "flex";
                          }}
                        />
                        <div
                          className="absolute inset-0 hidden items-center justify-center bg-muted text-muted-foreground text-[10px] flex-col gap-1"
                          style={{ display: "none" }}
                        >
                          <span>⚠️</span>
                          <span>صورة مفقودة</span>
                        </div>
                        {p.caption && (
                          <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[9px] p-1 truncate">
                            {p.caption}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inspections + Vouchers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <SearchIcon size={16} className="text-primary" />
              الفحوصات المرتبطة
              <span className="text-[10px] text-muted-foreground font-normal">({inspections.length})</span>
            </h2>
            <Button size="sm" variant="outline" onClick={openNewInspection} className="gap-1 h-8">
              <FilePlus2 size={12} /> فحص جديد
            </Button>
          </div>
          {inspections.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">لا توجد فحوصات</p>
          ) : (
            <ul className="space-y-1.5">
              {inspections.map((ins) => (
                <li
                  key={ins.id}
                  className="flex items-center justify-between text-xs bg-secondary/30 border border-border/50 rounded px-3 py-2"
                >
                  <div>
                    <span className="font-mono text-primary">{ins.id}</span>
                    <span className="text-muted-foreground mr-2">— {ins.damageType}</span>
                  </div>
                  <span className="text-muted-foreground">{ins.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Receipt size={16} className="text-warning" />
              سندات الصرف المرتبطة
              <span className="text-[10px] text-muted-foreground font-normal">({linkedVouchers.length})</span>
            </h2>
            <span className="text-xs font-bold text-warning">
              {vouchersTotal.toLocaleString()} ر.ع
            </span>
          </div>
          {linkedVouchers.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">لا توجد سندات</p>
          ) : (
            <>
              {/* شريط التحديد + الإجراءات */}
              <div className="flex items-center justify-between gap-2 mb-2 bg-secondary/40 border border-border/50 rounded px-2 py-1.5">
                <label className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
                  <Checkbox
                    checked={selectedExpenseIds.size === linkedVouchers.length && linkedVouchers.length > 0}
                    onCheckedChange={(v) => {
                      setSelectedExpenseIds(v ? new Set(linkedVouchers.map((x) => x.id)) : new Set());
                    }}
                  />
                  تحديد الكل
                  {selectedExpenseIds.size > 0 && (
                    <span className="text-[10px] text-muted-foreground">({selectedExpenseIds.size} محددة)</span>
                  )}
                </label>
                {allowDelete && selectedExpenseIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-[11px] text-destructive hover:bg-destructive/10"
                    onClick={async () => {
                      if (!confirm(`حذف ${selectedExpenseIds.size} سند صرف؟`)) return;
                      const ids = Array.from(selectedExpenseIds);
                      for (const eid of ids) {
                        await expensesStore.remove(eid);
                      }
                      setSelectedExpenseIds(new Set());
                      toast.success(`تم حذف ${ids.length} سند`);
                    }}
                  >
                    <Trash2 size={12} /> حذف المحدد
                  </Button>
                )}
              </div>
              <ul className="space-y-1.5">
                {linkedVouchers.map((v) => {
                  const expenseLabel =
                    v.partName ||
                    v.description ||
                    v.beneficiary ||
                    v.categoryName ||
                    "—";
                  const checked = selectedExpenseIds.has(v.id);
                  return (
                    <li key={v.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          setSelectedExpenseIds((prev) => {
                            const next = new Set(prev);
                            if (c) next.add(v.id);
                            else next.delete(v.id);
                            return next;
                          });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setPreviewExpense(v)}
                        title="اضغط لمعاينة سند الصرف"
                        className="flex-1 text-right flex items-center justify-between text-xs bg-secondary/30 hover:bg-secondary/60 border border-border/50 hover:border-info/40 rounded px-3 py-2 transition-colors cursor-pointer"
                      >
                        <div className="flex flex-col items-start min-w-0">
                          <span className="font-mono text-info">{v.voucherNumber}</span>
                          <span className="text-foreground text-[11px] font-medium truncate max-w-[200px]">
                            {expenseLabel}
                          </span>
                          {v.categoryName && expenseLabel !== v.categoryName && (
                            <span className="text-muted-foreground text-[9px]">{v.categoryName}</span>
                          )}
                        </div>
                        <span className="font-semibold text-foreground shrink-0">
                          {Number(v.amount).toLocaleString()} ر.ع
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle>تعديل أمر العمل {displayNo}</DialogTitle>
          </DialogHeader>
          <WorkOrderForm initial={order} onClose={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>

      <WorkOrderStatusDialog order={statusOpen ? order : null} open={statusOpen} onOpenChange={setStatusOpen} cloudJobOrderId={cloudJobOrderId} />
      <StagePhotosDialog
        orderId={photosOpen ? order.id : null}
        open={photosOpen}
        onClose={() => setPhotosOpen(false)}
      />
      <WorkOrderBulkExpenseDialog
        order={expenseOpen ? order : null}
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
      />
      <WorkOrderExpenseDialog
        order={convertPart ? order : null}
        open={!!convertPart}
        onOpenChange={(open) => !open && setConvertPart(null)}
        initialRequiredPart={convertPart}
        onExpenseSaved={(expense) => {
          if (!convertPart) return;
          updateNeededPartInOrder(order.id, convertPart.id, {
            convertedToExpense: true,
            convertedExpenseId: expense.id,
            convertedAt: new Date().toISOString(),
            status: "secured",
          });
          toast.success("تم تحويل قطعة الغيار إلى مصروف وربطها بأمر العمل");
          setConvertPart(null);
        }}
      />
      <ExpensePreviewDialog
        expense={previewExpense}
        open={!!previewExpense}
        onOpenChange={(o) => !o && setPreviewExpense(null)}
      />
      <QrLabel order={qrOpen ? order : null} open={qrOpen} onClose={() => setQrOpen(false)} />
      <WhatsAppCenter
        order={waOpen ? order : null}
        open={waOpen}
        onOpenChange={setWaOpen}
        defaultTab={waTab}
      />
      <PdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        htmlContent={previewHtml}
        title={previewTitle}
      />

      <VehicleDeliveryReceiptDialog
        open={deliveryReceiptOpen}
        onOpenChange={setDeliveryReceiptOpen}
        order={order}
      />

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`حذف أمر العمل ${displayNo}`}
        description={`سيتم نقل أمر العمل الخاص بـ "${order.customer}" إلى سلة المهملات.`}
        onConfirm={async () => {
          try {
            await archiveWorkOrder(order, "Archive Work Order Only");
          } catch (error: any) {
            toast.error(error?.message || "فشل حذف/أرشفة أمر العمل في Supabase");
            return;
          }
          const removed = deleteWorkOrder(order.id);
          if (removed) {
            moveToTrash({
              type: "work_order",
              entityId: removed.id,
              label: `${removed.customer} - ${removed.plate}`,
              payload: removed,
            });
            logActivity({
              action: "delete",
              entity: "work_order",
              entityId: removed.id,
              label: `أمر عمل ${removed.customer} - ${removed.plate}`,
              description: `نقل لسلة المهملات`,
              amount: removed.totalCost,
            });
            toast.success(`تم نقل ${removed.id} للمهملات`);
            navigate("/work-orders");
          }
        }}
      />

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={(o) => !o && setLightboxUrl(null)}>
        <DialogContent className="max-w-4xl bg-card border-border p-2">
          {lightboxUrl && (
            <img src={lightboxUrl} alt="" className="w-full h-auto max-h-[85vh] object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <p className="text-xs font-semibold text-primary mb-2 flex items-center gap-1.5 border-r-2 border-primary pr-2">
        {icon}
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  highlight,
  amount,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  amount?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span
        className={`${mono ? "font-mono" : ""} ${
          highlight ? "text-primary font-bold" : "text-foreground"
        } text-left`}
        {...(amount ? { "data-amount": "true" } : {})}
      >
        {value}
      </span>
    </div>
  );
}
