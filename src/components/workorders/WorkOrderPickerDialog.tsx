import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Car, User, Hash, X, Eye, EyeOff } from "lucide-react";
import { getWorkOrders, subscribeWorkOrders, type WorkOrder } from "@/lib/workOrdersStore";

const CLOSED_STATUSES = ["تم التسليم", "مغلق"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (order: WorkOrder) => void;
  title?: string;
  description?: string;
}

const statusColors: Record<string, string> = {
  "تحت الإصلاح": "bg-warning/15 text-warning",
  "بانتظار الموافقة": "bg-info/15 text-info",
  "جاهز للتسليم": "bg-success/15 text-success",
  "تحت الفحص": "bg-primary/15 text-primary",
  "تم التسليم": "bg-success/15 text-success",
  "مغلق": "bg-muted text-muted-foreground",
  "بانتظار قطع الغيار": "bg-warning/15 text-warning",
  "ضبط الجودة": "bg-info/15 text-info",
};

export default function WorkOrderPickerDialog({
  open,
  onOpenChange,
  onPick,
  title = "اختر أمر العمل",
  description = "ابحث برقم الأمر، اسم العميل، رقم اللوحة، VIN، أو رقم الجوال",
}: Props) {
  const [orders, setOrders] = useState<WorkOrder[]>(getWorkOrders());
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    const unsub = subscribeWorkOrders(() => setOrders([...getWorkOrders()]));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setShowClosed(false);
    }
  }, [open]);

  const visible = useMemo(
    () => (showClosed ? orders : orders.filter((o) => !CLOSED_STATUSES.includes(o.status))),
    [orders, showClosed]
  );
  const hiddenCount = orders.length - visible.length;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return visible.slice(0, 50);
    return visible.filter((o) =>
      [o.id, o.customer, o.plate, o.vin, o.phone, o.vehicleType, o.model, o.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    ).slice(0, 50);
  }, [q, visible]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl bg-card border-border max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Search size={18} className="text-primary" />
            {title}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </DialogHeader>

        <div className="relative">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="مثال: WO-2024-001 أو أحمد محمد أو أ ب ج 1234"
            className="pr-9 pl-9 h-11 text-sm"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary text-muted-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground flex items-center justify-between px-1">
          <span>{filtered.length} نتيجة{hiddenCount > 0 && !showClosed ? ` (${hiddenCount} مخفية)` : ""}</span>
          <button
            onClick={() => setShowClosed((s) => !s)}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            {showClosed ? <EyeOff size={11} /> : <Eye size={11} />}
            {showClosed ? "إخفاء المغلقة/المسلّمة" : "إظهار المغلقة/المسلّمة"}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 -mx-6 px-6 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
              لا توجد نتائج مطابقة
            </div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  onPick(o);
                  onOpenChange(false);
                }}
                className="w-full text-right p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-secondary/40 transition-all group"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <Hash size={12} className="text-primary" />
                    <span className="font-mono text-xs text-primary font-semibold">{o.id}</span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      statusColors[o.status] || "bg-secondary text-foreground"
                    }`}
                  >
                    {o.status}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-foreground">
                    <User size={11} className="text-muted-foreground" />
                    <span className="truncate">{o.customer}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Car size={11} />
                    <span className="truncate">
                      {o.vehicleType} {o.model} — <span className="font-mono">{o.plate}</span>
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
