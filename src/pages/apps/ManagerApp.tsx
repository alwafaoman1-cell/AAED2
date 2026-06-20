import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ClipboardList, Car, Users, Package, ShieldCheck,
  TrendingUp, AlertTriangle, LogOut, Briefcase, FileText, BellRing,
  Wallet, BarChart3, ChevronLeft, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { getWorkOrders, subscribeWorkOrders } from "@/lib/workOrdersStore";
import { salesStore } from "@/lib/salesStore";
import { expensesStore } from "@/lib/expensesStore";
import { inventoryStore } from "@/lib/inventoryStore";
import { toast } from "sonner";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

interface Tile {
  label: string; value: string; icon: any; tone: string; to?: string; sub?: string;
}

interface QuickLink { label: string; to: string; icon: any; cls: string; }

export default function ManagerApp() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeWorkOrders(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const u1 = salesStore.subscribe(() => setTick((t) => t + 1));
    const u2 = expensesStore.subscribe(() => setTick((t) => t + 1));
    return () => { u1(); u2(); };
  }, []);

  const stats = useMemo(() => {
    const orders = getWorkOrders();
    const d = today();
    const todayOrders = orders.filter((o) => (o.entryDate || "").slice(0, 10) === d);
    const openOrders = orders.filter((o) => !["تم التسليم", "مغلق"].includes(o.status as any));
    const ready = orders.filter((o) => o.status === "جاهز للتسليم");
    const waitingParts = orders.filter((o) => o.status === "بانتظار قطع الغيار");

    const invoices = salesStore.list({ type: "invoice" }).filter((d) => !d.isDeleted);
    const todayRevenue = invoices
      .filter((i) => (i.date || "").slice(0, 10) === d)
      .reduce((s, i) => s + Number(i.total || 0), 0);
    const monthRevenue = invoices
      .filter((i) => (i.date || "").slice(0, 7) === d.slice(0, 7))
      .reduce((s, i) => s + Number(i.total || 0), 0);

    const unpaid = invoices.filter((i) => i.status !== "paid")
      .reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.paidTotal || 0)), 0);

    const lowStock = inventoryStore.getAll().filter((p: any) =>
      p.minStock != null && Number(p.quantity || 0) <= Number(p.minStock)
    ).length;

    return { todayOrders: todayOrders.length, openOrders: openOrders.length, ready: ready.length,
      waitingParts: waitingParts.length, todayRevenue, monthRevenue, unpaid, lowStock };
  }, [tick]);

  const tiles: Tile[] = [
    { label: "إيراد اليوم", value: fmt(stats.todayRevenue), sub: "ر.ع", icon: Wallet, tone: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/30 text-emerald-500", to: "/sales/invoices" },
    { label: "إيراد الشهر", value: fmt(stats.monthRevenue), sub: "ر.ع", icon: TrendingUp, tone: "from-primary/15 to-primary/5 border-primary/30 text-primary", to: "/dashboard/executive" },
    { label: "أوامر اليوم", value: String(stats.todayOrders), icon: ClipboardList, tone: "from-blue-500/15 to-blue-500/5 border-blue-500/30 text-blue-500", to: "/work-orders" },
    { label: "أوامر مفتوحة", value: String(stats.openOrders), icon: Briefcase, tone: "from-indigo-500/15 to-indigo-500/5 border-indigo-500/30 text-indigo-500", to: "/work-orders" },
    { label: "جاهز للتسليم", value: String(stats.ready), icon: ShieldCheck, tone: "from-green-500/15 to-green-500/5 border-green-500/30 text-green-500", to: "/work-orders" },
    { label: "بانتظار قطع", value: String(stats.waitingParts), icon: Package, tone: "from-amber-500/15 to-amber-500/5 border-amber-500/30 text-amber-500", to: "/work-orders" },
    { label: "مستحقات عملاء", value: fmt(stats.unpaid), sub: "ر.ع", icon: FileText, tone: "from-rose-500/15 to-rose-500/5 border-rose-500/30 text-rose-500", to: "/sales/payments" },
    { label: "تنبيهات مخزون", value: String(stats.lowStock), icon: AlertTriangle, tone: "from-red-500/15 to-red-500/5 border-red-500/30 text-red-500", to: "/inventory" },
  ];

  const quick: QuickLink[] = [
    { label: "أوامر العمل", to: "/work-orders", icon: ClipboardList, cls: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
    { label: "العملاء", to: "/customers", icon: Users, cls: "bg-cyan-500/10 text-cyan-500 border-cyan-500/30" },
    { label: "المركبات", to: "/vehicles", icon: Car, cls: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30" },
    { label: "المبيعات", to: "/sales", icon: Wallet, cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
    { label: "التأمين", to: "/insurance", icon: ShieldCheck, cls: "bg-purple-500/10 text-purple-500 border-purple-500/30" },
    { label: "المخزون", to: "/inventory", icon: Package, cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
    { label: "المحاسبة", to: "/accounting", icon: FileText, cls: "bg-rose-500/10 text-rose-500 border-rose-500/30" },
    { label: "تقارير سحابية", to: "/reports/cloud-advanced", icon: BarChart3, cls: "bg-teal-500/10 text-teal-500 border-teal-500/30" },
    { label: "لوحة تنفيذية", to: "/dashboard/executive", icon: TrendingUp, cls: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/30" },
    { label: "تنبيهات التأمين", to: "/insurance/alerts", icon: BellRing, cls: "bg-orange-500/10 text-orange-500 border-orange-500/30" },
    { label: "الموظفون", to: "/staff", icon: Users, cls: "bg-sky-500/10 text-sky-500 border-sky-500/30" },
    { label: "الإعدادات", to: "/settings", icon: LayoutDashboard, cls: "bg-muted text-foreground border-border" },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30 pb-24">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-background/80 border-b pt-safe">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 grid place-items-center text-primary-foreground shadow-lg">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">تطبيق المدير</div>
              <div className="font-bold leading-tight">{profile?.full_name || "Manager"}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)} title="تحديث">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={async () => { await signOut(); toast.success("تم تسجيل الخروج"); }} title="خروج">
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
                  <ChevronLeft className="w-4 h-4 opacity-50" />
                </div>
                <div className="text-2xl font-bold">{t.value}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  {t.label} {t.sub && <Badge variant="outline" className="text-[10px] py-0 px-1">{t.sub}</Badge>}
                </div>
              </Card>
            </button>
          ))}
        </div>

        <div>
          <div className="text-sm font-semibold text-muted-foreground mb-2 px-1">الوصول السريع</div>
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
