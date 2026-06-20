import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Package, Plus, Search, AlertTriangle, TrendingUp, Edit, Trash2, Filter,
  Barcode, Tag, Boxes, X, ArrowDownUp, Printer, Eye, FileSpreadsheet,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatCard from "@/components/StatCard";
import BarcodeLabelDialog from "@/components/inventory/BarcodeLabelDialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import { inventoryStore, getInventoryFacets, type Part } from "@/lib/inventoryStore";
import { moveToTrash } from "@/lib/trashStore";
import { canDelete, canEdit } from "@/lib/permissions";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { toast } from "sonner";

const empty: Part = {
  id: "", name: "", partNumber: "", supplier: "",
  buyPrice: 0, sellPrice: 0, stock: 0, minStock: 5, sold: 0,
  brand: "", category: "", barcode: "", status: "active",
};

type StatusFilter = "all" | "in_stock" | "low" | "out";

export default function Inventory() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [parts, setParts] = useState<Part[]>(inventoryStore.getAll());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Part | null>(null);
  const [form, setForm] = useState<Part>(empty);
  const [deleting, setDeleting] = useState<Part | null>(null);
  const [printingBarcode, setPrintingBarcode] = useState<Part | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [barcodeFilter, setBarcodeFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => inventoryStore.subscribe(() => setParts([...inventoryStore.getAll()])), []);

  const { brands, categories } = useMemo(() => getInventoryFacets(), [parts]);
  const lowStock = parts.filter((p) => p.stock > 0 && p.stock <= p.minStock);
  const outStock = parts.filter((p) => p.stock <= 0);

  const filtered = parts.filter((p) => {
    const term = searchTerm.trim().toLowerCase();
    const matchTerm =
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.partNumber.toLowerCase().includes(term) ||
      (p.barcode || "").toLowerCase().includes(term);
    const matchBrand = brandFilter === "all" || p.brand === brandFilter;
    const matchCat = categoryFilter === "all" || p.category === categoryFilter;
    const matchBarcode = !barcodeFilter || (p.barcode || "").includes(barcodeFilter.trim());
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "in_stock" && p.stock > p.minStock) ||
      (statusFilter === "low" && p.stock > 0 && p.stock <= p.minStock) ||
      (statusFilter === "out" && p.stock <= 0);
    return matchTerm && matchBrand && matchCat && matchBarcode && matchStatus;
  });

  const totalValue = parts.reduce((a, b) => a + b.stock * b.sellPrice, 0);
  const topSeller = [...parts].sort((a, b) => b.sold - a.sold)[0];

  function openNew() {
    setForm({ ...empty, id: `PRT-${String(parts.length + 1).padStart(3, "0")}` });
    setEditing(null);
    setShowForm(true);
  }
  function openEdit(p: Part) { setForm(p); setEditing(p); setShowForm(true); }
  function handleSave() {
    if (!form.name) { toast.error("الاسم مطلوب"); return; }
    if (editing) { inventoryStore.update(editing.id, form); toast.success("تم التحديث"); }
    else { inventoryStore.add(form); toast.success("تمت الإضافة"); }
    setShowForm(false);
  }
  function handleDelete() {
    if (!deleting) return;
    const r = inventoryStore.remove(deleting.id);
    if (r) { moveToTrash({ type: "inventory", entityId: r.id, label: `${r.name} (${r.partNumber})`, payload: r }); toast.success("تم النقل للمهملات"); }
    setDeleting(null);
  }
  function clearFilters() {
    setBrandFilter("all"); setCategoryFilter("all"); setStatusFilter("all");
    setBarcodeFilter(""); setSearchTerm("");
  }

  const activeFiltersCount = [
    brandFilter !== "all", categoryFilter !== "all",
    statusFilter !== "all", !!barcodeFilter,
  ].filter(Boolean).length;

  const bulk = useBulkSelection(filtered);
  function handleBulkDelete() {
    bulk.selectedItems.forEach((p) => {
      const r = inventoryStore.remove(p.id);
      if (r) moveToTrash({ type: "inventory", entityId: r.id, label: `${r.name} (${r.partNumber})`, payload: r });
    });
    toast.success(`تم نقل ${bulk.count} منتج للمهملات`);
    bulk.clear();
  }
  function handleBulkExport() {
    exportRowsAsCsv(
      `inventory-${new Date().toISOString().slice(0, 10)}`,
      ["الاسم", "رقم القطعة", "الباركود", "الماركة", "التصنيف", "المورد", "سعر الشراء", "سعر البيع", "المخزون", "حد التنبيه", "المُباع"],
      bulk.selectedItems.map((p) => [p.name, p.partNumber, p.barcode || "", p.brand || "", p.category || "", p.supplier, p.buyPrice, p.sellPrice, p.stock, p.minStock, p.sold]),
    );
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("inventory.title")}</h1>
          <p className="text-sm text-muted-foreground">{isRtl ? "قطع الغيار، المنتجات والمواد" : "Spare parts, products and materials"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/movements">
            <Button variant="outline" className="gap-2 border-border">
              <ArrowDownUp size={16} /> {isRtl ? "الإذن المخزنية" : "Stock Movements"}
            </Button>
          </Link>
          <Link to="/inventory/import-catalog">
            <Button variant="outline" className="gap-2 border-border">
              <Package size={16} /> {isRtl ? "استيراد كتالوج" : "Import Catalog"}
            </Button>
          </Link>
          {allowEdit && (
            <Button onClick={openNew} className="gradient-gold text-primary-foreground shadow-gold hover:opacity-90 gap-2">
              <Plus size={18} /> {isRtl ? "إضافة منتج" : "Add Item"}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="إجمالي الأصناف" value={parts.length} icon={Package} variant="info" />
        <StatCard title="منخفضة المخزون" value={lowStock.length} icon={AlertTriangle} variant="warning" />
        <StatCard title="الأكثر مبيعاً" value={topSeller?.name || "-"} icon={TrendingUp} variant="gold" />
        <StatCard title="قيمة المخزون" value={`${totalValue.toLocaleString()} ر.ع`} icon={Boxes} variant="success" />
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-warning flex items-center gap-2 mb-2">
            <AlertTriangle size={16} /> تنبيه: قطع قاربت على النفاد
          </h3>
          <div className="flex flex-wrap gap-2">
            {lowStock.map((p) => (
              <span key={p.id} className="text-xs bg-warning/10 text-warning px-2 py-1 rounded-lg">
                {p.name} (متبقي: {p.stock})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث بالاسم، رقم القطعة، أو الباركود..."
              className="pr-9 bg-secondary border-border"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters((s) => !s)}
            className="border-border gap-2 relative"
          >
            <Filter size={16} /> الفلاتر
            {activeFiltersCount > 0 && (
              <span className="absolute -top-1.5 -left-1.5 bg-primary text-primary-foreground text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {activeFiltersCount}
              </span>
            )}
          </Button>
          {activeFiltersCount > 0 && (
            <Button variant="ghost" onClick={clearFilters} className="gap-1 text-muted-foreground">
              <X size={14} /> مسح
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-border">
            <FilterField label="الماركة" icon={Tag}>
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الماركات</SelectItem>
                  {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="التصنيف" icon={Boxes}>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع التصنيفات</SelectItem>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="الحالة" icon={AlertTriangle}>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="in_stock">في المخزون</SelectItem>
                  <SelectItem value="low">منخفض</SelectItem>
                  <SelectItem value="out">نفد</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="الباركود" icon={Barcode}>
              <Input
                value={barcodeFilter}
                onChange={(e) => setBarcodeFilter(e.target.value)}
                placeholder="ادخل الباركود..."
                className="bg-secondary border-border font-mono"
              />
            </FilterField>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          عرض <span className="text-foreground font-semibold">{filtered.length}</span> من {parts.length} منتج
        </p>
        {filtered.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={bulk.allChecked} onCheckedChange={bulk.toggleAll} />
            تحديد الكل
          </label>
        )}
      </div>

      {/* Grid Cards */}
      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Package size={48} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">لا توجد منتجات مطابقة</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              part={p}
              allowEdit={allowEdit}
              allowDelete={allowDelete}
              selected={bulk.isSelected(p.id)}
              onToggleSelect={() => bulk.toggle(p.id)}
              onView={() => navigate(`/inventory/${p.id}`)}
              onEdit={() => openEdit(p)}
              onDelete={() => setDeleting(p)}
              onPrintBarcode={() => setPrintingBarcode(p)}
            />
          ))}
        </div>
      )}

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="منتج">
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleBulkExport}>
          <FileSpreadsheet size={14} /> تصدير CSV
        </Button>
        {allowDelete && (
          <Button size="sm" variant="destructive" className="gap-1 h-8" onClick={handleBulkDelete}>
            <Trash2 size={14} /> حذف
          </Button>
        )}
      </BulkActionBar>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">{editing ? `تعديل ${editing.name}` : "منتج جديد"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2 max-h-[70vh] overflow-y-auto">
            <Field label="الاسم *">
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border" />
            </Field>
            <Field label="رقم القطعة">
              <Input value={form.partNumber} onChange={e => setForm({ ...form, partNumber: e.target.value })} className="bg-secondary border-border font-mono" />
            </Field>
            <Field label="الباركود">
              <Input value={form.barcode || ""} onChange={e => setForm({ ...form, barcode: e.target.value })} className="bg-secondary border-border font-mono" placeholder="EAN/UPC" />
            </Field>
            <Field label="الماركة">
              <Input value={form.brand || ""} onChange={e => setForm({ ...form, brand: e.target.value })} className="bg-secondary border-border" />
            </Field>
            <Field label="التصنيف">
              <Input value={form.category || ""} onChange={e => setForm({ ...form, category: e.target.value })} className="bg-secondary border-border" />
            </Field>
            <Field label="المورد">
              <Input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className="bg-secondary border-border" />
            </Field>
            <Field label="الموقع/الرف">
              <Input value={form.location || ""} onChange={e => setForm({ ...form, location: e.target.value })} className="bg-secondary border-border" />
            </Field>
            <Field label="الحالة">
              <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v as "active" | "inactive" })}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشط</SelectItem>
                  <SelectItem value="inactive">غير نشط</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="سعر الشراء">
              <Input type="number" value={form.buyPrice} onChange={e => setForm({ ...form, buyPrice: Number(e.target.value) })} className="bg-secondary border-border" />
            </Field>
            <Field label="سعر البيع">
              <Input type="number" value={form.sellPrice} onChange={e => setForm({ ...form, sellPrice: Number(e.target.value) })} className="bg-secondary border-border" />
            </Field>
            <Field label="المخزون الحالي">
              <Input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: Number(e.target.value) })} className="bg-secondary border-border" />
            </Field>
            <Field label="حد التنبيه">
              <Input type="number" value={form.minStock} onChange={e => setForm({ ...form, minStock: Number(e.target.value) })} className="bg-secondary border-border" />
            </Field>
          </div>
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1">حفظ</Button>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-border">إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف ${deleting?.name || ""}`}
        description="سيتم نقل المنتج إلى سلة المهملات."
      />

      <BarcodeLabelDialog
        open={!!printingBarcode}
        onOpenChange={(o) => !o && setPrintingBarcode(null)}
        part={printingBarcode}
      />
    </div>
  );
}

function ProductCard({
  part, allowEdit, allowDelete, selected, onToggleSelect, onView, onEdit, onDelete, onPrintBarcode,
}: {
  part: Part;
  allowEdit: boolean;
  allowDelete: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPrintBarcode: () => void;
}) {
  const isOut = part.stock <= 0;
  const isLow = part.stock > 0 && part.stock <= part.minStock;
  const statusColor = isOut
    ? "bg-destructive/15 text-destructive border-destructive/30"
    : isLow
      ? "bg-warning/15 text-warning border-warning/30"
      : "bg-success/15 text-success border-success/30";
  const statusLabel = isOut ? "نفد" : isLow ? "منخفض" : "متوفر";

  const margin = part.buyPrice > 0
    ? Math.round(((part.sellPrice - part.buyPrice) / part.buyPrice) * 100)
    : 0;

  return (
    <div className={`group bg-card border rounded-xl p-4 shadow-card hover:shadow-gold hover:border-primary/40 transition-all cursor-pointer ${selected ? "border-primary ring-2 ring-primary/30" : "border-border"}`} onClick={onView}>
      {/* Top: status + actions */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button onClick={onPrintBarcode} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary" title="طباعة باركود">
            <Printer size={14} />
          </button>
          <button onClick={onView} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-info" title="تفاصيل">
            <Eye size={14} />
          </button>
          {allowEdit && (
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-info" title="تعديل">
              <Edit size={14} />
            </button>
          )}
          {allowDelete && (
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="حذف">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Icon + Name */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0">
          <Package size={22} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">{part.name}</h3>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{part.partNumber}</p>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-3 min-h-[20px]">
        {part.brand && (
          <span className="text-[10px] bg-info/10 text-info px-1.5 py-0.5 rounded">{part.brand}</span>
        )}
        {part.category && (
          <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">{part.category}</span>
        )}
      </div>

      {/* Barcode */}
      {part.barcode && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-3 font-mono">
          <Barcode size={12} /> {part.barcode}
        </div>
      )}

      {/* Prices */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border">
        <div>
          <p className="text-[10px] text-muted-foreground">سعر البيع</p>
          <p className="text-sm font-bold text-foreground">{part.sellPrice} <span className="text-[10px] font-normal text-muted-foreground">ر.ع</span></p>
        </div>
        <div className="text-left">
          <p className="text-[10px] text-muted-foreground">المخزون</p>
          <p className={`text-sm font-bold ${isOut ? "text-destructive" : isLow ? "text-warning" : "text-success"}`}>
            {part.stock} <span className="text-[10px] font-normal text-muted-foreground">قطعة</span>
          </p>
        </div>
      </div>

      {/* Footer: buy + margin */}
      <div className="flex items-center justify-between pt-2 mt-2 border-t border-border/50 text-[10px] text-muted-foreground">
        <span>شراء: {part.buyPrice} ر.ع</span>
        {margin > 0 && (
          <span className="text-success font-semibold">+{margin}%</span>
        )}
      </div>
    </div>
  );
}

function FilterField({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Icon size={11} /> {label}
      </label>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
