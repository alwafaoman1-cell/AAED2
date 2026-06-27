import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Search, Filter, Eye, Edit, Printer, Car, FileText, Workflow, QrCode, Camera, Trash2, MoreHorizontal, Search as SearchIcon, Receipt, FilePlus2, FolderOpen, Package, MessageCircle, Shield, Copy, FileSpreadsheet, FilePlus, Phone, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getWorkOrderHtml, getNeededPartsRequestHtml } from "@/lib/pdfGenerator";
import { toEnglishDigits, formatPlateLatin } from "@/lib/numberUtils";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import WorkOrderStatusDialog from "@/components/workorders/WorkOrderStatusDialog";
import QrLabel from "@/components/workorders/QrLabel";
import StagePhotosDialog from "@/components/workorders/StagePhotosDialog";
import WorkOrderForm from "@/components/workorders/WorkOrderForm";
import WorkOrderExpenseDialog from "@/components/workorders/WorkOrderExpenseDialog";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import {
  deleteWorkOrder,
  getWorkOrders,
  subscribeWorkOrders,
  updateWorkOrder,
  WORK_ORDER_STATUSES,
  isPartStillNeeded,
  type WorkOrder,
} from "@/lib/workOrdersStore";
import { staffStore } from "@/lib/staffStore";
import { buildPartsRequestMessage, sendWhatsAppAndLog } from "@/lib/partsWhatsApp";
import { inspectionsStore } from "@/lib/inspectionsStore";
import { moveToTrash } from "@/lib/trashStore";
import { canDelete, canEdit } from "@/lib/permissions";
import { logActivity } from "@/lib/auditLogStore";
import { toast } from "sonner";
import {
  archiveWorkOrder,
  deleteWorkOrderKeepFinancial,
  deleteWorkOrderWithRelated,
  getWorkOrderImpact,
  type DeleteMode,
  type ImpactSummary,
} from "@/lib/deletePolicy";
import { computeDays, durationLevel } from "@/lib/claimDurationStatus";
import { usePersistedState } from "@/hooks/usePersistedState";
import { TablePaginationControls } from "@/components/ui/table-pagination-controls";
import WorkOrderTypeBadge from "@/components/workorders/WorkOrderTypeBadge";
import { isInsuranceWorkOrder, resolveWorkOrderType } from "@/lib/workOrderType";

const DURATION_BAR_HEX: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "",
};
const DURATION_BAR_TINT: Record<string, string> = {
  red: "rgba(239,68,68,0.08)",
  orange: "rgba(249,115,22,0.07)",
  yellow: "rgba(234,179,8,0.06)",
  green: "",
};
const CLOSED_STATUSES = new Set(["تم التسليم", "مغلق"]);

function getOrderDelayStyle(order: WorkOrder): { boxShadow?: string; backgroundColor?: string; days: number | null; level: string } {
  if (CLOSED_STATUSES.has(order.status)) return { days: null, level: "green" };
  const days = computeDays(order.entryDate);
  const level = durationLevel(days);
  if (level === "green") return { days, level };
  return {
    boxShadow: `inset 4px 0 0 ${DURATION_BAR_HEX[level]}`,
    backgroundColor: DURATION_BAR_TINT[level],
    days,
    level,
  };
}

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

const STATUS_GROUPS: Record<string, string[]> = {
  repair: ["تحت الإصلاح", "تحت الفحص"],
  waiting: ["بانتظار الموافقة", "بانتظار قطع الغيار"],
  ready: ["جاهز للتسليم"],
  delivered: ["تم التسليم", "مغلق"],
};

const hasOrderValue = (value?: string) => !!(value && value.trim() !== "" && value.trim() !== "-");
const isInsuranceOrder = (order: WorkOrder) => isInsuranceWorkOrder(order);

function insuranceReason(order: WorkOrder) {
  if (hasOrderValue(order.insurance)) return order.insurance;
  if (hasOrderValue(order.claimNumber)) return `مطالبة ${order.claimNumber}`;
  if ((order.serviceType || "").trim() === "حادث") return "حادث";
  return "";
}


function buildWorkOrderHtml(order: WorkOrder) {
  return getWorkOrderHtml({
    orderNumber: order.id, date: order.entryDate, customerName: order.customer,
    workOrderType: resolveWorkOrderType(order), trackingToken: order.trackingToken,
    customerPhone: order.phone, vehicleType: order.vehicleType, model: order.model,
    year: order.year, plateNumber: order.plate, vin: order.vin, insurance: order.insurance,
    claimNumber: order.claimNumber, serviceType: order.serviceType, technician: order.technician,
    status: order.status, totalCost: order.totalCost,
    description: order.diagnosis,
    color: order.color, mileage: order.mileage,
    laborCost: order.laborCost, partsCost: order.partsCost,
    extraExpenses: order.extraExpenses,
    depositApplied: order.depositApplied,
    photos: (order.photos || []).map(p => ({ phase: p.phase, dataUrl: p.dataUrl, caption: p.caption })),
  });
}

