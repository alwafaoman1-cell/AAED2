// لوحة KPI تنفيذية مباشرة من السحابة (Realtime).
// تعرض: إيراد اليوم/الشهر، أوامر مفتوحة، مطالبات تأمين، مخزون منخفض،
// أعلى عملاء، أعلى مصروفات.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard";
import {
  ArrowRight, RefreshCw, DollarSign, Wrench, ShieldCheck, PackageX,
  TrendingUp, TrendingDown, Users, Cloud,
} from "lucide-react";
import { formatMoney } from "@/lib/pdfGenerator";

const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonthISO = () => {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
};

function useExecData() {
  return useQuery({
    queryKey: ["exec_dashboard"],
    refetchInterval: 30000,
    queryFn: async () => {
      const today = todayISO();
      const monthStart = firstOfMonthISO();
      const [salesToday, salesMonth, openOrders, openClaims, lowStock, expensesMonth, insInvMonth, ordersMonth] = await Promise.all([
        supabase.from("sales_documents").select("total,doc_type,customer_name").eq("doc_type", "invoice").gte("date", today).lte("date", today),
        supabase.from("sales_documents").select("total,customer_name,doc_type").eq("doc_type", "invoice").gte("date", monthStart).lte("date", today),
        supabase.from("job_orders").select("id,status", { count: "exact", head: true }).not("status", "in", "(delivered,closed,cancelled)"),
        supabase.from("insurance_claims").select("id,status,estimated_amount", { count: "exact" }).in("status", ["pending", "approved"]),
        supabase.from("inventory").select("id,name,quantity,min_quantity").lte("quantity", 100),
        supabase.from("expenses").select("amount,category_name,beneficiary,date").gte("date", monthStart).lte("date", today),
        supabase.from("insurance_invoices" as any).select("total").gte("issued_at", monthStart),
        supabase.from("job_orders").select("parts_cost,labor_cost,created_at").gte("created_at", monthStart),
      ]);
      const lowList = (lowStock.data || []).filter((i: any) => Number(i.quantity) <= Number(i.min_quantity));
      const revenueToday = (salesToday.data || []).reduce((s, r) => s + Number(r.total || 0), 0);
      const revenueMonth = (salesMonth.data || []).reduce((s, r) => s + Number(r.total || 0), 0)
        + (insInvMonth.data || []).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
      const cogsMonth = (ordersMonth.data || []).reduce((s, r) => s + Number(r.parts_cost || 0), 0);
      const laborMonth = (ordersMonth.data || []).reduce((s, r) => s + Number(r.labor_cost || 0), 0);
      const topCustomers = Object.entries(
        (salesMonth.data || []).reduce((acc: Record<string, number>, r: any) => {
          const k = r.customer_name || "—";
          acc[k] = (acc[k] || 0) + Number(r.total || 0);
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const topExpenses = Object.entries(
        (expensesMonth.data || []).reduce((acc: Record<string, number>, r: any) => {
          const k = r.category_name || r.beneficiary || "—";
          acc[k] = (acc[k] || 0) + Number(r.amount || 0);
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const expensesTotal = (expensesMonth.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      const openClaimsAmount = (openClaims.data || []).reduce((s, r) => s + Number(r.estimated_amount || 0), 0);
      const grossProfit = revenueMonth - cogsMonth - laborMonth;
      return {
        revenueToday, revenueMonth, expensesTotal,
        cogsMonth, laborMonth, grossProfit,
        openOrders: openOrders.count || 0,
        openClaimsCount: openClaims.count || 0, openClaimsAmount,
        lowStock: lowList,
        topCustomers, topExpenses,
        profitMonth: grossProfit - expensesTotal,
      };
    },
  });
}

export default function ExecutiveDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, refetch, isFetching } = useExecData();

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="text-primary" size={26} /> لوحة تنفيذية مباشرة
          </h1>
          <p className="text-sm text-muted-foreground mt-1">مؤشرات حية من السحابة — تتحدث تلقائياً كل 30 ثانية</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> تحديث
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1">
            <ArrowRight size={14} /> رجوع
          </Button>
        </div>
      </div>

      {isLoading || !data ? (
        <Card className="p-12 text-center text-muted-foreground">جاري التحميل من السحابة...</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="إيراد اليوم" value={formatMoney(data.revenueToday)} icon={DollarSign} variant="success" />
            <StatCard title="إيراد الشهر" value={formatMoney(data.revenueMonth)} icon={TrendingUp} variant="info" />
            <StatCard title="مصروفات الشهر" value={formatMoney(data.expensesTotal)} icon={TrendingDown} variant="warning" />
            <StatCard title="صافي ربح الشهر" value={formatMoney(data.profitMonth)} icon={TrendingUp} variant={data.profitMonth >= 0 ? "gold" : "warning"} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="تكلفة قطع الغيار (COGS)" value={formatMoney(data.cogsMonth)} icon={TrendingDown} variant="warning" />
            <StatCard title="أجور العمالة" value={formatMoney(data.laborMonth)} icon={Wrench} variant="info" />
            <StatCard title="مجمل الربح" value={formatMoney(data.grossProfit)} icon={TrendingUp} variant={data.grossProfit >= 0 ? "success" : "warning"} />
            <StatCard title="هامش الربح" value={`${data.revenueMonth > 0 ? ((data.profitMonth / data.revenueMonth) * 100).toFixed(1) : "0.0"}%`} icon={TrendingUp} variant={data.profitMonth >= 0 ? "gold" : "warning"} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard title="أوامر عمل مفتوحة" value={String(data.openOrders)} icon={Wrench} variant="info" />
            <StatCard title={`مطالبات تأمين فعّالة`} value={`${data.openClaimsCount} · ${formatMoney(data.openClaimsAmount)}`} icon={ShieldCheck} variant="info" />
            <StatCard title="قطع تحت الحد الأدنى" value={String(data.lowStock.length)} icon={PackageX} variant={data.lowStock.length > 0 ? "warning" : "info"} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Users size={14} /> أعلى 5 عملاء (هذا الشهر)</h3>
              {data.topCustomers.length === 0 ? (
                <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.topCustomers.map(([name, amt], i) => (
                    <li key={i} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0">
                      <span>{i + 1}. {name}</span>
                      <span className="font-mono font-semibold" dir="ltr">{formatMoney(amt as number)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingDown size={14} /> أعلى 5 بنود مصروفات</h3>
              {data.topExpenses.length === 0 ? (
                <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.topExpenses.map(([name, amt], i) => (
                    <li key={i} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0">
                      <span>{i + 1}. {name}</span>
                      <span className="font-mono font-semibold text-destructive" dir="ltr">{formatMoney(amt as number)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {data.lowStock.length > 0 && (
            <Card className="p-4 border-warning/40">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-warning">
                <PackageX size={14} /> قطع وصلت للحد الأدنى ({data.lowStock.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr className="border-b border-border">
                    <th className="text-right py-1">الاسم</th><th className="text-right py-1">المتوفر</th><th className="text-right py-1">الحد الأدنى</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/50">
                    {data.lowStock.slice(0, 20).map((p: any) => (
                      <tr key={p.id} className="hover:bg-secondary/30 cursor-pointer" onClick={() => navigate(`/inventory/${p.id}`)}>
                        <td className="py-1">{p.name}</td>
                        <td className="py-1 font-mono text-destructive">{p.quantity}</td>
                        <td className="py-1 font-mono">{p.min_quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
