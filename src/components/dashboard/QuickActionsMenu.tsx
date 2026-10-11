import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Zap, Receipt, Camera, FileText, ChevronDown, Plus, Wrench, Package, Car, FileSpreadsheet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { toast } from "sonner";

const WorkOrderPickerDialog = lazy(() => import("@/components/workorders/WorkOrderPickerDialog"));
const WorkOrderExpenseDialog = lazy(() => import("@/components/workorders/WorkOrderExpenseDialog"));
const StagePhotosDialog = lazy(() => import("@/components/workorders/StagePhotosDialog"));

type ActionMode = "expense" | "photos" | "invoice" | "quote" | null;

export default function QuickActionsMenu() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const label = (ar: string, en: string) => isRtl ? ar : en;
  const [mode, setMode] = useState<ActionMode>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedOrder, setPickedOrder] = useState<WorkOrder | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  function startAction(next: ActionMode) {
    setMode(next);
    setPickerOpen(true);
  }

  async function handlePick(order: WorkOrder) {
    setPickedOrder(order);
    if (mode === "expense") {
      setExpenseOpen(true);
    } else if (mode === "photos") {
      setPhotosOpen(true);
    } else if (mode === "invoice" || mode === "quote") {
      try {
        const [{ stockMovementsStore }, { inventoryStore }] = await Promise.all([
          import("@/lib/stockMovementsStore"),
          import("@/lib/inventoryStore"),
        ]);
        // اجلب القطع المستهلكة فعلياً من حركات المخزون (OUT) المرتبطة بأمر العمل
        const relatedMovements = stockMovementsStore.getAll().filter(
          (m) => m.type === "OUT" &&
            (m.reference === order.id || (m.notes || "").includes(order.id) || (m.reason || "").includes(order.id))
        );
        const consumedParts: Array<{ id: string; name: string; partNumber: string; qty: number; unitPrice: number }> = [];
        relatedMovements.forEach((mv) => {
          mv.items.forEach((it) => {
            const part = inventoryStore.getById(it.partId);
            const existing = consumedParts.find((p) => p.id === it.partId);
            if (existing) existing.qty += it.qty;
            else consumedParts.push({
              id: it.partId, name: it.partName, partNumber: it.partNumber,
              qty: it.qty, unitPrice: part?.sellPrice || 0,
            });
          });
        });

        sessionStorage.setItem(
          "alwafa_invoice_prefill",
          JSON.stringify({
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
          })
        );
        toast.success(mode === "quote"
          ? label(`تم تحضير عرض سعر / تقدير تأمين لأمر العمل ${order.id}`, `Quote prepared for work order ${order.id}`)
          : label(`تم تحضير فاتورة جديدة لأمر العمل ${order.id}`, `Invoice prepared for work order ${order.id}`));
        navigate(`${mode === "invoice" ? "/sales/invoices/new" : "/sales/quotes/new"}?fromWorkOrder=` + encodeURIComponent(order.id));
      } catch {
        toast.error(label("تعذّر تجهيز المستند", "Could not prepare the document"));
      }
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            className="gradient-gold text-primary-foreground gap-2 shadow-lg hover:opacity-95 hover:shadow-xl transition-all h-11 px-5"
          >
            <Zap size={18} />
            {label("إجراءات سريعة", "Quick actions")}
            <ChevronDown size={14} className="opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 bg-card border-border shadow-2xl"
          style={{ direction: isRtl ? "rtl" : "ltr" }}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            {label("الإجراءات الأكثر استخداماً", "Frequently used actions")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => startAction("expense")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-warning/10 focus:text-warning"
          >
            <Receipt size={16} className="text-warning" />
            <div className="flex-1">
              <div className="text-sm font-medium">{label("إضافة مصروفات أمر عمل", "Add work order expense")}</div>
              <div className="text-[10px] text-muted-foreground">{label("سند صرف مرتبط بأمر عمل", "Expense voucher linked to a work order")}</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => startAction("photos")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-info/10 focus:text-info"
          >
            <Camera size={16} className="text-info" />
            <div className="flex-1">
              <div className="text-sm font-medium">{label("إضافة صور أمر عمل", "Add work order photos")}</div>
              <div className="text-[10px] text-muted-foreground">{label("رفع صور حسب المرحلة", "Upload photos by repair stage")}</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => startAction("invoice")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-success/10 focus:text-success"
          >
            <FileText size={16} className="text-success" />
            <div className="flex-1">
              <div className="text-sm font-medium">{label("إنشاء فاتورة لأمر عمل", "Create work order invoice")}</div>
              <div className="text-[10px] text-muted-foreground">{label("تحويل الأمر إلى فاتورة بيع تفصيلية", "Prepare an itemized sales invoice")}</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => startAction("quote")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-primary/10 focus:text-primary"
          >
            <FileSpreadsheet size={16} className="text-primary" />
            <div className="flex-1">
              <div className="text-sm font-medium">{label("عرض سعر / تقدير تأمين", "Quote / insurance estimate")}</div>
              <div className="text-[10px] text-muted-foreground">{label("عرض سعر سريع لعميل أو شركة تأمين", "Quick quote for a customer or insurer")}</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            {label("اختصارات إضافية", "More shortcuts")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => navigate("/vehicles?action=new")}
            className="gap-2 cursor-pointer py-2"
          >
            <Car size={16} className="text-primary" />
            <span className="text-sm">{label("استلام مركبة جديدة", "Receive a vehicle")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/work-orders")}
            className="gap-2 cursor-pointer py-2"
          >
            <Plus size={16} className="text-primary" />
            <span className="text-sm">{label("أمر عمل جديد", "New work order")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/inspection")}
            className="gap-2 cursor-pointer py-2"
          >
            <Wrench size={16} className="text-primary" />
            <span className="text-sm">{label("فحص جديد", "New inspection")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/work-orders?parts=1")}
            className="gap-2 cursor-pointer py-2"
          >
            <Package size={16} className="text-info" />
            <span className="text-sm">{label("السيارات التي تحتاج قطع غيار", "Vehicles awaiting parts")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/inventory/movements")}
            className="gap-2 cursor-pointer py-2"
          >
            <Package size={16} className="text-primary" />
            <span className="text-sm">{label("حركة مخزنية", "Stock movement")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* اختيار أمر العمل */}
      <Suspense fallback={<span role="status" className="sr-only">{label("جارٍ فتح الإجراء…", "Opening action…")}</span>}>
        {pickerOpen && <WorkOrderPickerDialog
          open={pickerOpen}
          onOpenChange={(o) => {
            setPickerOpen(o);
            if (!o && !expenseOpen && !photosOpen) setMode(null);
          }}
          onPick={handlePick}
          title={
            mode === "expense"
              ? label("اختر أمر العمل لإضافة مصروف", "Pick a work order to add an expense")
              : mode === "photos"
              ? label("اختر أمر العمل لإضافة صور", "Pick a work order to add photos")
              : mode === "invoice"
              ? label("اختر أمر العمل لإنشاء فاتورة", "Pick a work order to create an invoice")
              : mode === "quote"
              ? label("اختر أمر العمل لإنشاء عرض سعر / تقدير تأمين", "Pick a work order for a quote / estimate")
              : label("اختر أمر العمل", "Pick a work order")
          }
        />}

        {/* مصروفات */}
        {expenseOpen && <WorkOrderExpenseDialog
          order={pickedOrder}
          open={expenseOpen}
          onOpenChange={(o) => {
            setExpenseOpen(o);
            if (!o) {
              setMode(null);
              setPickedOrder(null);
            }
          }}
        />}

        {/* صور */}
        {photosOpen && <StagePhotosDialog
          orderId={pickedOrder?.id ?? null}
          open={photosOpen}
          onClose={() => {
            setPhotosOpen(false);
            setMode(null);
            setPickedOrder(null);
          }}
        />}
      </Suspense>
    </>
  );
}
