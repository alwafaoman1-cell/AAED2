import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Edit, Trash2, Phone, ArrowRight, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard";
import { suppliersStore, type Supplier } from "@/lib/suppliersStore";
import {
  purchaseInvoicesStore,
  getPurchaseTotals,
} from "@/lib/purchaseInvoicesStore";
import { canDelete, canEdit } from "@/lib/permissions";
import { moveToTrash } from "@/lib/trashStore";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { toast } from "sonner";
import SupplierFormDialog from "@/components/purchases/SupplierFormDialog";
import ImportSuppliersFromExcelButton from "@/components/purchases/ImportSuppliersFromExcelButton";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>(suppliersStore.getAll());
  const [invoices, setInvoices] = useState(purchaseInvoicesStore.getAll());
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => suppliersStore.subscribe(() => setSuppliers([...suppliersStore.getAll()])), []);
  useEffect(() => purchaseInvoicesStore.subscribe(() => setInvoices([...purchaseInvoicesStore.getAll()])), []);

  const balanceMap = useMemo(() => {
    const m: Record<string, { total: number; paid: number; due: number }> = {};
    invoices.forEach((i) => {
      const cur = m[i.supplierId] || { total: 0, paid: 0, due: 0 };
      const t = getPurchaseTotals(i).total;
      cur.total += t;
      cur.paid += i.paidAmount || 0;
      cur.due = cur.total - cur.paid;
      m[i.supplierId] = cur;
    });
    return m;
  }, [invoices]);

  const allBrands = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((s) => (s.vehicleBrands || []).forEach((b) => set.add(b)));
    return Array.from(set).sort();
  }, [suppliers]);
  const [brandFilter, setBrandFilter] = useState<string>("");

  const filtered = suppliers.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.phone.includes(search) ||
      (s.vehicleBrands || []).some((b) => b.toLowerCase().includes(search.toLowerCase()));
    const matchesBrand =
      !brandFilter ||
      (s.vehicleBrands || []).some(
        (b) => b === brandFilter || b.includes("جميع"),
      );
    return matchesSearch && matchesBrand;
  });

  function tryDelete(s: Supplier) {
    const linkedInvoices = invoices.filter((i) => i.supplierId === s.id);
    if (linkedInvoices.length) {
      toast.error(`لا يمكن حذف "${s.name}" — يرتبط بـ ${linkedInvoices.length} فاتورة شراء. احذف الفواتير أولاً.`);
      return;
    }
    setDeleting(s);
  }

  function handleDelete() {
    if (!deleting) return;
    const r = suppliersStore.remove(deleting.id);
    if (r) {
      moveToTrash({
        type: "supplier" as never,
        entityId: r.id,
        label: r.name,
        payload: r,
      });
      toast.success("تم النقل للمهملات");
    }
    setDeleting(null);
  }

  const totalDue = Object.values(balanceMap).reduce((s, b) => s + b.due, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/inventory" className="hover:text-foreground flex items-center gap-1">
              <ArrowRight size={14} /> المخزون
            </Link>
            <span>/</span>
            <span className="text-foreground">الموردين</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">إدارة الموردين</h1>
          <p className="text-sm text-muted-foreground">قاعدة بيانات الموردين وأرصدتهم</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowEdit && <ImportSuppliersFromExcelButton />}
          {allowEdit && (
            <Button onClick={() => { setEditing(null); setShowForm(true); }} className="gradient-gold text-primary-foreground shadow-gold gap-2">
              <Plus size={18} /> مورد جديد
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="عدد الموردين" value={suppliers.length} icon={Building2} variant="info" />
        <StatCard title="الفواتير الإجمالية" value={invoices.length} icon={Building2} variant="gold" />
        <StatCard title="إجمالي المستحق" value={`${totalDue.toFixed(3)} ر.ع`} icon={Building2} variant="warning" />
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف أو ماركة سيارة..."
            className="pr-9 bg-card border-border"
          />
        </div>
        {allBrands.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground ml-1">تصفية بالماركة:</span>
            <button
              type="button"
              onClick={() => setBrandFilter("")}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                !brandFilter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              الكل
            </button>
            {allBrands.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBrandFilter(b === brandFilter ? "" : b)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                  brandFilter === b
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                <th className="text-right py-3 px-4 font-medium">المورد</th>
                <th className="text-right py-3 px-4 font-medium">الهاتف</th>
                <th className="text-right py-3 px-4 font-medium hidden md:table-cell">الرقم الضريبي</th>
                <th className="text-right py-3 px-4 font-medium hidden xl:table-cell">العنوان</th>
                <th className="text-right py-3 px-4 font-medium hidden md:table-cell">الفئة / الماركات</th>
                <th className="text-right py-3 px-4 font-medium">إجمالي المشتريات</th>
                <th className="text-right py-3 px-4 font-medium">الرصيد المستحق</th>
                <th className="text-right py-3 px-4 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const bal = balanceMap[s.id] || { total: 0, paid: 0, due: 0 };
                return (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="py-3 px-4">
                      <div className="text-foreground font-medium">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{s.id}</div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{s.phone}</td>
                    <td className="py-3 px-4 text-muted-foreground font-mono text-xs hidden md:table-cell">{s.taxNumber || "-"}</td>
                    <td className="py-3 px-4 text-muted-foreground hidden xl:table-cell">{s.address || "-"}</td>
                    <td className="py-3 px-4 hidden md:table-cell">
                      {s.category && (
                        <div className="text-[11px] text-muted-foreground mb-1">{s.category}</div>
                      )}
                      <div className="flex flex-wrap gap-1 max-w-[260px]">
                        {(s.vehicleBrands || []).slice(0, 6).map((b) => (
                          <span
                            key={b}
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                          >
                            {b}
                          </span>
                        ))}
                        {(s.vehicleBrands || []).length > 6 && (
                          <span className="text-[10px] text-muted-foreground">+{(s.vehicleBrands || []).length - 6}</span>
                        )}
                        {!(s.vehicleBrands || []).length && (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-foreground font-mono">{bal.total.toFixed(3)}</td>
                    <td className={`py-3 px-4 font-mono font-semibold ${bal.due > 0 ? "text-destructive" : "text-success"}`}>{bal.due.toFixed(3)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        {s.phone && (
                          <a href={`tel:${s.phone}`} className="p-1.5 rounded hover:bg-secondary text-success" title="اتصال">
                            <Phone size={14} />
                          </a>
                        )}
                        {allowEdit && (
                          <button onClick={() => { setEditing(s); setShowForm(true); }} className="p-1.5 rounded hover:bg-secondary text-info" title="تعديل">
                            <Edit size={14} />
                          </button>
                        )}
                        {allowDelete && (
                          <button onClick={() => tryDelete(s)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="حذف">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <SupplierFormDialog open={showForm} onOpenChange={setShowForm} editing={editing} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف ${deleting?.name || ""}`}
        description="سيتم نقل المورد إلى سلة المهملات."
      />
    </div>
  );
}
