import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Shield, Clock, CheckCircle, DollarSign, FileText, TrendingUp,
  AlertTriangle, Plus, ArrowLeft, Building2, Activity, Banknote,
  KanbanSquare, Bell, Receipt, FileSpreadsheet, Wrench, Truck, Hourglass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StatCard from "@/components/StatCard";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useClaimPayments } from "@/hooks/useClaimPayments";
import { useInsuranceInvoices } from "@/hooks/useInsuranceInvoices";
import { useInsuranceAlerts } from "@/hooks/useInsuranceAlerts";
import { toEnglishDigits } from "@/lib/numberUtils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { getClaimVehicleLocation, isActiveClaim } from "@/lib/claimVehicleLocation";

const fmt = (n: number) => toEnglishDigits(Math.round(n).toLocaleString("en-US"));

export default function InsuranceHub() {
  const navigate = useNavigate();
  const { data: claims = [], isLoading } = useInsuranceClaims();
  const { data: payments = [] } = useClaimPayments();
  const { data: invoices = [] } = useInsuranceInvoices();
  const alerts = useInsuranceAlerts();

  const stats = useMemo(() => {
    const total = claims.length;
    const pending = claims.filter((c) => c.status === "pending").length;
    const approved = claims.filter((c) => c.status === "approved").length;
    const paid = claims.filter((c) => c.status === "paid").length;
    const rejected = claims.filter((c) => c.status === "rejected").length;
    const estimatedTotal = claims.reduce((s, c) => s + (Number(c.estimated_amount) || 0), 0);
    const approvedTotal = claims.reduce((s, c) => s + (Number(c.approved_amount) || 0), 0);
    const paidTotal = payments.filter((p) => p.status === "cleared").reduce((s, p) => s + Number(p.amount || 0), 0);
    const invoicedTotal = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const outstanding = Math.max(invoicedTotal - paidTotal, 0);
    const approvalRate = total ? Math.round(((approved + paid) / total) * 100) : 0;

    // KPIs مبنية على تاريخ الدخول وتاريخ التسليم الفعلي
    const now = Date.now();
    const inWorkshop = claims.filter((c) => getClaimVehicleLocation(c) === "in_workshop").length;
    const withCustomer = claims.filter((c) => getClaimVehicleLocation(c) === "with_customer").length;
    const deliveredCount = claims.filter((c) => getClaimVehicleLocation(c) === "delivered").length;
    const completedPendingCollection = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && Number(i.total) - Number(i.paid_amount || 0) > 0.01).length;
    const overdueClaims = claims.filter((c) => {
      const delivered = (c as any).delivered_at;
      if (delivered) return false;
      const days = Math.round((now - new Date(c.created_at).getTime()) / 86_400_000);
      return days > 30;
    }).length;

    return { total, pending, approved, paid, rejected, estimatedTotal, approvedTotal, paidTotal, invoicedTotal, outstanding, approvalRate,
      inWorkshop, withCustomer, deliveredCount, completedPendingCollection, overdueClaims };
  }, [claims, payments, invoices]);

  // Top 5 insurance companies by claim count
  const topCompanies = useMemo(() => {
    const map = new Map<string, { name: string; count: number; amount: number }>();
    for (const c of claims) {
      const key = c.insurance_company || "—";
      const cur = map.get(key) || { name: key, count: 0, amount: 0 };
      cur.count++;
      cur.amount += Number(c.approved_amount || c.estimated_amount || 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [claims]);

  // Status distribution for pie
  const statusData = [
    { name: "معلقة", value: stats.pending, color: "hsl(var(--warning))" },
    { name: "معتمدة", value: stats.approved, color: "hsl(var(--success))" },
    { name: "مدفوعة", value: stats.paid, color: "hsl(var(--info))" },
    { name: "مرفوضة", value: stats.rejected, color: "hsl(var(--destructive))" },
  ].filter((d) => d.value > 0);

  // Aging buckets for outstanding receivables
  const agingBuckets = useMemo(() => {
    const now = Date.now();
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    for (const inv of invoices) {
      if (inv.status === "paid" || inv.status === "cancelled") continue;
      const remaining = Number(inv.total) - Number(inv.paid_amount || 0);
      if (remaining <= 0) continue;
      const issued = new Date(inv.issued_at || inv.created_at).getTime();
      const ageDays = Math.floor((now - issued) / 86400000);
      if (ageDays <= 30) buckets["0-30"] += remaining;
      else if (ageDays <= 60) buckets["31-60"] += remaining;
      else if (ageDays <= 90) buckets["61-90"] += remaining;
      else buckets["90+"] += remaining;
    }
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [invoices]);

  // Monthly claims trend (last 6 months)
  const monthlyTrend = useMemo(() => {
    const months: { name: string; claims: number; amount: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("en-US", { month: "short" });
      months.push({ name: label, claims: 0, amount: 0 });
    }
    for (const c of claims) {
      const cd = new Date(c.created_at);
      const idx = 5 - (now.getMonth() - cd.getMonth() + (now.getFullYear() - cd.getFullYear()) * 12);
      if (idx >= 0 && idx < 6) {
        months[idx].claims++;
        months[idx].amount += Number(c.estimated_amount || 0);
      }
    }
    return months;
  }, [claims]);

  const recentClaims = claims.filter(isActiveClaim).slice(0, 6);
  const criticalAlerts = alerts.filter((a) => a.severity === "critical").slice(0, 5);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Shield className="text-primary" />
            مركز إدارة التأمين
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">لوحة تحكم متكاملة للمطالبات والمدفوعات والشركات</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/insurance/list")} className="gap-2">
            <FileText size={16} /> كل المطالبات
          </Button>
          <Button onClick={() => navigate("/insurance/new")} className="gap-2">
            <Plus size={16} /> مطالبة جديدة
          </Button>
        </div>
      </div>


      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard title="إجمالي المطالبات" value={stats.total} icon={Shield} variant="info" />
        <StatCard title="معلقة" value={stats.pending} icon={Clock} variant="warning" />
        <StatCard title="معتمدة" value={stats.approved} icon={CheckCircle} variant="success" />
        <StatCard title="معدل القبول" value={`${stats.approvalRate}%`} icon={TrendingUp} variant="gold" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard title="إجمالي مقدّر" value={`${fmt(stats.estimatedTotal)} OMR`} icon={FileText} variant="info" />
        <StatCard title="معتمد" value={`${fmt(stats.approvedTotal)} OMR`} icon={CheckCircle} variant="success" />
        <StatCard title="محصّل" value={`${fmt(stats.paidTotal)} OMR`} icon={DollarSign} variant="gold" />
        <StatCard title="مستحقات" value={`${fmt(stats.outstanding)} OMR`} icon={Banknote} variant="warning" />
      </div>

      {/* KPIs عمليات الورشة (مبنية على تاريخ الدخول / التسليم) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        <StatCard title="داخل الورشة" value={stats.inWorkshop} icon={Wrench} variant="info" />
        <StatCard title="مكتملة" value={stats.deliveredCount} icon={CheckCircle} variant="success" />
        <StatCard title="مسلَّمة" value={stats.deliveredCount} icon={Truck} variant="success" />
        <StatCard title="بانتظار التحصيل" value={stats.completedPendingCollection} icon={Hourglass} variant="warning" />
        <StatCard title="متأخرة (+30 يوم)" value={stats.overdueClaims} icon={AlertTriangle} variant={stats.overdueClaims > 0 ? "warning" : "success"} />
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2 text-destructive">
              <AlertTriangle size={18} /> تنبيهات حرجة ({alerts.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={() => navigate("/insurance/alerts")} className="gap-1 text-xs">
              عرض الكل <ArrowLeft size={14} />
            </Button>
          </div>
          <div className="space-y-2">
            {criticalAlerts.map((a) => (
              <button
                key={a.id}
                onClick={() => a.href && navigate(a.href)}
                className="w-full text-right flex items-start gap-3 p-3 bg-card border border-border rounded-lg hover:bg-secondary/50 transition"
              >
                <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly trend */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <Activity size={16} className="text-primary" /> اتجاه المطالبات الشهري
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Bar dataKey="claims" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} name="المطالبات" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status pie */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3 text-sm">توزيع حالات المطالبات</h3>
          {statusData.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground">لا توجد بيانات</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                  {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Aging + Top companies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <Banknote size={16} className="text-warning" /> تقادم المستحقات (Aging)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={agingBuckets} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: number) => `${fmt(v)} OMR`}
              />
              <Bar dataKey="value" fill="hsl(var(--warning))" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <Building2 size={16} className="text-primary" /> أعلى 5 شركات تأمين
          </h3>
          {topCompanies.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">لا توجد بيانات</div>
          ) : (
            <div className="space-y-2">
              {topCompanies.map((c, i) => {
                const max = topCompanies[0].amount || 1;
                const pct = (c.amount / max) * 100;
                return (
                  <div key={c.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] shrink-0">#{i + 1}</Badge>
                        <span className="font-medium truncate">{c.name}</span>
                        <span className="text-muted-foreground shrink-0">({c.count})</span>
                      </div>
                      <span className="font-mono text-xs shrink-0" dir="ltr">{fmt(c.amount)} OMR</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary to-primary/60" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Claims */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Clock size={16} /> أحدث المطالبات
          </h3>
          <Button variant="ghost" size="sm" onClick={() => navigate("/insurance/list")} className="gap-1 text-xs">
            عرض الكل <ArrowLeft size={14} />
          </Button>
        </div>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground text-sm">جاري التحميل...</div>
        ) : recentClaims.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">لا توجد مطالبات بعد</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentClaims.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/insurance/${c.id}`)}
                className="text-right p-3 border border-border rounded-lg hover:bg-secondary/50 transition"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-primary" dir="ltr">{c.claim_number}</span>
                  <Badge variant="outline" className="text-[10px] h-5">{c.status}</Badge>
                </div>
                <div className="text-sm font-medium truncate">{c.insurance_company}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {(c as any).vehicle_make} {(c as any).vehicle_model} — {(c as any).vehicle_plate}
                </div>
                <div className="text-xs font-mono mt-1" dir="ltr">{fmt(Number(c.estimated_amount))} OMR</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
