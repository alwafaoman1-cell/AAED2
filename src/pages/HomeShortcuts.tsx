import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  PlusCircle, ClipboardList, Car, Users, ShieldCheck, Boxes,
  Receipt, Calculator, ClipboardCheck, FileBarChart2, Settings,
  Smartphone, Search, Bell, LayoutDashboard,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getWorkOrders } from "@/lib/workOrdersStore";
import { vehiclesStore } from "@/lib/vehiclesStore";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

interface Tile {
  to: string;
  labelAr: string;
  labelEn: string;
  icon: React.ElementType;
  accent: string;
  span?: string;
  hint?: string;
  badgeQuery?: "openWorkOrders" | "todayWorkOrders" | "vehicles" | "pendingClaims" | "lowStock" | "unpaidInvoices" | "pendingInspections";
}

const TILES: Tile[] = [
  { to: "/work-orders/new", labelAr: "أمر عمل جديد", labelEn: "New Work Order", icon: PlusCircle, accent: "from-primary to-primary/60", span: "md:col-span-2", hint: "إنشاء سريع <5 ثوانٍ", badgeQuery: "todayWorkOrders" },
  { to: "/work-orders", labelAr: "أوامر العمل", labelEn: "Work Orders", icon: ClipboardList, accent: "from-sky-500 to-blue-600", badgeQuery: "openWorkOrders" },
  { to: "/vehicles", labelAr: "السيارات", labelEn: "Vehicles", icon: Car, accent: "from-amber-500 to-orange-600", badgeQuery: "vehicles" },
  { to: "/customers", labelAr: "العملاء", labelEn: "Customers", icon: Users, accent: "from-emerald-500 to-teal-600" },
  { to: "/insurance", labelAr: "التأمين", labelEn: "Insurance", icon: ShieldCheck, accent: "from-rose-500 to-red-600", span: "md:col-span-2", hint: "المطالبات • الدفعات • الأرشيف", badgeQuery: "pendingClaims" },
  { to: "/inventory", labelAr: "المخزون", labelEn: "Inventory", icon: Boxes, accent: "from-violet-500 to-purple-600", badgeQuery: "lowStock" },
  { to: "/sales/invoices", labelAr: "الفواتير", labelEn: "Invoices", icon: Receipt, accent: "from-cyan-500 to-sky-600", badgeQuery: "unpaidInvoices" },
  { to: "/accounting", labelAr: "المحاسبة", labelEn: "Accounting", icon: Calculator, accent: "from-indigo-500 to-blue-700" },
  { to: "/inspection", labelAr: "الفحص", labelEn: "Inspection", icon: ClipboardCheck, accent: "from-fuchsia-500 to-pink-600", badgeQuery: "pendingInspections" },
  { to: "/reports", labelAr: "التقارير", labelEn: "Reports", icon: FileBarChart2, accent: "from-yellow-500 to-amber-600" },
  { to: "/dashboard/executive", labelAr: "لوحة تنفيذية", labelEn: "Executive", icon: LayoutDashboard, accent: "from-slate-500 to-zinc-700" },
  { to: "/settings", labelAr: "الإعدادات", labelEn: "Settings", icon: Settings, accent: "from-neutral-500 to-neutral-700" },
];

type BadgeCounts = Record<string, number>;

