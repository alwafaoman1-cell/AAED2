import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DollarSign, TrendingUp, TrendingDown, BarChart3, LayoutDashboard, Settings2, BookOpen, ChevronDown, ChevronLeft, ExternalLink } from "lucide-react";
import StatCard from "@/components/StatCard";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import FinanceSettings from "@/components/accounting/FinanceSettings";
import JournalLedger from "@/components/accounting/JournalLedger";
import { journalStore, type JournalEntry } from "@/lib/journalStore";
import { formatMoney, getTemplateSettings } from "@/lib/pdfGenerator";
import { getJournalSourceRoute, JOURNAL_SOURCE_LABEL } from "@/lib/journalSourceLink";
import { expensesStore } from "@/lib/expensesStore";
import { salesStore } from "@/lib/salesStore";

const REVENUE_ACCOUNTS = new Set([
  "إيرادات المبيعات",
  "إيرادات خدمات الورشة",
]);
const EXPENSE_ACCOUNTS = new Set([
  "مصروف شراء",
  "مصاريف شحن",
  "مصاريف تشغيلية",
  "خصم ممنوح",
]);

const fmt = (n: number) => formatMoney(n);
const monthLabel = (ym: string) =>
  new Date(`${ym}-01`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

interface AccountBreakdown {
  account: string;
  total: number;
  count: number;
  entries: JournalEntry[];
}

function isLiveAccountingEntry(entry: JournalEntry): boolean {
  // Legacy insurance claim approval journals represented estimates/approvals,
  // not issued invoices. Keep them out of actual accounting dashboards.
  if (entry.source === "insurance_claim") return false;

  if (entry.source === "expense") {
    const expense = expensesStore.getById(entry.sourceId);
    return !!expense && !expense.deletedAt && !expense.archivedAt;
  }

  if (entry.source === "customer_payment" || entry.source === "insurance_payment" || entry.source === "supplier_payment") {
    return true;
  }

  if (entry.source === "sales_invoice" || entry.source === "work_order_invoice") {
    const doc = salesStore.get(entry.sourceId);
    return !!doc && !doc.isDeleted && doc.status !== "cancelled" && doc.status !== "draft";
  }

  return true;
}

function liveAccountingEntries(): JournalEntry[] {
  return journalStore.getAll().filter(isLiveAccountingEntry);
}

export default function Accounting() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<JournalEntry[]>(liveAccountingEntries());
  useEffect(() => {
    const refresh = () => setEntries(liveAccountingEntries());
    const unsubJournal = journalStore.subscribe(refresh);
    const unsubExpenses = expensesStore.subscribe(refresh);
    const unsubSales = salesStore.subscribe(refresh);
    expensesStore.refresh();
    return () => {
      unsubJournal();
      unsubExpenses();
      unsubSales();
    };
  }, []);

  const { revenue, expenses, profit, margin, monthly, recent, revenueByAccount, expensesByAccount } = useMemo(() => {
    let revenue = 0;
    let expenses = 0;
    const byMonth = new Map<string, { revenue: number; expenses: number }>();
    const revMap = new Map<string, AccountBreakdown>();
    const expMap = new Map<string, AccountBreakdown>();

    for (const e of entries) {
      const ym = (e.date || "").slice(0, 7);
      const slot = byMonth.get(ym) || { revenue: 0, expenses: 0 };
      if (REVENUE_ACCOUNTS.has(e.creditAccount)) {
        revenue += e.amount;
        slot.revenue += e.amount;
        const r = revMap.get(e.creditAccount) || { account: e.creditAccount, total: 0, count: 0, entries: [] };
        r.total += e.amount; r.count++; r.entries.push(e);
        revMap.set(e.creditAccount, r);
      }
      if (EXPENSE_ACCOUNTS.has(e.debitAccount)) {
        expenses += e.amount;
        slot.expenses += e.amount;
        const x = expMap.get(e.debitAccount) || { account: e.debitAccount, total: 0, count: 0, entries: [] };
        x.total += e.amount; x.count++; x.entries.push(e);
        expMap.set(e.debitAccount, x);
      }
      byMonth.set(ym, slot);
    }

    // Actual dashboard source of truth:
    // - revenue from issued/non-cancelled invoices only, excluding VAT
    // - expenses from active expense vouchers only
    // - estimates/claim approvals are never included as actual revenue/cost
    revenue = 0;
    expenses = 0;
    byMonth.clear();
    revMap.clear();
    expMap.clear();

    const actualInvoices = salesStore
      .list({ type: "invoice" })
      .filter((doc) => !doc.isDeleted && doc.status !== "cancelled" && doc.status !== "draft");
    actualInvoices.forEach((doc) => {
      const amount = Number(doc.subtotal || 0);
      const ym = (doc.date || doc.createdAt || "").slice(0, 7);
      const slot = byMonth.get(ym) || { revenue: 0, expenses: 0 };
      revenue += amount;
      slot.revenue += amount;
      byMonth.set(ym, slot);
    });
    revMap.set("فواتير معتمدة", { account: "فواتير معتمدة", total: revenue, count: actualInvoices.length, entries: [] });

    const actualExpenses = expensesStore
      .getAll()
      .filter((expense) => !expense.deletedAt && !expense.archivedAt && !expense.refunded);
    actualExpenses.forEach((expense) => {
      const amount = Number(expense.subtotal ?? expense.amount ?? 0);
      const ym = (expense.date || expense.createdAt || "").slice(0, 7);
      const slot = byMonth.get(ym) || { revenue: 0, expenses: 0 };
      expenses += amount;
      slot.expenses += amount;
      byMonth.set(ym, slot);
      const account = expense.categoryName || "سندات صرف فعلية";
      const x = expMap.get(account) || { account, total: 0, count: 0, entries: [] };
      x.total += amount; x.count++;
      expMap.set(account, x);
    });

    const profit = revenue - expenses;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    const monthly = Array.from(byMonth.entries())
      .filter(([k]) => k)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([k, v]) => ({ name: monthLabel(k), revenue: v.revenue, expenses: v.expenses, profit: v.revenue - v.expenses }));

    const recent = [...entries]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    const revenueByAccount = Array.from(revMap.values()).sort((a, b) => b.total - a.total);
    const expensesByAccount = Array.from(expMap.values()).sort((a, b) => b.total - a.total);

    return { revenue, expenses, profit, margin, monthly, recent, revenueByAccount, expensesByAccount };
  }, [entries]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">المحاسبة</h1>
        <p className="text-sm text-muted-foreground">التقارير المالية مبنية على القيود المُرحَّلة تلقائياً</p>
      </div>

      <Tabs defaultValue="overview" dir="rtl" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview"><LayoutDashboard size={14} className="ml-1" /> نظرة عامة</TabsTrigger>
          <TabsTrigger value="journal"><BookOpen size={14} className="ml-1" /> دفتر اليومية</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 size={14} className="ml-1" /> إعدادات المالية</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="إجمالي الإيرادات" value={fmt(revenue)} icon={TrendingUp} variant="success" />
            <StatCard title="إجمالي المصروفات" value={fmt(expenses)} icon={TrendingDown} variant="warning" />
            <StatCard title="صافي الربح" value={fmt(profit)} icon={DollarSign} variant="gold" trend={profit >= 0 ? "ربح" : "خسارة"} trendUp={profit >= 0} />
            <StatCard title="هامش الربح" value={`${margin.toFixed(1)}%`} icon={BarChart3} variant="info" />
          </div>

          <div className="bg-card border border-border rounded-xl p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-4">الإيرادات والمصروفات (آخر 6 أشهر)</h3>
            {monthly.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">لا توجد بيانات بعد — ستظهر تلقائياً عند ترحيل القيود</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", direction: "rtl" }} />
                  <Legend wrapperStyle={{ direction: "rtl" }} />
                  <Bar dataKey="revenue" name="إيرادات" fill="hsl(142, 70%, 45%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="مصروفات" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="ربح" fill="hsl(42, 90%, 55%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* === بطاقة تفاصيل حساب الربح === */}
          <div className="bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <DollarSign size={16} className="text-primary" /> تفاصيل حساب الربح حسب الحسابات
              </h3>
              <div className="text-xs text-muted-foreground">
                صافي الربح: <span className={`font-bold font-mono ${profit >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmt(profit)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* الإيرادات */}
              <div className="rounded-lg border border-success/30 bg-success/5">
                <div className="flex items-center justify-between p-3 border-b border-success/20">
                  <h4 className="text-sm font-bold text-success flex items-center gap-2"><TrendingUp size={14} /> الإيرادات</h4>
                  <span className="text-sm font-mono font-bold text-success" dir="ltr">{fmt(revenue)}</span>
                </div>
                {revenueByAccount.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">لا توجد إيرادات بعد</div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {revenueByAccount.map((b) => (
                      <Collapsible key={b.account}>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-success/10 transition-colors text-right">
                          <div className="flex items-center gap-2">
                            <ChevronLeft size={14} className="text-muted-foreground transition-transform [[data-state=open]>&]:-rotate-90" />
                            <span className="text-sm text-foreground">{b.account}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{b.count}</span>
                          </div>
                          <span className="text-sm font-mono font-semibold text-success" dir="ltr">{fmt(b.total)}</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="bg-background/50 px-3 py-2 space-y-1">
                            {b.entries.slice(0, 50).map((e) => {
                              const route = getJournalSourceRoute(e.source, e.sourceId);
                              return (
                                <div key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-xs border-b border-border/30 last:border-0">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-foreground truncate">{e.description}</p>
                                    <p className="text-[10px] text-muted-foreground font-mono" dir="ltr">{e.date} · {JOURNAL_SOURCE_LABEL[e.source]} · {e.sourceId}</p>
                                  </div>
                                  <span className="font-mono font-semibold text-success shrink-0" dir="ltr">{fmt(e.amount)}</span>
                                  {route && (
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => navigate(route)} title="فتح المصدر">
                                      <ExternalLink size={11} />
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                )}
              </div>

              {/* المصروفات */}
              <div className="rounded-lg border border-destructive/30 bg-destructive/5">
                <div className="flex items-center justify-between p-3 border-b border-destructive/20">
                  <h4 className="text-sm font-bold text-destructive flex items-center gap-2"><TrendingDown size={14} /> المصروفات</h4>
                  <span className="text-sm font-mono font-bold text-destructive" dir="ltr">{fmt(expenses)}</span>
                </div>
                {expensesByAccount.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">لا توجد مصروفات بعد</div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {expensesByAccount.map((b) => (
                      <Collapsible key={b.account}>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-destructive/10 transition-colors text-right">
                          <div className="flex items-center gap-2">
                            <ChevronLeft size={14} className="text-muted-foreground transition-transform [[data-state=open]>&]:-rotate-90" />
                            <span className="text-sm text-foreground">{b.account}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{b.count}</span>
                          </div>
                          <span className="text-sm font-mono font-semibold text-destructive" dir="ltr">{fmt(b.total)}</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="bg-background/50 px-3 py-2 space-y-1">
                            {b.entries.slice(0, 50).map((e) => {
                              const route = getJournalSourceRoute(e.source, e.sourceId);
                              return (
                                <div key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-xs border-b border-border/30 last:border-0">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-foreground truncate">{e.description}</p>
                                    <p className="text-[10px] text-muted-foreground font-mono" dir="ltr">{e.date} · {JOURNAL_SOURCE_LABEL[e.source]} · {e.sourceId}</p>
                                  </div>
                                  <span className="font-mono font-semibold text-destructive shrink-0" dir="ltr">{fmt(e.amount)}</span>
                                  {route && (
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => navigate(route)} title="فتح المصدر">
                                      <ExternalLink size={11} />
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-4">آخر القيود المُرحَّلة</h3>
            {recent.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">لا توجد قيود بعد</div>
            ) : (
              <div className="space-y-2">
                {recent.map((e) => {
                  const isRevenue = REVENUE_ACCOUNTS.has(e.creditAccount);
                  const isExpense = EXPENSE_ACCOUNTS.has(e.debitAccount);
                  const sign = isRevenue ? "+" : isExpense ? "-" : "";
                  const cls = isRevenue ? "bg-success/15 text-success" : isExpense ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground";
                  const Icon = isRevenue ? TrendingUp : isExpense ? TrendingDown : BookOpen;
                  const route = getJournalSourceRoute(e.source, e.sourceId);
                  return (
                    <div key={e.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary/20">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{e.description}</p>
                          <p className="text-[10px] text-muted-foreground font-mono" dir="ltr">{e.date} · {e.id} · {JOURNAL_SOURCE_LABEL[e.source]}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold font-mono ${isRevenue ? "text-success" : isExpense ? "text-destructive" : "text-foreground"}`} dir="ltr">
                          {sign}{fmt(e.amount)}
                        </span>
                        {route && (
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => navigate(route)} title="فتح المستند">
                            <ExternalLink size={11} /> فتح
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="journal"><JournalLedger /></TabsContent>
        <TabsContent value="settings"><FinanceSettings /></TabsContent>
      </Tabs>
    </div>
  );
}
