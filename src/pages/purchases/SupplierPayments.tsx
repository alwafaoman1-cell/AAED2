import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, ArrowRight, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard";
import { supplierPaymentsStore, type SupplierPayment } from "@/lib/supplierPaymentsStore";
import SupplierPaymentDialog from "@/components/purchases/SupplierPaymentDialog";
import { canEdit } from "@/lib/permissions";

export default function SupplierPayments() {
  const [payments, setPayments] = useState<SupplierPayment[]>(supplierPaymentsStore.getAll());
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const allowEdit = canEdit();

  useEffect(
    () => supplierPaymentsStore.subscribe(() => setPayments([...supplierPaymentsStore.getAll()])),
    [],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.supplierName.toLowerCase().includes(q) ||
        (p.reference || "").toLowerCase().includes(q),
    );
  }, [payments, search]);

  const total = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/inventory" className="hover:text-foreground flex items-center gap-1">
              <ArrowRight size={14} /> المخزون
            </Link>
            <span>/</span>
            <span className="text-foreground">مدفوعات الموردين</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">مدفوعات الموردين</h1>
          <p className="text-sm text-muted-foreground">سجل الدفعات والتسويات للموردين</p>
        </div>
        {allowEdit && (
          <Button onClick={() => setShowForm(true)} className="gradient-gold text-primary-foreground shadow-gold gap-2">
            <Plus size={18} /> دفعة جديدة
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="عدد الدفعات" value={payments.length} icon={DollarSign} variant="info" />
        <StatCard title="إجمالي المدفوعات" value={`${total.toFixed(3)} ر.ع`} icon={DollarSign} variant="gold" />
        <StatCard title="آخر دفعة" value={payments[0]?.date || "-"} icon={DollarSign} variant="success" />
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم أو مورد أو مرجع..." className="pr-9 bg-card border-border" />
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                <th className="text-right py-3 px-4 font-medium">رقم الدفعة</th>
                <th className="text-right py-3 px-4 font-medium">المورد</th>
                <th className="text-right py-3 px-4 font-medium">التاريخ</th>
                <th className="text-right py-3 px-4 font-medium">الفاتورة</th>
                <th className="text-right py-3 px-4 font-medium">طريقة الدفع</th>
                <th className="text-right py-3 px-4 font-medium hidden md:table-cell">المرجع</th>
                <th className="text-right py-3 px-4 font-medium">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">لا توجد دفعات بعد</td></tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/20">
                  <td className="py-3 px-4 font-mono text-xs text-primary font-semibold">{p.id}</td>
                  <td className="py-3 px-4 text-foreground">{p.supplierName}</td>
                  <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{p.date}</td>
                  <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{p.invoiceId || "-"}</td>
                  <td className="py-3 px-4">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-foreground">{p.method}</span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{p.reference || "-"}</td>
                  <td className="py-3 px-4 text-success font-mono font-semibold">{p.amount.toFixed(3)} ر.ع</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SupplierPaymentDialog open={showForm} onOpenChange={setShowForm} />
    </div>
  );
}
