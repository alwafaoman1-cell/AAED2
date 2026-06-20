import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ArrowRight, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard";
import { purchaseReturnsStore, type PurchaseReturn } from "@/lib/purchaseReturnsStore";

export default function PurchaseReturns() {
  const [returns, setReturns] = useState<PurchaseReturn[]>(purchaseReturnsStore.getAll());
  const [search, setSearch] = useState("");

  useEffect(
    () => purchaseReturnsStore.subscribe(() => setReturns([...purchaseReturnsStore.getAll()])),
    [],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return returns;
    return returns.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.invoiceId.toLowerCase().includes(q),
    );
  }, [returns, search]);

  const total = returns.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Link to="/inventory" className="hover:text-foreground flex items-center gap-1">
            <ArrowRight size={14} /> المخزون
          </Link>
          <span>/</span>
          <span className="text-foreground">مرتجعات المشتريات</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">مرتجعات المشتريات</h1>
        <p className="text-sm text-muted-foreground">إشعارات مدينة وإرجاع البضاعة للموردين</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="عدد المرتجعات" value={returns.length} icon={RotateCcw} variant="info" />
        <StatCard title="إجمالي قيمة المرتجعات" value={`${total.toFixed(3)} ر.ع`} icon={RotateCcw} variant="warning" />
        <StatCard title="آخر مرتجع" value={returns[0]?.date || "-"} icon={RotateCcw} variant="gold" />
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم المرتجع أو المورد..." className="pr-9 bg-card border-border" />
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                <th className="text-right py-3 px-4 font-medium">رقم المرتجع</th>
                <th className="text-right py-3 px-4 font-medium">الفاتورة الأصلية</th>
                <th className="text-right py-3 px-4 font-medium">المورد</th>
                <th className="text-right py-3 px-4 font-medium">التاريخ</th>
                <th className="text-right py-3 px-4 font-medium">عدد الأصناف</th>
                <th className="text-right py-3 px-4 font-medium hidden md:table-cell">السبب</th>
                <th className="text-right py-3 px-4 font-medium">القيمة</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">لا توجد مرتجعات بعد</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/20">
                  <td className="py-3 px-4 font-mono text-xs text-warning font-semibold">{r.id}</td>
                  <td className="py-3 px-4 font-mono text-xs text-primary">{r.invoiceId}</td>
                  <td className="py-3 px-4 text-foreground">{r.supplierName}</td>
                  <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{r.date}</td>
                  <td className="py-3 px-4 text-foreground">{r.items.length}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{r.reason || "-"}</td>
                  <td className="py-3 px-4 text-warning font-mono font-semibold">{r.total.toFixed(3)} ر.ع</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
