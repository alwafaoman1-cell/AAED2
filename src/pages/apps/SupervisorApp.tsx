import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ListFilter, LogOut, Moon, Plus, RefreshCw, Receipt, Search, Sun, X } from "lucide-react";
import { useTheme } from "@/contexts/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useCan } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { SupervisorVehicleCard } from "@/components/supervisor/SupervisorVehicleCard";
import type { SupervisorPanelSelection } from "@/components/supervisor/SupervisorActionPanel";
import { listSupervisorLegacyOrders, listSupervisorMilestones, listSupervisorVisits, supervisorEntryPath, supervisorVehicleFromVisit, SUPERVISOR_CENTER_CHANNEL_SUPPORTED, SUPERVISOR_PAGE_SIZE, type SupervisorChannel, type SupervisorTab, type SupervisorVehicle } from "@/lib/supervisorWorkspace";
import { VISIT_STAGES, type VehicleCenterTab, type VisitStage } from "@/lib/vehicleVisitLifecycle";
import { getEntryRearThumbnailUrls } from "@/lib/vehicleRearThumbnails";
import "@/lib/i18n/supervisorWorkspace";
import { useSupervisorTheme } from "@/hooks/useSupervisorTheme";

const SupervisorActionPanel = lazy(() => import("@/components/supervisor/SupervisorActionPanel").then((module) => ({ default: module.SupervisorActionPanel })));
const tabs: SupervisorTab[] = ["in_workshop", "with_customer", "needs_review", "delivered", "cancelled", "legacy"];

