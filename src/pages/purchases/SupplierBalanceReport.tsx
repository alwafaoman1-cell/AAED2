import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileSpreadsheet, Printer, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { supplierPaymentsStore } from "@/lib/supplierPaymentsStore";
import { purchaseReturnsStore } from "@/lib/purchaseReturnsStore";
import { purchaseInvoicesStore } from "@/lib/purchaseInvoicesStore";
import {
  buildSupplierBalanceReport,
  getSupplierBalanceReportHtml,
  downloadSupplierBalanceCsv,
} from "@/lib/purchaseReports";

export default function SupplierBalanceReport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tick, setTick] = useState(0);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    const subs = [
      purchaseInvoicesStore.subscribe(() => setTick((x) => x + 1)),
      supplierPaymentsStore.subscribe(() => setTick((x) => x + 1)),
      purchaseReturnsStore.subscribe(() => setTick((x) => x + 1)),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  const report = useMemo(() => {
    const payments = supplierPaymentsStore.getAll().map((p) => ({
      supplierId: p.supplierId, amount: p.amount, date: p.date,
    }));
    const returns = purchaseReturnsStore.getAll().map((r) => ({
      supplierId: r.supplierId, total: r.total, date: r.date,
    }));
    return buildSupplierBalanceReport(payments, returns, from || undefined, to || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, tick]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Link to="/inventory" className="hover:text-foreground flex items-center gap-1">
            <ArrowRight size={14} /> المخزون
          </Link>
          <span>/</span>
          <span className="text-foreground">تقرير رصيد الموردين</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">تقرير رصيد الموردين</h1>
        <p className="text-sm text-muted-foreground">إجمالي المشتريات والمدفوع والمتبقي لكل مورد ضمن فترة محددة</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Filter size={14} /> الفترة الزمنية
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">من</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-secondary border-border" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">إلى</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-secondary border-border" />
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <Button onClick={() => setPreviewHtml(getSupplierBalanceReportHtml(report))} className="gradient-gold text-primary-foreground gap-2 flex-1">
              <Printer size={16} /> طباعة / PDF
            </Button>
            <Button onClick={() => downloadSupplierBalanceCsv(report)} variant="outline" className="border-border gap-2 flex-1">
              <FileSpreadsheet size={16} /> تنزيل Excel
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="عدد الموردين" value={report.rows.length} icon={FileSpreadsheet} variant="info" />
        <StatCard title="إجمالي المشتريات" value={`${report.totals.purchases.toFixed(3)} ر.ع`} icon={FileSpreadsheet} variant="gold" />
        <StatCard title="المدفوع" value={`${report.totals.paid.toFixed(3)} ر.ع`} icon={FileSpreadsheet} variant="success" />
        <StatCard title="المتبقي المستحق" value={`${report.totals.remaining.toFixed(3)} ر.ع`} icon={FileSpreadsheet} variant="warning" />
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                <th className="text-right py-3 px-4 font-medium">المورد</th>
                <th className="text-right py-3 px-4 font-medium">عدد الفواتير</th>
                <th className="text-right py-3 px-4 font-medium">إجمالي المشتريات</th>
                <th className="text-right py-3 px-4 font-medium">المدفوع</th>
                <th className="text-right py-3 px-4 font-medium">المرتجعات</th>
                <th className="text-right py-3 px-4 font-medium">الرصيد المستحق</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">لا توجد بيانات في هذه الفترة</td></tr>
              )}
              {report.rows.map((r) => (
                <tr key={r.supplierId} className="border-b border-border/50 hover:bg-secondary/20">
                  <td className="py-3 px-4 text-foreground font-medium">{r.supplierName}</td>
                  <td className="py-3 px-4 text-muted-foreground">{r.invoicesCount}</td>
                  <td className="py-3 px-4 text-foreground font-mono">{r.totalPurchases.toFixed(3)}</td>
                  <td className="py-3 px-4 text-success font-mono">{r.totalPaid.toFixed(3)}</td>
                  <td className="py-3 px-4 text-warning font-mono">{r.totalReturns.toFixed(3)}</td>
                  <td className={`py-3 px-4 font-mono font-semibold ${r.remaining > 0 ? "text-destructive" : "text-success"}`}>{r.remaining.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {previewHtml && (
        <PdfPreviewDialog
          open={!!previewHtml}
          onOpenChange={(o) => !o && setPreviewHtml(null)}
          htmlContent={previewHtml}
          title="تقرير رصيد الموردين"
        />
      )}
    </div>
  );
}
