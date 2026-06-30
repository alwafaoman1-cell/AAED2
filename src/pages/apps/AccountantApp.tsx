import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calculator, FileText, Wallet, Receipt, BookOpen, LogOut, RefreshCw,
  TrendingDown, TrendingUp, AlertCircle, ChevronLeft, ShieldCheck, BarChart3,
  Banknote, FileSpreadsheet, ArrowDownToLine, ArrowUpFromLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { salesStore } from "@/lib/salesStore";
import { expensesStore } from "@/lib/expensesStore";
import { journalStore } from "@/lib/journalStore";
import { toast } from "sonner";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

interface Tile { label: string; value: string; sub?: string; icon: any; tone: string; to?: string; }
interface QL { label: string; to: string; icon: any; cls: string; }

export default function AccountantApp() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const u1 = salesStore.subscribe(() => setTick((t) => t + 1));
    const u2 = expensesStore.subscribe(() => setTick((t) => t + 1));
    const u3 = journalStore.subscribe(() => setTick((t) => t + 1));
    return () => { u1(); u2(); u3(); };
  }, []);

  const data = useMemo(() => {
    const d = today();
    const month = d.slice(0, 7);

    const invoices = salesStore.list({ type: "invoice" }).filter((x) => !x.isDeleted);
    const todayRev = invoices.filter((i) => (i.date || "").slice(0, 10) === d)
      .reduce((s, i) => s + Number(i.total || 0), 0);
    const monthRev = invoices.filter((i) => (i.date || "").slice(0, 7) === month)
      .reduce((s, i) => s + Number(i.total || 0), 0);
    const monthVat = invoices.filter((i) => (i.date || "").slice(0, 7) === month)
      .reduce((s, i) => s + Number(i.taxTotal || 0), 0);
    const unpaid = invoices.filter((i) => i.status !== "paid")
      .reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.paidTotal || 0)), 0);
    const unpaidCount = invoices.filter((i) => i.status !== "paid" &&
      Math.max(0, Number(i.total || 0) - Number(i.paidTotal || 0)) > 0).length;

    const expenses = expensesStore.getAll();
    const todayExp = expenses.filter((e) => e.date === d).reduce((s, e) => s + Number(e.amount || 0), 0);
    const monthExp = expenses.filter((e) => (e.date || "").slice(0, 7) === month).reduce((s, e) => s + Number(e.amount || 0), 0);

    const journal = journalStore.getAll();
    const recentJournal = journal.slice(0, 5);
    const todayJournal = journal.filter((j) => j.date === d).length;

    return {
      todayRev, monthRev, monthVat, unpaid, unpaidCount,
      todayExp, monthExp, todayJournal, recentJournal,
      netToday: todayRev - todayExp, netMonth: monthRev - monthExp,
    };
  }, [tick]);

  const tiles: Tile[] = [
    { label: "إيراد اليوم", value: fmt(data.todayRev), sub: "ر.ع", icon: TrendingUp, tone: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/30 text-emerald-500", to: "/sales/invoices" },
    { label: "مصروف اليوم", value: fmt(data.todayExp), sub: "ر.ع", icon: TrendingDown, tone: "from-rose-500/15 to-rose-500/5 border-rose-500/30 text-rose-500", to: "/accounting" },
    { label: "صافي اليوم", value: fmt(data.netToday), sub: "ر.ع", icon: Wallet, tone: "from-blue-500/15 to-blue-500/5 border-blue-500/30 text-blue-500" },
    { label: "قيود اليوم", value: String(data.todayJournal), icon: BookOpen, tone: "from-indigo-500/15 to-indigo-500/5 border-indigo-500/30 text-indigo-500", to: "/accounting" },
    { label: "إيراد الشهر", value: fmt(data.monthRev), sub: "ر.ع", icon: TrendingUp, tone: "from-primary/15 to-primary/5 border-primary/30 text-primary", to: "/reports/monthly" },
    { label: "مصروف الشهر", value: fmt(data.monthExp), sub: "ر.ع", icon: ArrowUpFromLine, tone: "from-amber-500/15 to-amber-500/5 border-amber-500/30 text-amber-500", to: "/accounting" },
    { label: "VAT الشهر", value: fmt(data.monthVat), sub: "ر.ع", icon: Receipt, tone: "from-teal-500/15 to-teal-500/5 border-teal-500/30 text-teal-500", to: "/reports/cloud-advanced" },
    { label: "مستحقات عملاء", value: fmt(data.unpaid), sub: `${data.unpaidCount} فاتورة`, icon: AlertCircle, tone: "from-red-500/15 to-red-500/5 border-red-500/30 text-red-500", to: "/sales/payments" },
  ];

  const quick: QL[] = [
    { label: "سند قبض", to: "/accounting/receipts", icon: ArrowDownToLine, cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
    { label: "سند صرف", to: "/accounting/expenses", icon: ArrowUpFromLine, cls: "bg-rose-500/10 text-rose-500 border-rose-500/30" },
    { label: "فاتورة جديدة", to: "/sales/invoices/new", icon: FileText, cls: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
    { label: "مدفوعات عملاء", to: "/sales/payments", icon: Banknote, cls: "bg-cyan-500/10 text-cyan-500 border-cyan-500/30" },
    { label: "دفتر اليومية", to: "/accounting", icon: BookOpen, cls: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30" },
    { label: "محاسبة التأمين", to: "/insurance/accounting", icon: ShieldCheck, cls: "bg-purple-500/10 text-purple-500 border-purple-500/30" },
    { label: "دفعات التأمين", to: "/insurance/payments", icon: Wallet, cls: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/30" },
    { label: "تقرير شهري", to: "/reports/monthly", icon: BarChart3, cls: "bg-teal-500/10 text-teal-500 border-teal-500/30" },
    { label: "تقارير سحابية", to: "/reports/cloud-advanced", icon: FileSpreadsheet, cls: "bg-sky-500/10 text-sky-500 border-sky-500/30" },
    { label: "سجل النشاط", to: "/settings/audit-log", icon: AlertCircle, cls: "bg-muted text-foreground border-border" },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30 pb-24">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-background/80 border-b pt-safe">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-lg">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">تطبيق المحاسب</div>
              <div className="font-bold leading-tight">{profile?.full_name || "Accountant"}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)}><RefreshCw className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" onClick={async () => { await signOut(); toast.success("تم تسجيل الخروج"); }}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <section className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((t, i) => (
            <button key={i} onClick={() => t.to && navigate(t.to)} className="text-right">
              <Card className={`p-4 bg-gradient-to-br ${t.tone} border transition-all hover:scale-[1.02] active:scale-95`}>
                <div className="flex items-start justify-between mb-2">
                  <t.icon className="w-5 h-5" />
                  {t.to && <ChevronLeft className="w-4 h-4 opacity-50" />}
                </div>
                <div className="text-2xl font-bold tabular-nums">{t.value}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  {t.label} {t.sub && <Badge variant="outline" className="text-[10px] py-0 px-1">{t.sub}</Badge>}
                </div>
              </Card>
            </button>
          ))}
        </div>

        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" /> آخر قيود اليومية
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/accounting")}>الكل</Button>
          </div>
          <div className="space-y-1">
            {data.recentJournal.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">لا توجد قيود بعد</div>
            )}
            {data.recentJournal.map((j) => (
              <div key={j.id} className="flex items-center justify-between text-xs bg-muted/40 rounded-md px-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[10px]">{j.id}</Badge>
                  <span className="truncate">{j.description}</span>
                </div>
                <span className="font-bold tabular-nums text-primary">{fmt(j.amount)}</span>
              </div>
            ))}
          </div>
        </Card>

        <div>
          <div className="text-sm font-semibold text-muted-foreground mb-2 px-1">الإجراءات السريعة</div>
          <div className="grid grid-cols-3 gap-2">
            {quick.map((q, i) => (
              <button key={i} onClick={() => navigate(q.to)}
                className={`p-3 rounded-xl border ${q.cls} flex flex-col items-center gap-1 text-xs font-medium hover:scale-[1.03] active:scale-95 transition-transform`}>
                <q.icon className="w-5 h-5" />
                <span className="text-center leading-tight">{q.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