export default function SupervisorApp() {
  useRealtimeSync();
  useSupervisorTheme();
  const { t, i18n } = useTranslation("supervisorWorkspace");
  const { resolved: resolvedTheme, setTheme } = useTheme();
  const { profile, signOut, hasRole } = useAuth();
  const navigate = useNavigate();
  const canEntry = useCan("Vehicles", "Create/Edit");
  const canExpense = useCan("Expenses", "Add/Edit/Delete");
  const canStages = useCan("Work Orders", "Status & delivery");
  const canOrder = useCan("Work Orders", "Create/Edit");
  const canMessages = hasRole("admin", "manager", "insurance", "supervisor");
  const [tab, setTab] = useState<SupervisorTab>("in_workshop");
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [channel, setChannel] = useState<SupervisorChannel>("all");
  const [stage, setStage] = useState<VisitStage | "all">("all");
  const [pageState, setPageState] = useState({ scope: "", page: 1 });
  const [selection, setSelection] = useState<SupervisorPanelSelection | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const filters = useMemo(() => ({ search: settledSearch, channel, stage }), [settledSearch, channel, stage]);
  const scope = JSON.stringify([profile?.tenant_id, tab, filters]);
  const page = pageState.scope === scope ? pageState.page : 1;
  const setPage = (value: number) => setPageState({ scope, page: Math.max(1, value) });
  // No inactive-tab prefetching and no previous-page placeholder presented as current.
  const center = useQuery({
    queryKey: ["vehicle_visit", "center", "supervisor", profile?.tenant_id, tab, filters, page],
    queryFn: () => listSupervisorVisits({ tab: tab as VehicleCenterTab, page, filters }),
    enabled: Boolean(profile?.tenant_id) && tab !== "legacy",
    staleTime: 15_000, refetchOnWindowFocus: true, refetchInterval: 60_000,
  });
  const legacy = useQuery({
    queryKey: ["job_orders", "supervisor_legacy", profile?.tenant_id, settledSearch, channel, page],
    queryFn: () => listSupervisorLegacyOrders({ tenantId: profile!.tenant_id, page, search: settledSearch, channel }),
    enabled: Boolean(profile?.tenant_id) && tab === "legacy" && canOrder,
    staleTime: 15_000, refetchOnWindowFocus: true,
  });
  const active = tab === "legacy" ? legacy : center;
  const error = active.error;
  const rows = useMemo(() => error ? [] : tab === "legacy" ? legacy.data?.rows || []
    : (center.data?.items || []).map(supervisorVehicleFromVisit), [tab, center.data, legacy.data, error]);
  const total = error ? undefined : tab === "legacy" ? legacy.data?.pagination.totalRows : center.data?.total;
  const pages = Math.max(1, tab === "legacy" ? legacy.data?.pagination.totalPages || 1 : Math.ceil((center.data?.total || 0) / SUPERVISOR_PAGE_SIZE));
  useEffect(() => {
    if (!active.isFetching && !error && total !== undefined && page > pages) setPageState({ scope, page: pages });
  }, [active.isFetching, error, total, page, pages, scope]);
  const entryIds = rows.flatMap((row) => row.entryId ? [row.entryId] : []);
  const thumbnails = useQuery({
    queryKey: ["vehicle_media", "entry_rear_thumbnails", profile?.tenant_id, entryIds.join("|")],
    queryFn: () => getEntryRearThumbnailUrls(profile!.tenant_id, entryIds),
    enabled: Boolean(profile?.tenant_id) && entryIds.length > 0 && !error,
    staleTime: 120_000,
  });
  const milestones = useQuery({
    queryKey: ["vehicle_visit", "supervisor_timing", profile?.tenant_id, entryIds.join("|")],
    queryFn: () => listSupervisorMilestones(profile!.tenant_id, entryIds),
    enabled: Boolean(profile?.tenant_id) && entryIds.length > 0 && !error,
    staleTime: 60_000, retry: 1,
  });
  const filterCount = Number(Boolean(search.trim())) + Number(channel !== "all") + Number(stage !== "all");
  function openEntry(row: SupervisorVehicle) {
    if (canEntry) navigate(supervisorEntryPath(row));
  }
  return <main dir={i18n.dir()} className="min-h-dvh bg-background pb-6 text-foreground">
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-lg font-bold">{t("title")}</h1><p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{t("subtitle")}</p></div>
        <div className="flex flex-wrap items-center gap-2 [&_button]:min-h-11 [&_button]:min-w-11">
          <LanguageSwitcher />
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("theme")} title={t(resolvedTheme === "dark" ? "lightTheme" : "darkTheme")}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>{resolvedTheme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}</Button>
          <Button variant="outline" className="min-h-11" disabled={active.isFetching} onClick={() => void active.refetch()}>
            <RefreshCw className={`me-2 h-4 w-4 ${active.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />{t("refresh")}
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={() => void signOut()}><LogOut className="me-2 h-4 w-4" aria-hidden="true" />{t("signOut")}</Button>
        </div>
      </div>
    </header>
    <div className="mx-auto max-w-screen-2xl space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap gap-2">
        {canEntry && <Button className="min-h-11" onClick={() => navigate("/supervisor/entry/new")}><Plus className="me-2 h-4 w-4" />{t("newEntry")}</Button>}
        {canExpense && <Button variant="outline" className="min-h-11" onClick={() => setSelection({ action: "expense" })}><Receipt className="me-2 h-4 w-4" />{t("generalExpense")}</Button>}
        {canExpense && <Button variant="outline" className="min-h-11" onClick={() => setSelection({ action: "expenseHistory" })}>{t("expenseHistory")}</Button>}
      </div>
      <nav aria-label={t("custody")} className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.filter((value) => value !== "legacy" || canOrder).map((value) => <Button key={value} className="min-h-11 shrink-0 px-3 text-xs"
          variant={tab === value ? "default" : "outline"} aria-pressed={tab === value} onClick={() => setTab(value)}>{t(value)}</Button>)}
      </nav>
      <section className="grid grid-cols-2 items-end gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-[minmax(12rem,1fr)_minmax(9rem,auto)_minmax(9rem,auto)_auto]" aria-label={t("searchLabel")}>
        <label className="relative col-span-2 self-end md:col-span-1"><span className="sr-only">{t("searchLabel")}</span><Search className="pointer-events-none absolute start-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input className="min-h-11 ps-10 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("search")} />
        </label>
        <label className="space-y-1 text-xs">{t("channel")}
          <select className="block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" aria-label={t("channel")}
            value={channel} disabled={tab !== "legacy" && !SUPERVISOR_CENTER_CHANNEL_SUPPORTED} onChange={(event) => setChannel(event.target.value as SupervisorChannel)}>
            {(["all", "cash", "insurance"] as const).map((value) => <option key={value} value={value}>{t(value)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs">{t("stage")}
          <select className="block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" aria-label={t("stage")} value={stage} disabled={tab === "legacy"}
            onChange={(event) => setStage(event.target.value as VisitStage | "all")}>
            <option value="all">{t("allStages")}</option>{VISIT_STAGES.map((value) => <option key={value} value={value}>{t(value)}</option>)}
          </select>
        </label>
        <Button variant="ghost" className="col-span-2 min-h-11 gap-2 text-xs md:col-span-1" disabled={!filterCount} onClick={() => { setSearch(""); setChannel("all"); setStage("all"); }}>
          {filterCount ? <X className="h-4 w-4" aria-hidden="true" /> : <ListFilter className="h-4 w-4" aria-hidden="true" />}{t("clearFilters")}{filterCount ? ` (${filterCount})` : ""}
        </Button>
      </section>
      <p className="text-xs leading-5 text-muted-foreground">{t("timingLegend")}</p>
      {milestones.isError && <p role="status" className="text-xs text-warning">{t("timingFailed")}</p>}
      {!SUPERVISOR_CENTER_CHANNEL_SUPPORTED && tab !== "legacy" && <p role="status" className="text-xs text-muted-foreground">{t("channelPending")}</p>}
      {tab === "legacy" && <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs">{t("legacyNotice")}</p>}
      {!profile?.tenant_id || active.isPending ? <p role="status" className="py-8 text-center text-sm">{t("loading")}</p>
        : error ? <section role="alert" className="rounded-xl border border-destructive p-4 text-sm"><p>{t("loadError")}</p><Button className="mt-3 min-h-11" onClick={() => void active.refetch()}>{t("retry")}</Button></section>
          : <>
            {total !== undefined && <p className="text-sm text-muted-foreground">{t(tab === "legacy" ? "candidateTotal" : "total", { count: total })}</p>}
            {rows.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {rows.map((row) => <SupervisorVehicleCard key={row.key} row={row} photoUrl={row.entryId ? thumbnails.data?.[row.entryId] : undefined}
                permissions={{ expense: canExpense, stages: canStages, workOrder: canOrder, entry: canEntry, messages: canMessages }}
                milestones={milestones.isError ? undefined : milestones.data} now={now}
                onAction={(action, current) => setSelection({ action, row: current })} onOpenEntry={openEntry} />)}
            </div> : <p role="status" className="rounded-xl border border-border p-6 text-center text-sm">{t(tab === "legacy" && total ? "legacyEmpty" : "empty")}</p>}
            <div className="flex flex-wrap items-center justify-center gap-3" aria-label={t("pagination", { page, pages })}>
              <Button className="min-h-11" variant="outline" disabled={page <= 1 || active.isFetching} onClick={() => setPage(page - 1)}>{t("previous")}</Button>
              <span className="text-sm" aria-live="polite">{t("pagination", { page, pages })}</span>
              <Button className="min-h-11" variant="outline" disabled={page >= pages || active.isFetching} onClick={() => setPage(page + 1)}>{t("next")}</Button>
            </div>
          </>}
    </div>
    {selection && <Suspense fallback={<p role="status" className="p-4 text-sm">{t("loading")}</p>}>
      <SupervisorActionPanel key={`${profile?.tenant_id}:${selection.action}:${selection.row?.key || "general"}`} selection={selection} onClose={() => setSelection(null)} />
    </Suspense>}
  </main>;
}