function useBadgeCounts() {
  const { profile } = useAuth();
  const [counts, setCounts] = useState<BadgeCounts>({});

  const fetchCounts = useCallback(async () => {
    if (!profile?.tenant_id) return;
    const tenantId = profile.tenant_id;
    const today = new Date().toISOString().slice(0, 10);

    const results: BadgeCounts = {};

    // Local stores (fast, no network)
    try {
      const wos = getWorkOrders();
      results.openWorkOrders = wos.filter(
        (o) => o.status && !["مغلق", "تم التسليم"].includes(o.status)
      ).length;
      results.todayWorkOrders = wos.filter(
        (o) => o.entryDate === today || (o as any).created_at?.startsWith?.(today)
      ).length;
    } catch { /* ignore */ }

    try {
      results.vehicles = vehiclesStore.getAll().filter((v) => !v.archived).length;
    } catch { /* ignore */ }

    // Cloud counts (parallel)
    const promises: Promise<void>[] = [];

    // Pending insurance claims
    promises.push(
      (async () => {
        try {
          const { count, error } = await (supabase as any)
            .from("insurance_claims")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .in("status", ["pending", "approved", "rejected", "cancelled", "paid"]);
          if (!error && count !== null && count !== undefined) results.pendingClaims = count;
        } catch { /* ignore */ }
      })()
    );

    // Low stock
    promises.push(
      (async () => {
        try {
          const { count, error } = await (supabase as any)
            .from("inventory_items")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .lte("quantity", 10); // fallback if min_stock column missing
          if (!error && count !== null && count !== undefined) results.lowStock = count;
        } catch { /* ignore */ }
      })()
    );

    // Unpaid invoices
    promises.push(
      (async () => {
        try {
          const { count, error } = await (supabase as any)
            .from("sales_invoices")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .not("status", "eq", "paid");
          if (!error && count !== null && count !== undefined) results.unpaidInvoices = count;
        } catch { /* ignore */ }
      })()
    );

    // Pending inspections
    promises.push(
      (async () => {
        try {
          const { count, error } = await (supabase as any)
            .from("job_orders")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("status", "inspection");
          if (!error && count !== null && count !== undefined) results.pendingInspections = count;
        } catch { /* ignore */ }
      })()
    );

    await Promise.all(promises);
    setCounts(results);
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchCounts();
    const id = setInterval(fetchCounts, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, [fetchCounts]);

  return counts;
}

export default function HomeShortcuts() {
  const { i18n } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAr = i18n.language?.startsWith("ar");
  const [q, setQ] = useState("");
  const badgeCounts = useBadgeCounts();

  const filtered = TILES.filter((t) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return t.labelAr.toLowerCase().includes(s) || t.labelEn.toLowerCase().includes(s);
  });

  const greet = (() => {
    const h = new Date().getHours();
    if (isAr) return h < 12 ? "صباح الخير" : h < 18 ? "مساء الخير" : "مساء الخير";
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (filtered.length > 0) navigate(filtered[0].to);
  }

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      {/* Ambient background glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute top-1/3 -left-32 w-[360px] h-[360px] rounded-full bg-rose-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* Hero */}
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">{greet}{profile?.full_name ? `، ${profile.full_name}` : ""}</p>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                {isAr ? "بماذا تريد أن تبدأ؟" : "What would you like to do?"}
              </h1>
            </div>
            <Link
              to="/admin/notifications"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border bg-card/70 backdrop-blur hover:border-primary/40 text-muted-foreground hover:text-foreground transition"
            >
              <Bell size={13} /> {isAr ? "التنبيهات" : "Alerts"}
            </Link>
          </div>

          {/* Quick search jumps to first matching tile */}
          <form onSubmit={onSearchSubmit} className="relative max-w-xl">
            <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={isAr ? "ابحث عن قسم… (مثل: مخزون، فواتير، تأمين)" : "Jump to a section…"}
              className="w-full h-11 ps-9 pe-3 rounded-xl bg-card/80 backdrop-blur border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm text-foreground placeholder:text-muted-foreground transition"
            />
          </form>
        </header>

        {/* Tile grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-[110px] sm:auto-rows-[130px] gap-3 sm:gap-4">
          {filtered.map((t, i) => {
            const Icon = t.icon;
            const count = t.badgeQuery ? (badgeCounts[t.badgeQuery] || 0) : 0;
            return (
              <Link
                key={t.to}
                to={t.to}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`tile-fade group relative ${t.span || ""} rounded-2xl overflow-hidden border border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.35)] transition-all flex flex-col justify-between p-3 sm:p-4`}
              >
                <div className="relative self-start">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br ${t.accent} flex items-center justify-center text-white shadow-lg shadow-black/20 group-hover:scale-110 transition-transform`}>
                    <Icon size={20} strokeWidth={2.2} />
                  </div>
                  {count > 0 && (
                    <span className="absolute -top-1.5 -end-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shadow-sm border border-white/20">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  <div className="text-sm sm:text-base font-bold text-foreground group-hover:text-primary transition-colors leading-tight">
                    {isAr ? t.labelAr : t.labelEn}
                  </div>
                  {t.hint && (
                    <div className="text-[10px] sm:text-[11px] text-muted-foreground leading-tight line-clamp-1">{t.hint}</div>
                  )}
                </div>
                <div className="absolute top-2 end-2 w-1.5 h-1.5 rounded-full bg-primary/0 group-hover:bg-primary/80 transition-colors" />
              </Link>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
              {isAr ? "لا توجد نتائج" : "No matches"}
            </div>
          )}
        </div>

        {/* Footer row: app shortcuts */}
        <div className="flex items-center gap-2 flex-wrap pt-2">
          <span className="text-[11px] text-muted-foreground">{isAr ? "تطبيقات سريعة:" : "Quick apps:"}</span>
          {[
            { to: "/technician", label: isAr ? "تطبيق الفني" : "Technician" },
            { to: "/supervisor", label: isAr ? "المشرف" : "Supervisor" },
            { to: "/accountant", label: isAr ? "المحاسب" : "Accountant" },
            { to: "/install", label: isAr ? "تثبيت التطبيق" : "Install App" },
          ].map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-border bg-secondary/40 hover:border-primary/40 hover:text-primary text-muted-foreground transition"
            >
              <Smartphone size={11} /> {a.label}
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .tile-fade {
          opacity: 0;
          transform: translateY(8px);
          animation: tileIn 360ms cubic-bezier(.2,.7,.2,1) forwards;
        }
        @keyframes tileIn {
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
