import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
import WorkOrderPickerDialog from "@/components/workorders/WorkOrderPickerDialog";
import WorkOrderExpenseDialog from "@/components/workorders/WorkOrderExpenseDialog";
import StagePhotosDialog from "@/components/workorders/StagePhotosDialog";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { stockMovementsStore } from "@/lib/stockMovementsStore";
import { inventoryStore } from "@/lib/inventoryStore";
import { toast } from "sonner";

type ActionMode = "expense" | "photos" | "invoice" | "quote" | null;

export default function QuickActionsMenu() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ActionMode>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedOrder, setPickedOrder] = useState<WorkOrder | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  function startAction(next: ActionMode) {
    setMode(next);
    setPickerOpen(true);
  }

  function handlePick(order: WorkOrder) {
    setPickedOrder(order);
    if (mode === "expense") {
      setExpenseOpen(true);
    } else if (mode === "photos") {
      setPhotosOpen(true);
    } else if (mode === "invoice" || mode === "quote") {
      // اجلب القطع المستهلكة فعلياً من حركات المخزون (OUT) المرتبطة بأمر العمل
      const relatedMovements = stockMovementsStore
        .getAll()
        .filter(
          (m) =>
            m.type === "OUT" &&
            (m.reference === order.id ||
              (m.notes || "").includes(order.id) ||
              (m.reason || "").includes(order.id))
        );
      const consumedParts: Array<{ id: string; name: string; partNumber: string; qty: number; unitPrice: number }> = [];
      relatedMovements.forEach((mv) => {
        mv.items.forEach((it) => {
          const part = inventoryStore.getById(it.partId);
          const existing = consumedParts.find((p) => p.id === it.partId);
          if (existing) {
            existing.qty += it.qty;
          } else {
            consumedParts.push({
              id: it.partId,
              name: it.partName,
              partNumber: it.partNumber,
              qty: it.qty,
              unitPrice: part?.sellPrice || 0,
            });
          }
        });
      });

      try {
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
        toast.success(
          mode === "quote"
            ? `تم تحضير عرض سعر / تقدير تأمين لأمر العمل ${order.id}`
            : `تم تحضير فاتورة جديدة لأمر العمل ${order.id}`
        );
        navigate(`/sales?new=${mode}&from=` + encodeURIComponent(order.id));
      } catch {
        toast.error("تعذّر تجهيز المستند");
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
            إجراءات سريعة
            <ChevronDown size={14} className="opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 bg-card border-border shadow-2xl"
          style={{ direction: "rtl" }}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            الإجراءات الأكثر استخداماً
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => startAction("expense")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-warning/10 focus:text-warning"
          >
            <Receipt size={16} className="text-warning" />
            <div className="flex-1">
              <div className="text-sm font-medium">إضافة مصروفات أمر عمل</div>
              <div className="text-[10px] text-muted-foreground">سند صرف مرتبط بأمر عمل</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => startAction("photos")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-info/10 focus:text-info"
          >
            <Camera size={16} className="text-info" />
            <div className="flex-1">
              <div className="text-sm font-medium">إضافة صور أمر عمل</div>
              <div className="text-[10px] text-muted-foreground">رفع صور حسب المرحلة</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => startAction("invoice")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-success/10 focus:text-success"
          >
            <FileText size={16} className="text-success" />
            <div className="flex-1">
              <div className="text-sm font-medium">إنشاء فاتورة لأمر عمل</div>
              <div className="text-[10px] text-muted-foreground">تحويل الأمر إلى فاتورة بيع تفصيلية</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => startAction("quote")}
            className="gap-2 cursor-pointer py-2.5 focus:bg-primary/10 focus:text-primary"
          >
            <FileSpreadsheet size={16} className="text-primary" />
            <div className="flex-1">
              <div className="text-sm font-medium">عرض سعر / تقدير تأمين</div>
              <div className="text-[10px] text-muted-foreground">عرض سعر سريع لعميل أو شركة تأمين</div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            اختصارات إضافية
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => navigate("/vehicles?action=new")}
            className="gap-2 cursor-pointer py-2"
          >
            <Car size={16} className="text-primary" />
            <span className="text-sm">استلام مركبة جديدة</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/work-orders")}
            className="gap-2 cursor-pointer py-2"
          >
            <Plus size={16} className="text-primary" />
            <span className="text-sm">أمر عمل جديد</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/inspection")}
            className="gap-2 cursor-pointer py-2"
          >
            <Wrench size={16} className="text-primary" />
            <span className="text-sm">فحص جديد</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/work-orders?parts=1")}
            className="gap-2 cursor-pointer py-2"
          >
            <Package size={16} className="text-info" />
            <span className="text-sm">السيارات التي تحتاج قطع غيار</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/inventory/movements")}
            className="gap-2 cursor-pointer py-2"
          >
            <Package size={16} className="text-primary" />
            <span className="text-sm">حركة مخزنية</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* اختيار أمر العمل */}
      <WorkOrderPickerDialog
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o && !expenseOpen && !photosOpen) setMode(null);
        }}
        onPick={handlePick}
        title={
          mode === "expense"
            ? "اختر أمر العمل لإضافة مصروف"
            : mode === "photos"
            ? "اختر أمر العمل لإضافة صور"
            : mode === "invoice"
            ? "اختر أمر العمل لإنشاء فاتورة"
            : mode === "quote"
            ? "اختر أمر العمل لإنشاء عرض سعر / تقدير تأمين"
            : "اختر أمر العمل"
        }
      />

      {/* مصروفات */}
      <WorkOrderExpenseDialog
        order={pickedOrder}
        open={expenseOpen}
        onOpenChange={(o) => {
          setExpenseOpen(o);
          if (!o) {
            setMode(null);
            setPickedOrder(null);
          }
        }}
      />

      {/* صور */}
      <StagePhotosDialog
        orderId={pickedOrder?.id ?? null}
        open={photosOpen}
        onClose={() => {
          setPhotosOpen(false);
          setMode(null);
          setPickedOrder(null);
        }}
      />
    </>
  );
}
