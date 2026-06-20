// شريط KPI أعلى صفحة التقارير - مؤشرات فورية (مع توحيد الإيرادات: أوامر عمل + فواتير تأمين)
import { TrendingUp, Receipt, ShoppingCart, Package, AlertCircle, Wallet, ArrowDownCircle, Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  buildProfitLossReport, buildPurchasesReport,
  buildInventoryReport, type ReportFilters,
} from "@/lib/reportsEngine";
import { useUnifiedRevenue } from "@/hooks/useUnifiedRevenue";
import { useMemo } from "react";

const fmt = (n: number) =>
  (n || 0).toLocaleString("ar-OM", { maximumFractionDigits: 2 }) + " ر.ع";

interface KpiTile {
  label: string;
  value: string;
  hint?: string;
  icon: any;
  color: string;
  trend?: "up" | "down" | "warn";
}

export default function ReportsKpiBar({ filters }: { filters: ReportFilters }) {
  const unified = useUnifiedRevenue(filters);

  const data = useMemo(() => {
    const pl = buildProfitLossReport(filters);
    const purchases = buildPurchasesReport(filters);
    const inv = buildInventoryReport();

    // ندمج إيرادات التأمين (بدون VAT) فوق P&L لتفادي خلط الإجمالي بالصافي
    // مع تجنّب احتساب ضريبة التأمين مرّتين (مرة في journalStore، ومرة عبر insurance_invoices.vat)
    const insSubtotal = unified.insurance.total - unified.insurance.vat;
    const unifiedRevenue = (pl.revenue || 0) + insSubtotal;
    // VAT المحصّلة الموحدة = من journalStore فقط (ضريبة المبيعات + ضريبة التأمين تُسجّل كقيود).
    // إن لم تكن فواتير التأمين تُرحَّل تلقائياً، نستخدم insurance VAT من الجدول.
    const unifiedVatCollected = unified.unified.vatCollected;
    const unifiedVatDue = unifiedVatCollected - pl.vatPaid;
    const adjustedNetProfit = pl.netProfit + insSubtotal;
    const adjustedMargin = unifiedRevenue > 0 ? (adjustedNetProfit / unifiedRevenue) * 100 : 0;

    return { pl, purchases, inv, unifiedRevenue, unifiedVatCollected, unifiedVatDue, adjustedNetProfit, adjustedMargin };
  }, [filters, unified]);

  const tiles: KpiTile[] = [
    {
      label: "صافي الربح",
      value: fmt(data.adjustedNetProfit),
      hint: `هامش ${data.adjustedMargin.toFixed(1)}%`,
      icon: TrendingUp,
      color: "bg-success/15 text-success border-success/30",
      trend: data.adjustedNetProfit >= 0 ? "up" : "down",
    },
    {
      label: "VAT المستحقة للهيئة",
      value: fmt(data.unifiedVatDue),
      hint: `مخرجات ${fmt(data.unifiedVatCollected)}`,
      icon: Receipt,
      color: "bg-warning/15 text-warning border-warning/30",
      trend: "warn",
    },
    {
      label: "مبيعات مدفوعة",
      value: fmt(unified.unified.paidRevenue),
      hint: `${unified.unified.invoicesCount} فاتورة`,
      icon: ShoppingCart,
      color: "bg-primary/15 text-primary border-primary/30",
      trend: "up",
    },
    {
      label: "مبيعات معلقة",
      value: fmt(unified.unified.pendingRevenue),
      hint: "بانتظار التحصيل",
      icon: AlertCircle,
      color: "bg-destructive/15 text-destructive border-destructive/30",
      trend: "warn",
    },
    {
      label: "إيرادات التأمين",
      value: fmt(unified.insurance.total),
      hint: `${unified.insurance.count} فاتورة • محصّل ${fmt(unified.insurance.paid)}`,
      icon: Shield,
      color: "bg-info/15 text-info border-info/30",
    },
    {
      label: "إجمالي المشتريات",
      value: fmt(data.purchases.totalPurchases),
      hint: `متبقي ${fmt(data.purchases.totalRemaining)}`,
      icon: ArrowDownCircle,
      color: "bg-info/15 text-info border-info/30",
    },
    {
      label: "قيمة المخزون",
      value: fmt(data.inv.totals.totalValue),
      hint: `${data.inv.totals.items} صنف`,
      icon: Package,
      color: "bg-secondary text-foreground border-border",
    },
    {
      label: "إجمالي الإيرادات",
      value: fmt(data.unifiedRevenue),
      hint: `أ.عمل ${fmt(unified.workOrders.totalRevenue)} • تأمين ${fmt(unified.insurance.total)}`,
      icon: Wallet,
      color: "bg-primary/10 text-primary border-primary/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
      {tiles.map((t, i) => {
        const Icon = t.icon;
        return (
          <Card key={i} className={`p-3 border ${t.color} transition-transform hover:scale-[1.02]`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium opacity-80 truncate">{t.label}</p>
                <p className="text-sm font-bold mt-1 truncate">{t.value}</p>
                {t.hint && <p className="text-[10px] opacity-70 mt-0.5 truncate">{t.hint}</p>}
              </div>
              <Icon size={18} className="flex-shrink-0 opacity-80" />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
