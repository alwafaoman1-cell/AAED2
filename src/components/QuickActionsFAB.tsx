import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Zap, Receipt, Camera, FileText, FileSpreadsheet, Plus, Wrench, Car,
  Package, ArrowDownUp, ShieldPlus, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getQuickActionsSettings, subscribeQuickActionsSettings,
  type QuickActionKey, type QuickActionsSettings,
} from "@/lib/quickActionsSettingsStore";
import WorkOrderPickerDialog from "@/components/workorders/WorkOrderPickerDialog";
import WorkOrderBulkExpenseDialog from "@/components/workorders/WorkOrderBulkExpenseDialog";
import StagePhotosDialog from "@/components/workorders/StagePhotosDialog";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { stockMovementsStore } from "@/lib/stockMovementsStore";
import { inventoryStore } from "@/lib/inventoryStore";

const HIDDEN_ROUTES = ["/auth", "/reset-password", "/track", "/v/"];

type ActionMode = "expense" | "photos" | "invoice" | "quote" | null;

const ACTION_META: Record<QuickActionKey, { icon: any; color: string; route?: string; needsPick?: ActionMode }> = {
  expense:        { icon: Receipt,        color: "text-warning",  needsPick: "expense" },
  photos:         { icon: Camera,         color: "text-info",     needsPick: "photos" },
  invoice:        { icon: FileText,       color: "text-success",  needsPick: "invoice" },
  quote:          { icon: FileSpreadsheet, color: "text-primary", needsPick: "quote" },
  newWorkOrder:   { icon: Plus,           color: "text-primary",  route: "/work-orders" },
  newInspection:  { icon: Wrench,         color: "text-primary",  route: "/inspection" },
  newVehicle:     { icon: Car,            color: "text-primary",  route: "/vehicles?action=new" },
  neededParts:    { icon: Package,        color: "text-info",     route: "/work-orders?parts=1" },
  stockMovement:  { icon: ArrowDownUp,    color: "text-primary",  route: "/inventory/movements" },
  newClaim:       { icon: ShieldPlus,     color: "text-sky-500",  route: "/insurance/new" },
  newEstimate:    { icon: FileSpreadsheet, color: "text-amber-500", route: "/insurance/independent-estimates?new=1" },
};

