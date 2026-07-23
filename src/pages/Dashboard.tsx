import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Car, Wrench, Clock, CheckCircle, FileText, AlertTriangle,
  Package, ClipboardCheck, Search, Shield, Star, PackageX,
  Filter, GripVertical, RotateCcw, Activity, Users, TrendingUp, Timer, Percent,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import StatCard from "@/components/StatCard";
import QuickActionsMenu from "@/components/dashboard/QuickActionsMenu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { inventoryStore, type Part } from "@/lib/inventoryStore";
import { getWorkOrders, refreshWorkOrdersFromCloud, subscribeWorkOrders, type WorkOrder } from "@/lib/workOrdersStore";
import { salesStore, type SalesDoc } from "@/lib/salesStore";
import { staffStore, type Technician } from "@/lib/staffStore";
import { refreshVehiclesFromCloud, vehiclesStore } from "@/lib/vehiclesStore";
import { customersStore, refreshCustomersFromCloud, type Customer } from "@/lib/customersStore";
import { suppliersStore } from "@/lib/suppliersStore";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import SupplementsKpiCard from "@/components/dashboard/SupplementsKpiCard";

const statusColors: Record<string, string> = {
  "تحت الإصلاح": "bg-warning/15 text-warning",
  "بانتظار الموافقة": "bg-info/15 text-info",
  "جاهز للتسليم": "bg-success/15 text-success",
  "تحت الفحص": "bg-primary/15 text-primary",
  "تم التسليم": "bg-success/15 text-success",
  "مغلق": "bg-muted text-muted-foreground",
};

type PeriodKey = "today" | "week" | "month" | "all";

function periodStart(key: PeriodKey): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (key === "today") return d.getTime();
  if (key === "week") { d.setDate(d.getDate() - 6); return d.getTime(); }
  if (key === "month") { d.setDate(1); return d.getTime(); }
  return 0;
}
function inPeriod(iso: string | undefined, key: PeriodKey): boolean {
  if (key === "all") return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= periodStart(key);
}

const LAYOUT_KEY = "dashboard:layout:v1";
const DEFAULT_LAYOUT = ["kpis", "stats", "charts", "main"];

function useLayout() {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (Array.isArray(p) && p.every((x) => typeof x === "string")) {
        const merged = [...p.filter((x) => DEFAULT_LAYOUT.includes(x))];
        DEFAULT_LAYOUT.forEach((x) => { if (!merged.includes(x)) merged.push(x); });
        return merged;
      }
    } catch { /* noop */ }
    return DEFAULT_LAYOUT;
  });
  useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(order)); }, [order]);
  return { order, setOrder, reset: () => setOrder(DEFAULT_LAYOUT) };
}

