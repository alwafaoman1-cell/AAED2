import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ClipboardCheck,
  Cloud,
  DollarSign,
  FileWarning,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import StatCard from "@/components/StatCard";
import {
  buildDataQualityIssues,
  buildExecutiveAccountingSummary,
  buildWorkOrderAccountingRows,
  formatOMR,
} from "@/lib/accounting/core";
import { expensesStore } from "@/lib/expensesStore";
import { salesStore } from "@/lib/salesStore";
import { getWorkOrders } from "@/lib/workOrdersStore";

function firstOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExecutiveDashboard() {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [isRefreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const cleanups = [
      salesStore.subscribe(() => setTick((n) => n + 1)),
      expensesStore.subscribe(() => setTick((n) => n + 1)),
    ];
    const timer = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      window.clearInterval(timer);
    };
  }, []);

  const data = useMemo(() => {
    const range = { from: firstOfMonthISO(), to: todayISO() };
    const rows = buildWorkOrderAccountingRows(range);
    const summary = buildExecutiveAccountingSummary(range);
    const allRows = buildWorkOrderAccountingRows();
    const qualityIssues = buildDataQualityIssues();
    const recentDelivered = allRows
      .filter((row) => /delivered|closed|تم التسليم|مغلق/i.test(row.status))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 8);
    const recentActivity = rows
      .filter((row) => row.invoiceTotal > 0 || row.totalCost > 0)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 8);
    return {
      rows,
      summary,
      qualityIssues,
      recentDelivered,
      recentActivity,
      totalClaims: allRows.filter((row) => String(row.orderType).includes("insurance")).length,
      approvedClaims: allRows.filter((row) => String(row.orderType).includes("insurance") && row.revenueExVat > 0).length,
      invoicedClaims: allRows.filter((row) => String(row.orderType).includes("insurance") && row.hasInvoice).length,
      paidClaims: allRows.filter((row) => String(row.orderType).includes("insurance") && row.paidAmount >= row.invoiceTotal && row.invoiceTotal > 0).length,
      unpaidClaims: allRows.filter((row) => String(row.orderType).includes("insurance") && row.outstandingAmount > 0).length,
    };
  }, [tick]);

  const refresh = () => {
    setRefreshing(true);
    setTick((n) => n + 1);
    window.setTimeout(() => setRefreshing(false), 350);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Cloud className="text-primary" size={26} />
            اللوحة التنفيذية المحاسبية
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            كل الأرقام من Accounting Core الموحد، بدون بيانات تجريبية أو أرقام hardcoded.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh} disabled={isRefreshing} className="gap-1">
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} /> تحديث
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1">
            <ArrowRight size={14} /> رجوع
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard title="Total Revenue Excluding VAT" value={formatOMR(data.summary.totalRevenueExVat)} icon={DollarSign} variant="success" />
        <StatCard title="Total VAT Output" value={formatOMR(data.summary.totalVatOutput)} icon={TrendingUp} variant="info" />
        <StatCard title="Total Invoice Amount" value={formatOMR(data.summary.totalInvoiceAmount)} icon={ClipboardCheck} variant="gold" />
        <StatCard title="Total Paid Amount" value={formatOMR(data.summary.totalPaidAmount)} icon={DollarSign} variant="success" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard title="Total Outstanding" value={formatOMR(data.summary.totalOutstandingAmount)} icon={FileWarning} variant="warning" />
        <StatCard title="Total Expenses" value={formatOMR(data.summary.totalExpenses)} icon={TrendingDown} variant="warning" />
        <StatCard title="Net Profit by Invoices" value={formatOMR(data.summary.netProfit)} icon={TrendingUp} variant={data.summary.netProfit >= 0 ? "success" : "warning"} />
        <StatCard title="Profit Margin" value={data.summary.averageProfitMargin == null ? "N/A" : `${data.summary.averageProfitMargin.toFixed(2)}%`} icon={TrendingUp} variant="info" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard title="Total Work Orders" value={String(data.summary.workOrdersCount)} icon={Wrench} variant="info" />
        <StatCard title="Open Work Orders" value={String(data.summary.openWorkOrders)} icon={Wrench} variant="info" />
        <StatCard title="Delivered Work Orders" value={String(data.summary.deliveredWorkOrders)} icon={ClipboardCheck} variant="success" />
        <StatCard title="Vehicles In Workshop" value={String(data.summary.vehiclesInWorkshop)} icon={Wrench} variant="gold" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MiniMetric title="Total Claims" value={data.totalClaims} />
        <MiniMetric title="Approved Claims" value={data.approvedClaims} />
        <MiniMetric title="Invoiced Claims" value={data.invoicedClaims} />
        <MiniMetric title="Paid Claims" value={data.paidClaims} />
        <MiniMetric title="Unpaid Claims" value={data.unpaidClaims} danger={data.unpaidClaims > 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <TrendingUp size={14} /> Recent Financial Activity
          </h3>
          {data.recentActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا توجد بيانات مالية حالية.</p>
          ) : (
            <div className="space-y-2">
              {data.recentActivity.map((row) => (
                <button
                  key={row.workOrderId}
                  type="button"
                  onClick={() => navigate(`/work-orders/${row.workOrderNumber}`)}
                  className="flex w-full items-center justify-between rounded-lg border border-border/60 p-2 text-right text-xs hover:bg-muted/50"
                >
                  <span>
                    <b>{row.workOrderNumber}</b> — {row.customerName}
                    <span className="block text-muted-foreground">{row.date} · {row.finalCostSource}</span>
                  </span>
                  <span className={row.netProfit >= 0 ? "font-mono text-success" : "font-mono text-destructive"}>
                    {formatOMR(row.netProfit)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ClipboardCheck size={14} /> Recent Delivered Vehicles
          </h3>
          {data.recentDelivered.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا توجد مركبات مسلمة حديثًا.</p>
          ) : (
            <div className="space-y-2">
              {data.recentDelivered.map((row) => (
                <button
                  key={row.workOrderId}
                  type="button"
                  onClick={() => navigate(`/work-orders/${row.workOrderNumber}`)}
                  className="flex w-full items-center justify-between rounded-lg border border-border/60 p-2 text-right text-xs hover:bg-muted/50"
                >
                  <span>
                    <b>{row.vehiclePlate}</b> — {row.vehicleName}
                    <span className="block text-muted-foreground">{row.customerName} · {row.date}</span>
                  </span>
                  <span className="font-mono">{formatOMR(row.invoiceTotal)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck size={14} /> Data Quality / جودة البيانات
        </h3>
        {data.qualityIssues.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد مشاكل جودة بيانات ظاهرة حاليًا.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.qualityIssues.map((issue) => (
              <div
                key={issue.id}
                className={`rounded-lg border p-3 text-sm ${
                  issue.severity === "critical" ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{issue.label}</span>
                  <b className="font-mono">{issue.count}</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function MiniMetric({ title, value, danger = false }: { title: string; value: number; danger?: boolean }) {
  return (
    <Card className={`p-3 ${danger ? "border-warning/40 bg-warning/5" : ""}`}>
      <p className="text-[10px] text-muted-foreground">{title}</p>
      <p className={`mt-1 font-mono text-xl font-bold ${danger ? "text-warning" : ""}`}>{value}</p>
    </Card>
  );
}
