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
  Wallet,
  Loader2,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  MoreHorizontal,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

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
  type StagePhoto,
  refreshWorkOrdersFromCloud,
  upsertWorkOrderInCache,
  fetchWorkOrderFromCloudByIdentifier,
  restoreWorkOrderFromTrash,
  normalizeWorkOrderStatus,
} from "@/lib/workOrdersStore";
import { supabase } from "@/integrations/supabase/client";
import { inspectionsStore } from "@/lib/inspectionsStore";
import { getExpensesForWorkOrder, fetchExpensesForWorkOrder, expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import { queryKeys } from "@/lib/queryKeys";
import { Checkbox } from "@/components/ui/checkbox";
import { canDelete, canEdit, canManageFinance } from "@/lib/permissions";
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
import { ensureCustomerPortalToken } from "@/lib/customerPortalTokens";
import SmartCustomerSendBar from "@/components/workorders/SmartCustomerSendBar";
import { isUuid } from "@/lib/uuid";
import { extractWorkOrderNumber } from "@/lib/workOrderNumber";
// PortalNotesPending moved to /messages
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import WhatsAppCenter from "@/components/workorders/WhatsAppCenter";
import QuickEmailButton from "@/components/QuickEmailButton";
import { salesStore, statusLabel, type SalesDoc } from "@/lib/salesStore";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import WorkOrderTypeBadge from "@/components/workorders/WorkOrderTypeBadge";
import { resolveWorkOrderType } from "@/lib/workOrderType";
import { archiveWorkOrder } from "@/lib/deletePolicy";
import VehicleAvatar from "@/components/vehicles/VehicleAvatar";
import { classifyWorkOrderCosts, splitVatInclusiveAmount } from "@/lib/workOrderCosting";
import { formatCurrencyEnglish } from "@/lib/formatters/numberFormat";
import { fetchUnifiedOperationalState, listUnifiedVehicleMedia, type UnifiedMediaRecord } from "@/lib/claimWorkOrderUnified";
import { mergeWorkOrderMedia } from "@/lib/workOrderMedia";
import { fetchWorkOrderAttachedPhotos } from "@/lib/workOrderAttachedPhotos";
import { refreshSignedPhotoUrls } from "@/lib/workOrderPhotosStorage";
import { useWorkOrderFinancials } from "@/hooks/useWorkOrderFinancials";
import UnifiedAddPaymentDialog from "@/components/payments/UnifiedAddPaymentDialog";
import { paymentTargetFromWorkOrderInvoice } from "@/lib/paymentTargets";
import type { WorkOrderLinkedInvoice } from "@/lib/workOrderFinancials";

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

Object.assign(statusColors, {
  "تحت الفحص": "bg-primary/15 text-primary",
  "بانتظار الموافقة": "bg-info/15 text-info",
  "بانتظار قطع الغيار": "bg-warning/15 text-warning",
  "تحت الإصلاح": "bg-warning/15 text-warning",
  "ضبط الجودة": "bg-info/15 text-info",
  "جاهز للتسليم": "bg-success/15 text-success",
  "تم التسليم": "bg-success/25 text-success",
  "مغلق": "bg-muted text-muted-foreground",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_EN: Record<string, string> = {
  "تحت الفحص": "Under inspection",
  "بانتظار الموافقة": "Awaiting approval",
  "بانتظار قطع الغيار": "Awaiting parts",
  "تحت الإصلاح": "In repair",
  "ضبط الجودة": "Quality check",
  "جاهز للتسليم": "Ready for delivery",
  "تم التسليم": "Delivered",
  "مغلق": "Closed",
};

function workOrderStatusColor(status: string): string {
  const normalized = normalizeWorkOrderStatus(status);
  const colors: Record<string, string> = {
    "تحت الفحص": "bg-primary/15 text-primary",
    "بانتظار الموافقة": "bg-info/15 text-info",
    "بانتظار قطع الغيار": "bg-warning/15 text-warning",
    "تحت الإصلاح": "bg-warning/15 text-warning",
    "ضبط الجودة": "bg-info/15 text-info",
    "جاهز للتسليم": "bg-success/15 text-success",
    "تم التسليم": "bg-success/25 text-success",
    "مغلق": "bg-muted text-muted-foreground",
  };
  return colors[normalized] || statusColors[status] || "bg-muted text-muted-foreground";
}

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

Object.assign(SUPA_STATUS_TO_AR, {
  received: "تحت الفحص",
  diagnosing: "تحت الفحص",
  awaiting_parts: "بانتظار قطع الغيار",
  waiting_parts: "بانتظار قطع الغيار",
  in_progress: "تحت الإصلاح",
  quality_check: "ضبط الجودة",
  ready: "جاهز للتسليم",
  completed: "جاهز للتسليم",
  delivered: "تم التسليم",
  closed: "مغلق",
});

export default function WorkOrderDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isEnglish = i18n.language.startsWith("en");
  const label = (ar: string, en: string) => isEnglish ? en : ar;
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [order, setOrder] = useState<WorkOrder | undefined>(() => getWorkOrderById(id));
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [cloudJobOrderId, setCloudJobOrderId] = useState<string | null>(null);
  const [unifiedMedia, setUnifiedMedia] = useState<UnifiedMediaRecord[]>([]);
  const [resolvedLegacyPhotos, setResolvedLegacyPhotos] = useState<StagePhoto[]>([]);
  const [attachedPhotos, setAttachedPhotos] = useState<StagePhoto[]>([]);
  const [mediaRevision, setMediaRevision] = useState(0);
  const currentOrderId = order?.id;
  const currentOrderStatus = order?.status;
  const currentOrderPhotoCount = order?.photos?.length ?? 0;
  const currentOrderCloudId = order?.cloudId;
  const currentOrderClaimId = order?.claimId;
  const currentOrderClaimNumber = order?.claimNumber;
  const currentOrderPhotos = order?.photos;

  useEffect(() => {
    let cancelled = false;
    const source = order?.photos || [];
    setResolvedLegacyPhotos(source);
    void refreshSignedPhotoUrls(source).then((resolved) => {
      if (!cancelled && resolved) setResolvedLegacyPhotos(resolved);
    }).catch((error) => console.warn("[work order photos] URL refresh failed", error));
    return () => { cancelled = true; };
  }, [order?.photos]);

  useEffect(() => {
    let cancelled = false;
    if (!cloudJobOrderId) { setAttachedPhotos([]); return; }
    void fetchWorkOrderAttachedPhotos(cloudJobOrderId).then((rows) => {
      if (!cancelled) setAttachedPhotos(rows);
    }).catch((error) => console.warn("[work order attached photos] load failed", error));
    return () => { cancelled = true; };
  }, [cloudJobOrderId, mediaRevision]);

  // Resolve cloud UUID for job_orders (used by Supplements/Reception/Approval sections)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const candidate = currentOrderCloudId || currentOrderId || id;
      if (candidate && UUID_RE.test(candidate)) { setCloudJobOrderId(candidate); return; }
      const woNo = extractWorkOrderNumber(order?.displayNumber || id || "");
      if (!woNo) { setCloudJobOrderId(null); return; }
      const { data } = await supabase.from("job_orders").select("id").ilike("order_number", woNo).maybeSingle();
      if (!cancelled) setCloudJobOrderId((data as any)?.id || null);
    })();
    return () => { cancelled = true; };
  }, [id, currentOrderId, currentOrderCloudId, order?.displayNumber]);

  // Detect status/photos changes triggered by the top buttons and prompt auto-send
  useEffect(() => {
    if (!currentOrderId || !currentOrderStatus) return;
    const curStatus = currentOrderStatus;
    const curLen = currentOrderPhotoCount;
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
  }, [currentOrderId, currentOrderStatus, currentOrderPhotoCount]);

  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [photoPdfBusy, setPhotoPdfBusy] = useState(false);
  const [photoPdfProgress, setPhotoPdfProgress] = useState(0);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [previewExpense, setPreviewExpense] = useState<ExpenseRecord | null>(null);
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
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
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [convertPart, setConvertPart] = useState<NeededPart | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<WorkOrderLinkedInvoice | null>(null);
  const [expenseTick, setExpenseTick] = useState(0);
  const [expensesReady, setExpensesReady] = useState(() => expensesStore.isHydrated());
  const [laborEditOpen, setLaborEditOpen] = useState(false);
  const [laborDraft, setLaborDraft] = useState(0);
  const [savingLabor, setSavingLabor] = useState(false);
  const financialQuery = useWorkOrderFinancials(order);
  const orderExpensesQuery = useQuery({
    queryKey: [...queryKeys.expenseManagement.all, "work_order", order?.cloudId || order?.id || ""],
    enabled: !!order,
    queryFn: () => fetchExpensesForWorkOrder(order!),
  });

  const allowEdit = canEdit();
  const allowDelete = canDelete();
  const allowManageExpenses = canManageFinance();

  useEffect(() => {
    const unsubscribe = expensesStore.subscribe(() => {
      setExpensesReady(expensesStore.isHydrated());
      setExpenseTick((value) => value + 1);
    });
    if (!expensesStore.isHydrated()) {
      void expensesStore.refresh().finally(() => setExpensesReady(expensesStore.isHydrated()));
    }
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingRemote(true);
    const local = getWorkOrderById(id);
    setOrder(local);
    const unsub = subscribeWorkOrders(() => setOrder((prev) => getWorkOrderById(id) || prev));

    // Fallback: resolve UUID, current typed numbers and every historical number alias.
    const isUuid = UUID_RE.test(id);
    const woMatch = extractWorkOrderNumber(id);
    if (!local && id && (isUuid || woMatch)) {
      setLoadingRemote(true);
      (async () => {
        const q = supabase
          .from("job_orders")
          .select(`
            id, order_number, status, description, diagnosis,
            labor_cost, parts_cost, final_total, subtotal, created_at,
            insurance_claim_number, insurance_company, insurance_approved,
            work_order_type, claim_id, customer_id, vehicle_id, tracking_token, tracking_expires_at, archived_at, deleted_at,
            parts_needed, work_items,
            customer:customers(name, phone),
            vehicle:vehicles(brand, model, plate_number, year, color, vin, vin_number)
          `);
        let { data, error } = isUuid
          ? await q.eq("id", id).maybeSingle()
          : await q.ilike("order_number", woMatch!).maybeSingle();
        if (error || !data) {
          const baseQuery = supabase
            .from("job_orders")
            .select(`
              id, order_number, status, description, diagnosis,
              labor_cost, parts_cost, final_total, subtotal, created_at,
              insurance_claim_number, insurance_company, insurance_approved,
              work_order_type, claim_id, customer_id, vehicle_id, tracking_token, tracking_expires_at, archived_at, deleted_at,
              parts_needed, work_items
            `);
          const baseResult = isUuid
            ? await baseQuery.eq("id", id).maybeSingle()
            : await baseQuery.ilike("order_number", woMatch!).maybeSingle();
          data = baseResult.data as any;
          error = baseResult.error as any;
        }
        if ((error || !data) && !isUuid && woMatch) {
          const aliased = await fetchWorkOrderFromCloudByIdentifier(woMatch).catch(() => null);
          if (aliased) {
            if (active) {
              setOrder(aliased);
              setCloudJobOrderId(aliased.cloudId || null);
              setLoadingRemote(false);
            }
            return;
          }
        }
        if (!error && data) {
          let claimInfo: { approvedAmount?: number | null; estimatedAmount?: number | null; estimationType?: string | null } | null = null;
          if ((data as any).claim_id) {
            const { data: claim } = await supabase
              .from("insurance_claims")
              .select("id,approved_amount,estimated_amount,estimation_type")
              .eq("id", (data as any).claim_id)
              .maybeSingle();
            if (claim) {
              claimInfo = {
                approvedAmount: (claim as any).approved_amount,
                estimatedAmount: (claim as any).estimated_amount,
                estimationType: (claim as any).estimation_type,
              };
            }
          }
          const costs = classifyWorkOrderCosts({
            laborCost: (data as any).labor_cost,
            partsCost: (data as any).parts_cost,
            finalTotal: (data as any).final_total,
            subtotal: (data as any).subtotal,
            claim: claimInfo,
            partsNeeded: Array.isArray((data as any).parts_needed) ? (data as any).parts_needed : [],
            workItems: Array.isArray((data as any).work_items) ? (data as any).work_items : [],
          });
          let v: any = (data as any).vehicle || {};
          let c: any = (data as any).customer || {};
          if (!c.name && (data as any).customer_id) {
            const { data: customerRow } = await supabase
              .from("customers")
              .select("name, phone")
              .eq("id", (data as any).customer_id)
              .maybeSingle();
            c = customerRow || c;
          }
          if (!v.plate_number && (data as any).vehicle_id) {
            const { data: vehicleRow } = await supabase
              .from("vehicles")
              .select("brand, model, plate_number, year, color, vin, vin_number")
              .eq("id", (data as any).vehicle_id)
              .maybeSingle();
            v = vehicleRow || v;
          }
          const unified = await fetchUnifiedOperationalState({
            claimId: (data as any).claim_id || null,
            workOrderId: (data as any).id || null,
          });
          const unifiedStatus = unified?.operational_status
            ? normalizeWorkOrderStatus(SUPA_STATUS_TO_AR[unified.operational_status] || unified.operational_status)
            : null;
          const adapted: WorkOrder = {
            id: (data as any).order_number || (data as any).id,
            cloudId: (data as any).id,
            displayNumber: (data as any).order_number || undefined,
            workOrderType: (data as any).work_order_type || ((data as any).claim_id ? "insurance" : "general_customer"),
            claimId: (data as any).claim_id || undefined,
            trackingToken: (data as any).tracking_token || undefined,
            trackingExpiresAt: (data as any).tracking_expires_at || undefined,
            archivedAt: (data as any).archived_at || undefined,
            deletedAt: (data as any).deleted_at || undefined,
            customer: c.name || "—",
            phone: c.phone || "",
            plate: v.plate_number || "—",
            vehicleType: v.brand || "",
            model: v.model || "",
            year: v.year ? String(v.year) : "",
            vin: v.vin_number || v.vin || "",
            color: v.color || "",
            mileage: "",
            insurance: (data as any).insurance_company || ((data as any).insurance_approved ? "تأمين" : "-"),
            claimNumber: (data as any).insurance_claim_number || "-",
            entryDate: (unified?.vehicle_received_at || (data as any).received_at || (data as any).created_at || "").slice(0, 10),
            technician: "",
            serviceType: (data as any).insurance_claim_number ? "حادث" : "صيانة",
            status: unifiedStatus || normalizeWorkOrderStatus(SUPA_STATUS_TO_AR[(data as any).status] || (data as any).status || "تحت الفحص"),
            totalCost: costs.totalCost,
            laborCost: costs.laborCost,
            partsCost: costs.partsCost,
            insuranceApprovedAmount: costs.insuranceApprovedAmount,
            insuranceApprovalMode: costs.insuranceApprovalMode,
            lumpSumNotItemized: costs.lumpSumNotItemized,
            paintMaterialsCost: costs.paintMaterialsCost,
            diagnosis: (data as any).diagnosis || (data as any).description || "",
            description: unified?.operational_notes || (data as any).description || "",
            photos: [],
            partsNeeded: Array.isArray(unified?.parts_required) && unified.parts_required.length ? unified.parts_required as any : Array.isArray((data as any).parts_needed) ? (data as any).parts_needed : [],
            workItems: Array.isArray((data as any).work_items) ? (data as any).work_items : [],
            receivedAt: unified?.vehicle_received_at || (data as any).received_at || undefined,
          };
          const cached = upsertWorkOrderInCache(adapted);
          if (active) setOrder(cached);
        }
        if (active) setLoadingRemote(false);
      })().catch(() => {
        if (active) {
          setOrder(undefined);
          setLoadingRemote(false);
        }
      });
    } else if (id && (isUuid || woMatch)) {
      void fetchWorkOrderFromCloudByIdentifier(id).then((fresh) => {
        if (active) setOrder(fresh || undefined);
      }).catch(() => {
        if (active) setOrder(undefined);
      }).finally(() => {
        if (active) setLoadingRemote(false);
      });
    } else {
      setLoadingRemote(false);
    }
    return () => { active = false; unsub(); };
  }, [id]);

  const inspections = useMemo(
    () => (order ? inspectionsStore.getAll().filter((i) => i.workOrder === order.id) : []),
    [order]
  );

  const linkedVouchers = useMemo(() => {
    // The store revision intentionally refreshes this derived external-store view.
    void expenseTick;
    if (!order) return [];
    // A completed scoped cloud query is authoritative; the legacy cache can
    // contain older metadata-only links. Include the cache only while a fresh
    // query is loading so a newly saved voucher appears without delay.
    if (orderExpensesQuery.isSuccess && !orderExpensesQuery.isFetching) return orderExpensesQuery.data;
    const merged = new Map<string, ExpenseRecord>();
    for (const expense of orderExpensesQuery.data || []) merged.set(expense.id, expense);
    for (const expense of getExpensesForWorkOrder(order)) merged.set(expense.id, expense);
    return [...merged.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [order, expenseTick, orderExpensesQuery.data, orderExpensesQuery.isSuccess, orderExpensesQuery.isFetching]);
  const vouchersTotal = linkedVouchers.reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const partsExpenseTotal = linkedVouchers.reduce((sum, expense) => {
    const text = `${expense.expenseType || ""} ${expense.categoryName || ""} ${expense.description || ""}`.toLowerCase();
    const isPart = !!expense.partName || expense.expenseType === "cash_vehicle_parts" || /spare|parts|قطع|غيار/.test(text);
    return sum + (isPart ? Number(expense.amount || 0) : 0);
  }, 0);
  const otherExpenseTotal = Math.max(0, vouchersTotal - partsExpenseTotal);
  const expenseVatTotal = linkedVouchers.reduce((sum, expense) => sum + Number(expense.vatAmount || 0), 0);
  const cashSpentTotal = linkedVouchers.reduce(
    (sum, expense) => sum + Number(expense.total ?? (Number(expense.amount || 0) + Number(expense.vatAmount || 0))),
    0,
  );
  const actualRevenue = Number(financialQuery.data?.subtotal || 0);
  const actualCollected = Number(financialQuery.data?.paid || 0);
  const actualOutstanding = Number(financialQuery.data?.remaining || 0);
  const actualProfit = actualRevenue - vouchersTotal;

  // كشف الفاتورة المرتبطة بأمر العمل (إن وجدت)
  const [salesDocs, setSalesDocs] = useState(() => ({
    invoices: salesStore.list({ type: "invoice", includeDeleted: false }),
    quotes: salesStore.list({ type: "quote", includeDeleted: false }),
  }));
  useEffect(() => {
    const refresh = () => setSalesDocs({
      invoices: salesStore.list({ type: "invoice", includeDeleted: false }),
      quotes: salesStore.list({ type: "quote", includeDeleted: false }),
    });
    const unsub = salesStore.subscribe(refresh);
    refresh();
    return () => { unsub(); };
  }, []);
  useEffect(() => {
    if (!currentOrderId) return;
    let cancelled = false;
    void (async () => {
      const tenantId = await getCurrentTenantId();
      if (!tenantId || cancelled) return;
      const tag = `#WO:${currentOrderId}`;
      const filter = isUuid(currentOrderId)
        ? `work_order_id.eq.${currentOrderId},notes.ilike.%${tag}%`
        : `notes.ilike.%${tag}%`;
      const { data, error } = await supabase.from("sales_documents")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(filter)
        .limit(10);
      if (error) throw error;
      if (!cancelled) await Promise.all((data || []).map((row) => salesStore.refreshOne(row.id)));
    })().catch((error) => console.warn("[WorkOrderDetail] linked sales documents unavailable", error));
    return () => { cancelled = true; };
  }, [currentOrderId]);
  const linkedInvoice = useMemo<SalesDoc | undefined>(() => {
    if (!currentOrderId) return undefined;
    const tag = `#WO:${currentOrderId}`;
    const key = `WO-${currentOrderId}`;
    return salesDocs.invoices
      .find((d) => d.fromDocId === key || (d.notes || "").includes(tag));
  }, [currentOrderId, salesDocs.invoices]);
  const linkedQuote = useMemo<SalesDoc | undefined>(() => {
    if (!currentOrderId) return undefined;
    const tag = `#WO:${currentOrderId}`;
    const key = `WO-${currentOrderId}`;
    return salesDocs.quotes
      .find((d) => d.fromDocId === key || (d.notes || "").includes(tag));
  }, [currentOrderId, salesDocs.quotes]);
  const primaryFinancialInvoice = financialQuery.data?.invoices[0] || null;
  const payableFinancialInvoice = financialQuery.data?.invoices.find((invoice) => invoice.remaining > 0.001) || null;
  const paymentTarget = useMemo(
    () => paymentInvoice ? paymentTargetFromWorkOrderInvoice(paymentInvoice) : null,
    [paymentInvoice],
  );

  // ابحث عن مطالبة تأمين مرتبطة بهذا الأمر (عبر رقم المطالبة أو job_order_id)
  const [linkedClaim, setLinkedClaim] = useState<{ id: string; claim_number: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLinkedClaim(null);
    if (!currentOrderId) return;
    (async () => {
      try {
        const tenantId = await getCurrentTenantId();
        if (!tenantId || cancelled) return;
        let row: any = null;
        if (currentOrderClaimId && UUID_RE.test(currentOrderClaimId)) {
          const { data, error } = await supabase
            .from("insurance_claims")
            .select("id, claim_number")
            .eq("tenant_id", tenantId)
            .eq("id", currentOrderClaimId)
            .maybeSingle();
          if (error) throw error;
          row = data;
        }
        const cn = (currentOrderClaimNumber || "").trim();
        if (!row && cn && cn !== "-") {
          const { data, error } = await supabase
            .from("insurance_claims")
            .select("id, claim_number")
            .eq("tenant_id", tenantId)
            .eq("claim_number", cn)
            .maybeSingle();
          if (error) throw error;
          row = data;
        }
        if (!row) {
          const candidateJobOrderIds = Array.from(new Set([
            currentOrderCloudId,
            cloudJobOrderId,
            UUID_RE.test(currentOrderId) ? currentOrderId : null,
          ].filter(Boolean))) as string[];
          for (const jobOrderId of candidateJobOrderIds) {
            const { data, error } = await supabase
              .from("insurance_claims")
              .select("id, claim_number")
              .eq("tenant_id", tenantId)
              .or(`auto_job_order_id.eq.${jobOrderId},job_order_id.eq.${jobOrderId}`)
              .maybeSingle();
            if (error) throw error;
            if (data) {
              row = data;
              break;
            }
          }
        }
        if (!cancelled && row) setLinkedClaim(row);
      } catch (error) { console.warn("[WorkOrderDetail] linked claim unavailable", error); }
    })();
    return () => { cancelled = true; };
  }, [currentOrderId, currentOrderCloudId, currentOrderClaimId, currentOrderClaimNumber, cloudJobOrderId]);

  useEffect(() => {
    let cancelled = false;
    if (!currentOrderId) {
      setUnifiedMedia([]);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const rows = await listUnifiedVehicleMedia({
          claimId: currentOrderClaimId || null,
          workOrderId: currentOrderCloudId || cloudJobOrderId || (UUID_RE.test(currentOrderId) ? currentOrderId : null),
        });
        if (!cancelled) setUnifiedMedia(rows);
      } catch (error) {
        console.warn("[work order unified media] load skipped", error);
        if (!cancelled) setUnifiedMedia([]);
      }
    })();
    return () => { cancelled = true; };
  }, [currentOrderClaimId, currentOrderCloudId, currentOrderId, currentOrderPhotos, cloudJobOrderId]);

  async function handleRestoreDeletedOrder() {
    if (!order?.deletedAt || !allowDelete || restoring) return;
    setRestoring(true);
    try {
      const restored = await restoreWorkOrderFromTrash(order);
      setOrder(restored);
      toast.success(isEnglish ? "Work order restored. Its delivery and archive status were preserved." : "استُعيد أمر العمل مع الحفاظ على حالة التسليم والأرشفة.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (isEnglish ? "Could not restore the work order" : "تعذرت استعادة أمر العمل"));
    } finally {
      setRestoring(false);
    }
  }

  if (loadingRemote) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {isEnglish ? "Checking the work order in the cloud…" : "جارٍ التحقق من أمر العمل في السحابة…"}
      </div>
    );
  }

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

  if (order.deletedAt) {
    const deletedNumber = order.displayNumber || order.id;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Button variant="ghost" onClick={() => smartBack(navigate, "/work-orders")} className="gap-2">
          <ArrowRight size={16} /> {isEnglish ? "Back to work orders" : "العودة إلى أوامر العمل"}
        </Button>
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={20} />
            <h1 className="text-lg font-bold">{isEnglish ? "Deleted work order" : "أمر عمل محذوف"}</h1>
          </div>
          <p className="font-mono font-semibold" dir="ltr">{deletedNumber}</p>
          <p className="text-sm text-muted-foreground">
            {isEnglish
              ? "This work order is soft-deleted in the cloud. Editing, delivery and financial actions are unavailable until it is restored. Restoring will not create another order or reopen a delivered vehicle."
              : "هذا الأمر محذوف منطقيًا في السحابة. التعديل والتسليم والإجراءات المالية غير متاحة قبل الاستعادة. لن تنشئ الاستعادة أمرًا جديدًا ولن تعيد مركبة مُسلّمة إلى قائمة الورشة النشطة."}
          </p>
          {allowDelete && (
            <Button onClick={() => void handleRestoreDeletedOrder()} disabled={restoring} className="gap-2">
              {restoring ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              {isEnglish ? "Restore work order" : "استعادة أمر العمل"}
            </Button>
          )}
          {!allowDelete && <p className="text-sm text-muted-foreground">{isEnglish ? "Ask an administrator or manager to restore it." : "اطلب الاستعادة من المدير أو المسؤول."}</p>}
        </div>
      </div>
    );
  }

  const currentIdx = WORK_ORDER_STATUSES.indexOf(normalizeWorkOrderStatus(order.status));
  const partsNeeded = order.partsNeeded || [];
  const photos = mergeWorkOrderMedia(unifiedMedia, [...resolvedLegacyPhotos, ...attachedPhotos]);
  const vehiclePhotos = photos.filter((photo) => photo.phase !== "inspection");
  const inspectionPhotos = photos.filter((photo) => photo.phase === "inspection");
  // رقم العرض الرسمي (WO-C-YY-NNNN / WO-I-YY-NNNN) المستخدم بدل UUID.
  const displayNo = order.displayNumber || (UUID_RE.test(order.id) ? `WO-${order.id.slice(0, 8).toUpperCase()}` : order.id);
  const effectiveLinkedClaim = linkedClaim || (order.claimId && UUID_RE.test(order.claimId)
    ? { id: order.claimId, claim_number: order.claimNumber && order.claimNumber !== "-" ? order.claimNumber : "مطالبة مرتبطة" }
    : null);
  const insuranceApprovedBreakdown = splitVatInclusiveAmount(order.insuranceApprovedAmount || 0, 0.05);
  const hasInsuranceApprovedAmount = insuranceApprovedBreakdown.totalIncludingVat > 0;
  const linkedInvoiceTotal = Number(financialQuery.data?.total || 0);
  const hasLinkedInvoiceTotal = linkedInvoiceTotal > 0;
  const displayedClaimTotal =
    hasLinkedInvoiceTotal
      ? linkedInvoiceTotal
      : hasInsuranceApprovedAmount
      ? insuranceApprovedBreakdown.totalIncludingVat
      : Number(order.totalCost) || 0;
  const displayedLaborCharges =
    Number(order.laborCost) > 0
      ? Number(order.laborCost)
      : 0;
  const displayedPartsCost = expensesReady
    ? partsExpenseTotal
    : Number(order.partsCost) || 0;

  function openLaborEditor() {
    setLaborDraft(displayedLaborCharges);
    setLaborEditOpen(true);
  }

  async function saveLaborCharges() {
    if (!order.cloudId || !isUuid(order.cloudId)) {
      toast.error("تعذر تحديد أمر العمل في قاعدة البيانات");
      return;
    }
    const amount = Number(laborDraft);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("أدخل أجرة عمل صحيحة");
      return;
    }

    setSavingLabor(true);
    try {
      const { data, error } = await (supabase.from("job_orders") as any)
        .update({ labor_cost: amount, updated_at: new Date().toISOString() })
        .eq("id", order.cloudId)
        .is("deleted_at", null)
        .select("id,labor_cost")
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) throw new Error("أمر العمل غير موجود أو محذوف");

      const savedLabor = Number(data.labor_cost || 0);
      const updatedOrder: WorkOrder = {
        ...order,
        laborCost: savedLabor,
        totalCost: savedLabor + Number(order.partsCost || 0),
      };
      setOrder(upsertWorkOrderInCache(updatedOrder));
      setLaborEditOpen(false);
      toast.success("تم تحديث أجرة العمل");
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحديث أجرة العمل");
    } finally {
      setSavingLabor(false);
    }
  }

  async function handlePrintWorkOrder() {
    // Pre-build tracking QR into the cache before sync HTML render
    const { buildTrackingQrDataUrl } = await import("@/lib/pdfGenerator");

    // Fetch customer signature if available (from portal token)
    let effectiveTrackingToken = order!.trackingToken;
    let customerSignatureDataUrl: string | undefined;
    let customerSignatureName: string | undefined;
    let customerSignatureDate: string | undefined;
    if (cloudJobOrderId) {
      const ensuredToken = await ensureCustomerPortalToken(cloudJobOrderId);
      const { data: tok } = await supabase
        .from("customer_portal_tokens")
        .select("token, signature_data_url, signer_name, signed_at")
        .eq("job_order_id", cloudJobOrderId)
        .maybeSingle();
      const t: any = tok;
      if (t?.token || ensuredToken?.token) effectiveTrackingToken = t?.token || ensuredToken?.token;
      if (t?.signature_data_url) {
        customerSignatureDataUrl = t.signature_data_url;
        customerSignatureName = t.signer_name || undefined;
        customerSignatureDate = t.signed_at ? new Date(t.signed_at).toLocaleString("en-GB") : undefined;
      }
    }
    if (effectiveTrackingToken) await buildTrackingQrDataUrl(effectiveTrackingToken);

    const html = getWorkOrderHtml({
      orderNumber: order!.displayNumber || (UUID_RE.test(order!.id) ? `WO-${order!.id.slice(0, 8).toUpperCase()}` : order!.id),
      workOrderType: resolveWorkOrderType(order!),
      trackingToken: effectiveTrackingToken,
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
      workItems: order!.workItems,
      partsNeeded: order!.partsNeeded,
      photos: photos.map((p) => ({ phase: p.phase, dataUrl: p.dataUrl, caption: p.caption })),
      customerSignatureDataUrl,
      customerSignatureName,
      customerSignatureDate,
    });
    setPreviewHtml(html);
    setPreviewTitle(`أمر عمل ${order!.displayNumber || order!.id}`);
    setPreviewOpen(true);
  }

  async function handleDownloadPhotosPdf() {
    if (!order || photoPdfBusy) return;
    if (!photos.length) {
      toast.info(label("لا توجد صور لتنزيلها", "There are no photos to download"));
      return;
    }
    setPhotoPdfBusy(true);
    setPhotoPdfProgress(0);
    try {
      const [{ generateWorkOrderPhotosPdf }, { downloadBlob }] = await Promise.all([
        import("@/lib/workOrderPhotoPdf"),
        import("@/lib/photoAlbumPdf"),
      ]);
      const orderedPhotos = [...photos].sort((a, b) =>
        PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || (a.uploadedAt || "").localeCompare(b.uploadedAt || ""));
      const blob = await generateWorkOrderPhotosPdf(orderedPhotos, displayNo, (completed) => setPhotoPdfProgress(completed));
      downloadBlob(blob, `${displayNo}-photos.pdf`);
      toast.success(label(`تم تجهيز ${photos.length} صورة في ملف PDF`, `${photos.length} photos are ready in one PDF`));
    } catch (error) {
      console.error("[work order photos] PDF export failed", error);
      const failedImage = /PHOTO_PDF_IMAGE_FAILED:(\d+)/.exec(String(error));
      toast.error(failedImage
        ? label(`تعذر قراءة الصورة رقم ${failedImage[1]}؛ لم يُنشأ ملف ناقص. أعد فتح الصفحة وحاول مجددًا.`, `Photo ${failedImage[1]} could not be read. No incomplete PDF was downloaded. Reopen the page and retry.`)
        : label("تعذر تجهيز PDF الصور. لم يُنزّل ملف ناقص.", "Could not prepare the photo PDF. No incomplete file was downloaded."));
    } finally {
      setPhotoPdfBusy(false);
    }
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
    <div className="min-w-0 space-y-4" data-testid="work-order-detail-page">
      <header data-testid="work-order-control-center" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex min-w-0 items-start gap-3 p-4 sm:items-center sm:p-5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => smartBack(navigate, "/work-orders")}
            aria-label={label("العودة إلى أوامر العمل", "Back to work orders")}
            className="h-10 w-10 shrink-0"
          >
            <ArrowRight size={18} className={isEnglish ? "rotate-180" : ""} />
          </Button>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <WorkOrderTypeBadge
                workOrderType={order.workOrderType}
                claimId={order.claimId}
                claimNumber={order.claimNumber}
                insurance={order.insurance}
                locale={isEnglish ? "en" : "ar"}
              />
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${workOrderStatusColor(order.status)}`}>
                {isEnglish ? STATUS_EN[normalizeWorkOrderStatus(order.status)] || order.status : normalizeWorkOrderStatus(order.status)}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="shrink-0 whitespace-nowrap font-mono text-xl font-bold tracking-tight text-primary sm:text-2xl" dir="ltr">
                {displayNo}
              </h1>
              <span className="text-sm font-medium text-muted-foreground">{label("تفاصيل أمر العمل", "Work order details")}</span>
            </div>
            <p className="truncate text-sm text-foreground" title={`${order.customer} · ${order.vehicleType} ${order.model} · ${order.plate}`}>
              {order.customer} <span className="text-muted-foreground">·</span> {order.vehicleType} {order.model} <span className="text-muted-foreground">·</span> <bdi dir="ltr">{order.plate}</bdi>
            </p>
          </div>
          <VehicleAvatar
            size="md"
            vehicleId={order.vehicleId}
            imageUrl={order.vehicleThumbnailUrl || order.vehicleImageUrl}
            fallbackPhotos={photos.map((photo) => photo.dataUrl)}
            label={`${order.vehicleType} ${order.model}`.trim() || order.plate}
            className="hidden shrink-0 lg:flex"
          />
        </div>
        <div className="border-t border-border bg-muted/20 px-4 py-3 sm:px-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">{label("تقدم العمل", "Work progress")}</span>
            <span className="text-muted-foreground">{Math.max(currentIdx + 1, 1)} / {WORK_ORDER_STATUSES.length}</span>
          </div>
          <div className="flex gap-1" role="progressbar" aria-valuenow={Math.max(currentIdx + 1, 1)} aria-valuemin={0} aria-valuemax={WORK_ORDER_STATUSES.length} aria-label={label("تقدم أمر العمل", "Work order progress")}>
            {WORK_ORDER_STATUSES.map((status, index) => (
              <span
                key={status}
                title={isEnglish ? STATUS_EN[status] : status}
                className={`h-1.5 min-w-0 flex-1 rounded-full ${index <= currentIdx ? "bg-primary" : "bg-border"}`}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-2 hidden text-xs font-semibold text-muted-foreground lg:block">{label("الإجراءات السريعة", "Quick actions")}</div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button size="sm" variant="outline" onClick={() => { statusDirtyRef.current = true; setStatusOpen(true); }} className="min-h-10 gap-1.5">
            <Workflow size={15} /> {label("تغيير الحالة", "Change status")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { photoDirtyRef.current = true; setPhotosOpen(true); }} className="min-h-10 gap-1.5">
            <Camera size={15} /> {label("الصور", "Photos")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setWaTab("templates"); setWaOpen(true); }} className="min-h-10 gap-1.5 text-success">
            <MessageCircle size={15} /> {label("واتساب", "WhatsApp")}
          </Button>
          <Button size="sm" onClick={handlePrintWorkOrder} className="min-h-10 gap-1.5 gradient-gold text-primary-foreground">
            <Printer size={15} /> {label("طباعة / PDF", "Print / PDF")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setActionsExpanded((value) => !value)} aria-expanded={actionsExpanded} aria-controls="work-order-secondary-actions" className="col-span-2 min-h-10 gap-1.5 sm:ms-auto lg:hidden">
            <MoreHorizontal size={16} /> {label("بقية الإجراءات", "More actions")} <ChevronDown size={14} className={actionsExpanded ? "rotate-180" : ""} />
          </Button>
        </div>
        <div id="work-order-secondary-actions" className={`${actionsExpanded ? "flex" : "hidden lg:flex"} mt-3 min-w-0 flex-wrap items-center gap-3 border-t border-border pt-3`}>
          {/* Secondary operations are available on demand without repeating the quick actions. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
            {allowEdit && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="min-h-10 gap-1.5 text-xs">
                <Edit size={14} className="text-info" /> {label("تعديل", "Edit")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setExpenseOpen(true)} className="min-h-10 gap-1.5 text-xs">
              <Receipt size={14} className="text-warning" /> {label("إضافة مصروف", "Add expense")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setQrOpen(true)} className="min-h-10 gap-1.5 text-xs">
              <QrCode size={14} className="text-primary" /> {label("رابط العميل QR", "Customer QR")}
            </Button>
          </div>

          <div className="flex items-center rounded-lg bg-muted/30 p-2">
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
              buttonLabel={label("إيميل", "Email")}
              buttonSize="sm"
              buttonClassName="min-h-10 gap-1.5 text-xs text-info hover:bg-info/10"
            />
          </div>

          {/* المطالبة المرتبطة */}
          {effectiveLinkedClaim && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/insurance/${effectiveLinkedClaim.id}`)}
              className="h-9 gap-1.5 border-info/40 text-info hover:bg-info/10"
              title={label("فتح المطالبة التأمينية المرتبطة", "Open linked insurance claim")}
            >
              <ShieldCheck size={14} />
              {label("فتح المطالبة", "Open claim")} <span className="font-mono text-xs">{effectiveLinkedClaim.claim_number}</span>
            </Button>
          )}
          {/* المجموعة 3: الفواتير والطباعة */}
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={
                    linkedInvoice || primaryFinancialInvoice
                      ? "h-9 gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                      : "h-9 gap-1.5 border-success/40 text-success hover:bg-success/10"
                  }
                >
                  {linkedInvoice || primaryFinancialInvoice ? <Receipt size={14} /> : <FilePlus2 size={14} />}
                  {linkedInvoice || primaryFinancialInvoice
                    ? `${label("الفاتورة", "Invoice")} ${linkedInvoice?.number || primaryFinancialInvoice?.number}`
                    : label("فاتورة", "Invoice")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {linkedInvoice && (
                  <>
                    <DropdownMenuLabel className="text-xs flex items-center justify-between">
                      <span>{label("الفاتورة المرتبطة", "Linked invoice")}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusLabel(linkedInvoice.status).cls}`}>
                        {statusLabel(linkedInvoice.status)[isEnglish ? "en" : "ar"]}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/invoices/${linkedInvoice.id}`)}
                      className="gap-2"
                    >
                      <Eye size={14} className="text-info" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">{label("عرض الفاتورة", "View invoice")}</span>
                        <span className="text-xs text-muted-foreground">
                          {label("الإجمالي", "Total")}: {linkedInvoice.total.toFixed(3)} — {label("المتبقي", "Remaining")}: {linkedInvoice.balanceDue.toFixed(3)}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/invoices/${linkedInvoice.id}/edit`)}
                      className="gap-2"
                    >
                      <Edit size={14} className="text-warning" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">{label("تعديل الفاتورة", "Edit invoice")}</span>
                        <span className="text-xs text-muted-foreground">
                          {label("تعديل البنود والمدفوعات والإعدادات", "Edit items, payments and settings")}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {!linkedInvoice && primaryFinancialInvoice?.kind === "insurance_invoice" && (
                  <>
                    <DropdownMenuLabel className="text-xs">{label("الفاتورة التأمينية المرتبطة", "Linked insurance invoice")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => primaryFinancialInvoice.claimId && navigate(`/insurance/${primaryFinancialInvoice.claimId}?tab=payments`)}
                      className="gap-2"
                    >
                      <Eye size={14} className="text-info" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">{label("فتح الفاتورة والتحصيل", "Open invoice and collections")}</span>
                        <span className="text-xs text-muted-foreground">
                          {label("الإجمالي", "Total")}: {primaryFinancialInvoice.total.toFixed(3)} — {label("المتبقي", "Remaining")}: {primaryFinancialInvoice.remaining.toFixed(3)}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuLabel className="text-xs">
                  {linkedInvoice ? label("إنشاء فاتورة إضافية", "Create another invoice") : label("اختر نوع الفاتورة", "Choose invoice type")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => navigate(`/sales/invoices/new?fromWorkOrder=${order.id}`)}
                  className="gap-2"
                >
                  <User size={14} className="text-primary" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{label("فاتورة عميل", "Customer invoice")} {linkedInvoice ? label("جديدة", "new") : ""}</span>
                    <span className="text-xs text-muted-foreground">{label("فاتورة بيع للزبون مباشرة", "Direct customer sales invoice")}</span>
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
                    <span className="text-sm font-semibold">{label("فاتورة تأمينية", "Insurance invoice")}</span>
                    <span className="text-xs text-muted-foreground">
                      {order.claimNumber && order.claimNumber !== "-"
                        ? label("بالقالب الرسمي ورقم المطالبة وLPO", "Official template, claim number and LPO")
                        : label("يحتاج ربط أمر العمل بمطالبة تأمين", "Link an insurance claim first")}
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
                  {linkedQuote ? `${label("العرض", "Quote")} ${linkedQuote.number}` : label("عرض سعر", "Quote")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {linkedQuote && (
                  <>
                    <DropdownMenuLabel className="text-xs flex items-center justify-between">
                      <span>{label("عرض السعر المرتبط", "Linked quote")}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusLabel(linkedQuote.status).cls}`}>
                        {statusLabel(linkedQuote.status)[isEnglish ? "en" : "ar"]}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/quotes/${linkedQuote.id}`)}
                      className="gap-2"
                    >
                      <Eye size={14} className="text-info" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">{label("عرض", "View")}</span>
                        <span className="text-xs text-muted-foreground">
                          {label("الإجمالي", "Total")}: {linkedQuote.total.toFixed(3)}
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigate(`/sales/quotes/${linkedQuote.id}/edit`)}
                      className="gap-2"
                    >
                      <Edit size={14} className="text-warning" /> <span className="text-sm font-semibold">{label("تعديل", "Edit")}</span>
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
                        <span className="text-sm font-semibold">{label("تحويل إلى فاتورة", "Convert to invoice")}</span>
                        <span className="text-xs text-muted-foreground">
                          {linkedQuote.status === "converted" ? label("تم التحويل مسبقاً", "Already converted") : label("إنشاء فاتورة من بنود العرض", "Create invoice from quote items")}
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
                    <span className="text-sm font-semibold">{linkedQuote ? label("عرض سعر إضافي", "Another quote") : label("إنشاء عرض سعر", "Create quote")}</span>
                    <span className="text-xs text-muted-foreground">{label("يجلب بيانات أمر العمل تلقائياً", "Uses work-order details")}</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>


            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 gap-1.5 border-warning/40 text-warning hover:bg-warning/10">
                  <Package size={14} /> {label("طلب شراء", "Purchase request")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 space-y-3" align="end">
                <div>
                  <Label className="text-xs">{label("تاريخ الطلب", "Request date")}</Label>
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
                  <Printer size={14} /> {label("معاينة وطباعة", "Preview and print")}
                </Button>
              </PopoverContent>
            </Popover>

            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/work-orders/${encodeURIComponent(order.displayNumber || order.id)}/delivery`, {
                state: { returnTo: `/work-orders/${encodeURIComponent(order.displayNumber || order.id)}` },
              })}
              className="h-9 gap-1.5 border-success/40 text-success hover:bg-success/10"
            >
              <FileText size={14} /> {label("خروج وتسليم المركبة", "Vehicle delivery")}
            </Button>

          </div>

          {/* المجموعة 4: الإجراء الخطر */}
          {allowDelete && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              className="ms-auto min-h-10 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={14} /> {label("حذف", "Delete")}
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards wrap into two readable columns on tablets. */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Section icon={<User size={14} />} title={label("العميل", "Customer")}>
          <Row label={label("الاسم", "Name")} value={order.customer} />
          <Row label={label("الهاتف", "Phone")} value={order.phone} mono />
        </Section>
        <Section icon={<Car size={14} />} title={label("المركبة", "Vehicle")}>
          <Row label={label("النوع", "Make / model")} value={`${order.vehicleType} ${order.model} ${order.year}`} />
          <Row label={label("اللوحة", "Plate")} value={order.plate} mono />
          <Row label={label("رقم الهيكل", "VIN")} value={order.vin || "-"} mono />
          <Row label={label("اللون", "Color")} value={order.color || "-"} />
          <Row label={label("الكيلومترات", "Mileage")} value={order.mileage ? `${order.mileage} ${label("كم", "km")}` : "-"} />
        </Section>
        <Section icon={<Wrench size={14} />} title={label("العمل", "Work")}>
          <Row label={label("نوع الخدمة", "Service")} value={order.serviceType} />
          <Row label={label("الفني", "Technician")} value={order.technician || "-"} />
          <Row label={label("تاريخ الدخول", "Entry date")} value={order.entryDate} />
        </Section>
        <Section icon={<ShieldCheck size={14} />} title={label("التأمين والتكلفة", "Insurance & cost")}>
          <Row label={label("شركة التأمين", "Insurer")} value={order.insurance} />
          <Row label={label("رقم المطالبة", "Claim no.")} value={order.claimNumber} mono />
          {hasInsuranceApprovedAmount && (
            <Row
              label={label("المبلغ المعتمد من التأمين", "Insurance approved amount")}
              value={formatCurrencyEnglish(insuranceApprovedBreakdown.totalIncludingVat, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, "OMR")}
              highlight
              amount
            />
          )}
          {hasInsuranceApprovedAmount && (
            <>
              <Row label={label("المبلغ قبل الضريبة", "Subtotal before VAT")} value={formatCurrencyEnglish(insuranceApprovedBreakdown.subtotalBeforeVat, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, "OMR")} amount />
              <Row label="VAT 5%" value={formatCurrencyEnglish(insuranceApprovedBreakdown.vatAmount, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, "OMR")} amount />
            </>
          )}
          {order.lumpSumNotItemized && (
            <Row label={label("مبلغ مقطوع", "Lump sum")} value={label("اعتماد مبلغ مقطوع دون تفصيل", "Lump sum approval, not itemized")} />
          )}
          <Row label={label("أجرة العمل", "Labor charges")} value={formatCurrencyEnglish(displayedLaborCharges, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, "OMR")} amount />
          {allowEdit && (
            <Button type="button" size="sm" variant="outline" className="min-h-9 w-full gap-1 text-xs" onClick={openLaborEditor}>
              <Edit size={12} /> {label("تعديل أجرة العمل", "Edit labor charges")}
            </Button>
          )}
          <Row label={label("تكلفة قطع الغيار الفعلية", "Actual parts cost")} value={formatCurrencyEnglish(displayedPartsCost, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, "OMR")} amount />
          <Row
            label={hasLinkedInvoiceTotal ? label("إجمالي الفواتير شامل الضريبة", "Invoice total incl. VAT") : label("الإجمالي شامل الضريبة", "Total incl. VAT")}
            value={formatCurrencyEnglish(displayedClaimTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, "OMR")}
            highlight
            amount
          />
        </Section>
      </div>

      {order.diagnosis && (
        <div className="bg-secondary/30 border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">{label("التشخيص / ملاحظات", "Diagnosis / notes")}</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{order.diagnosis}</p>
        </div>
      )}

      {/* Desktop workspace: two balanced columns; mobile remains a single readable flow. */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
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

        {/* Customer-facing links and updates share one compact desktop column. */}
        {cloudJobOrderId ? (
          <div className="space-y-3">
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
              status={normalizeWorkOrderStatus(order.status)}
              customerName={order.customer}
              customerPhone={order.phone}
            />
            <div className="flex justify-end rounded-lg border border-border/60 bg-card px-3 py-2">
              <SendStageNotificationButton jobOrderId={cloudJobOrderId} status={normalizeWorkOrderStatus(order.status)} />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
            {label("روابط العميل وإرسال التحديثات غير متاحة — هذا الأمر غير مزامن مع السحابة بعد.", "Customer links are unavailable until this work order is synced to the cloud.")}
          </div>
        )}
      </div>

      {/* ملاحظات العملاء من بوابة QR تظهر الآن في صفحة /messages "المراسلات" */}

      {/* Supplements — additional work requiring customer approval (placed directly under needed parts) */}
      {cloudJobOrderId ? (
        <SupplementsSection
          jobOrderId={cloudJobOrderId}
          customerName={order.customer}
          customerPhone={order.phone}
          onPhotosChanged={() => setMediaRevision((value) => value + 1)}
        />
      ) : (
        <div className="bg-card border border-dashed border-border rounded-xl p-4 text-center text-xs text-muted-foreground">
          {label("الأعمال الإضافية ورابط موافقة العميل غير متاحة — هذا الأمر غير مزامن مع السحابة بعد.", "Supplements and customer approval are unavailable until this work order is synced to the cloud.")}
        </div>
      )}

      {/* Approval history (customer signature log) */}
      {cloudJobOrderId && <ApprovalHistoryTab jobOrderId={cloudJobOrderId} />}

      <section className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4" aria-label={label("الصور والمستندات", "Photos and documents")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ImageIcon size={16} className="text-primary" />
            {label("الصور والمستندات", "Photos and documents")}
          </h2>
          <Button size="sm" variant="outline" onClick={() => void handleDownloadPhotosPdf()} disabled={!photos.length || photoPdfBusy} className="min-h-10 gap-2">
            {photoPdfBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {photoPdfBusy
              ? label(`تجهيز الصور ${photoPdfProgress}/${photos.length}`, `Preparing photos ${photoPdfProgress}/${photos.length}`)
              : label(`تنزيل جميع الصور PDF (${photos.length})`, `Download all photos PDF (${photos.length})`)}
          </Button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-3">
          <MediaGroup
            title={label("صور المركبة ومراحل الإصلاح", "Vehicle and repair photos")}
            photos={vehiclePhotos}
            phases={PHASES.filter((phase) => phase !== "inspection")}
            isEnglish={isEnglish}
            onOpen={setLightboxUrl}
          />
          <MediaGroup
            title={label("صور الفحص", "Inspection photos")}
            photos={inspectionPhotos}
            phases={["inspection"]}
            isEnglish={isEnglish}
            onOpen={setLightboxUrl}
          />
          <div className="min-w-0 rounded-lg border border-border bg-muted/15 p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
              <FileText size={14} className="text-info" /> {label("المستندات", "Documents")}
            </h3>
            {effectiveLinkedClaim ? (
              <>
                <p className="mb-2 text-xs text-muted-foreground">{label("مستندات التأمين محفوظة في المطالبة المرتبطة؛ لا تُنشأ نسخة ثانية هنا.", "Insurance documents remain in the linked claim; no duplicate is stored here.")}</p>
                <Button size="sm" variant="outline" className="min-h-9 max-w-full gap-1" onClick={() => navigate(`/insurance/${effectiveLinkedClaim.id}`)}>
                  <Eye size={14} /> {label("فتح مستندات المطالبة", "Open claim documents")}
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{label("لا توجد مطالبة مرتبطة لعرض مستنداتها.", "No linked claim documents are available.")}</p>
            )}
          </div>
        </div>
      </section>

      {/* Inspections + Vouchers */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-border bg-card p-4 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Wallet size={16} className="text-success" />
              {label("الفواتير والتحصيل الرسمي", "Invoices and collections")}
              <span className="text-xs text-muted-foreground font-normal">
                ({financialQuery.data?.invoices.length || 0})
              </span>
            </h2>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-success/40 text-success hover:bg-success/10"
              disabled={financialQuery.isLoading || !payableFinancialInvoice}
              onClick={() => payableFinancialInvoice && setPaymentInvoice(payableFinancialInvoice)}
            >
              <Wallet size={13} />
              {payableFinancialInvoice ? label("إضافة دفعة", "Add payment") : label("لا يوجد رصيد مستحق", "No outstanding balance")}
            </Button>
          </div>
          {!!financialQuery.data?.invoices.length && (
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FinancialMetric label={label("الإيراد الرسمي قبل الضريبة", "Recognized revenue before VAT")} value={actualRevenue} tone="success" />
              <FinancialMetric label={label("المبلغ المحصل", "Amount collected")} value={actualCollected} tone="success" />
              <FinancialMetric label={label("الرصيد المتبقي", "Balance due")} value={actualOutstanding} />
            </div>
          )}
          {financialQuery.isLoading ? (
            <p className="py-2 text-center text-xs text-muted-foreground">{label("جاري مزامنة الفواتير والدفعات…", "Syncing invoices and payments…")}</p>
          ) : financialQuery.isError ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <span>{label("تعذر تحميل الفاتورة والدفعات المرتبطة.", "Could not load the linked invoices and payments.")}</span>
              <Button size="sm" variant="outline" onClick={() => void financialQuery.refetch()}>{label("إعادة المحاولة", "Retry")}</Button>
            </div>
          ) : !financialQuery.data?.invoices.length ? (
            <p className="rounded-lg border border-dashed p-2 text-center text-xs text-muted-foreground">
              {label("لا توجد فاتورة معتمدة مرتبطة بأمر العمل. يجب إنشاء الفاتورة أولًا قبل تسجيل دفعة رسمية.", "No approved invoice is linked. Create one before recording a payment.")}
            </p>
          ) : (
            <div className="space-y-2">
              {financialQuery.data.invoices.map((invoice) => (
                <div key={`${invoice.kind}:${invoice.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-secondary/20 p-3">
                  <div>
                    <div className="text-sm font-semibold">{invoice.number}</div>
                    <div className="text-xs text-muted-foreground">
                      {invoice.kind === "insurance_invoice" ? label("فاتورة تأمين", "Insurance invoice") : label("فاتورة كاش", "Cash invoice")}
                      {` · ${label("الإجمالي", "Total")} ${invoice.total.toFixed(3)} · ${label("المدفوع", "Paid")} ${invoice.paid.toFixed(3)} · ${label("المتبقي", "Remaining")} ${invoice.remaining.toFixed(3)} OMR`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={invoice.remaining <= 0.001}
                    onClick={() => setPaymentInvoice(invoice)}
                  >
                    <Wallet size={13} />
                    {invoice.remaining <= 0.001 ? label("مدفوعة بالكامل", "Paid in full") : label("إضافة دفعة لهذه الفاتورة", "Add payment to this invoice")}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {!!financialQuery.data?.invoices.length && <p className="mt-3 text-xs text-muted-foreground">
            {label("الإيراد يُثبت من الفاتورة المعتمدة قبل الضريبة، والدفعة تُسجل كتحصيل رسمي دون مضاعفة الإيراد.", "Revenue comes from the approved invoice before VAT. Payments collect that invoice without duplicating revenue.")}
          </p>}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <SearchIcon size={16} className="text-primary" />
              {label("الفحوصات المرتبطة", "Linked inspections")}
              <span className="text-xs text-muted-foreground font-normal">({inspections.length})</span>
            </h2>
            <Button size="sm" variant="outline" onClick={openNewInspection} className="gap-1 h-8">
              <FilePlus2 size={12} /> {label("فحص جديد", "New inspection")}
            </Button>
          </div>
          {inspections.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-1">{label("لا توجد فحوصات بعد.", "No inspections yet.")}</p>
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
              {label("سندات الصرف المرتبطة", "Linked expense vouchers")}
              <span className="text-xs text-muted-foreground font-normal">({linkedVouchers.length})</span>
            </h2>
            <span className="text-xs font-bold text-warning">
              {vouchersTotal.toLocaleString()} OMR
            </span>
          </div>
          {(linkedVouchers.length > 0 || actualRevenue > 0) && <>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <FinancialMetric label={label("تكلفة قطع الغيار الفعلية", "Actual parts cost")} value={partsExpenseTotal} tone="warning" />
              <FinancialMetric label={label("مصروفات فعلية أخرى", "Other direct costs")} value={otherExpenseTotal} />
              <FinancialMetric label={label("إجمالي التكلفة قبل الضريبة", "Total cost before VAT")} value={vouchersTotal} tone="warning" />
              <FinancialMetric label={label("ضريبة المدخلات على المصروفات", "Input VAT on expenses")} value={expenseVatTotal} />
              <FinancialMetric label={label("إجمالي المنفق على السيارة شامل الضريبة", "Total vehicle spending incl. VAT")} value={cashSpentTotal} tone="warning" />
              <FinancialMetric label={label("الربح الفعلي حتى الآن", "Actual profit to date")} value={actualProfit} tone={actualProfit < 0 ? "danger" : "success"} className="sm:col-span-2 lg:col-span-3" />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {label("الإيراد من الفواتير المعتمدة قبل الضريبة فقط، والتكلفة من سندات الصرف الفعلية. التقديرات لا تدخل في الربح الفعلي.", "Revenue comes from approved invoices before VAT; costs come from actual linked vouchers. Estimates are excluded from actual profit.")}
            </p>
          </>}
          {orderExpensesQuery.isError && linkedVouchers.length === 0 ? (
            <div className="py-4 text-center text-xs text-destructive">
              {label("تعذر تحميل سندات الصرف من السحابة. لا يمكن تأكيد عدم وجود مصروفات.", "Could not load expense vouchers from the cloud. The absence of expenses cannot be confirmed.")}
              <Button variant="outline" size="sm" className="mx-2" onClick={() => void orderExpensesQuery.refetch()}>{label("إعادة المحاولة", "Retry")}</Button>
            </div>
          ) : orderExpensesQuery.isPending && linkedVouchers.length === 0 ? (
            <p role="status" className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-4"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> {label("جاري تحميل سندات الصرف المرتبطة…", "Loading linked expense vouchers…")}</p>
          ) : linkedVouchers.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-1">{label("لا توجد سندات صرف بعد.", "No expense vouchers yet.")}</p>
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
                      {allowManageExpenses && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9 shrink-0 gap-1 px-2 text-[11px]"
                          onClick={() => setEditingExpense(v)}
                          title="تعديل سند الصرف المرتبط"
                        >
                          <Edit size={12} /> تعديل
                        </Button>
                      )}
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
          <WorkOrderForm
            initial={order}
            onClose={() => setEditOpen(false)}
            onSaved={(saved) => {
              setEditOpen(false);
              setOrder(saved);
              if (saved.id !== order.id) {
                navigate(`/work-orders/${encodeURIComponent(saved.id)}`, { replace: true });
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={laborEditOpen} onOpenChange={(open) => !savingLabor && setLaborEditOpen(open)}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle>تعديل أجرة العمل</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="work-order-labor-charge">أجرة العمل (ر.ع)</Label>
            <Input
              id="work-order-labor-charge"
              type="number"
              min="0"
              step="0.001"
              value={laborDraft}
              onChange={(event) => setLaborDraft(Number(event.target.value))}
              disabled={savingLabor}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setLaborEditOpen(false)} disabled={savingLabor}>إلغاء</Button>
            <Button type="button" onClick={() => void saveLaborCharges()} disabled={savingLabor}>
              {savingLabor ? "جاري الحفظ…" : "حفظ"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <WorkOrderStatusDialog
        order={statusOpen ? order : null}
        open={statusOpen}
        onOpenChange={setStatusOpen}
        cloudJobOrderId={cloudJobOrderId}
        onRequestHandover={() => navigate(`/work-orders/${encodeURIComponent(order.displayNumber || order.id)}/delivery`, {
          state: { returnTo: `/work-orders/${encodeURIComponent(order.displayNumber || order.id)}` },
        })}
      />
      <StagePhotosDialog
        orderId={photosOpen ? order.id : null}
        open={photosOpen}
        onClose={() => setPhotosOpen(false)}
      />
      <WorkOrderBulkExpenseDialog
        order={expenseOpen ? order : null}
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        onSaved={() => setExpenseTick((value) => value + 1)}
      />
      <WorkOrderExpenseDialog
        order={convertPart ? order : null}
        open={!!convertPart}
        onOpenChange={(open) => !open && setConvertPart(null)}
        initialRequiredPart={convertPart}
        onExpenseSaved={(expense) => {
          if (!convertPart) return;
          const convertedPartId = convertPart.id;
          setConvertPart(null);
          void updateNeededPartInOrder(order.id, convertedPartId, {
            convertedToExpense: true,
            convertedExpenseId: expense.id,
            convertedAt: new Date().toISOString(),
            status: "secured",
          }).then((saved) => {
            if (!saved) throw new Error("أمر العمل غير موجود");
            toast.success("تم تحويل قطعة الغيار إلى مصروف وربطها بأمر العمل");
          }).catch((error: any) => {
            toast.error(error?.message || "تم حفظ المصروف لكن تعذر تحديث القطعة المرتبطة");
          });
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

      <WorkOrderExpenseDialog
        order={editingExpense ? order : null}
        open={!!editingExpense}
        onOpenChange={(open) => !open && setEditingExpense(null)}
        initialExpense={editingExpense}
        onExpenseSaved={(expense) => setEditingExpense(expense)}
      />

      <UnifiedAddPaymentDialog
        open={!!paymentInvoice}
        onOpenChange={(open) => { if (!open) setPaymentInvoice(null); }}
        initialTarget={paymentTarget}
        lockInitialTarget
        onSaved={() => {
          setPaymentInvoice(null);
          void financialQuery.refetch();
        }}
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
          let removed = deleteWorkOrder(order.id);
          await refreshWorkOrdersFromCloud().catch(() => {});
          deleteWorkOrder(order.id);
          const trashed = removed || order;
          if (trashed) {
            removed = trashed;
            const cloudEntityId = trashed.cloudId && isUuid(trashed.cloudId) ? trashed.cloudId : trashed.id;
            moveToTrash({
              type: "work_order",
              entityId: cloudEntityId,
              label: `${trashed.displayNumber || trashed.id} - ${trashed.customer} - ${trashed.plate}`,
              payload: { ...trashed, cloudId: cloudEntityId },
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
    <div className="min-w-0 rounded-xl border border-border bg-card p-3">
      <p className="mb-2 flex items-center gap-1.5 border-s-2 border-primary ps-2 text-xs font-semibold text-primary">
        {icon}
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function MediaGroup({ title, photos, phases, isEnglish, onOpen }: {
  title: string;
  photos: StagePhoto[];
  phases: StagePhase[];
  isEnglish: boolean;
  onOpen: (url: string) => void;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/15 p-3">
      <h3 className="mb-2 text-xs font-semibold text-foreground">{title} <span className="font-normal text-muted-foreground">({photos.length})</span></h3>
      {photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">{isEnglish ? "No photos yet" : "لا توجد صور بعد"}</p>
      ) : (
        <div className="space-y-3">
          {phases.map((phase) => {
            const phasePhotos = photos.filter((photo) => photo.phase === phase);
            if (phasePhotos.length === 0) return null;
            return (
              <div key={phase}>
                <p className="mb-1 text-xs text-muted-foreground">{STAGE_LABELS[phase][isEnglish ? "en" : "ar"]}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-3">
                  {phasePhotos.map((photo) => (
                    <button key={photo.id} type="button" onClick={() => onOpen(photo.dataUrl)} aria-label={`${isEnglish ? "View photo" : "عرض صورة"} ${photo.caption || STAGE_LABELS[phase][isEnglish ? "en" : "ar"]}`} className="group relative min-w-0 overflow-hidden rounded-lg border border-border bg-muted hover:border-primary/50">
                      <img src={photo.dataUrl} alt={photo.caption || STAGE_LABELS[phase][isEnglish ? "en" : "ar"]} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; const fallback = event.currentTarget.nextElementSibling as HTMLElement | null; if (fallback) fallback.style.display = "flex"; }} />
                      <span className="absolute inset-0 hidden items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground">{isEnglish ? "Photo unavailable" : "الصورة غير متاحة"}</span>
                      {photo.caption && <span className="absolute inset-x-0 bottom-0 truncate bg-foreground/75 px-1 py-0.5 text-xs text-background">{photo.caption}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FinancialMetric({
  label,
  value,
  tone = "default",
  className = "",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
}) {
  const toneClass = tone === "success"
    ? "border-success/30 bg-success/5 text-success"
    : tone === "warning"
      ? "border-warning/30 bg-warning/5 text-warning"
      : tone === "danger"
        ? "border-destructive/30 bg-destructive/5 text-destructive"
        : "border-border bg-secondary/20 text-foreground";
  return (
    <div className={`rounded-lg border p-2 ${toneClass} ${className}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-bold">OMR {Number(value || 0).toFixed(3)}</p>
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
    <div className="flex min-w-0 justify-between gap-2 text-xs">
      <span className="max-w-[55%] text-muted-foreground">{label}:</span>
      <span
        className={`${mono ? "font-mono" : ""} ${
          highlight ? "text-primary font-bold" : "text-foreground"
        } min-w-0 break-words text-end`}
        {...(amount ? { "data-amount": "true" } : {})}
      >
        {value}
      </span>
    </div>
  );
}
