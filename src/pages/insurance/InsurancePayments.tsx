import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DollarSign, AlertTriangle, Clock, TrendingUp, Search, Building2, BarChart3 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import StatCard from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClaimPayments, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/hooks/useClaimPayments";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import { useInsuranceInvoices } from "@/hooks/useInsuranceInvoices";
import { useOverdueInsuranceAlerts, type OverdueCompany } from "@/hooks/useOverdueInsuranceAlerts";
import { formatDateLatin } from "@/lib/numberUtils";

export default function InsurancePayments() {
  const navigate = useNavigate();
  const { data: payments } = useClaimPayments();
  const { data: claims } = useInsuranceClaims();
  const { data: companies } = useInsuranceCompanies();
  const { data: invoices } = useInsuranceInvoices();
  const overdueList = useOverdueInsuranceAlerts();
  const [search, setSearch] = useState("");

  // KPIs
  const stats = useMemo(() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

    const activeInvoices = (invoices ?? []).filter((invoice) => invoice.status !== "cancelled");
    const totalInvoiced = activeInvoices.reduce((s, invoice) => s + Number(invoice.total || 0), 0);
    const totalPaid = (payments ?? [])
      .filter((p) => p.status !== "bounced")
      .reduce((s, p) => s + Number(p.amount), 0);
    const monthPaid = (payments ?? [])
      .filter((p) => p.status !== "bounced" && new Date(p.payment_date) >= startOfMonth)
      .reduce((s, p) => s + Number(p.amount), 0);

    const overdueAmount = overdueList.reduce((s, o) => s + o.remaining, 0);

    return { totalInvoiced, totalApproved: totalInvoiced, totalPaid, monthPaid, overdueAmount, remaining: Math.max(0, totalInvoiced - totalPaid) };
  }, [invoices, payments, overdueList]);

  // Monthly payments chart (last 6 months)
  const monthlyChart = useMemo(() => {
    const months: { key: string; label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      months.push({ key, label, total: 0 });
    }
    (payments ?? []).filter((p) => p.status !== "bounced").forEach((p) => {
      const d = new Date(p.payment_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const m = months.find((x) => x.key === key);
      if (m) m.total += Number(p.amount);
    });
    return months;
  }, [payments]);

  // Per-company aggregation
  const perCompany = useMemo(() => {
    const map = new Map<string, { name: string; companyId: string | null; approved: number; paid: number; remaining: number; overdue: number; }>();
    (claims ?? []).forEach((c) => {
      const key = (c as any).insurance_company_id || c.insurance_company;
      if (!key) return;
      const name = c.insurance_company || companies?.find((co) => co.id === (c as any).insurance_company_id)?.name || "غير محدد";
      const companyId = (c as any).insurance_company_id || null;
      const claimInvoices = (invoices ?? []).filter((invoice) => invoice.claim_id === c.id && invoice.status !== "cancelled");
      const invoiced = claimInvoices.reduce((s, invoice) => s + Number(invoice.total || 0), 0);
      const paid = claimInvoices.reduce((s, invoice) => s + Number(invoice.paid_amount || 0), 0);
      const rem = invoiced - paid;
      if (invoiced <= 0) return;

      const company = companies?.find((co) => co.id === (c as any).insurance_company_id);
      const terms = company?.payment_terms_days ?? 90;
      const baseDate = c.approved_at ? new Date(c.approved_at).getTime() : new Date(c.created_at).getTime();
      const days = Math.floor((Date.now() - baseDate) / 86400000);
      const isOverdue = c.status === "approved" && rem > 0 && days > terms;

      const existing = map.get(key) || { name, companyId, approved: 0, paid: 0, remaining: 0, overdue: 0 };
      existing.approved += invoiced;
      existing.paid += paid;
      existing.remaining += rem;
      if (isOverdue) existing.overdue += rem;
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.remaining - a.remaining);
  }, [claims, invoices, companies]);

  const filteredPayments = (payments ?? []).filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      p.payment_number?.toLowerCase().includes(s) ||
      p.claim?.claim_number?.toLowerCase().includes(s) ||
      p.claim?.insurance_company?.toLowerCase().includes(s) ||
      p.reference_number?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">لوحة مدفوعات التأمين</h1>
          <p className="text-xs md:text-sm text-muted-foreground">متابعة ما تم تحصيله، التنبؤ بالشهر، والتنبيهات الفورية للمتأخرات</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 md:flex-initial" onClick={() => navigate("/insurance/companies")}>
            <Building2 size={16} className="ml-2" /> الشركات
          </Button>
          <Button variant="outline" size="sm" className="flex-1 md:flex-initial" onClick={() => navigate("/insurance")}>المطالبات</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
        <StatCard title="إجمالي المعتمد" value={`${stats.totalApproved.toLocaleString()} ر.ع`} icon={TrendingUp} variant="info" />
        <StatCard title="إجمالي المدفوع" value={`${stats.totalPaid.toLocaleString()} ر.ع`} icon={DollarSign} variant="success" />
        <StatCard title="مقبوض هذا الشهر" value={`${stats.monthPaid.toLocaleString()} ر.ع`} icon={Clock} variant="gold" />
        <StatCard title="إجمالي المتأخرات" value={`${stats.overdueAmount.toLocaleString()} ر.ع`} icon={AlertTriangle} variant={stats.overdueAmount > 0 ? "warning" : "success"} />
      </div>

      {/* Monthly chart + Overdue alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-primary" />
            <h2 className="text-base font-semibold">المقبوضات الشهرية (آخر 6 أشهر)</h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  formatter={(v: any) => [`${Number(v).toLocaleString()} ر.ع`, "المحصل"]}
                />
                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-destructive" />
            <h2 className="text-base font-semibold">تنبيهات التأخر</h2>
          </div>
          <OverdueAlertsList overdueList={overdueList} navigate={navigate} />
        </Card>
      </div>

      {/* Per-company table */}
      <Card className="overflow-hidden">
        <div className="p-3 md:p-4 border-b border-border">
          <h2 className="text-sm md:text-base font-semibold">المتبقي حسب شركة التأمين</h2>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border">
          {perCompany.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : perCompany.map((c, i) => (
            <div key={i} className="p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm">{c.name}</div>
                {c.companyId && (
                  <button className="text-xs text-primary hover:underline whitespace-nowrap" onClick={() => navigate(`/insurance/companies/${c.companyId}`)}>
                    كشف الحساب ←
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="text-muted-foreground">المعتمد: <span className="text-foreground">{c.approved.toLocaleString()} ر.ع</span></div>
                <div className="text-muted-foreground">المدفوع: <span className="text-success">{c.paid.toLocaleString()} ر.ع</span></div>
                <div className="text-muted-foreground">المتبقي: <span className={c.remaining > 0 ? "text-warning font-bold" : "text-success"}>{c.remaining.toLocaleString()} ر.ع</span></div>
                <div className="text-muted-foreground">المتأخر: <span className={c.overdue > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>{c.overdue > 0 ? `${c.overdue.toLocaleString()} ر.ع` : "-"}</span></div>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الشركة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المعتمد</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المدفوع</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المتبقي</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المتأخر</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {perCompany.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">لا توجد بيانات</td></tr>
              ) : perCompany.map((c, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-secondary/10">
                  <td className="py-2.5 px-4 font-semibold">{c.name}</td>
                  <td className="py-2.5 px-4">{c.approved.toLocaleString()} ر.ع</td>
                  <td className="py-2.5 px-4 text-success">{c.paid.toLocaleString()} ر.ع</td>
                  <td className={`py-2.5 px-4 font-bold ${c.remaining > 0 ? "text-warning" : "text-success"}`}>
                    {c.remaining.toLocaleString()} ر.ع
                  </td>
                  <td className={`py-2.5 px-4 font-semibold ${c.overdue > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {c.overdue > 0 ? `${c.overdue.toLocaleString()} ر.ع` : "-"}
                  </td>
                  <td className="py-2.5 px-4">
                    {c.companyId && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/insurance/companies/${c.companyId}`)}>
                        كشف الحساب ←
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="relative md:max-w-sm">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="بحث في الدفعات..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 md:p-4 border-b border-border">
          <h2 className="text-sm md:text-base font-semibold">سجل الدفعات الكامل ({filteredPayments.length})</h2>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border">
          {filteredPayments.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">لا توجد دفعات</div>
          ) : filteredPayments.map((p) => (
            <button key={p.id} className="w-full text-right p-3 space-y-1.5 hover:bg-secondary/10"
                    onClick={() => p.claim_id && navigate(`/insurance/${p.claim_id}`)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-primary truncate">{p.payment_number}</div>
                  <div className="text-sm font-semibold truncate">{p.claim?.insurance_company ?? "-"}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    مطالبة: <span className="font-mono">{p.claim?.claim_number ?? "-"}</span>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                  p.status === "cleared" ? "bg-success/15 text-success" :
                  p.status === "bounced" ? "bg-destructive/15 text-destructive" :
                  "bg-warning/15 text-warning"
                }`}>{PAYMENT_STATUS_LABELS[p.status]}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{formatDateLatin(p.payment_date)} • {PAYMENT_METHOD_LABELS[p.payment_method]}</span>
                <span className="font-semibold text-success">{Number(p.amount).toLocaleString()} ر.ع</span>
              </div>
            </button>
          ))}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">رقم</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">التاريخ</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المطالبة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الشركة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الطريقة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المبلغ</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">لا توجد دفعات</td></tr>
              ) : filteredPayments.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/10 cursor-pointer"
                    onClick={() => p.claim_id && navigate(`/insurance/${p.claim_id}`)}>
                  <td className="py-2.5 px-4 font-mono text-xs text-primary">{p.payment_number}</td>
                  <td className="py-2.5 px-4">{formatDateLatin(p.payment_date)}</td>
                  <td className="py-2.5 px-4 font-mono text-xs">{p.claim?.claim_number ?? "-"}</td>
                  <td className="py-2.5 px-4">{p.claim?.insurance_company ?? "-"}</td>
                  <td className="py-2.5 px-4">{PAYMENT_METHOD_LABELS[p.payment_method]}</td>
                  <td className="py-2.5 px-4 font-semibold text-success">{Number(p.amount).toLocaleString()} ر.ع</td>
                  <td className="py-2.5 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === "cleared" ? "bg-success/15 text-success" :
                      p.status === "bounced" ? "bg-destructive/15 text-destructive" :
                      "bg-warning/15 text-warning"
                    }`}>{PAYMENT_STATUS_LABELS[p.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// قائمة تنبيهات التأخر مع فلتر نطاق أيام وحد أدنى للمتبقي
// ────────────────────────────────────────────────────────────────
function OverdueAlertsList({
  overdueList,
  navigate,
}: {
  overdueList: OverdueCompany[];
  navigate: (path: string) => void;
}) {
  const [range, setRange] = useState<"all" | "0-15" | "16-30" | "31+">("all");
  const [minRemaining, setMinRemaining] = useState<string>("");

  const filtered = useMemo(() => {
    return overdueList.filter((o) => {
      const days = o.oldestDays;
      if (range === "0-15" && !(days >= 0 && days <= 15)) return false;
      if (range === "16-30" && !(days >= 16 && days <= 30)) return false;
      if (range === "31+" && days < 31) return false;
      const min = parseFloat(minRemaining) || 0;
      if (min > 0 && o.remaining < min) return false;
      return true;
    });
  }, [overdueList, range, minRemaining]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">نطاق الأيام</Label>
          <Select value={range} onValueChange={(v) => setRange(v as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="0-15">0 - 15 يوم</SelectItem>
              <SelectItem value="16-30">16 - 30 يوم</SelectItem>
              <SelectItem value="31+">31+ يوم</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">الحد الأدنى للمتبقي</Label>
          <Input
            type="number" min={0} placeholder="0"
            value={minRemaining}
            onChange={(e) => setMinRemaining(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {overdueList.length === 0 ? "✓ لا توجد متأخرات" : "لا نتائج ضمن الفلتر"}
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filtered.map((o, i) => (
            <button
              key={i}
              onClick={() => o.companyId && navigate(`/insurance/companies/${o.companyId}`)}
              className="w-full text-right p-2.5 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{o.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground font-bold">
                  {o.oldestDays} يوم
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs">
                <span className="text-muted-foreground">{o.claimsCount} مطالبة • مدة: {o.termsDays} يوم</span>
                <span className="font-bold text-warning">{o.remaining.toLocaleString()} ر.ع</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
