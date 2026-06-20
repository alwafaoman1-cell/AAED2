import { useEffect, useState } from "react";
import {
  ArrowDown, ArrowUp, ArrowLeftRight, Plus, Filter, Calendar,
  FileText, Trash2, Eye, FileSpreadsheet, FileDown,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StatCard from "@/components/StatCard";
import StockMovementDialog from "@/components/inventory/StockMovementDialog";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import {
  stockMovementsStore, reverseStockMovement,
  type MovementType, type StockMovement,
} from "@/lib/stockMovementsStore";
import { exportMovementsToExcel, exportMovementsToPdf } from "@/lib/inventoryExports";
import { canDelete } from "@/lib/permissions";
import { toast } from "sonner";

export default function StockMovements() {
  const [movements, setMovements] = useState<StockMovement[]>(stockMovementsStore.getAll());
  const [showDialog, setShowDialog] = useState(false);
  const [defaultType, setDefaultType] = useState<MovementType>("IN");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [referenceFilter, setReferenceFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [viewing, setViewing] = useState<StockMovement | null>(null);
  const [deleting, setDeleting] = useState<StockMovement | null>(null);
  const allowDelete = canDelete();

  useEffect(() => stockMovementsStore.subscribe(() => setMovements([...stockMovementsStore.getAll()])), []);

  const filtered = movements
    .filter((m) => typeFilter === "all" || m.type === typeFilter)
    .filter((m) => !dateFrom || m.date >= dateFrom)
    .filter((m) => !dateTo || m.date <= dateTo)
    .filter((m) => !referenceFilter || (m.reference || "").toLowerCase().includes(referenceFilter.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const counts = {
    IN: movements.filter((m) => m.type === "IN").length,
    OUT: movements.filter((m) => m.type === "OUT").length,
    TRANSFER: movements.filter((m) => m.type === "TRANSFER").length,
  };

  function openNew(type: MovementType) {
    setDefaultType(type);
    setShowDialog(true);
  }

  function handleDelete() {
    if (!deleting) return;
    reverseStockMovement(deleting);
    stockMovementsStore.remove(deleting.id);
    toast.success(`تم حذف ${deleting.id} وإلغاء أثرها على المخزون`);
    setDeleting(null);
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الإذن المخزنية</h1>
          <p className="text-sm text-muted-foreground">
            <Link to="/inventory" className="hover:text-primary">المخزون</Link> ← حركات الإدخال والإخراج والتحويل
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openNew("IN")} className="bg-success/15 text-success hover:bg-success/25 border border-success/30 gap-2">
            <ArrowDown size={16} /> إذن إدخال
          </Button>
          <Button onClick={() => openNew("OUT")} className="bg-destructive/15 text-destructive hover:bg-destructive/25 border border-destructive/30 gap-2">
            <ArrowUp size={16} /> إذن إخراج
          </Button>
          <Button onClick={() => openNew("TRANSFER")} className="bg-info/15 text-info hover:bg-info/25 border border-info/30 gap-2">
            <ArrowLeftRight size={16} /> إذن تحويل
          </Button>
          <div className="w-px h-8 bg-border mx-1" />
          <Button
            variant="outline"
            onClick={() => {
              if (filtered.length === 0) { toast.warning("لا توجد بيانات للتصدير"); return; }
              exportMovementsToExcel(filtered);
              toast.success("تم تصدير ملف Excel");
            }}
            className="border-border gap-2"
          >
            <FileSpreadsheet size={16} /> Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (filtered.length === 0) { toast.warning("لا توجد بيانات للتصدير"); return; }
              exportMovementsToPdf(filtered, { type: typeFilter, from: dateFrom, to: dateTo, reference: referenceFilter });
              toast.success("تم تصدير ملف PDF");
            }}
            className="border-border gap-2"
          >
            <FileDown size={16} /> PDF
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="إجمالي الحركات" value={movements.length} icon={FileText} variant="info" />
        <StatCard title="إدخال" value={counts.IN} icon={ArrowDown} variant="success" />
        <StatCard title="إخراج" value={counts.OUT} icon={ArrowUp} variant="warning" />
        <StatCard title="تحويل" value={counts.TRANSFER} icon={ArrowLeftRight} variant="info" />
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="border-border gap-2">
            <Filter size={16} /> الفلاتر
          </Button>
          {(typeFilter !== "all" || dateFrom || dateTo || referenceFilter) && (
            <Button variant="ghost" onClick={() => { setTypeFilter("all"); setDateFrom(""); setDateTo(""); setReferenceFilter(""); }} className="text-muted-foreground">
              مسح الفلاتر
            </Button>
          )}
        </div>
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-border">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">النوع</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="IN">إدخال</SelectItem>
                  <SelectItem value="OUT">إخراج</SelectItem>
                  <SelectItem value="TRANSFER">تحويل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">من تاريخ</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">إلى تاريخ</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الرقم المرجعي</label>
              <Input value={referenceFilter} onChange={(e) => setReferenceFilter(e.target.value)} placeholder="بحث..." className="bg-secondary border-border" />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={48} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">لا توجد حركات مخزنية</p>
            <Button onClick={() => openNew("IN")} className="mt-4 gap-2">
              <Plus size={16} /> إنشاء أول إذن
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الرقم</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">النوع</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">التاريخ</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">السبب</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">المرجع</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الأصناف</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="py-3 px-4 font-mono text-xs text-foreground">{m.id}</td>
                    <td className="py-3 px-4"><TypeBadge type={m.type} /></td>
                    <td className="py-3 px-4 text-muted-foreground flex items-center gap-1">
                      <Calendar size={12} /> {m.date}
                    </td>
                    <td className="py-3 px-4 text-foreground max-w-[200px] truncate">{m.reason}</td>
                    <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{m.reference || "-"}</td>
                    <td className="py-3 px-4 text-muted-foreground">{m.items.length} صنف</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewing(m)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-info" title="عرض">
                          <Eye size={14} />
                        </button>
                        {allowDelete && (
                          <button onClick={() => setDeleting(m)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="حذف">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Dialog */}
      <StockMovementDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        defaultType={defaultType}
      />

      {/* View Dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewing && <TypeBadge type={viewing.type} />}
              {viewing?.id}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Info label="التاريخ" value={viewing.date} />
                <Info label="المرجع" value={viewing.reference || "-"} />
                {viewing.fromLocation && <Info label="من موقع" value={viewing.fromLocation} />}
                {viewing.toLocation && <Info label="إلى موقع" value={viewing.toLocation} />}
              </div>
              <Info label="السبب" value={viewing.reason} />
              {viewing.notes && <Info label="ملاحظات" value={viewing.notes} />}

              <div>
                <h4 className="text-xs text-muted-foreground mb-2">الأصناف ({viewing.items.length})</h4>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-secondary/30 border-b border-border">
                        <th className="text-right py-2 px-3 text-muted-foreground">الصنف</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">الرقم</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">الكمية</th>
                        {viewing.type === "IN" && <th className="text-right py-2 px-3 text-muted-foreground">التكلفة</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {viewing.items.map((it) => (
                        <tr key={it.partId} className="border-b border-border/50 last:border-0">
                          <td className="py-2 px-3 text-foreground">{it.partName}</td>
                          <td className="py-2 px-3 font-mono text-muted-foreground">{it.partNumber}</td>
                          <td className="py-2 px-3 font-bold">{it.qty}</td>
                          {viewing.type === "IN" && (
                            <td className="py-2 px-3 text-muted-foreground">{it.unitCost?.toFixed(3) ?? "-"}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف ${deleting?.id || ""}`}
        description="سيتم عكس أثر هذه الحركة على المخزون. هل أنت متأكد؟"
      />
    </div>
  );
}

function TypeBadge({ type }: { type: MovementType }) {
  const config = {
    IN: { label: "إدخال", color: "bg-success/15 text-success border-success/30", icon: ArrowDown },
    OUT: { label: "إخراج", color: "bg-destructive/15 text-destructive border-destructive/30", icon: ArrowUp },
    TRANSFER: { label: "تحويل", color: "bg-info/15 text-info border-info/30", icon: ArrowLeftRight },
  }[type];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${config.color}`}>
      <Icon size={10} /> {config.label}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}