function SortableSection({ id, customizing, children }: { id: string; customizing: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !customizing });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 } as React.CSSProperties;
  return (
    <div ref={setNodeRef} style={style} className={customizing ? "ring-1 ring-dashed ring-primary/40 rounded-xl relative" : "relative"}>
      {customizing && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute -top-2 -right-2 z-10 p-1 rounded-full bg-primary text-primary-foreground shadow-md cursor-grab active:cursor-grabbing"
          aria-label="drag"
        >
          <GripVertical size={14} />
        </button>
      )}
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const localeCode = i18n.language === "en" ? "en-US" : "ar-SA";

  // ===== Live data =====
  const [inventory, setInventory] = useState<Part[]>(inventoryStore.getAll());
  const [orders, setOrders] = useState<WorkOrder[]>(getWorkOrders());
  const [docs, setDocs] = useState<SalesDoc[]>(salesStore.list());
  const [techs, setTechs] = useState<Technician[]>(staffStore.getAll());
  const [customers, setCustomers] = useState<Customer[]>(customersStore.getAll());

  useEffect(() => { const u = inventoryStore.subscribe(() => setInventory([...inventoryStore.getAll()])); return () => { u(); }; }, []);
  useEffect(() => { const u = subscribeWorkOrders(() => setOrders([...getWorkOrders()])); return () => { u(); }; }, []);
  useEffect(() => { const u = salesStore.subscribe(() => setDocs([...salesStore.list()])); return () => { u(); }; }, []);
  useEffect(() => { const u = staffStore.subscribe(() => setTechs([...staffStore.getAll()])); return () => { u(); }; }, []);
  useEffect(() => { const u = customersStore.subscribe(() => setCustomers([...customersStore.getAll()])); return () => { u(); }; }, []);
  useEffect(() => {
    let cancelled = false;
    const syncDashboardStores = async () => {
      await Promise.allSettled([
        refreshWorkOrdersFromCloud(),
        refreshCustomersFromCloud(),
        refreshVehiclesFromCloud(),
      ]);
      if (!cancelled) {
        setOrders([...getWorkOrders()]);
        setCustomers([...customersStore.getAll()]);
      }
    };
    void syncDashboardStores();
    return () => {
      cancelled = true;
    };
  }, []);

  // ===== Filters =====
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const techOptions = useMemo(() => Array.from(new Set(techs.map((x) => x.name))), [techs]);
  const serviceOptions = useMemo(() => Array.from(new Set(orders.map((o) => (o.serviceType || "").trim()).filter(Boolean))), [orders]);

  const filteredOrders = useMemo(() => orders.filter((o) => {
    if (!inPeriod(o.entryDate, period)) return false;
    if (techFilter !== "all" && o.technician !== techFilter) return false;
    if (serviceFilter !== "all" && (o.serviceType || "").trim() !== serviceFilter) return false;
    return true;
  }), [orders, period, techFilter, serviceFilter]);

  const filteredDocs = useMemo(() => docs.filter((d) => inPeriod(d.date, period)), [docs, period]);

  // ===== Stats =====
  const stats = useMemo(() => {
    const inWorkshop = filteredOrders.filter((o) => !["تم التسليم", "مغلق"].includes(o.status)).length;
    const underInspection = filteredOrders.filter((o) => o.status === "تحت الفحص").length;
    const waitingInsurance = filteredOrders.filter((o) => o.status === "بانتظار الموافقة").length;
    const underRepair = filteredOrders.filter((o) => o.status === "تحت الإصلاح").length;
    const readyDelivery = filteredOrders.filter((o) => o.status === "جاهز للتسليم").length;
    const openOrders = filteredOrders.filter((o) => !["مغلق"].includes(o.status)).length;
    const closedToday = orders.filter((o) => (o.status === "مغلق" || o.status === "تم التسليم") && inPeriod(o.entryDate, "today")).length;
    const invoices = filteredDocs.filter((d) => d.type === "invoice");
    const unpaidInvoices = invoices.filter((d) => (d.balanceDue || 0) > 0.001).length;
    return { inWorkshop, underInspection, waitingInsurance, underRepair, readyDelivery, openOrders, closedToday, unpaidInvoices };
  }, [filteredOrders, filteredDocs, orders]);

  // ===== KPIs =====
  const kpis = useMemo(() => {
    const total = filteredOrders.length || 1;
    const closed = filteredOrders.filter((o) => ["تم التسليم", "مغلق"].includes(o.status)).length;
    const completionRate = (closed / total) * 100;

    const closedWithDates = filteredOrders.filter((o) => ["تم التسليم", "مغلق"].includes(o.status) && o.entryDate);
    const avgDays = closedWithDates.length
      ? closedWithDates.reduce((s, o) => s + Math.max(0, Math.floor((Date.now() - new Date(o.entryDate).getTime()) / 86400000)), 0) / closedWithDates.length
      : 0;

    const invoices = filteredDocs.filter((d) => d.type === "invoice");
    const totalAmt = invoices.reduce((s, d) => s + (d.total || 0), 0);
    const paidAmt = invoices.reduce((s, d) => s + ((d.total || 0) - (d.balanceDue || 0)), 0);
    const collectionRate = totalAmt > 0 ? (paidAmt / totalAmt) * 100 : 0;

    const activeIds = new Set(filteredOrders.map((o) => (o.customer || "").trim()).filter(Boolean));
    return { completionRate, avgDays, collectionRate, activeCustomers: activeIds.size };
  }, [filteredOrders, filteredDocs]);

  // ===== Service distribution =====
  const serviceData = useMemo(() => {
    const palette = ["hsl(0,72%,51%)", "hsl(42,90%,55%)", "hsl(199,89%,48%)", "hsl(142,70%,45%)", "hsl(270,70%,55%)", "hsl(24,85%,55%)"];
    const counts = new Map<string, number>();
    filteredOrders.forEach((o) => {
      const k = (o.serviceType || (i18n.language === "en" ? "Other" : "أخرى")).trim() || (i18n.language === "en" ? "Other" : "أخرى");
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return Array.from(counts.entries()).slice(0, 6).map(([name, value], i) => ({ name, value, color: palette[i % palette.length] }));
  }, [filteredOrders, i18n.language]);

  // ===== Recent + alerts + top techs =====
  const recentOrders = useMemo(() => filteredOrders.slice(0, 5), [filteredOrders]);
  const topTechnicians = useMemo(() => [...techs].sort((a, b) => b.completedThisMonth - a.completedThisMonth).slice(0, 3), [techs]);

  const lowStock = inventory.filter((p) => p.stock > 0 && p.stock <= p.minStock);
  const outStock = inventory.filter((p) => p.stock <= 0);
  const inventoryAlerts = [
    ...outStock.map((p) => ({ text: `${t("inventory.title")}: ${p.name}`, type: "destructive" as const, to: `/inventory/${p.id}`, icon: PackageX })),
    ...lowStock.map((p) => ({ text: `${p.name} — ${p.stock} (${t("inventory.minStock")}: ${p.minStock})`, type: "warning" as const, to: `/inventory/${p.id}`, icon: Package })),
  ];
  const overdueOrders = orders.filter((o) => {
    if (["تم التسليم", "مغلق", "جاهز للتسليم"].includes(o.status)) return false;
    if (!o.entryDate) return false;
    return Math.floor((Date.now() - new Date(o.entryDate).getTime()) / 86400000) >= 3;
  });
  const otherAlerts = overdueOrders.slice(0, 3).map((o) => ({
    text: `${o.customer} — ${i18n.language === "en" ? "delayed" : "تأخر"} ${Math.floor((Date.now() - new Date(o.entryDate).getTime()) / 86400000)} ${i18n.language === "en" ? "days" : "أيام"}`,
    type: "destructive" as const, to: "/work-orders", icon: AlertTriangle,
  }));
  const allAlerts = [...inventoryAlerts, ...otherAlerts];

  // ===== Live activity =====
  const activities = useMemo(() => {
    type Act = { id: string; ts: number; label: string; sublabel: string; to: string; icon: typeof FileText; tone: string };
    const acts: Act[] = [];
    filteredOrders.slice(0, 30).forEach((o) => acts.push({
      id: `wo-${o.id}`, ts: new Date(o.entryDate || 0).getTime() || 0,
      label: `${t("dashboard.activityCreatedOrder")} • ${o.id}`,
      sublabel: `${o.customer} — ${o.vehicleType || ""} ${o.model || ""}`,
      to: `/work-orders/${o.id}`, icon: Wrench, tone: "text-primary",
    }));
    filteredDocs.slice(0, 30).forEach((d) => acts.push({
      id: `sd-${d.id}`, ts: new Date(d.date || d.createdAt || 0).getTime() || 0,
      label: `${t("dashboard.activityInvoice")} • ${d.number}`,
      sublabel: `${d.customerName} — ${(d.total || 0).toLocaleString(localeCode)} ${t("common.currency")}`,
      to: `/sales/${d.type === "quote" ? "quotes" : d.type === "credit_note" ? "credit-notes" : d.type === "return_invoice" ? "returns" : d.type === "recurring_invoice" ? "recurring" : "invoices"}/${d.id}`, icon: FileText, tone: "text-success",
    }));
    customers.slice(0, 10).forEach((c) => acts.push({
      id: `c-${c.id}`, ts: 0,
      label: `${t("dashboard.activityCustomer")}`,
      sublabel: `${c.name}${c.phone ? ` — ${c.phone}` : ""}`,
      to: `/customers/${c.id}`, icon: Users, tone: "text-info",
    }));
    return acts.sort((a, b) => b.ts - a.ts).slice(0, 8);
  }, [filteredOrders, filteredDocs, customers, t, localeCode]);

  // ===== Search =====
  const { data: insuranceClaims = [] } = useInsuranceClaims();
  const { data: insuranceCompanies = [] } = useInsuranceCompanies();
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as { kind: string; label: string; sub: string; to: string }[];
    const out: { kind: string; label: string; sub: string; to: string }[] = [];
    orders.forEach((o) => {
      if (`${o.id} ${o.customer} ${o.plate} ${o.vehicleType} ${o.model}`.toLowerCase().includes(q))
        out.push({ kind: t("workOrders.title"), label: o.id, sub: `${o.customer} — ${o.plate}`, to: `/work-orders/${o.id}` });
    });
    customers.forEach((c) => {
      if (`${c.name} ${c.phone}`.toLowerCase().includes(q))
        out.push({ kind: t("customers.title"), label: c.name, sub: c.phone || "", to: `/customers/${c.id}` });
    });
    vehiclesStore.getAll().forEach((v) => {
      if (`${v.plate} ${v.type}`.toLowerCase().includes(q))
        out.push({ kind: t("vehicles.title"), label: v.plate, sub: v.type, to: `/vehicles/${encodeURIComponent(v.id)}` });
    });
    docs.forEach((d) => {
      if (`${d.number} ${d.customerName}`.toLowerCase().includes(q))
        out.push({ kind: t("sales.title"), label: d.number, sub: d.customerName, to: `/sales/${d.type === "quote" ? "quotes" : d.type === "credit_note" ? "credit-notes" : d.type === "return_invoice" ? "returns" : d.type === "recurring_invoice" ? "recurring" : "invoices"}/${d.id}` });
    });
    insuranceClaims.forEach((c: any) => {
      const txt = `${c.claim_number || ""} ${c.insurance_company || ""} ${c.vehicle_plate || ""} ${c.vehicle_make || ""} ${c.vehicle_model || ""} ${c.customer_name || ""}`.toLowerCase();
      if (txt.includes(q))
        out.push({ kind: "تأمين", label: c.claim_number || "—", sub: `${c.insurance_company || ""} — ${c.vehicle_plate || ""}`, to: `/insurance/${c.id}` });
    });
    insuranceCompanies.forEach((c: any) => {
      if (`${c.name || ""} ${c.contact_phone || ""}`.toLowerCase().includes(q))
        out.push({ kind: "شركة تأمين", label: c.name, sub: c.contact_phone || "", to: `/insurance/companies/${c.id}` });
    });
    inventory.forEach((p: any) => {
      if (`${p.name || ""} ${p.code || p.sku || ""} ${p.barcode || ""}`.toLowerCase().includes(q))
        out.push({ kind: "قطعة", label: p.name, sub: p.code || p.sku || "", to: `/inventory/${encodeURIComponent(p.id)}` });
    });
    suppliersStore.getAll().forEach((s: any) => {
      if (`${s.name || ""} ${s.phone || ""}`.toLowerCase().includes(q))
        out.push({ kind: "مورد", label: s.name, sub: s.phone || "", to: `/inventory/suppliers` });
    });
    return out.slice(0, 20);
  }, [search, orders, customers, docs, insuranceClaims, insuranceCompanies, inventory, t]);

  // ===== Layout DnD =====
  const { order, setOrder, reset } = useLayout();
  const [customizing, setCustomizing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = order.indexOf(String(active.id));
    const newI = order.indexOf(String(over.id));
    if (oldI < 0 || newI < 0) return;
    setOrder(arrayMove(order, oldI, newI));
  }

  const fmtPct = (n: number) => `${n.toFixed(0)}%`;
  const fmtDays = (n: number) => `${n.toFixed(1)} ${i18n.language === "en" ? "d" : "ي"}`;

  // ===== Section renderers =====
  const sections: Record<string, React.ReactNode> = {
    kpis: (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard title={t("dashboard.completionRate")} value={fmtPct(kpis.completionRate)} icon={Percent} variant="success" to="/work-orders" />
        <StatCard title={t("dashboard.avgRepairDays")} value={fmtDays(kpis.avgDays)} icon={Timer} variant="info" to="/work-orders" />
        <StatCard title={t("dashboard.collectionRate")} value={fmtPct(kpis.collectionRate)} icon={TrendingUp} variant="gold" to="/accounting" />
        <StatCard title={t("dashboard.activeCustomers")} value={kpis.activeCustomers} icon={Users} to="/customers" />
      </div>
    ),
    stats: (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 md:gap-4">
        <StatCard title={t("dashboard.stats.vehiclesInWorkshop")} value={stats.inWorkshop} icon={Car} variant="gold" to="/vehicles" />
        <StatCard title={t("dashboard.stats.underInspection")} value={stats.underInspection} icon={Search} variant="info" to="/inspection" />
        <StatCard title={t("dashboard.stats.waitingInsurance")} value={stats.waitingInsurance} icon={Shield} variant="warning" to="/insurance" />
        <StatCard title={t("dashboard.stats.underRepair")} value={stats.underRepair} icon={Wrench} variant="default" to="/work-orders" />
        <StatCard title={t("dashboard.stats.readyDelivery")} value={stats.readyDelivery} icon={CheckCircle} variant="success" to="/work-orders" />
        <StatCard title={t("dashboard.stats.openOrders")} value={stats.openOrders} icon={FileText} to="/work-orders" />
        <StatCard title={t("dashboard.stats.closedToday")} value={stats.closedToday} icon={ClipboardCheck} variant="success" to="/work-orders" />
        <StatCard title={t("dashboard.stats.unpaidInvoices")} value={stats.unpaidInvoices} icon={AlertTriangle} variant="warning" to="/sales" />
      </div>
    ),
    charts: (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-3 md:p-4 shadow-card">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Activity size={16} className="text-primary" /> {t("dashboard.activity")}
          </h3>
          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {activities.length === 0 && (
              <p className="text-xs text-muted-foreground py-6 text-center">{t("dashboard.noActivity")}</p>
            )}
            {activities.map((a) => (
              <Link key={a.id} to={a.to} className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/40 transition-colors">
                <span className={`mt-0.5 ${a.tone}`}><a.icon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">{a.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{a.sublabel}</div>
                </div>
                {a.ts > 0 && (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {new Date(a.ts).toLocaleDateString(localeCode)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-3 md:p-4 shadow-card">
          <h3 className="text-sm font-semibold text-foreground mb-3 md:mb-4">{t("dashboard.serviceDistribution")}</h3>
          {serviceData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
              {i18n.language === "en" ? "No data yet" : "لا توجد بيانات بعد"}
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={serviceData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
                    {serviceData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-2">
                {serviceData.map((s, i) => (
                  <span key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                    {s.name} ({s.value})
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    ),
    main: (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-3 md:p-4 shadow-card">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <h3 className="text-sm font-semibold text-foreground">{t("dashboard.recentOrders")}</h3>
            <Link to="/work-orders" className="text-xs text-primary hover:underline">{t("dashboard.viewAll")} ←</Link>
          </div>
          <div className="overflow-x-auto -mx-3 md:mx-0 px-3 md:px-0">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium text-xs">{t("workOrders.orderNumber")}</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium text-xs">{t("workOrders.customer")}</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium text-xs hidden md:table-cell">{t("workOrders.vehicle")}</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium text-xs hidden md:table-cell">{t("workOrders.plate")}</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium text-xs">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    {i18n.language === "en" ? "No work orders" : "لا توجد أوامر"}
                  </td></tr>
                )}
                {recentOrders.map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/work-orders/${o.id}`)} className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer">
                    <td className="py-2.5 px-2 font-mono text-xs text-primary">{o.id}</td>
                    <td className="py-2.5 px-2 text-foreground truncate max-w-[120px]">{o.customer}</td>
                    <td className="py-2.5 px-2 text-muted-foreground hidden md:table-cell">{o.vehicleType} {o.model}</td>
                    <td className="py-2.5 px-2 text-muted-foreground hidden md:table-cell font-mono">{o.plate}</td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[10px] px-2 py-1 rounded-full font-medium whitespace-nowrap ${statusColors[o.status] || "bg-secondary text-foreground"}`}>{o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-3 md:p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle size={16} className="text-warning" /> {t("dashboard.alerts")}
            </h3>
            <div className="space-y-2">
              {allAlerts.length === 0 && (
                <p className="text-xs text-muted-foreground py-3 text-center">
                  {i18n.language === "en" ? "No alerts ✓" : "لا توجد تنبيهات ✓"}
                </p>
              )}
              {allAlerts.map((a, i) => (
                <Link key={i} to={a.to} className={`block text-xs p-2.5 rounded-lg border transition-all hover:scale-[1.02] hover:shadow-md ${a.type === "warning" ? "bg-warning/5 border-warning/20 text-warning hover:bg-warning/10" : "bg-destructive/5 border-destructive/20 text-destructive hover:bg-destructive/10"}`}>{a.text}</Link>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 md:p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Star size={16} className="text-primary" /> {t("dashboard.topTechnicians")}
              </h3>
              <Link to="/staff" className="text-xs text-primary hover:underline">{t("dashboard.viewAll")} ←</Link>
            </div>
            <div className="space-y-3">
              {topTechnicians.map((tech, i) => (
                <Link key={tech.id} to="/staff" className="flex items-center justify-between p-1.5 -mx-1.5 rounded-lg hover:bg-secondary/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-full gradient-gold flex items-center justify-center text-[10px] font-bold text-primary-foreground flex-shrink-0">{i + 1}</span>
                    <span className="text-sm text-foreground truncate">{tech.name}</span>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{tech.completedThisMonth} {t("dashboard.vehicleCount")}</span>
                    <span className="text-[10px] text-primary mr-2">★ {tech.rating}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
  };

  return (
    <div className="space-y-4 md:space-y-6 pt-12 lg:pt-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-foreground truncate">{t("dashboard.title")}</h1>
          <p className="text-xs md:text-sm text-muted-foreground">{t("dashboard.interactiveDashboard")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <QuickActionsMenu />
          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground bg-card rounded-lg px-3 py-2 border border-border">
            <Clock size={14} />
            <span>{t("dashboard.lastUpdate")}: {new Date().toLocaleTimeString(localeCode)}</span>
          </div>
        </div>
      </div>

      <SupplementsKpiCard />

      {/* Search + Filters bar */}
      <div className="bg-card border border-border rounded-xl p-3 md:p-4 shadow-card flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dashboard.searchPlaceholder")}
            className="ps-9"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute top-1/2 -translate-y-1/2 end-2 p-1 rounded hover:bg-secondary" aria-label="clear">
              <X size={14} />
            </button>
          )}
          {searchResults.length > 0 && (
            <div className="absolute z-40 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-80 overflow-auto">
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => { navigate(r.to); setSearch(""); }} className="w-full text-start px-3 py-2 hover:bg-secondary/60 border-b border-border/50 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{r.label}</span>
                    <span className="text-[10px] text-muted-foreground">{r.kind}</span>
                  </div>
                  {r.sub && <div className="text-xs text-muted-foreground truncate">{r.sub}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t("dashboard.today")}</SelectItem>
              <SelectItem value="week">{t("dashboard.week")}</SelectItem>
              <SelectItem value="month">{t("dashboard.month")}</SelectItem>
              <SelectItem value="all">{t("dashboard.allTime")}</SelectItem>
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter size={14} /> {t("dashboard.filters")}
                {(techFilter !== "all" || serviceFilter !== "all") && <span className="w-2 h-2 rounded-full bg-primary" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("dashboard.technician")}</label>
                <Select value={techFilter} onValueChange={setTechFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("dashboard.allTechnicians")}</SelectItem>
                    {techOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("dashboard.serviceType")}</label>
                <Select value={serviceFilter} onValueChange={setServiceFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("dashboard.allServices")}</SelectItem>
                    {serviceOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(techFilter !== "all" || serviceFilter !== "all") && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => { setTechFilter("all"); setServiceFilter("all"); }}>
                  <X size={14} /> {i18n.language === "en" ? "Clear" : "مسح"}
                </Button>
              )}
            </PopoverContent>
          </Popover>

          <Button variant={customizing ? "default" : "outline"} size="sm" className="gap-2" onClick={() => setCustomizing((v) => !v)}>
            <GripVertical size={14} /> {customizing ? t("dashboard.done") : t("dashboard.customizeLayout")}
          </Button>
          {customizing && (
            <Button variant="ghost" size="sm" className="gap-2" onClick={reset}>
              <RotateCcw size={14} /> {t("dashboard.resetLayout")}
            </Button>
          )}
        </div>
      </div>

      {customizing && (
        <p className="text-xs text-muted-foreground text-center">{t("dashboard.dragHint")}</p>
      )}

      {/* Sortable sections */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-4 md:space-y-6">
            {order.map((id) => (
              <SortableSection key={id} id={id} customizing={customizing}>
                {sections[id]}
              </SortableSection>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
