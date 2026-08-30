import { useEffect, useMemo, useRef, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight, Car, Calendar, Gauge, Palette, History, DollarSign, FileText,
  Edit, Plus, Printer, Share2, Image as ImageIcon, Wrench, Shield, Trash2,
  ChevronDown, ChevronUp, ExternalLink, Receipt, Search, Filter, Camera, Banknote,
  Activity, RefreshCw, CheckCircle2, Loader2, Download, Archive, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatCard from "@/components/StatCard";
import PhotoPairsGrid from "@/components/vehicles/PhotoPairsGrid";
import ShareVehicleDialog from "@/components/vehicles/ShareVehicleDialog";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import PhotoLightbox, { type LightboxPhoto } from "@/components/vehicles/PhotoLightbox";
import VehicleStatusTimelineDialog from "@/components/vehicles/VehicleStatusTimelineDialog";
import VehicleAvatar from "@/components/vehicles/VehicleAvatar";
import { saveVehicleToCloud, vehiclesStore, refreshVehiclesFromCloud, type Vehicle, type VehiclePhotoPair } from "@/lib/vehiclesStore";
import { getWorkOrders, subscribeWorkOrders, refreshWorkOrdersFromCloud, type WorkOrder, STAGE_LABELS, type StagePhase } from "@/lib/workOrdersStore";
import { customersStore } from "@/lib/customersStore";
import { getVehicleCardHtml, getWorkOrderHtml, getStagePhotosAlbumHtml } from "@/lib/pdfGenerator";
import { canEdit } from "@/lib/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";
import PlateInput from "@/components/vehicles/PlateInput";
import { formatDateLatin } from "@/lib/numberUtils";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { fetchVehicle360Snapshot } from "@/lib/vehicle360";
import {
  VehicleAuditPanel,
  VehicleClaimsPanel,
  VehicleFinancialPanel,
  VehicleMediaPanel,
  VehicleOverviewPanel,
  VehicleTimelinePanel,
  VehicleVisitsPanel,
} from "@/components/vehicles/Vehicle360Panels";

export default function VehicleDetail() {
  const { plate } = useParams<{ plate: string }>();
  const navigate = useNavigate();
  const decodedPlate = plate ? decodeURIComponent(plate) : "";
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const english = i18n.language.toLowerCase().startsWith("en");
  const tx = (ar: string, en: string) => english ? en : ar;

  const [tick, setTick] = useState(0);
  useEffect(() => vehiclesStore.subscribe(() => setTick((t) => t + 1)), []);
  // Subscribe to WO store so photo changes immediately reflect here
  useEffect(() => subscribeWorkOrders(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    void refreshVehiclesFromCloud();
  }, []);

  const vehicle = useMemo(() => vehiclesStore.getById(decodedPlate), [decodedPlate, tick]);
  const vehicle360Query = useQuery({
    queryKey: queryKeys.vehicle360.detail(profile?.tenant_id, vehicle?.cloudId),
    queryFn: () => fetchVehicle360Snapshot(profile!.tenant_id, vehicle!.cloudId!, vehicle!.plate),
    enabled: Boolean(profile?.tenant_id && vehicle?.cloudId),
    staleTime: 60_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const vehicle360 = vehicle360Query.data;
  const allOrders = useMemo<WorkOrder[]>(() => getWorkOrders(), [tick]);
  const orders = useMemo(
    () => allOrders.filter((o) => o.plate === decodedPlate).sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    [allOrders, decodedPlate],
  );

  const [editOpen, setEditOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfHtml, setPdfHtml] = useState("");
  const [pdfTitle, setPdfTitle] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [expandedWO, setExpandedWO] = useState<string | null>(null);
  const [woSearch, setWoSearch] = useState("");
  const [woStatus, setWoStatus] = useState<string>("all");

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState<LightboxPhoto[]>([]);
  const [lightboxStart, setLightboxStart] = useState(0);

  // Status timeline dialog
  const [statusDlgOpen, setStatusDlgOpen] = useState(false);

  // Sync state is event/query driven. No focus reload and no periodic polling.
  type SyncState = "idle" | "syncing" | "synced" | "error";
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const lastPhotoFingerprint = useRef<string>("");

  // Build a stable fingerprint of all stage photos for the linked plate (auto-sync detector)
  const photoFingerprint = useMemo(() => {
    return orders
      .flatMap((o) => (o.photos || []).map((p) => `${o.id}:${p.id}:${p.uploadedAt}`))
      .sort()
      .join("|");
  }, [orders]);

  // Detect actual changes in photo set and notify
  useEffect(() => {
    if (!photoFingerprint) {
      lastPhotoFingerprint.current = "";
      return;
    }
    if (lastPhotoFingerprint.current && lastPhotoFingerprint.current !== photoFingerprint) {
      toast.success("تمت مزامنة صور المراحل من أوامر العمل", {
        description: "تم تحديث أرشيف السيارة بالصور الجديدة.",
      });
      setSyncState("synced");
      setLastSyncAt(new Date());
    }
    lastPhotoFingerprint.current = photoFingerprint;
  }, [photoFingerprint]);

  const qc = useQueryClient();
  async function manualSync() {
    setSyncState("syncing");
    try {
      await qc.invalidateQueries({ queryKey: queryKeys.vehicle360.detail(profile?.tenant_id, vehicle?.cloudId), refetchType: "active" });
      await Promise.all([
        refreshVehiclesFromCloud().catch(() => {}),
        refreshWorkOrdersFromCloud().catch(() => {}),
      ]);
      setTick((t) => t + 1);
      setSyncState("synced");
      setLastSyncAt(new Date());
      toast.success(tx("تم تحديث سجل المركبة من المصادر السحابية", "Vehicle history refreshed from cloud sources"));
    } catch (e) {
      setSyncState("error");
      toast.error("فشل التحديث");
    }
  }

  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Car size={48} className="text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">السيارة غير موجودة</h2>
        <p className="text-sm text-muted-foreground mb-6">رقم اللوحة: {decodedPlate}</p>
        <Button onClick={() => smartBack(navigate, "/vehicles")} variant="outline">العودة للأرشيف</Button>
      </div>
    );
  }

  // Official cloud financials are preferred; compatibility values are used only while loading.
  const totalRepairCost = vehicle360?.financial.totalBilled ?? orders.reduce(
    (sum, o) => sum + (Number(o.totalCost) || 0), 0,
  );
  const totalLabor = orders.reduce((sum, o) => sum + (o.laborCost || 0), 0);
  const totalParts = vehicle360?.financial.partsExpenses ?? orders.reduce((sum, o) => sum + (o.partsCost || 0), 0);
  const totalExtras = orders.reduce(
    (sum, o) => sum + (o.extraExpenses?.reduce((s, e) => s + (e.amount || 0), 0) || 0),
    0,
  );
  const totalDeposits = vehicle360?.financial.totalCollected ?? 0;
  const uniqueStatuses = Array.from(new Set(orders.map((o) => o.status)));
  const claimOnlyVisits = (vehicle360?.claims || []).filter((claim: any) => !claim.job_order_id && !claim.auto_job_order_id);
  const workshopVisitDates = [
    ...orders.map((o) => o.entryDate).filter(Boolean),
    ...claimOnlyVisits.map((claim: any) => String(claim.accident_date || claim.created_at || "").slice(0, 10)).filter(Boolean),
  ].sort();
  const workshopVisits = orders.length + claimOnlyVisits.length;
  const firstWorkshopVisit = workshopVisitDates[0] || "-";
  const lastWorkshopVisit = workshopVisitDates[workshopVisitDates.length - 1] || "-";
  const trackingVisits = Number(vehicle360?.tracking.count || (vehicle as any).trackingVisits || (vehicle as any).tracking_views || 0);
  const lastTrackingOpen = vehicle360?.tracking.lastOpenedAt
    ? formatDateLatin(String(vehicle360.tracking.lastOpenedAt).slice(0, 10))
    : "-";

  const photoPairs = vehicle.photoPairs || [];

  // Aggregate stage photos from ALL work orders (auto-sync from WO archive)
  const woPhotoGroups = orders
    .map((o) => ({ orderId: o.id, date: o.entryDate, service: o.serviceType, photos: o.photos || [] }))
    .filter((g) => g.photos.length > 0);
  const totalWoPhotos = woPhotoGroups.reduce((s, g) => s + g.photos.length, 0);

  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      !woSearch ||
      o.id.toLowerCase().includes(woSearch.toLowerCase()) ||
      (o.diagnosis || "").toLowerCase().includes(woSearch.toLowerCase()) ||
      (o.serviceType || "").toLowerCase().includes(woSearch.toLowerCase()) ||
      (o.technician || "").toLowerCase().includes(woSearch.toLowerCase());
    const matchesStatus = woStatus === "all" || o.status === woStatus;
    return matchesSearch && matchesStatus;
  });

  const allowEdit = canEdit();
  const isArchived = !!vehicle.archived;

  async function restoreArchivedVehicle(openEditAfterRestore = false) {
    if (!allowEdit) {
      toast.error("ليست لديك صلاحية استعادة المركبات المؤرشفة");
      return;
    }
    const restored: Vehicle = {
      ...vehicle,
      archived: false,
      archivedAt: undefined,
      archivedReason: undefined,
    };
    try {
      await saveVehicleToCloud(restored, { previousPlate: vehicle.plate });
      vehiclesStore.update(vehicle.id, restored);
      toast.success("تمت استعادة المركبة إلى القائمة النشطة");
      if (openEditAfterRestore) {
        setTimeout(() => setEditOpen(true), 0);
      }
    } catch (error: any) {
      toast.error(error?.message || "تعذر استعادة المركبة في Supabase");
    }
  }

  function openWoPdf(o: WorkOrder) {
    const html = getWorkOrderHtml({
      orderNumber: o.id, date: o.entryDate, customerName: o.customer,
      customerPhone: o.phone, vehicleType: o.vehicleType, model: o.model,
      year: o.year, plateNumber: o.plate, vin: o.vin, insurance: o.insurance,
      claimNumber: o.claimNumber, serviceType: o.serviceType, technician: o.technician,
      status: o.status, totalCost: o.totalCost,
      description: o.diagnosis,
      color: o.color, mileage: o.mileage,
      laborCost: o.laborCost, partsCost: o.partsCost,
      extraExpenses: o.extraExpenses,
      depositApplied: o.depositApplied,
      photos: (o.photos || []).map((p) => ({ phase: p.phase, dataUrl: p.dataUrl, caption: p.caption })),
    });
    setPdfHtml(html);
    setPdfTitle(`أمر عمل ${o.id}`);
    setPdfOpen(true);
  }

  function openPdf() {
    const html = getVehicleCardHtml({
      plate: vehicle.plate,
      type: vehicle.type,
      vin: vehicle.vin,
      year: vehicle.year,
      color: vehicle.color,
      mileage: vehicle.mileage,
      owner: vehicle.owner,
      ownerPhone: vehicle.ownerPhone,
      visits: vehicle.visits || orders.length,
      totalSpent: vehicle.totalSpent || totalRepairCost,
      lastVisit: vehicle.lastVisit,
      notes: vehicle.notes,
      workOrders: orders.map((o) => ({
        orderNumber: o.id,
        date: o.entryDate,
        serviceType: o.serviceType,
        status: o.status,
        technician: o.technician,
        cost: o.totalCost,
        description: o.diagnosis || o.description,
      })),
      photoPairs: photoPairs.map((p) => ({
        workOrderId: p.workOrderId,
        date: p.date,
        beforeUrl: p.beforeUrl,
        afterUrl: p.afterUrl,
        caption: p.caption,
      })),
      claims: orders
        .filter((o) => o.claimNumber && o.claimNumber !== "-")
        .map((o) => ({
          claimNumber: o.claimNumber,
          insuranceCompany: o.insurance,
          estimatedAmount: o.totalCost,
          status: "مرتبطة بأمر العمل",
        })),
    });
    setPdfHtml(html);
    setPdfTitle(`بطاقة السيارة ${vehicle.plate}`);
    setPdfOpen(true);
  }

  async function shareWhatsApp() {
    const text =
      `🚗 *بطاقة سيارة - ${vehicle.plate}*\n` +
      `الموديل: ${vehicle.type}\n` +
      `المالك: ${vehicle.owner}\n` +
      `الهاتف: ${vehicle.ownerPhone || "-"}\n` +
      `عدد الزيارات: ${orders.length}\n` +
      `إجمالي الإنفاق: ${(vehicle.totalSpent || totalRepairCost).toLocaleString()} ر.ع\n` +
      `آخر زيارة: ${vehicle.lastVisit}`;
    try {
      await sendWhatsAppMessage({ message: text, phone: vehicle.ownerPhone, vehicleId: vehicle.id, recipientName: vehicle.owner });
      toast.success("تم إرسال بطاقة السيارة عبر واتساب");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
    }
  }

  // Open lightbox for a single order's photos
  function openLightboxForOrder(o: WorkOrder, startIdx = 0) {
    const lbPhotos: LightboxPhoto[] = (o.photos || []).map((p) => ({
      id: p.id,
      dataUrl: p.dataUrl,
      caption: p.caption,
      phase: p.phase,
      phaseLabel: STAGE_LABELS[p.phase as StagePhase]?.ar || p.phase,
      orderId: o.id,
      date: o.entryDate,
    }));
    if (!lbPhotos.length) return;
    setLightboxPhotos(lbPhotos);
    setLightboxStart(startIdx);
    setLightboxOpen(true);
  }

  // Open lightbox with ALL photos across all orders
  function openAllPhotosLightbox(startIdx = 0) {
    const lbPhotos: LightboxPhoto[] = woPhotoGroups.flatMap((g) =>
      g.photos.map((p) => ({
        id: p.id,
        dataUrl: p.dataUrl,
        caption: p.caption,
        phase: p.phase,
        phaseLabel: STAGE_LABELS[p.phase as StagePhase]?.ar || p.phase,
        orderId: g.orderId,
        date: g.date,
      })),
    );
    if (!lbPhotos.length) return;
    setLightboxPhotos(lbPhotos);
    setLightboxStart(startIdx);
    setLightboxOpen(true);
  }

  // Export all stage photos as a separate PDF album
  function exportStagePhotosPdf() {
    if (totalWoPhotos === 0) {
      toast.error("لا توجد صور مراحل لتصديرها");
      return;
    }
    const html = getStagePhotosAlbumHtml({
      vehiclePlate: vehicle.plate,
      vehicleType: vehicle.type,
      owner: vehicle.owner,
      groups: woPhotoGroups.map((g) => ({
        orderId: g.orderId,
        orderDate: g.date,
        serviceType: g.service,
        photos: g.photos.map((p) => ({
          phase: p.phase,
          phaseLabel: STAGE_LABELS[p.phase as StagePhase]?.ar || p.phase,
          dataUrl: p.dataUrl,
          caption: p.caption,
          uploadedAt: p.uploadedAt,
        })),
      })),
    });
    setPdfHtml(html);
    setPdfTitle(`ألبوم صور المراحل — ${vehicle.plate}`);
    setPdfOpen(true);
  }
  function newWorkOrderForVehicle() {
    // We pass plate via navigate state so WorkOrders page can prefill (best-effort).
    navigate("/work-orders", { state: { prefillPlate: vehicle.plate, prefillVehicle: vehicle } });
    toast.info(`إنشاء أمر عمل جديد للسيارة ${vehicle.plate}`);
  }

  function openNewVisitForVehicle() {
    const latest = orders[0];
    const previousClosed = latest && /delivered|closed|ready|تسليم|مغلق|جاهز/i.test(String(latest.status || ""));
    navigate("/work-orders/new", {
      state: {
        prefillCustomer: vehicle.owner,
        prefillPhone: vehicle.ownerPhone,
        prefillPlate: vehicle.plate,
        prefillVehicle: vehicle,
        prefillVisit: latest
          ? {
              parentWorkOrderId: latest.cloudId,
              parentOrderNumber: latest.displayNumber || latest.id,
              visitNumber: workshopVisits + 1,
              visitType: previousClosed ? "new_visit" : "supplement",
              returnReason: previousClosed ? "new work after delivery" : "additional work before delivery",
            }
          : { visitNumber: 1, visitType: "new_visit" },
      },
    });
    toast.info(`فتح عمل جديد للمركبة ${vehicle.plate}`);
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <button
          onClick={() => smartBack(navigate, "/vehicles")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowRight size={14} /> العودة لأرشيف السيارات
        </button>

        <div className="bg-card border border-border rounded-xl p-5 shadow-card">
          <div className="flex flex-col lg:flex-row lg:items-start gap-5">
            <VehicleAvatar
              size="lg"
              vehicleId={vehicle.cloudId}
              imageUrl={(vehicle as any).vehicle_thumbnail_url || (vehicle as any).vehicle_cover_image_url}
              fallbackPhotos={orders.flatMap((order) => (order.photos || []).map((photo) => photo.dataUrl))}
              label={`${vehicle.type || ""} ${vehicle.plate || ""}`.trim() || "Vehicle"}
              canEdit={allowEdit}
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-2 mb-1">
                <h1 className="text-2xl font-bold text-foreground">{vehicle.type}</h1>
                <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-muted-foreground font-mono">
                  {vehicle.plate}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                المالك: <span className="text-foreground font-medium">{vehicle.owner}</span>
                {(() => {
                  const c = customersStore.findByName(vehicle.owner);
                  return c ? (
                    <>
                      {" "}
                      <button
                        onClick={() => navigate(`/customers/${c.id}`)}
                        className="text-[11px] text-primary hover:underline mr-1"
                      >
                        (ملف العميل)
                      </button>
                    </>
                  ) : null;
                })()}
                {vehicle.ownerPhone && (
                  <>
                    {" • "}
                    <a href={`tel:${vehicle.ownerPhone}`} className="text-primary hover:underline" dir="ltr">
                      {vehicle.ownerPhone}
                    </a>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {vehicle.year && <Chip icon={Calendar} text={vehicle.year} />}
                {vehicle.color && <Chip icon={Palette} text={vehicle.color} />}
                {vehicle.mileage && <Chip icon={Gauge} text={`${vehicle.mileage} كم`} />}
                {vehicle.vin && <Chip icon={FileText} text={vehicle.vin} mono />}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {isArchived ? (
                <>
                  {allowEdit && (
                    <>
                      <Button onClick={() => restoreArchivedVehicle(false)} variant="outline" size="sm" className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10">
                        <RotateCcw size={14} /> استعادة المركبة
                      </Button>
                      <Button onClick={() => restoreArchivedVehicle(true)} variant="secondary" size="sm" className="gap-1.5">
                        <Edit size={14} /> تعديل بعد الاستعادة
                      </Button>
                    </>
                  )}
                  <Button onClick={() => navigate("/vehicles")} variant="outline" size="sm" className="gap-1.5">
                    <Archive size={14} /> العودة للأرشيف
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={openNewVisitForVehicle} className="gradient-gold text-primary-foreground gap-1.5" size="sm">
                    <Plus size={14} /> أمر عمل جديد
                  </Button>
                  <Button onClick={() => setStatusDlgOpen(true)} variant="outline" size="sm" className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10">
                    <Activity size={14} /> مخطط الحالة
                  </Button>
                </>
              )}
              <Button onClick={openPdf} variant="outline" size="sm" className="gap-1.5">
                <Printer size={14} /> طباعة بطاقة
              </Button>
              {!isArchived && (
                <>
                  <Button onClick={() => setShareOpen(true)} variant="outline" size="sm" className="gap-1.5">
                    <Share2 size={14} /> مشاركة عامة / QR
                  </Button>
                  <Button onClick={shareWhatsApp} variant="outline" size="sm" className="gap-1.5">
                    <Share2 size={14} /> WhatsApp
                  </Button>
                </>
              )}
              {allowEdit && !isArchived && (
                <Button onClick={() => setEditOpen(true)} variant="outline" size="sm" className="gap-1.5">
                  <Edit size={14} /> تعديل
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {isArchived && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-foreground flex items-start gap-3">
          <Archive size={18} className="text-warning shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">هذه المركبة مؤرشفة</div>
            <div className="text-xs text-muted-foreground mt-1">
              لا يمكن تعديل بيانات المركبة الأساسية وهي في الأرشيف. استعد المركبة أولًا، ثم استخدم “تعديل بعد الاستعادة”.
              {vehicle.archivedAt ? ` تاريخ الأرشفة: ${formatDateLatin(String(vehicle.archivedAt).slice(0, 10))}.` : ""}
            </div>
          </div>
        </div>
      )}

      {vehicle360Query.isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {tx("تعذر تحميل السجل السحابي الكامل للمركبة. لم يتم إخفاء البيانات الأساسية ويمكن إعادة المحاولة بأمان.", "The complete cloud vehicle history could not be loaded. Core vehicle data remains visible and you can retry safely.")}
          <Button size="sm" variant="outline" className="ms-3" onClick={() => vehicle360Query.refetch()}>{tx("إعادة المحاولة", "Retry")}</Button>
        </div>
      )}

      {/* Official lifetime summary. Payments are actual payment rows, not invoice cached totals. */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <StatCard title={tx("زيارات الورشة", "Workshop visits")} value={vehicle360 ? Math.max(vehicle360.entries.length, vehicle360.workOrders.length) : workshopVisits || vehicle.visits || 0} icon={History} variant="info" />
        <StatCard title={tx("الحالة الحالية", "Current status")} value={vehicle360?.currentPresence || "—"} icon={Activity} variant="info" />
        <StatCard title={tx("أول زيارة", "First visit")} value={vehicle360?.firstVisitAt || firstWorkshopVisit} icon={Calendar} variant="info" />
        <StatCard title={tx("آخر زيارة", "Latest visit")} value={vehicle360?.lastVisitAt || lastWorkshopVisit} icon={Calendar} variant="success" />
        <StatCard title={tx("زيارات رابط التتبع", "Tracking visits")} value={trackingVisits} icon={Activity} variant="info" />
        <StatCard title={tx("آخر فتح للرابط", "Last tracking open")} value={lastTrackingOpen} icon={Activity} variant="info" />
        <StatCard title={tx("إجمالي الفواتير", "Total billed")} value={`OMR ${totalRepairCost.toFixed(3)}`} icon={DollarSign} variant="success" />
        <StatCard title={tx("إجمالي المصروفات", "Actual expenses")} value={`OMR ${(vehicle360?.financial.expenses ?? (totalParts + totalLabor + totalExtras)).toFixed(3)}`} icon={Receipt} variant="warning" />
        <StatCard title={tx("قطع الغيار", "Spare parts")} value={`OMR ${totalParts.toFixed(3)}`} icon={Wrench} variant="gold" />
        <StatCard title={tx("أجرة العمل المسجلة", "Recorded labour charge")} value={`OMR ${totalLabor.toFixed(3)}`} icon={Wrench} variant="info" />
        <StatCard title={tx("المحصل فعليًا", "Actually collected")} value={`OMR ${totalDeposits.toFixed(3)}`} icon={Banknote} variant="success" />
      </div>

      {/* Permanent vehicle record. Cloud snapshot is the source for operational and financial history. */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto bg-secondary border border-border p-1">
          <TabsTrigger value="overview" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <Car size={14} /> {tx("نظرة عامة", "Overview")}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <Activity size={14} /> {tx("ماذا جرى للمركبة", "Vehicle history")} ({vehicle360?.timeline.length || 0})
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <History size={14} /> {tx("الزيارات وأوامر العمل", "Visits & work orders")} ({vehicle360?.workOrders.length ?? orders.length})
          </TabsTrigger>
          <TabsTrigger value="claims" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <Shield size={14} /> {tx("المطالبات والتقديرات", "Claims & estimates")} ({vehicle360?.claims.length || 0})
          </TabsTrigger>
          <TabsTrigger value="financial" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <DollarSign size={14} /> {tx("الحساب المالي", "Financials")}
          </TabsTrigger>
          <TabsTrigger value="media360" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <ImageIcon size={14} /> {tx("الصور والمستندات", "Photos & documents")} ({vehicle360?.media.length || 0})
          </TabsTrigger>
          <TabsTrigger value="wo-photos" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <Camera size={14} /> {tx("صور المراحل القديمة", "Legacy stage photos")} ({totalWoPhotos})
          </TabsTrigger>
          <TabsTrigger value="photos" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <ImageIcon size={14} /> {tx("قبل/بعد", "Before/after")} ({photoPairs.length})
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1 whitespace-nowrap data-[state=active]:bg-card">
            <Activity size={14} /> {tx("التدقيق الإداري", "Administrative audit")} ({vehicle360?.auditLogs.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {vehicle360 ? <VehicleOverviewPanel data={vehicle360} tx={tx} /> : <VehicleCloudLoading tx={tx} />}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          {vehicle360 ? <VehicleTimelinePanel data={vehicle360} tx={tx} /> : <VehicleCloudLoading tx={tx} />}
        </TabsContent>

        {/* Timeline — full WO archive */}
        <TabsContent value="timeline" className="mt-4 space-y-3">
          {vehicle360 ? <VehicleVisitsPanel data={vehicle360} tx={tx} /> : orders.length === 0 ? (
            <EmptyState icon={History} title="لا توجد أوامر عمل سابقة" hint="ستظهر هنا كل زيارات السيارة لاحقاً." />
          ) : (
            <>
              {/* Filters */}
              <div className="bg-card border border-border rounded-xl p-3 flex flex-col md:flex-row gap-2 items-stretch md:items-center">
                <div className="relative flex-1">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={woSearch}
                    onChange={(e) => setWoSearch(e.target.value)}
                    placeholder="بحث برقم الأمر، الفني، نوع الخدمة، التشخيص..."
                    className="pr-9 bg-secondary/40 border-border h-9"
                  />
                </div>
                <Select value={woStatus} onValueChange={setWoStatus}>
                  <SelectTrigger className="w-full md:w-56 h-9 bg-secondary/40 border-border">
                    <Filter size={14} className="ml-1 text-muted-foreground" />
                    <SelectValue placeholder="كل الحالات" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    {uniqueStatuses.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[11px] text-muted-foreground px-2 whitespace-nowrap">
                  عرض <span className="text-foreground font-semibold">{filteredOrders.length}</span> من {orders.length}
                </div>
              </div>

              {/* Timeline cards */}
              <div className="bg-card border border-border rounded-xl p-5 shadow-card">
                <div className="relative pr-6 border-r-2 border-border space-y-4">
                  {filteredOrders.map((o, idx) => {
                    const isExpanded = expandedWO === o.id;
                    const extras = o.extraExpenses || [];
                    const extrasTotal = extras.reduce((s, e) => s + (e.amount || 0), 0);
                    const photoCount = (o.photos || []).length;
                    return (
                      <div key={o.id} className="relative">
                        <div className="absolute -right-[31px] top-1 w-5 h-5 rounded-full bg-primary border-4 border-card flex items-center justify-center">
                          <span className="text-[8px] text-primary-foreground font-bold">{filteredOrders.length - idx}</span>
                        </div>
                        <div className="bg-secondary/30 border border-border rounded-lg overflow-hidden hover:border-primary/30 transition-colors">
                          {/* Header row */}
                          <div className="p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                              <div>
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="text-sm font-mono font-bold text-primary">{o.id}</span>
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-info/15 text-info">{o.serviceType}</span>
                                  <StatusBadge status={o.status} />
                                  {photoCount > 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary inline-flex items-center gap-1">
                                      <Camera size={10} /> {photoCount}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  <Calendar size={10} className="inline ml-1" />
                                  {o.entryDate} • الفني: <span className="text-foreground">{o.technician}</span>
                                </p>
                              </div>
                              <div className="text-left">
                                <div className="text-base font-bold text-foreground">{o.totalCost.toLocaleString()} ر.ع</div>
                                <div className="text-[10px] text-muted-foreground">
                                  عمالة {(o.laborCost || 0).toLocaleString()} • قطع {(o.partsCost || 0).toLocaleString()}
                                  {extrasTotal > 0 && <> • إضافي {extrasTotal.toLocaleString()}</>}
                                  {o.depositApplied && o.depositApplied > 0 && <> • <span className="text-success">دفعة مستلمة {o.depositApplied.toLocaleString()}</span></>}
                                </div>
                              </div>
                            </div>
                            {(o.diagnosis || o.description) && (
                              <p className="text-xs text-muted-foreground bg-card/50 rounded p-2 mt-2 border-r-2 border-primary/40">
                                {o.diagnosis || o.description}
                              </p>
                            )}
                            {o.claimNumber && o.claimNumber !== "-" && (
                              <div className="mt-2 text-[11px] text-muted-foreground">
                                <Shield size={10} className="inline ml-1 text-info" />
                                مطالبة <span className="font-mono text-info">{o.claimNumber}</span> • {o.insurance}
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
                              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                                onClick={() => setExpandedWO(isExpanded ? null : o.id)}>
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                {isExpanded ? "إخفاء التفاصيل" : "تفاصيل كاملة"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                                onClick={() => openWoPdf(o)}>
                                <Printer size={12} /> طباعة الأمر
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                                onClick={() => navigate("/work-orders", { state: { focusOrderId: o.id } })}>
                                <ExternalLink size={12} /> فتح في أوامر العمل
                              </Button>
                            </div>
                          </div>

                          {/* Expanded details */}
                          {isExpanded && (
                            <div className="border-t border-border bg-card/40 p-4 space-y-3">
                              {/* Cost breakdown — مصروفات فقط، الدفعات منفصلة في خانة مستقلة */}
                              <div>
                                <h5 className="text-[11px] font-semibold text-muted-foreground mb-2">تفصيل المصروفات</h5>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                  <CostCell label="عمالة" value={o.laborCost || 0} />
                                  <CostCell label="قطع غيار" value={o.partsCost || 0} />
                                  <CostCell label="مصروفات إضافية" value={extrasTotal} />
                                  <CostCell label="إجمالي المصروفات" value={(o.laborCost || 0) + (o.partsCost || 0) + extrasTotal} />
                                </div>
                                {o.depositApplied && o.depositApplied > 0 && (
                                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div className="bg-success/10 border border-success/30 rounded p-2 col-span-2 md:col-span-1">
                                      <div className="text-[10px] text-muted-foreground">دفعة مستلمة (دخل)</div>
                                      <div className="font-mono font-semibold text-success">+{o.depositApplied.toLocaleString()} ر.ع</div>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Extra expenses list */}
                              {extras.length > 0 && (
                                <div>
                                  <h5 className="text-[11px] font-semibold text-muted-foreground mb-2">المصروفات الإضافية</h5>
                                  <div className="space-y-1">
                                    {extras.map((e) => (
                                      <div key={e.id} className="flex justify-between text-xs bg-secondary/30 rounded px-2 py-1.5">
                                        <span className="text-foreground">{e.label}{e.notes && <span className="text-muted-foreground"> — {e.notes}</span>}</span>
                                        <span className="font-mono font-semibold">{e.amount.toLocaleString()} ر.ع</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Stage photos preview */}
                              {photoCount > 0 && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-[11px] font-semibold text-muted-foreground">صور المراحل ({photoCount})</h5>
                                    <button
                                      onClick={() => openLightboxForOrder(o, 0)}
                                      className="text-[10px] text-primary hover:underline"
                                    >
                                      عرض الكل / تكبير
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                                    {(o.photos || []).slice(0, 16).map((p, pi) => (
                                      <button
                                        type="button"
                                        key={p.id}
                                        onClick={() => openLightboxForOrder(o, pi)}
                                        className="aspect-square rounded overflow-hidden border border-border bg-secondary/30 relative group cursor-zoom-in hover:border-primary/50 transition"
                                      >
                                        <img src={p.dataUrl} alt={p.caption || p.phase} className="w-full h-full object-cover" />
                                        <span className="absolute bottom-0 inset-x-0 text-[8px] bg-background/80 text-foreground px-1 py-0.5 truncate text-center">
                                          {STAGE_LABELS[p.phase as StagePhase]?.ar || p.phase}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {filteredOrders.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">لا توجد نتائج للبحث الحالي.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="audit" className="mt-4 space-y-3">
          {vehicle360 ? <VehicleAuditPanel data={vehicle360} tx={tx} /> : <VehicleCloudLoading tx={tx} />}
        </TabsContent>

        {/* WO Stage Photos — auto-aggregated from work orders */}
        <TabsContent value="wo-photos" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-card">
            {/* Header with sync indicator + actions */}
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4 pb-3 border-b border-border">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">صور مراحل العمل من جميع أوامر العمل</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{tx("تتحدث من المزامنة المركزية عند تغير أمر العمل، دون تحديث دوري للصفحة", "Updated by central realtime sync when a work order changes, without periodic page reloads")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Sync status indicator */}
                <SyncIndicator state={syncState} lastSyncAt={lastSyncAt} onManualSync={manualSync} />
                <span className="text-[11px] px-2 py-1 rounded-full bg-secondary text-muted-foreground whitespace-nowrap">
                  {totalWoPhotos} صورة • {woPhotoGroups.length} أمر
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={exportStagePhotosPdf}
                  disabled={totalWoPhotos === 0}
                >
                  <Download size={13} /> تصدير الصور PDF
                </Button>
                {totalWoPhotos > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => openAllPhotosLightbox(0)}
                  >
                    <ImageIcon size={13} /> عرض الكل
                  </Button>
                )}
              </div>
            </div>

            {totalWoPhotos === 0 ? (
              <EmptyState icon={Camera} title="لا توجد صور مراحل" hint="ارفع صور المراحل من شاشة أوامر العمل لتظهر هنا تلقائياً." />
            ) : (
              <div className="space-y-5">
                {woPhotoGroups.map((g, gIdx) => {
                  // Compute global offset for lightbox-all index
                  const globalOffset = woPhotoGroups
                    .slice(0, gIdx)
                    .reduce((s, gr) => s + gr.photos.length, 0);
                  return (
                    <div key={g.orderId} className="border border-border rounded-lg p-3 bg-secondary/20">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-bold text-primary">{g.orderId}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-info/15 text-info">{g.service}</span>
                          <span className="text-[11px] text-muted-foreground">{g.date}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{g.photos.length} صورة</span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                        {g.photos.map((p, pi) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => openAllPhotosLightbox(globalOffset + pi)}
                            className="aspect-square rounded-md overflow-hidden border border-border bg-card relative group cursor-zoom-in hover:border-primary transition"
                          >
                            <img src={p.dataUrl} alt={p.caption || p.phase} className="w-full h-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/95 to-transparent px-1.5 py-1">
                              <div className="text-[9px] font-semibold text-foreground truncate">
                                {STAGE_LABELS[p.phase as StagePhase]?.ar || p.phase}
                              </div>
                              {p.caption && <div className="text-[8px] text-muted-foreground truncate">{p.caption}</div>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Before/After Photos */}
        <TabsContent value="photos" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">معرض الصور قبل / بعد</h3>
              {allowEdit && !isArchived && (
                <Button size="sm" onClick={() => setPhotoOpen(true)} className="gap-1.5">
                  <Plus size={14} /> إضافة زوج صور
                </Button>
              )}
            </div>

            {photoPairs.length === 0 ? (
              <EmptyState icon={ImageIcon} title="لا توجد صور بعد" hint="أضف صور قبل وبعد كل عملية إصلاح لتوثيق الجودة." />
            ) : (
              <PhotoPairsGrid pairs={photoPairs} />
            )}
          </div>
        </TabsContent>

        {/* Claims */}
        <TabsContent value="claims" className="mt-4">
          {vehicle360 ? <VehicleClaimsPanel data={vehicle360} tx={tx} /> : <VehicleCloudLoading tx={tx} />}
        </TabsContent>

        <TabsContent value="financial" className="mt-4">
          {vehicle360 ? <VehicleFinancialPanel data={vehicle360} tx={tx} /> : <VehicleCloudLoading tx={tx} />}
        </TabsContent>

        <TabsContent value="media360" className="mt-4">
          {vehicle360 ? <VehicleMediaPanel data={vehicle360} tx={tx} /> : <VehicleCloudLoading tx={tx} />}
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      {allowEdit && <EditVehicleDialog open={editOpen} onOpenChange={setEditOpen} vehicle={vehicle} />}

      {/* Add Photo Pair Dialog */}
      {allowEdit && <AddPhotoPairDialog open={photoOpen} onOpenChange={setPhotoOpen} vehicle={vehicle} />}

      {/* Share Dialog (public link + QR) */}
      <ShareVehicleDialog vehicle={vehicle} open={shareOpen} onOpenChange={setShareOpen} />

      {/* PDF Preview */}
      <PdfPreviewDialog open={pdfOpen} onOpenChange={setPdfOpen} htmlContent={pdfHtml} title={pdfTitle} />

      {/* Photo Lightbox */}
      <PhotoLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        photos={lightboxPhotos}
        startIndex={lightboxStart}
      />

      {/* Vehicle Status Timeline */}
      <VehicleStatusTimelineDialog
        open={statusDlgOpen}
        onOpenChange={setStatusDlgOpen}
        orders={orders}
        plate={vehicle.plate}
      />
    </div>
  );
}

/* ─── Sync Indicator ─── */
function SyncIndicator({
  state, lastSyncAt, onManualSync,
}: { state: "idle" | "syncing" | "synced" | "error"; lastSyncAt: Date | null; onManualSync: () => void }) {
  const Icon = state === "syncing" ? Loader2 : state === "synced" ? CheckCircle2 : RefreshCw;
  const colorCls =
    state === "syncing" ? "text-warning" :
    state === "synced" ? "text-success" :
    state === "error" ? "text-destructive" : "text-muted-foreground";
  const label =
    state === "syncing" ? "جارٍ المزامنة..." :
    state === "synced" ? "متزامن" :
    state === "error" ? "خطأ" : "في الانتظار";
  const timeStr = lastSyncAt
    ? `${lastSyncAt.getHours().toString().padStart(2, "0")}:${lastSyncAt.getMinutes().toString().padStart(2, "0")}:${lastSyncAt.getSeconds().toString().padStart(2, "0")}`
    : null;

  return (
    <button
      onClick={onManualSync}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/60 border border-border hover:border-primary/50 transition text-[11px] cursor-pointer"
      title="اضغط للمزامنة اليدوية"
    >
      <Icon size={12} className={`${colorCls} ${state === "syncing" ? "animate-spin" : ""}`} />
      <span className={colorCls}>{label}</span>
      {timeStr && (
        <span className="text-muted-foreground font-mono text-[10px]" dir="ltr">{timeStr}</span>
      )}
    </button>
  );
}

function CostCell({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="bg-secondary/40 rounded p-2 border border-border/50">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-bold font-mono ${negative ? "text-destructive" : "text-foreground"}`}>
        {value.toLocaleString()} <span className="text-[9px] text-muted-foreground">ر.ع</span>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function Chip({ icon: Icon, text, mono }: { icon: any; text: string; mono?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-border text-muted-foreground ${mono ? "font-mono" : ""}`}>
      <Icon size={11} className="text-primary/70" />
      {text}
    </span>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: any; title: string; hint?: string }) {
  return (
    <div className="text-center py-12">
      <Icon size={40} className="mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-sm text-foreground font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function VehicleCloudLoading({ tx }: { tx: (ar: string, en: string) => string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
      <Loader2 className="me-2 h-5 w-5 animate-spin text-primary" />
      {tx("جارٍ بناء سجل المركبة من المصادر السحابية...", "Building the vehicle record from cloud sources...")}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status.includes("جاهز") || status.includes("تم")
      ? "bg-success/15 text-success"
      : status.includes("إصلاح") || status.includes("تحت")
      ? "bg-warning/15 text-warning"
      : "bg-info/15 text-info";
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cls}`}>{status}</span>;
}

function EditVehicleDialog({
  open, onOpenChange, vehicle,
}: { open: boolean; onOpenChange: (o: boolean) => void; vehicle: Vehicle }) {
  const [form, setForm] = useState<Vehicle>(vehicle);
  useEffect(() => setForm(vehicle), [vehicle, open]);

  async function save() {
    if (!form.plate || !form.owner) {
      toast.error("اللوحة والمالك مطلوبان");
      return;
    }
    try {
      await saveVehicleToCloud(form, { previousPlate: vehicle.plate });
      toast.success("تم تحديث بيانات السيارة");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحديث المركبة في Supabase");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">تعديل بيانات السيارة</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <FieldRow label="اللوحة *"><PlateInput value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} excludeId={vehicle.id} /></FieldRow>
          <FieldRow label="المالك *"><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></FieldRow>
          <FieldRow label="هاتف المالك"><Input dir="ltr" value={form.ownerPhone || ""} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} /></FieldRow>
          <FieldRow label="نوع/موديل"><Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></FieldRow>
          <FieldRow label="السنة"><Input value={form.year || ""} onChange={(e) => setForm({ ...form, year: e.target.value })} /></FieldRow>
          <FieldRow label="اللون"><Input value={form.color || ""} onChange={(e) => setForm({ ...form, color: e.target.value })} /></FieldRow>
          <FieldRow label="عداد المسافة"><Input value={form.mileage || ""} onChange={(e) => setForm({ ...form, mileage: e.target.value })} /></FieldRow>
          <FieldRow label="VIN"><Input className="font-mono" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} /></FieldRow>
          <div className="sm:col-span-2">
            <FieldRow label="ملاحظات">
              <Textarea rows={3} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </FieldRow>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} className="gradient-gold text-primary-foreground">حفظ التغييرات</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPhotoPairDialog({
  open, onOpenChange, vehicle,
}: { open: boolean; onOpenChange: (o: boolean) => void; vehicle: Vehicle }) {
  const [pair, setPair] = useState<Omit<VehiclePhotoPair, "id">>({
    workOrderId: "",
    date: new Date().toISOString().split("T")[0],
    beforeUrl: "",
    afterUrl: "",
    caption: "",
  });

  async function fileToDataUrl(file: File): Promise<string> {
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    return fileToWebpDataUrl(file);
  }

  async function pickFile(side: "before" | "after", e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    setPair((p) => ({ ...p, [side === "before" ? "beforeUrl" : "afterUrl"]: url }));
  }

  function save() {
    if (!pair.beforeUrl || !pair.afterUrl) {
      toast.error("الرجاء رفع صورتي قبل وبعد");
      return;
    }
    const updated: Vehicle = {
      ...vehicle,
      photoPairs: [
        { id: `PP-${Date.now()}`, ...pair },
        ...(vehicle.photoPairs || []),
      ],
    };
    vehiclesStore.update(vehicle.id, updated);
    toast.success("تمت إضافة الصور");
    onOpenChange(false);
    setPair({ workOrderId: "", date: new Date().toISOString().split("T")[0], beforeUrl: "", afterUrl: "", caption: "" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">إضافة زوج صور (قبل / بعد)</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <PhotoPicker label="قبل / Before" url={pair.beforeUrl} onPick={(e) => pickFile("before", e)} onClear={() => setPair({ ...pair, beforeUrl: "" })} />
          <PhotoPicker label="بعد / After" url={pair.afterUrl} onPick={(e) => pickFile("after", e)} onClear={() => setPair({ ...pair, afterUrl: "" })} />
          <FieldRow label="رقم أمر العمل (اختياري)">
            <Input value={pair.workOrderId} onChange={(e) => setPair({ ...pair, workOrderId: e.target.value })} placeholder="WO-2024-001" />
          </FieldRow>
          <FieldRow label="التاريخ">
            <Input type="date" value={pair.date} onChange={(e) => setPair({ ...pair, date: e.target.value })} />
          </FieldRow>
          <div className="sm:col-span-2">
            <FieldRow label="الوصف">
              <Input value={pair.caption} onChange={(e) => setPair({ ...pair, caption: e.target.value })} placeholder="مثال: إصلاح الصدام الأمامي" />
            </FieldRow>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} className="gradient-gold text-primary-foreground">حفظ الصور</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PhotoPicker({
  label, url, onPick, onClear,
}: {
  label: string;
  url?: string;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {url ? (
        <div className="relative aspect-video rounded-md overflow-hidden border border-border">
          <img src={url} alt={label} className="w-full h-full object-cover" />
          <button
            onClick={onClear}
            className="absolute top-2 left-2 p-1.5 rounded-full bg-destructive/90 text-destructive-foreground"
            aria-label="إزالة"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center aspect-video rounded-md border-2 border-dashed border-border bg-secondary/30 hover:border-primary cursor-pointer transition-colors">
          <ImageIcon size={28} className="text-muted-foreground/50 mb-2" />
          <span className="text-[11px] text-muted-foreground">اضغط لاختيار صورة</span>
          <input type="file" accept="image/*" className="hidden" onChange={onPick} />
        </label>
      )}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