export default function QuickActionsFAB() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const location = useLocation();
  const navigate = useNavigate();

  const [settings, setSettings] = useState<QuickActionsSettings>(() => getQuickActionsSettings());
  const [open, setOpen] = useState(false);

  // pick flow
  const [mode, setMode] = useState<ActionMode>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedOrder, setPickedOrder] = useState<WorkOrder | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeQuickActionsSettings((s) => setSettings({ ...s }));
    return () => { unsub(); };
  }, []);

  const hidden = useMemo(
    () => HIDDEN_ROUTES.some((r) => location.pathname.startsWith(r)),
    [location.pathname]
  );

  if (!settings.enabled || hidden) return null;

  const items = settings.visibleActions
    .map((k) => ({ key: k, ...ACTION_META[k] }))
    .filter(Boolean);

  const labelFor = (k: QuickActionKey) => {
    const map: Record<QuickActionKey, string> = {
      expense: isRtl ? "مصروف" : "Expense",
      photos: isRtl ? "صور" : "Photos",
      invoice: isRtl ? "فاتورة" : "Invoice",
      quote: isRtl ? "عرض سعر" : "Quote",
      newWorkOrder: isRtl ? "أمر عمل" : "Work Order",
      newInspection: isRtl ? "فحص" : "Inspection",
      newVehicle: isRtl ? "مركبة" : "Vehicle",
      neededParts: isRtl ? "قطع مطلوبة" : "Parts",
      stockMovement: isRtl ? "حركة مخزن" : "Stock",
      newClaim: isRtl ? "مطالبة" : "Claim",
      newEstimate: isRtl ? "تقدير سريع" : "Quick Estimate",
    };
    return map[k];
  };

  function handleAction(k: QuickActionKey) {
    setOpen(false);
    const meta = ACTION_META[k];
    if (meta.route) {
      navigate(meta.route);
      return;
    }
    if (meta.needsPick) {
      setMode(meta.needsPick);
      setPickerOpen(true);
    }
  }

  function handlePick(order: WorkOrder) {
    setPickedOrder(order);
    if (mode === "expense") setExpenseOpen(true);
    else if (mode === "photos") setPhotosOpen(true);
    else if (mode === "invoice" || mode === "quote") {
      const relatedMovements = stockMovementsStore.getAll().filter(
        (m) => m.type === "OUT" &&
          (m.reference === order.id || (m.notes || "").includes(order.id) || (m.reason || "").includes(order.id))
      );
      const consumedParts: Array<{ id: string; name: string; partNumber: string; qty: number; unitPrice: number }> = [];
      relatedMovements.forEach((mv) => {
        mv.items.forEach((it) => {
          const part = inventoryStore.getById(it.partId);
          const ex = consumedParts.find((p) => p.id === it.partId);
          if (ex) ex.qty += it.qty;
          else consumedParts.push({
            id: it.partId, name: it.partName, partNumber: it.partNumber,
            qty: it.qty, unitPrice: part?.sellPrice || 0,
          });
        });
      });
      try {
        sessionStorage.setItem("alwafa_invoice_prefill", JSON.stringify({
          docType: mode === "quote" ? "quote" : "invoice",
          workOrderId: order.id,
          customer: order.customer,
          vehiclePlate: order.plate,
          vehicleInfo: `${order.vehicleType} ${order.model} ${order.year}`.trim(),
          vin: order.vin,
          claimNumber: order.claimNumber,
          insuranceCompany: order.insurance,
          laborCost: order.laborCost || 0,
          partsCost: order.partsCost || 0,
          consumedParts,
          description: order.diagnosis || order.description || "",
        }));
        toast.success(isRtl ? "تم التحضير" : "Prepared");
        navigate(`/sales?new=${mode}&from=` + encodeURIComponent(order.id));
      } catch {
        toast.error(isRtl ? "تعذر التحضير" : "Failed");
      }
    }
  }

  // position
  const sideStyle: React.CSSProperties = {};
  const bottom = `${settings.offsetY}px`;
  sideStyle.bottom = bottom;
  if (settings.position === "bottom-center") {
    sideStyle.left = "50%";
    sideStyle.transform = "translateX(-50%)";
  } else if (settings.position === "bottom-left") {
    sideStyle.left = "20px";
  } else {
    sideStyle.right = "20px";
  }

  // popover side based on FAB position
  const popoverStyle: React.CSSProperties = { ...sideStyle, bottom: `${settings.offsetY + 72}px` };
  if (settings.position === "bottom-center") {
    popoverStyle.left = "50%";
    popoverStyle.transform = "translateX(-50%)";
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-background/30 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Popover */}
      {open && items.length > 0 && (
        <div
          style={popoverStyle}
          className="fixed z-[61] bg-card border border-border shadow-2xl rounded-2xl p-3 max-w-[92vw]"
          dir={isRtl ? "rtl" : "ltr"}
        >
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 min-w-[280px]">
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.key}
                  onClick={() => handleAction(it.key)}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-border bg-background/60 hover:bg-accent hover:scale-105 transition-all min-w-[80px]"
                >
                  <Icon size={22} className={it.color} />
                  <span className="text-[10px] font-medium text-foreground text-center leading-tight">
                    {labelFor(it.key)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={sideStyle}
        className="fixed z-[62] w-14 h-14 rounded-full gradient-gold text-primary-foreground shadow-2xl hover:shadow-[0_0_30px_rgba(212,165,55,0.6)] hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
        aria-label={isRtl ? "إجراءات سريعة" : "Quick actions"}
        title={isRtl ? "إجراءات سريعة" : "Quick actions"}
      >
        {open ? <X size={22} /> : <Zap size={22} />}
      </button>

      {/* shared dialogs */}
      <WorkOrderPickerDialog
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o && !expenseOpen && !photosOpen) setMode(null);
        }}
        onPick={handlePick}
        title={isRtl ? "اختر أمر العمل" : "Pick work order"}
      />
      <WorkOrderBulkExpenseDialog
        order={pickedOrder}
        open={expenseOpen}
        onOpenChange={(o) => {
          setExpenseOpen(o);
          if (!o) { setMode(null); setPickedOrder(null); }
        }}
      />
      <StagePhotosDialog
        orderId={pickedOrder?.id ?? null}
        open={photosOpen}
        onClose={() => { setPhotosOpen(false); setMode(null); setPickedOrder(null); }}
      />
    </>
  );
}