export default function WorkOrders() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<WorkOrder[]>(getWorkOrders());
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [entryFrom, setEntryFrom] = useState("");
  const [entryTo, setEntryTo] = useState("");
  const [archiveFilter, setArchiveFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editOrder, setEditOrder] = useState<WorkOrder | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [statusOrder, setStatusOrder] = useState<WorkOrder | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [qrOrder, setQrOrder] = useState<WorkOrder | null>(null);
  const [photosOrderId, setPhotosOrderId] = useState<string | null>(null);
  const [deleteOrder, setDeleteOrder] = useState<WorkOrder | null>(null);
  const [expenseOrder, setExpenseOrder] = useState<WorkOrder | null>(null);
  const [partsOnlyFilter, setPartsOnlyFilter] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedState<number>("work_orders_page_size", 20);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("archive_only");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteImpact, setDeleteImpact] = useState<ImpactSummary | null>(null);
  const allowEdit = canEdit();
  const allowDelete = canDelete();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("parts") === "1") setPartsOnlyFilter(true);
  }, [searchParams]);

  useEffect(() => {
    return subscribeWorkOrders(() => setOrders([...getWorkOrders()]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDeleteImpact(null);
    if (!deleteOrder) return;
    void getWorkOrderImpact(deleteOrder).then((impact) => {
      if (!cancelled) setDeleteImpact(impact);
    }).catch((error) => {
      if (!cancelled) toast.error(error?.message || "تعذر فحص المتعلقات");
    });
    return () => { cancelled = true; };
  }, [deleteOrder]);

  // عدد الفحوصات المرتبطة بكل أمر عمل
  const inspectionsByOrder: Record<string, number> = (() => {
    const map: Record<string, number> = {};
    inspectionsStore.getAll().forEach((i) => {
      map[i.workOrder] = (map[i.workOrder] || 0) + 1;
    });
    return map;
  })();

  // فتح فحص جديد مع تمرير ID أمر العمل (يلتقطه /inspection)
  const openNewInspection = (order: WorkOrder) => {
    sessionStorage.setItem("inspection_link_order", order.id);
    navigate("/inspection?new=1");
    toast.success(`فتح فحص جديد لأمر العمل ${order.id}`);
  };

  // فتح صفحة الفحص مع فلترة على رقم الأمر
  const openExistingInspections = (order: WorkOrder) => {
    navigate(`/inspection?wo=${encodeURIComponent(order.id)}`);
  };

  const filtered = orders.filter((o) => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesSearch = !normalizedSearch || [
      o.customer, o.plate, o.id, o.phone, o.claimNumber, o.insurance, o.technician,
    ].some((value) => (value || "").toLowerCase().includes(normalizedSearch));
    const statusGroup = STATUS_GROUPS[statusFilter];
    const delay = getOrderDelayStyle(o);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "overdue"
        ? delay.days !== null && delay.level !== "green"
        : (statusGroup ? statusGroup.includes(o.status) : o.status === statusFilter));
    const matchesOwnership = ownershipFilter === "all" || (ownershipFilter === "insurance" ? isInsuranceOrder(o) : !isInsuranceOrder(o));
    const matchesParts = !partsOnlyFilter || (o.partsNeeded && o.partsNeeded.some(isPartStillNeeded));
    const matchesTechnician = technicianFilter === "all" || o.technician === technicianFilter;
    const matchesEntryFrom = !entryFrom || (o.entryDate || "") >= entryFrom;
    const matchesEntryTo = !entryTo || (o.entryDate || "") <= entryTo;
    const matchesArchive = archiveFilter === "all" || (archiveFilter === "archived" ? !!o.archivedAt : !o.archivedAt);
    return matchesSearch && matchesStatus && matchesOwnership && matchesParts && matchesTechnician && matchesEntryFrom && matchesEntryTo && matchesArchive;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedOrders = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, ownershipFilter, technicianFilter, entryFrom, entryTo, archiveFilter, partsOnlyFilter, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // الأوامر التي تحتاج قطع غيار (لأي زر طباعة جماعي)
  const ordersNeedingParts = orders.filter(o => (o.partsNeeded || []).some(isPartStillNeeded));

  async function handlePreview(order: WorkOrder) {
    const { buildTrackingQrDataUrl } = await import("@/lib/pdfGenerator");
    await buildTrackingQrDataUrl(order.trackingToken);
    setPreviewHtml(buildWorkOrderHtml(order));
    setPreviewTitle(`أمر عمل ${order.id}`);
    setShowPreview(true);
  }

  async function handlePrintAllFiltered() {
    if (filtered.length === 0) {
      toast.error("لا توجد أوامر للطباعة");
      return;
    }
    const { buildTrackingQrDataUrl } = await import("@/lib/pdfGenerator");
    // Pre-build QR for every order in the batch
    await Promise.all(filtered.map(o => buildTrackingQrDataUrl(o.trackingToken)));
    // Print stack: each order on its own page
    const combined = filtered.map(o => {
      const html = buildWorkOrderHtml(o);
      // Extract body content only
      const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
      return match ? match[1] : html;
    }).join('<div style="page-break-after:always"></div>');
    const wrapper = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>طباعة جماعية</title>${
      buildWorkOrderHtml(filtered[0]).match(/<style>[\s\S]*?<\/style>/)?.[0] || ''
    }</head><body>${combined}</body></html>`;
    setPreviewHtml(wrapper);
    setPreviewTitle(`طباعة ${filtered.length} أمر عمل`);
    setShowPreview(true);
  }

  function openStatus(order: WorkOrder) {
    setStatusOrder(order);
    setShowStatus(true);
  }

  function handlePrintAllNeededParts() {
    if (ordersNeedingParts.length === 0) {
      toast.error("لا توجد سيارات تحتاج قطع غيار");
      return;
    }
    const html = getNeededPartsRequestHtml({
      requestNumber: `PR-ALL-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().slice(0, 10),
      rows: ordersNeedingParts.map((o) => ({
        workOrderId: o.id,
        customer: o.customer,
        vehicle: `${o.vehicleType} ${o.model} ${o.year}`.trim(),
        vehicleType: `${o.vehicleType} ${o.model}`.trim(),
        year: o.year,
        vin: o.vin,
        plate: o.plate,
        parts: (o.partsNeeded || []).map((p) => ({
          name: p.name,
          quantity: p.quantity,
          notes: p.notes,
          fulfilled: p.fulfilled,
        })),
      })),
    });
    setPreviewHtml(html);
    setPreviewTitle(`طلب قطع غيار — ${ordersNeedingParts.length} سيارة`);
    setShowPreview(true);
  }

  // Stats
  const inProgress = orders.filter(o => o.status === "تحت الإصلاح" || o.status === "تحت الفحص").length;
  const ready = orders.filter(o => o.status === "جاهز للتسليم").length;
  const waiting = orders.filter(o => o.status === "بانتظار الموافقة" || o.status === "بانتظار قطع الغيار").length;
  const insuranceCount = orders.filter(isInsuranceOrder).length;
  const cashCount = orders.length - insuranceCount;
  const delivered = orders.filter(o => o.status === "تم التسليم" || o.status === "مغلق").length;
  const overdue = orders.filter(o => {
    const delay = getOrderDelayStyle(o);
    return delay.days !== null && delay.level !== "green";
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("workOrders.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("workOrders.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={partsOnlyFilter ? "default" : "outline"}
            onClick={() => setPartsOnlyFilter((v) => !v)}
            className={`gap-1.5 h-9 ${partsOnlyFilter ? "bg-info text-info-foreground hover:bg-info/90" : "border-info/40 text-info hover:bg-info/10"}`}
          >
            <Package size={14} /> تحتاج قطع
            <span className="text-[10px] bg-background/20 rounded-full px-1.5 py-0.5">{ordersNeedingParts.length}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrintAllNeededParts}
            disabled={ordersNeedingParts.length === 0}
            className="h-9 gap-1.5 border-warning/40 text-warning hover:bg-warning/10 disabled:opacity-50"
          >
            <Printer size={14} /> طلب القطع
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (ordersNeedingParts.length === 0) {
                toast.error("لا توجد سيارات تحتاج قطع غيار");
                return;
              }
              toast.info("استخدم مركز واتساب داخل كل أمر عمل لاختيار المستلم وتسجيل الربط الكامل");
            }}
            disabled={ordersNeedingParts.length === 0}
            className="h-9 gap-1.5 border-success/40 text-success hover:bg-success/10 disabled:opacity-50"
          >
            <MessageCircle size={14} /> واتساب
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrintAllFiltered} className="h-9 gap-1.5 border-border text-foreground">
            <Printer size={14} /> طباعة الكل ({filtered.length})
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("/work-orders/new")}
            className="h-9 gap-1.5 gradient-gold text-primary-foreground shadow-gold hover:opacity-90"
          >
            <Plus size={16} /> {t("workOrders.newOrder")}
          </Button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`text-right bg-card border rounded-xl p-3 transition-all hover:shadow-md hover:-translate-y-0.5 ${statusFilter === "all" ? "border-primary/50 shadow-gold" : "border-border hover:border-primary/30"}`}
        >
          <p className="text-[10px] text-muted-foreground">إجمالي</p>
          <p className="text-lg font-bold text-foreground">{orders.length}</p>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("repair")}
          className={`text-right bg-card border rounded-xl p-3 transition-all hover:shadow-md hover:-translate-y-0.5 ${statusFilter === "repair" ? "border-warning/60" : "border-border hover:border-warning/40"}`}
        >
          <p className="text-[10px] text-muted-foreground">قيد الإصلاح</p>
          <p className="text-lg font-bold text-warning">{inProgress}</p>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("waiting")}
          className={`text-right bg-card border rounded-xl p-3 transition-all hover:shadow-md hover:-translate-y-0.5 ${statusFilter === "waiting" ? "border-info/60" : "border-border hover:border-info/40"}`}
        >
          <p className="text-[10px] text-muted-foreground">انتظار</p>
          <p className="text-lg font-bold text-info">{waiting}</p>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("ready")}
          className={`text-right bg-card border rounded-xl p-3 transition-all hover:shadow-md hover:-translate-y-0.5 ${statusFilter === "ready" ? "border-success/60" : "border-border hover:border-success/40"}`}
        >
          <p className="text-[10px] text-muted-foreground">جاهز للتسليم</p>
          <p className="text-lg font-bold text-success">{ready}</p>
        </button>
        <button type="button" onClick={() => setStatusFilter("بانتظار قطع الغيار")} className="text-right bg-card border border-border rounded-xl p-3 transition-all hover:border-warning/40">
          <p className="text-[10px] text-muted-foreground">بانتظار القطع</p>
          <p className="text-lg font-bold text-warning">{orders.filter(o => o.status === "بانتظار قطع الغيار").length}</p>
        </button>
        <button type="button" onClick={() => setStatusFilter("delivered")} className="text-right bg-card border border-border rounded-xl p-3 transition-all hover:border-success/40">
          <p className="text-[10px] text-muted-foreground">تم التسليم</p>
          <p className="text-lg font-bold text-success">{delivered}</p>
        </button>
        <button type="button" onClick={() => setOwnershipFilter("insurance")} className="text-right bg-card border border-border rounded-xl p-3 transition-all hover:border-sky-500/40">
          <p className="text-[10px] text-muted-foreground">تأمين</p>
          <p className="text-lg font-bold text-sky-600">{insuranceCount}</p>
        </button>
        <button type="button" onClick={() => setOwnershipFilter("cash")} className="text-right bg-card border border-border rounded-xl p-3 transition-all hover:border-emerald-500/40">
          <p className="text-[10px] text-muted-foreground">كاش / عام</p>
          <p className="text-lg font-bold text-emerald-600">{cashCount}</p>
        </button>
        <button type="button" onClick={() => setStatusFilter("overdue")} className="text-right bg-card border border-border rounded-xl p-3 transition-all hover:border-destructive/40">
          <p className="text-[10px] text-muted-foreground">متأخرة</p>
          <p className="text-lg font-bold text-destructive">{overdue}</p>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="بحث برقم الأمر، اسم العميل، رقم اللوحة، أو الهاتف..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-9 bg-card border-border text-foreground placeholder:text-muted-foreground" />
        </div>
        <Select value={ownershipFilter} onValueChange={setOwnershipFilter}>
          <SelectTrigger className="w-full sm:w-[190px] bg-card border-border text-foreground">
            <Shield size={14} className="ml-2" /><SelectValue placeholder="نوع الأمر" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">الكل ({orders.length})</SelectItem>
            <SelectItem value="insurance">تأمين ({insuranceCount})</SelectItem>
            <SelectItem value="cash">ورشة / كاش ({cashCount})</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] bg-card border-border text-foreground">
            <Filter size={14} className="ml-2" /><SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">جميع الحالات</SelectItem>
            <SelectItem value="repair">قيد الإصلاح / الفحص</SelectItem>
            <SelectItem value="waiting">انتظار</SelectItem>
            <SelectItem value="ready">جاهزة للتسليم</SelectItem>
            {WORK_ORDER_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
          <SelectTrigger className="w-full bg-card border-border text-foreground"><SelectValue placeholder="الفني / المشرف" /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">كل الفنيين</SelectItem>
            {Array.from(new Set(orders.map(o => o.technician).filter(Boolean))).map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={entryFrom} onChange={(e) => setEntryFrom(e.target.value)} className="bg-card border-border" aria-label="تاريخ الدخول من" />
        <Input type="date" value={entryTo} onChange={(e) => setEntryTo(e.target.value)} className="bg-card border-border" aria-label="تاريخ الدخول إلى" />
        <Select value={archiveFilter} onValueChange={setArchiveFilter}>
          <SelectTrigger className="w-full bg-card border-border text-foreground"><SelectValue placeholder="الأرشيف" /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">الحالي والأرشيف</SelectItem>
            <SelectItem value="current">الحالي فقط</SelectItem>
            <SelectItem value="archived">الأرشيف فقط</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["insurance", "Insurance Only", () => setOwnershipFilter("insurance")],
          ["cash", "Cash Only", () => setOwnershipFilter("cash")],
          ["repair", "In Workshop", () => setStatusFilter("repair")],
          ["ready", "Ready", () => setStatusFilter("ready")],
          ["delivered", "Delivered", () => setStatusFilter("delivered")],
          ["overdue", "Overdue", () => setStatusFilter("overdue")],
        ].map(([key, label, action]) => (
          <Button key={key as string} size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={action as () => void}>{label as string}</Button>
        ))}
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => {
          setSearchTerm(""); setStatusFilter("all"); setOwnershipFilter("all"); setTechnicianFilter("all"); setEntryFrom(""); setEntryTo(""); setArchiveFilter("all"); setPartsOnlyFilter(false);
        }}>مسح الفلاتر</Button>
      </div>

      <div className="hidden md:block bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="py-3 px-3 w-10">
                  <Checkbox
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onCheckedChange={(v) => setSelectedIds(v ? new Set(filtered.map(o => o.id)) : new Set())}
                  />
                </th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Order Type</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">رقم الأمر</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">العميل</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">السيارة</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden lg:table-cell">اللوحة</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden lg:table-cell">الخدمة</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden xl:table-cell">الفني</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الحالة</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">التكلفة</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.map((order) => {
                const delay = getOrderDelayStyle(order);
                const isInsurance = isInsuranceOrder(order);
                const insuranceLabel = insuranceReason(order);
                return (
                <tr
                  key={order.id}
                  onClick={() => navigate(`/work-orders/${encodeURIComponent(order.id)}`)}
                  className={`border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer ${selectedIds.has(order.id) ? "bg-primary/5" : ""}`}
                  style={{ boxShadow: delay.boxShadow, backgroundColor: delay.backgroundColor }}
                  title={delay.days && delay.level !== "green" ? `متأخر داخل الورشة منذ ${delay.days} يوم` : "عرض التفاصيل"}
                >
                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(order.id)}
                      onCheckedChange={(v) => {
                        setSelectedIds((s) => {
                          const n = new Set(s);
                          if (v) n.add(order.id);
                          else n.delete(order.id);
                          return n;
                        });
                      }}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <WorkOrderTypeBadge
                      compact
                      workOrderType={order.workOrderType}
                      claimId={order.claimId}
                      claimNumber={order.claimNumber}
                      insurance={order.insurance}
                    />
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-primary">
                    <div className="flex items-center gap-1.5">
                      {isInsurance && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-info/15 text-info border border-info/25 text-[9px] font-medium"
                          title={`أمر عمل تأمين: ${insuranceLabel || "مرتبط بتأمين"}${hasOrderValue(order.claimNumber) ? ` (${order.claimNumber})` : ""}`}
                        >
                          <Shield size={10} />
                          <span className="hidden lg:inline truncate max-w-[90px]">تأمين {insuranceLabel}</span>
                        </span>
                      )}
                      <span style={{ fontFamily: "Inter, monospace" }}>{toEnglishDigits(order.id)}</span>
                      {delay.level !== "green" && delay.days != null && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold"
                          style={{ backgroundColor: DURATION_BAR_HEX[delay.level], color: "#fff" }}
                          title={`متأخر منذ ${delay.days} يوم`}
                        >
                          {toEnglishDigits(String(delay.days))}d
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4"><div><p className="text-foreground font-medium">{order.customer}</p><p className="text-[10px] text-muted-foreground" style={{ fontFamily: "Inter, sans-serif" }}>{toEnglishDigits(order.phone || "")}</p></div></td>
                  <td className="py-3 px-4 text-muted-foreground hidden md:table-cell" style={{ fontFamily: "Inter, sans-serif" }}>{order.vehicleType} {order.model} {toEnglishDigits(order.year || "")}</td>
                  <td className="py-3 px-4 text-muted-foreground font-mono hidden lg:table-cell" style={{ fontFamily: "Inter, monospace" }}>{formatPlateLatin(order.plate)}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell">{order.serviceType}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden xl:table-cell">{order.technician}</td>
                  <td className="py-3 px-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); openStatus(order); }}
                      className={`text-[10px] px-2 py-1 rounded-full font-medium hover:ring-2 hover:ring-primary/30 transition-all cursor-pointer ${statusColors[order.status] || ""}`}
                      title="انقر لتغيير الحالة"
                    >
                      {order.status}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-foreground font-medium hidden md:table-cell" style={{ fontFamily: "Inter, sans-serif", direction: "ltr", textAlign: "right" }} data-amount="true">{toEnglishDigits(order.totalCost.toLocaleString("en-US"))} OMR</td>
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 border-border bg-secondary/30 hover:bg-secondary text-foreground"
                        >
                          <MoreHorizontal size={14} />
                          <span className="text-xs">الإجراءات</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52 bg-card border-border">
                        <DropdownMenuLabel className="text-xs text-muted-foreground">إجراءات الأمر</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => navigate(`/work-orders/${encodeURIComponent(order.id)}`)} className="gap-2 cursor-pointer">
                          <Eye size={14} className="text-muted-foreground" /> عرض التفاصيل
                        </DropdownMenuItem>
                        {allowEdit && (
                          <DropdownMenuItem onClick={() => setEditOrder(order)} className="gap-2 cursor-pointer">
                            <Edit size={14} className="text-info" /> تعديل الأمر
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => openStatus(order)} className="gap-2 cursor-pointer">
                          <Workflow size={14} className="text-info" /> تحديث الحالة
                        </DropdownMenuItem>

                        {/* زر فحص السيارة منسدل */}
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="gap-2 cursor-pointer">
                            <SearchIcon size={14} className="text-primary" /> فحص السيارة
                            {(inspectionsByOrder[order.id] || 0) > 0 && (
                              <span className="ml-auto text-[10px] bg-primary/15 text-primary rounded-full px-1.5">
                                {inspectionsByOrder[order.id]}
                              </span>
                            )}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="bg-card border-border">
                            <DropdownMenuItem onClick={() => openNewInspection(order)} className="gap-2 cursor-pointer">
                              <FilePlus2 size={14} className="text-success" /> فحص جديد لهذا الأمر
                            </DropdownMenuItem>
                            {(inspectionsByOrder[order.id] || 0) > 0 && (
                              <DropdownMenuItem onClick={() => openExistingInspections(order)} className="gap-2 cursor-pointer">
                                <FolderOpen size={14} className="text-info" /> الفحوصات السابقة
                                <span className="ml-auto text-[10px] text-muted-foreground">({inspectionsByOrder[order.id]})</span>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuItem onClick={() => setExpenseOrder(order)} className="gap-2 cursor-pointer">
                          <Receipt size={14} className="text-warning" /> مصروف على هذا الأمر
                        </DropdownMenuItem>

                        <DropdownMenuItem onClick={() => setPhotosOrderId(order.id)} className="gap-2 cursor-pointer">
                          <Camera size={14} className="text-primary" /> صور المراحل
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setQrOrder(order)} className="gap-2 cursor-pointer">
                          <QrCode size={14} className="text-primary" /> رمز QR
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handlePreview(order)} className="gap-2 cursor-pointer">
                          <Printer size={14} className="text-primary" /> طباعة / PDF
                        </DropdownMenuItem>
                        {resolveWorkOrderType(order) === "insurance" && <DropdownMenuItem
                          onClick={() => {
                            const parts = order.partsNeeded || [];
                            if (parts.length === 0) {
                              toast.error("لا توجد قطع غيار لهذا الأمر");
                              return;
                            }
                            void sendWhatsAppAndLog({
                              message: buildPartsRequestMessage(order),
                              phone: order.phone,
                              workOrderId: order.id,
                              kind: "parts_request",
                              recipientName: order.customer,
                              recipientType: "customer",
                            }).then(() => toast.success("تم الإرسال"))
                              .catch((error) => toast.error(error?.message || "فشل الإرسال"));
                          }}
                          className="gap-2 cursor-pointer"
                        >
                          <MessageCircle size={14} className="text-success" /> واتساب طلب قطع
                          {(order.partsNeeded || []).filter(isPartStillNeeded).length > 0 && (
                            <span className="ml-auto text-[10px] bg-success/15 text-success rounded-full px-1.5">
                              {(order.partsNeeded || []).filter(isPartStillNeeded).length}
                            </span>
                          )}
                        </DropdownMenuItem>}

                        {/* === المزيد من الإجراءات === */}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            const msg = `مرحباً ${order.customer}،\nحالة سيارتكم (${order.plate}) في الورشة الآن: ${order.status}\nأمر العمل: ${order.id}\nشكراً لكم — شركة الوفاء للأعمال المتكاملة.`;
                            void sendWhatsAppAndLog({
                              message: msg,
                              phone: order.phone,
                              workOrderId: order.id,
                              kind: "custom",
                              recipientName: order.customer,
                              recipientType: "customer",
                            }).then(() => toast.success("تم الإرسال"))
                              .catch((error) => toast.error(error?.message || "فشل الإرسال"));
                          }}
                          className="gap-2 cursor-pointer"
                        >
                          <Send size={14} className="text-info" /> واتساب: تحديث حالة للعميل
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            if (!order.phone) { toast.error("لا يوجد رقم هاتف للعميل"); return; }
                            window.location.href = `tel:${order.phone}`;
                          }}
                          className="gap-2 cursor-pointer"
                        >
                          <Phone size={14} className="text-info" /> اتصال بالعميل
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => order.plate ? navigate(`/vehicles/${encodeURIComponent(order.plate)}`) : toast.error("لا يوجد رقم لوحة")}
                          className="gap-2 cursor-pointer"
                        >
                          <Car size={14} className="text-primary" /> ملف السيارة
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const params = new URLSearchParams({
                              customer: order.customer,
                              phone: order.phone || "",
                              workOrder: order.id,
                              plate: order.plate || "",
                              vehicle: `${order.vehicleType} ${order.model} ${order.year || ""}`.trim(),
                            });
                            navigate(`/sales/invoices/new?${params.toString()}`);
                          }}
                          className="gap-2 cursor-pointer"
                        >
                          <FileSpreadsheet size={14} className="text-success" /> إنشاء فاتورة
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            sessionStorage.setItem("new_claim_from_order", JSON.stringify({
                              orderId: order.id,
                              customer: order.customer,
                              phone: order.phone || "",
                              plate: order.plate || "",
                              vehicleType: order.vehicleType || "",
                              model: order.model || "",
                              year: order.year || "",
                              insurance: order.insurance || "",
                              claimNumber: order.claimNumber || "",
                            }));
                            navigate("/insurance/new");
                          }}
                          className="gap-2 cursor-pointer"
                        >
                          <Shield size={14} className="text-info" /> إنشاء مطالبة تأمين
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => { navigator.clipboard.writeText(order.id); toast.success(`تم نسخ ${order.id}`); }}
                          className="gap-2 cursor-pointer"
                        >
                          <Copy size={14} className="text-muted-foreground" /> نسخ رقم الأمر
                        </DropdownMenuItem>
                        {allowDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setDeleteOrder(order)}
                              className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                            >
                              <Trash2 size={14} /> حذف الأمر
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground"><Car size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد نتائج</p></div>
        )}
        {filtered.length > 0 && (
          <TablePaginationControls
            page={page}
            pageSize={pageSize}
            totalItems={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>

      <div className="grid gap-3 md:hidden">
        {paginatedOrders.map((order) => {
          const delay = getOrderDelayStyle(order);
          return (
            <article
              key={order.id}
              onClick={() => navigate(`/work-orders/${encodeURIComponent(order.id)}`)}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
              style={{ boxShadow: delay.boxShadow, backgroundColor: delay.backgroundColor }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-bold text-primary">{toEnglishDigits(order.id)}</p>
                  <p className="mt-1 font-semibold text-foreground">{order.customer}</p>
                  <p className="text-xs text-muted-foreground">{formatPlateLatin(order.plate)} · {order.vehicleType} {order.model}</p>
                </div>
                <Checkbox
                  checked={selectedIds.has(order.id)}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) => setSelectedIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(order.id);
                    else next.delete(order.id);
                    return next;
                  })}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <WorkOrderTypeBadge
                  workOrderType={order.workOrderType}
                  claimId={order.claimId}
                  claimNumber={order.claimNumber}
                  insurance={order.insurance}
                />
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${statusColors[order.status] || "bg-muted"}`}>{order.status}</span>
                {delay.level !== "green" && delay.days !== null && <span className="rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive">{delay.days} يوم</span>}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
                <span className="text-muted-foreground">{order.technician || "غير مسند"}</span>
                <span className="font-semibold text-foreground">{order.totalCost.toLocaleString("en-US")} OMR</span>
              </div>
            </article>
          );
        })}
        {filtered.length > 0 && (
          <TablePaginationControls page={page} pageSize={pageSize} totalItems={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      <PdfPreviewDialog open={showPreview} onOpenChange={setShowPreview} htmlContent={previewHtml} title={previewTitle} />
      <WorkOrderStatusDialog order={statusOrder} open={showStatus} onOpenChange={setShowStatus} />
      <QrLabel order={qrOrder} open={!!qrOrder} onClose={() => setQrOrder(null)} />
      <StagePhotosDialog orderId={photosOrderId} open={!!photosOrderId} onClose={() => setPhotosOrderId(null)} />
      <WorkOrderExpenseDialog
        order={expenseOrder}
        open={!!expenseOrder}
        onOpenChange={(o) => !o && setExpenseOrder(null)}
      />

      {/* Edit dialog */}
      <Dialog open={!!editOrder} onOpenChange={(o) => !o && setEditOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">تعديل أمر العمل {editOrder?.id}</DialogTitle></DialogHeader>
          <WorkOrderForm initial={editOrder} onClose={() => setEditOrder(null)} />
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDeleteDialog
        open={!!deleteOrder}
        onOpenChange={(o) => !o && setDeleteOrder(null)}
        title={`حذف أمر العمل ${deleteOrder?.id || ""}`}
        description={`سيتم نقل أمر العمل الخاص بـ "${deleteOrder?.customer || ""}" إلى سلة المهملات. يمكنك استرجاعه لاحقاً.`}
        onConfirm={() => {
          if (!deleteOrder) return;
          const removed = deleteWorkOrder(deleteOrder.id);
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
          }
          setDeleteOrder(null);
        }}
      />

      <BulkActionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())} label="أمر">
        {/* تغيير الحالة جماعياً */}
        <Select
          onValueChange={(status) => {
            selectedIds.forEach((id) => updateWorkOrder(id, { status }));
            toast.success(`تم تحديث حالة ${selectedIds.size} أمر إلى "${status}"`);
            setOrders([...getWorkOrders()]);
            setSelectedIds(new Set());
          }}
        >
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="تغيير الحالة" /></SelectTrigger>
          <SelectContent>
            {WORK_ORDER_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
        {/* إسناد لفني */}
        <Select
          onValueChange={(tech) => {
            selectedIds.forEach((id) => updateWorkOrder(id, { technician: tech }));
            toast.success(`تم إسناد ${selectedIds.size} أمر إلى ${tech}`);
            setOrders([...getWorkOrders()]);
            setSelectedIds(new Set());
          }}
        >
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="إسناد لفني" /></SelectTrigger>
          <SelectContent>
            {staffStore.getAll().map((t) => (<SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>))}
          </SelectContent>
        </Select>
        {/* تصدير CSV/Excel */}
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={() => {
            const ids = Array.from(selectedIds);
            const ords = orders.filter((o) => ids.includes(o.id));
            const headers = ["رقم الأمر","العميل","اللوحة","المركبة","الحالة","الفني","التكلفة"];
            const rows = ords.map((o) => [o.id, o.customer, o.plate, `${o.vehicleType} ${o.model}`, o.status, o.technician || "", o.totalCost]);
            const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `work-orders-${new Date().toISOString().slice(0,10)}.csv`; a.click();
            URL.revokeObjectURL(url);
            toast.success(`تم تصدير ${ords.length} سجل`);
          }}
        >
          <FileSpreadsheet size={14} /> تصدير
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={async () => {
            const ids = Array.from(selectedIds);
            const ords = orders.filter(o => ids.includes(o.id));
            if (ords.length === 0) return;
            const { buildTrackingQrDataUrl } = await import("@/lib/pdfGenerator");
            await Promise.all(ords.map(o => buildTrackingQrDataUrl(o.trackingToken)));
            const combined = ords.map(o => {
              const html = buildWorkOrderHtml(o);
              const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
              return m ? m[1] : html;
            }).join('<div style="page-break-after:always"></div>');
            const wrapper = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>طباعة جماعية</title>${
              buildWorkOrderHtml(ords[0]).match(/<style>[\s\S]*?<\/style>/)?.[0] || ''
            }</head><body>${combined}</body></html>`;
            setPreviewHtml(wrapper);
            setPreviewTitle(`طباعة ${ords.length} أمر عمل`);
            setShowPreview(true);
          }}
        >
          <Printer size={14} /> طباعة
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={() => {
            const archivedAt = new Date().toISOString();
            selectedIds.forEach((id) => updateWorkOrder(id, { archivedAt, status: "مغلق" }));
            toast.success(`تم نقل ${selectedIds.size} أمر إلى الأرشيف`);
            setSelectedIds(new Set());
          }}
        >
          <FolderOpen size={14} /> للأرشيف
        </Button>
        {allowDelete && (
          <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={() => setShowBulkDelete(true)}>
            <Trash2 size={14} /> حذف
          </Button>
        )}
      </BulkActionBar>
      <ConfirmDeleteDialog
        open={showBulkDelete}
        onOpenChange={setShowBulkDelete}
        title={`حذف ${selectedIds.size} أمر عمل`}
        description="سيتم نقل جميع أوامر العمل المحددة إلى سلة المهملات."
        onConfirm={() => {
          let n = 0;
          selectedIds.forEach((id) => {
            const removed = deleteWorkOrder(id);
            if (removed) {
              moveToTrash({
                type: "work_order",
                entityId: removed.id,
                label: `${removed.customer} - ${removed.plate}`,
                payload: removed,
              });
              n++;
            }
          });
          toast.success(`تم نقل ${n} أمر للمهملات`);
          setSelectedIds(new Set());
          setShowBulkDelete(false);
        }}
      />
    </div>
  );
}
