import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, FileText, Edit, Trash2, RotateCcw, DollarSign, ArrowRight, Printer, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard";
import {
  purchaseInvoicesStore,
  getPurchaseTotals,
  type PurchaseInvoice,
} from "@/lib/purchaseInvoicesStore";
import { suppliersStore } from "@/lib/suppliersStore";
import { supplierPaymentsStore } from "@/lib/supplierPaymentsStore";
import { canDelete, canEdit } from "@/lib/permissions";
import { moveToTrash } from "@/lib/trashStore";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { toast } from "sonner";
import PurchaseInvoiceFormDialog from "@/components/purchases/PurchaseInvoiceFormDialog";
import SupplierPaymentDialog from "@/components/purchases/SupplierPaymentDialog";
import PurchaseReturnDialog from "@/components/purchases/PurchaseReturnDialog";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { getPurchaseInvoiceHtml } from "@/lib/purchaseReports";
import { unpostPurchaseInvoice } from "@/lib/purchaseAccounting";

type StatusFilter = "all" | "paid" | "partial" | "unpaid";

export default function PurchaseInvoices() {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>(purchaseInvoicesStore.getAll());
  const [suppliers, setSuppliers] = useState(suppliersStore.getAll());
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PurchaseInvoice | null>(null);
  const [deleting, setDeleting] = useState<PurchaseInvoice | null>(null);
  const [payInv, setPayInv] = useState<PurchaseInvoice | null>(null);
  const [returnInv, setReturnInv] = useState<PurchaseInvoice | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => purchaseInvoicesStore.subscribe(() => setInvoices([...purchaseInvoicesStore.getAll()])), []);
  useEffect(() => suppliersStore.subscribe(() => setSuppliers([...suppliersStore.getAll()])), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((i) => {
      if (q && !(
        i.id.toLowerCase().includes(q) ||
        i.supplierName.toLowerCase().includes(q) ||
        (i.invoiceNumber || "").toLowerCase().includes(q)
      )) return false;
      if (supplierFilter && i.supplierId !== supplierFilter) return false;
      if (from && i.date < from) return false;
      if (to && i.date > to) return false;
      if (statusFilter !== "all") {
        const t = getPurchaseTotals(i).total;
        const remaining = t - (i.paidAmount || 0);
        if (statusFilter === "paid" && !i.paid) return false;
        if (statusFilter === "partial" && (i.paid || (i.paidAmount || 0) <= 0)) return false;
        if (statusFilter === "unpaid" && (i.paid || (i.paidAmount || 0) > 0 || remaining <= 0)) return false;
      }
      return true;
    });
  }, [invoices, search, supplierFilter, statusFilter, from, to]);

  const totals = useMemo(() => {
    let total = 0, paid = 0;
    filtered.forEach((i) => {
      const t = getPurchaseTotals(i).total;
      total += t;
      paid += i.paidAmount || 0;
    });
    return { total, paid, due: total - paid };
  }, [filtered]);

  function tryDelete(inv: PurchaseInvoice) {
    // منع الحذف إذا توجد دفعات أو مرتجعات مرتبطة
    const payments = supplierPaymentsStore.getAll().filter((p) => p.invoiceId === inv.id);
    if (payments.length) {
      toast.error(`لا يمكن الحذف — يوجد ${payments.length} دفعة مرتبطة. ألغِ الدفعات أولاً أو سجّل مرتجعاً.`);
      return;
    }
    setDeleting(inv);
  }

  function handleDelete() {
    if (!deleting) return;
    unpostPurchaseInvoice(deleting); // عكس قيود + إعادة المخزون
    const r = purchaseInvoicesStore.remove(deleting.id);
    if (r) {
      moveToTrash({
        type: "purchase_invoice" as never,
        entityId: r.id,
        label: `${r.id} — ${r.supplierName}`,
        payload: r,
      });
      toast.success("تم الحذف وعكس القيود المحاسبية");
    }
    setDeleting(null);
  }

  function printInvoice(inv: PurchaseInvoice) {
    const supplier = suppliers.find((s) => s.id === inv.supplierId);
    const html = getPurchaseInvoiceHtml(inv, supplier);
    setPreviewTitle(`فاتورة شراء ${inv.id}`);
    setPreviewHtml(html);
  }

  function clearFilters() {
    setSearch(""); setSupplierFilter(""); setStatusFilter("all"); setFrom(""); setTo("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/inventory" className="hover:text-foreground flex items-center gap-1">
              <ArrowRight size={14} /> المخزون
            </Link>
            <span>/</span>
            <span className="text-foreground">فواتير الشراء</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">فواتير الشراء</h1>
          <p className="text-sm text-muted-foreground">إدارة مشتريات الورشة من الموردين • مع الترحيل المحاسبي التلقائي</p>
        </div>
        {allowEdit && (
          <Button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="gradient-gold text-primary-foreground shadow-gold gap-2"
          >
            <Plus size={18} /> فاتورة شراء جديدة
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="عدد الفواتير" value={filtered.length} icon={FileText} variant="info" />
        <StatCard title="إجمالي المشتريات" value={`${totals.total.toFixed(3)} ر.ع`} icon={FileText} variant="gold" />
        <StatCard title="المدفوع" value={`${totals.paid.toFixed(3)} ر.ع`} icon={DollarSign} variant="success" />
        <StatCard title="المستحق" value={`${totals.due.toFixed(3)} ر.ع`} icon={DollarSign} variant="warning" />
      </div>

      {/* فلاتر */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Filter size={14} /> فلاتر البحث
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative md:col-span-2">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم/مورد/خارجي..." className="pr-9 bg-secondary border-border" />
          </div>
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="h-10 rounded-md bg-secondary border border-border px-3 text-sm text-foreground">
            <option value="">كل الموردين</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="h-10 rounded-md bg-secondary border border-border px-3 text-sm text-foreground">
            <option value="all">كل الحالات</option>
            <option value="paid">مدفوعة</option>
            <option value="partial">مدفوعة جزئياً</option>
            <option value="unpaid">غير مدفوعة</option>
          </select>
          <div className="flex gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-secondary border-border" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-secondary border-border" />
          </div>
        </div>
        {(search || supplierFilter || statusFilter !== "all" || from || to) && (
          <button onClick={clearFilters} className="text-xs text-primary hover:underline">إعادة تعيين الفلاتر</button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                <th className="text-right py-3 px-4 font-medium">رقم الفاتورة</th>
                <th className="text-right py-3 px-4 font-medium">المورد</th>
                <th className="text-right py-3 px-4 font-medium hidden md:table-cell">رقم خارجي</th>
                <th className="text-right py-3 px-4 font-medium hidden md:table-cell">التاريخ</th>
                <th className="text-right py-3 px-4 font-medium">الإجمالي</th>
                <th className="text-right py-3 px-4 font-medium">المدفوع</th>
                <th className="text-right py-3 px-4 font-medium">الحالة</th>
                <th className="text-right py-3 px-4 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                    لا توجد فواتير مطابقة
                  </td>
                </tr>
              )}
              {filtered.map((inv) => {
                const t = getPurchaseTotals(inv);
                const remaining = t.total - (inv.paidAmount || 0);
                return (
                  <tr key={inv.id} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="py-3 px-4 font-mono text-xs text-primary font-semibold">{inv.id}</td>
                    <td className="py-3 px-4 text-foreground">{inv.supplierName}</td>
                    <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{inv.invoiceNumber || "-"}</td>
                    <td className="py-3 px-4 text-muted-foreground hidden md:table-cell font-mono text-xs">{inv.date}</td>
                    <td className="py-3 px-4 text-foreground font-mono">{t.total.toFixed(3)}</td>
                    <td className="py-3 px-4 text-success font-mono">{(inv.paidAmount || 0).toFixed(3)}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={inv.status} remaining={remaining} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => printInvoice(inv)} className="p-1.5 rounded hover:bg-secondary text-info" title="طباعة / PDF">
                          <Printer size={14} />
                        </button>
                        {!inv.paid && (
                          <button onClick={() => setPayInv(inv)} className="p-1.5 rounded hover:bg-success/10 text-success" title="دفع">
                            <DollarSign size={14} />
                          </button>
                        )}
                        <button onClick={() => setReturnInv(inv)} className="p-1.5 rounded hover:bg-warning/10 text-warning" title="مرتجع">
                          <RotateCcw size={14} />
                        </button>
                        {allowEdit && (
                          <button onClick={() => { setEditing(inv); setShowForm(true); }} className="p-1.5 rounded hover:bg-secondary text-info" title="تعديل">
                            <Edit size={14} />
                          </button>
                        )}
                        {allowDelete && (
                          <button onClick={() => tryDelete(inv)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="حذف">
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

      <PurchaseInvoiceFormDialog open={showForm} onOpenChange={setShowForm} editing={editing} />
      {payInv && (
        <SupplierPaymentDialog
          open={!!payInv}
          onOpenChange={(o) => !o && setPayInv(null)}
          prefillSupplierId={payInv.supplierId}
          prefillInvoiceId={payInv.id}
        />
      )}
      {returnInv && (
        <PurchaseReturnDialog
          open={!!returnInv}
          onOpenChange={(o) => !o && setReturnInv(null)}
          invoiceId={returnInv.id}
        />
      )}
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف فاتورة ${deleting?.id || ""}`}
        description="سيتم نقل الفاتورة للمهملات وعكس القيود المحاسبية وإعادة الكميات للمخزون."
      />
      {previewHtml && (
        <PdfPreviewDialog
          open={!!previewHtml}
          onOpenChange={(o) => !o && setPreviewHtml(null)}
          htmlContent={previewHtml}
          title={previewTitle}
        />
      )}
    </div>
  );
}

function StatusBadge({ status, remaining }: { status: PurchaseInvoice["status"]; remaining: number }) {
  if (status === "paid") return <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success font-medium">مدفوعة</span>;
  if (status === "partial") return <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium">مدفوعة جزئياً</span>;
  if (remaining > 0) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">غير مدفوعة</span>;
  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">مستلمة</span>;
}
