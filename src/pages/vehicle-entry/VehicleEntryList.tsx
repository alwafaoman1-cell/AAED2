import { lazy,Suspense,useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CarFront, FileSpreadsheet, Filter, LayoutGrid, List, Loader2, MoreHorizontal, Plus, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getVehicleEntryPresence, getVehicleEntryVisitPurpose, vehicleEntryStatusKey, VEHICLE_ENTRY_STATUSES } from "@/lib/vehicleEntryService";
import { listAllMatchingVehicleCenter, listVehicleVisitCenterPage, VEHICLE_CENTER_TABS, VISIT_STAGES, type VehicleCenterFilters, type VehicleCenterTab, type VisitStage } from "@/lib/vehicleVisitLifecycle";
import { TablePaginationControls } from "@/components/ui/table-pagination-controls";
import "@/i18n/vehicleCenterUpgrade";
import "@/lib/i18n/vehicleVisitWorkspace";
import "@/lib/i18n/vehicleCenterMobile";
import { getEntryRearThumbnailUrls } from "@/lib/vehicleRearThumbnails";
import { VehicleRearThumbnail } from "@/components/vehicles/VehicleRearThumbnail";
import { VehicleEntryStartChoices } from "@/components/vehicle-entry/VehicleEntryStartChoices";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { VehicleCenterCard } from "@/components/vehicle-entry/VehicleCenterCard";
import { VehicleCenterRowActions } from "@/components/vehicle-entry/VehicleCenterRowActions";
import { VehicleCenterNavigation } from "@/components/vehicle-entry/VehicleCenterNavigation";
import { CENTER_LOCATION_TABS, CENTER_WORK_STAGES, type VehicleCenterActionRequest } from "@/lib/vehicleCenterPresentation";
import { isVehicleVisitAwaitingArrival } from "@/lib/vehicleVisitIntake";
import { vehicleEntryArrivalTime } from "@/lib/vehicleEntryArrival";
import { Checkbox } from "@/components/ui/checkbox";
import { useVehicleLabelSelection } from "@/hooks/useVehicleLabelSelection";
import { VehicleEntryLabelActions, VehicleLabelCheckbox } from "@/components/vehicle-entry/VehicleEntryLabelActions";
const VehicleVisitQuickActionDialog=lazy(()=>import('./VehicleVisitQuickActionDialog').then(m=>({default:m.VehicleVisitQuickActionDialog})));

export default function VehicleEntryList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const activeTab: VehicleCenterTab = VEHICLE_CENTER_TABS.includes(params.get("location") as VehicleCenterTab)
    ? params.get("location") as VehicleCenterTab : "in_workshop";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [choosePurposeOpen, setChoosePurposeOpen] = useState(false);
  const [entryChannel, setEntryChannel] = useState<"cash" | "insurance" | null>(null);
  const [entryPurpose, setEntryPurpose] = useState<"workshop" | "inspection" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [stageFilter, setStageFilter] = useState<VisitStage | "all">("all");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [technician, setTechnician] = useState("all");
  const [location, setLocation] = useState("all");
  const [minDays, setMinDays] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [labelToolsOpen, setLabelToolsOpen] = useState(false);
  const [quickActionRow, setQuickActionRow] = useState<any | null>(null);
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const [pageSize, setPageSize] = useState(30);
  const filters: VehicleCenterFilters = useMemo(() => ({
    search: search.trim(), status, from, to, technician,
    location: location as VehicleCenterFilters["location"],
    minDays: Math.max(0, Math.floor(Number(minDays) || 0)), stage: activeTab === "in_workshop" ? stageFilter : "all",
  }), [search, status, from, to, technician, location, minDays, stageFilter, activeTab]);
  const scopeKey = JSON.stringify([profile?.tenant_id, activeTab, filters, pageSize]);
  const page = pageState.key === scopeKey ? pageState.page : 1;
  const setPage = (value: number) => setPageState({ key: scopeKey, page: value });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["vehicle_visit", "center", profile?.tenant_id, activeTab, filters, page, pageSize],
    queryFn: () => listVehicleVisitCenterPage({ tab: activeTab, filters, page, pageSize }),
    enabled: Boolean(profile?.tenant_id),
    staleTime: 15_000, refetchOnWindowFocus: true, refetchInterval: 60_000,
  });
  useEffect(() => {
    if (pageState.key !== scopeKey) {
      setPageState({ key: scopeKey, page: 1 });
    } else if (data && page > Math.max(1, Math.ceil(data.total / pageSize))) {
      setPageState({ key: scopeKey, page: Math.max(1, Math.ceil(data.total / pageSize)) });
    }
  }, [data, page, pageSize, scopeKey, pageState.key]);
  const rows = useMemo(() => (data?.items || []).map((visit) => ({
    ...visit.entry, _visitStage: visit.operationalStage, _reviewReason: visit.reviewReason, _hasFinalHandover: visit.hasFinalHandover,
    _canRegisterEntry: ["with_customer", "awaiting_arrival"].includes(activeTab) && (visit.hasSignedTemporaryRelease || isVehicleVisitAwaitingArrival(visit.entry)) && !visit.reviewReason,
  })), [data, activeTab]);
  const labels = useVehicleLabelSelection({ tenant: profile?.tenant_id, tab: activeTab, filters, token: data?.scopeToken, total: data?.total || 0, rows, onStale: () => { void refetch(); } });
  const technicians = data?.technicians || [];
  const stageCounts = data?.stages;
  const photoEntryIds = rows.filter((row) => !row._claimOnly).map((row) => row.id);
  const rearPhotos = useQuery({
    queryKey: ["vehicle_media", "entry_rear_thumbnails", profile?.tenant_id || "", photoEntryIds.join("|")],
    queryFn: () => getEntryRearThumbnailUrls(profile!.tenant_id, photoEntryIds),
    enabled: !!profile?.tenant_id && photoEntryIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
  const rearPhotoByEntry = rearPhotos.data || {};
  const statusLabel = (value: string) => {
    const key = vehicleEntryStatusKey(value);
    return key ? t(`vehicleEntry.statuses.${key}`) : value;
  };
  const purposeLabel = (row: any) => {
    if (row._claimOnly) return t("vehicleVisit.claim");
    const purpose = getVehicleEntryVisitPurpose(row);
    return t(purpose === "inspection" ? "vehicleEntry.inspectionPurpose" : purpose === "workshop" ? "vehicleEntry.workshopPurpose" : "vehicleEntry.unknownPurpose");
  };
  const stageLabel = (stage: VisitStage) => t(activeTab === "awaiting_arrival" && stage === "arrived" ? "vehicleEntryLabels:awaiting" : `vehicleVisit.${stage}`);
  const advancedFilterCount = [status !== "all", Boolean(from), Boolean(to), technician !== "all", location !== "all", Number(minDays) > 0].filter(Boolean).length;
  const hasFilters = advancedFilterCount > 0 || Boolean(search.trim()) || (activeTab === "in_workshop" && stageFilter !== "all");
  function clearFilters() {
    setSearch(""); setStatus("all"); setFrom(""); setTo(""); setTechnician("all"); setLocation("all"); setMinDays(""); setStageFilter("all");
  }

  function chooseTab(value: string) {
    const next = new URLSearchParams(params);
    next.set("location", value);
    setParams(next);
    setStageFilter("all");
  }

  const tabLabel = (tab: VehicleCenterTab) => t(tab === "awaiting_arrival" ? "vehicleEntryLabels:awaiting" : tab === "in_workshop" ? "vehicleEntry.workshopTab"
    : tab === "with_customer" ? "vehicleEntry.customerTab"
      : `vehicleCenterUpgrade:${tab === "needs_review" ? "reviewTab" : `${tab}Tab`}`);

  function openRowAction(row: any, request?: VehicleCenterActionRequest) {
    setQuickActionRow({ ...row, _centerAction: request });
  }

  function startEntry(purpose: "workshop" | "inspection" | null) {
    setEntryPurpose(purpose);
    if (!entryChannel || !purpose) return;
    setChoosePurposeOpen(false);
    navigate(`/vehicle-entry/new?channel=${entryChannel}&purpose=${purpose}`);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const exportMatches = (await listAllMatchingVehicleCenter({ tab: activeTab, filters })).map((visit) => ({
        ...visit.entry, _visitStage: visit.operationalStage, _reviewReason: visit.reviewReason,
      }));
      const XLSX = await import("xlsx");
      const header = [
        t("vehicleEntry.entryNumber"), t("vehicleVisit.recordType"), t(activeTab === "awaiting_arrival" ? "vehicleEntryLabels:formDate" : "vehicleEntry.arrival"), t("vehicleEntry.plate"),
        t("vehicleEntry.vehicle"), t("vehicleEntry.customer"), t("vehicleEntry.phone"),
        t("vehicleEntry.insurance"), t("vehicleEntry.deliveredBy"), t("vehicleEntry.location"),
        t("vehicleEntry.purpose"), t("vehicleEntry.status"), t("unifiedInvoices.claim"),
        t("vehicleEntry.workOrder"), t("vehicleEntry.issuedAt"), t("vehicleVisit.stage"), t("vehicleVisit.technician"), t("vehicleEntry.reviewLocation"), "VIN",
      ];
      const exportRows = exportMatches.map((row) => {
        const vehicle = row.vehicle || row.vehicle_snapshot || {};
        const customer = row.customer || row.customer_snapshot || {};
        return [
          row.entry_number,
          t(row._claimOnly ? "vehicleVisit.claimOnlyCard" : "vehicleVisit.entry"),
          [row.arrival_date, vehicleEntryArrivalTime(row)].filter(Boolean).join(" "),
          [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" "),
          [vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" "),
          customer.name || "", customer.phone || "",
          row.insurance_snapshot?.company_name || row.insurance_company?.name || "",
          row.delivered_by?.full_name || "",
          t(getVehicleEntryPresence(row) === "in_workshop" ? "vehicleEntry.workshopTab" : getVehicleEntryPresence(row) === "with_customer" ? "vehicleEntry.customerTab" : "vehicleEntry.reviewLocation"),
          purposeLabel(row), row._claimOnly ? t(`vehicleVisit.claimStatus.${row.status}`, { defaultValue: row.status }) : statusLabel(row.status),
          row.claim?.claim_number || row.converted_claim?.claim_number || row.insurance_snapshot?.claim_number || "",
          row.work_order?.order_number || row.converted_work_order?.order_number || "", row.issued_at || "",
          stageLabel(row._visitStage), row.work_order?.technician_name || row.converted_work_order?.technician_name || "",
          row._reviewReason ? t(`vehicleVisit.${row._reviewReason}`, { defaultValue: row._reviewReason }) : "",
          vehicle.vin_number || vehicle.vin || "",
        ].map((cell) => typeof cell === "string" && /^[=+@-]/.test(cell.trimStart()) ? `'${cell}` : cell);
      });
      const ws = XLSX.utils.aoa_to_sheet([header, ...exportRows]);
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: exportRows.length, c: header.length - 1 } }) };
      ws["!cols"] = header.map((h, i) => ({ wch: Math.max(12, h.length + 2, ...exportRows.map((r) => String(r[i] || "").length + 2)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Vehicle Entries");
      XLSX.writeFile(wb, `Vehicle_Entry_Receipts_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (cause) {
      toast.error((cause as Error)?.message === "VEHICLE_CENTER_EXPORT_CHANGED"
        ? t("vehicleCenterUpgrade:exportChanged") : (cause as Error)?.message || t("vehicleEntry.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  function renderRows(displayRows: any[]) {
    if (displayRows.length === 0) return <div className="p-8 text-center text-muted-foreground">{t("vehicleEntry.noMatching")}</div>;
    const renderCard = (row: any) => <VehicleCenterCard key={row.id} row={row} tab={activeTab} thumbnail={rearPhotoByEntry[row.id]}
      selection={labels} stageLabel={stageLabel} purposeLabel={purposeLabel} statusLabel={statusLabel} onOpen={openRowAction} />;
    if (view === "kanban") {
      const stages = activeTab === "in_workshop" ? (stageFilter === "all" ? CENTER_WORK_STAGES : [stageFilter])
        : VISIT_STAGES.filter(stage => displayRows.some(row => row._visitStage === stage));
      return <div className="flex min-w-0 snap-x gap-3 overflow-x-auto p-3">{stages.map((stage) => <section key={stage} className="min-w-[260px] max-w-[340px] flex-1 shrink-0 snap-start rounded-xl bg-muted/40 p-3">
        <h3 className="mb-3 flex justify-between gap-2 font-semibold">{stageLabel(stage)} <span>{stageCounts?.[stage] ?? "—"}</span></h3>
        <div className="space-y-2">{displayRows.filter(row => row._visitStage === stage).map(renderCard)}</div>
      </section>)}</div>;
    }
    if (isMobile) return <div className="grid min-w-0 gap-3 p-3">{displayRows.map(renderCard)}</div>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-start">
              <th scope="col" className="p-3 print:hidden"><Checkbox aria-label={t("vehicleEntryLabels:page")} checked={labels.pageChecked} disabled={labels.printing || !displayRows.length} onCheckedChange={(value) => labels.togglePage(value === true)} /></th>
              {["entryNumber", "arrival", "vehicle", "customer", "insurance", "deliveredBy", "location", "purpose", "status"].map((key) =>
                <th key={key} scope="col" className="p-3 text-start">{t(key === "arrival" && activeTab === "awaiting_arrival" ? "vehicleEntryLabels:formDate" : `vehicleEntry.${key}`)}</th>)}
              <th scope="col" className="p-3 text-start">{t("vehicleVisit.stage")}</th>
              <th scope="col" className="p-3 text-start">{t("vehicleVisit.technician")}</th>
              <th scope="col" className="p-3 text-start">{t("vehicleVisit.manageLocationAndStage")}</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const vehicle = row.vehicle || row.vehicle_snapshot || {};
              const customer = row.customer || row.customer_snapshot || {};
              const presence = getVehicleEntryPresence(row);
              return (
                <tr key={row.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-3 print:hidden"><VehicleLabelCheckbox row={row} selection={labels} /></td>
                  <td className="p-3 font-mono font-semibold text-primary"><Link to={row._claimOnly ? `/insurance/${row.claim.id}` : `/vehicle-entry/${row.id}`}>{row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard")}</Link>{row._claimOnly && <div className="text-xs font-normal text-warning">{t("vehicleVisit.claimOnlyCard")}</div>}</td>
                  <td className="p-3 whitespace-nowrap" dir="auto">{row.arrival_date || "—"} {vehicleEntryArrivalTime(row)}{row._arrivalSource === "claim_registration" && <div className="text-xs text-warning" dir="auto">{t("vehicleVisit.arrivalFromClaimRegistration")}</div>}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <VehicleRearThumbnail url={rearPhotoByEntry[row.id]} alt={t("vehicleEntry.rearPhoto", { vehicle: [vehicle.brand || vehicle.make, vehicle.model].filter(Boolean).join(" ") || row.entry_number })} />
                      <div className="min-w-0">
                        <div className="font-semibold" dir="auto">{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—"}</div>
                        <div className="text-xs text-muted-foreground" dir="auto">{[vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3" dir="auto">{customer.name || "—"}<div className="text-xs text-muted-foreground" dir="ltr">{customer.phone || ""}</div></td>
                  <td className="p-3" dir="auto">{row.insurance_snapshot?.company_name || row.insurance_company?.name || "—"}</td>
                  <td className="p-3" dir="auto">{row.delivered_by?.full_name || "—"}</td>
                  <td className="p-3">{presence === "needs_review" ? t("vehicleEntry.reviewLocation") : t(presence === "in_workshop" ? "vehicleEntry.workshopTab" : "vehicleEntry.customerTab")}</td>
                  <td className="p-3">{purposeLabel(row)}</td>
                  <td className="p-3"><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{row._claimOnly ? t(`vehicleVisit.claimStatus.${row.status}`, { defaultValue: row.status }) : statusLabel(row.status)}</span></td>
                  <td className="p-3">{stageLabel(row._visitStage)}{row._reviewReason && !row._claimOnly && <div className="max-w-44 text-xs text-warning" role="status">{t(`vehicleVisit.${row._reviewReason}`, { defaultValue: row._reviewReason })}</div>}</td>
                  <td className="p-3">{row.work_order?.technician_name || row.converted_work_order?.technician_name || "—"}</td>
                  <td className="min-w-52 p-3"><VehicleCenterRowActions row={row} tab={activeTab} onOpen={openRowAction} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="vehicle-center-page min-w-0 space-y-3 md:space-y-5" dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}>
      {quickActionRow&&<Suspense fallback={<p role="status">{t('vehicleEntry.loading')}</p>}><VehicleVisitQuickActionDialog row={quickActionRow} initialAction={quickActionRow._centerAction} open onOpenChange={(open) => { if (!open) setQuickActionRow(null); }} /></Suspense>}
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t("vehicleVisit.title")}</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">{t("vehicleEntry.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => window.print()} className="hidden gap-2 sm:inline-flex"><Printer size={16} /> {t("vehicleEntry.printLoaded")}</Button>
          <Button variant="outline" onClick={() => void exportExcel()} disabled={exporting} className="hidden gap-2 sm:inline-flex">{exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {t(exporting ? "vehicleEntry.exporting" : "vehicleEntry.export")}</Button>
          <Button onClick={() => { setEntryChannel(null); setEntryPurpose(null); setChoosePurposeOpen(true); }} className="h-10 flex-1 gap-2 sm:flex-none"><Plus size={16} aria-hidden="true" /> {t("vehicleEntry.new")}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="h-10 w-10 shrink-0 sm:hidden" aria-label={t("vehicleCenterMobile.moreActions")}>
            {exporting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <MoreHorizontal size={18} aria-hidden="true" />}
          </Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="print:hidden">
            <DropdownMenuItem onSelect={() => window.print()}><Printer size={16} className="me-2" />{t("vehicleEntry.printLoaded")}</DropdownMenuItem>
            <DropdownMenuItem disabled={exporting} onSelect={() => void exportExcel()}><FileSpreadsheet size={16} className="me-2" />{t("vehicleEntry.export")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLabelToolsOpen(open => !open)}><Printer size={16} className="me-2" />{t("vehicleEntryLabels:title")}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div>
      </div>

      <Dialog open={choosePurposeOpen} onOpenChange={setChoosePurposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("vehicleEntry.choosePurpose")}</DialogTitle>
            <DialogDescription>{t("vehicleEntry.choosePurposeDescription")}</DialogDescription>
          </DialogHeader>
          <VehicleEntryStartChoices channel={entryChannel} purpose={entryPurpose}
            onChannelChange={(channel) => { setEntryChannel(channel); setEntryPurpose(null); }} onPurposeChange={startEntry} />
        </DialogContent>
      </Dialog>

      <VehicleCenterNavigation active={activeTab} counts={data?.tabs} label={tabLabel} onChange={chooseTab} />

      {activeTab === "in_workshop" && <section className="space-y-2">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t("vehicleCenterMobile.workStages")}</h2>
          {stageFilter !== "all" && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setStageFilter("all")}>{t("vehicleVisitWorkspace.allStages")}</Button>}
        </div>
      <div role="group" aria-label={t("vehicleCenterMobile.stages")} className="vehicle-center-stages grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
        {CENTER_WORK_STAGES.map((stage) => <button key={stage} type="button" aria-pressed={stageFilter === stage}
          onClick={() => setStageFilter(stage)}
          className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-start transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${stageFilter === stage ? "border-primary/60 bg-primary/5" : "border-border bg-card"}`}>
          <span className="break-words text-xs text-foreground sm:text-sm">{stageLabel(stage)}</span>
          <strong className={`text-base tabular-nums ${stageFilter === stage ? "text-primary" : "text-foreground"}`}>{stageCounts?.[stage] ?? "—"}</strong>
        </button>)}
      </div>
      </section>}
      {["with_customer", "awaiting_arrival"].includes(activeTab) && <p className="text-xs leading-relaxed text-muted-foreground">{t(activeTab === "with_customer" ? "vehicleCenterMobile.customerGuide" : "vehicleCenterMobile.pendingGuide")}</p>}

      {hasFilters && <div className="flex justify-end"><Button className="h-8 text-xs" variant="ghost" size="sm" onClick={clearFilters}>{t("vehicleCenterMobile.clearFilters")}</Button></div>}

      <Card className="min-w-0 p-3 md:p-4">
        <Collapsible open={!isMobile || filtersOpen} onOpenChange={setFiltersOpen} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 md:grid-cols-5">
          <div className="relative min-w-0 md:col-span-2">
            <Search className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input aria-label={t("vehicleVisit.search")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(isMobile ? "vehicleCenterMobile.search" : "vehicleVisit.search")} className="min-w-0 pe-9 text-sm" />
          </div>
          <CollapsibleTrigger asChild><Button variant="outline" className="h-10 gap-1.5 px-2.5 text-xs md:hidden"><Filter size={16} aria-hidden="true" />{t("vehicleCenterMobile.filters")}
            {advancedFilterCount > 0 && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{advancedFilterCount}</span>}
          </Button></CollapsibleTrigger>
          <CollapsibleContent className="col-span-2 space-y-3 md:contents md:space-y-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:col-span-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label={t("vehicleEntry.statusFilter")}><SelectValue placeholder={t("vehicleEntry.statusFilter")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("vehicleEntry.allStatuses")}</SelectItem>
              {VEHICLE_ENTRY_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
              {(["pending", "approved", "paid", "cancelled", "rejected"] as const).map((s) =>
                <SelectItem key={`claim-${s}`} value={s}>{t(`vehicleVisit.claimStatus.${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" aria-label={t("unifiedInvoices.from")} value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label={t("unifiedInvoices.to")} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="grid gap-3 md:col-span-5 md:grid-cols-2 xl:grid-cols-4">
          <Select value={technician} onValueChange={setTechnician}><SelectTrigger aria-label={t("vehicleVisit.technician")}><SelectValue placeholder={t("vehicleVisit.technician")} /></SelectTrigger><SelectContent>
            <SelectItem value="all">{t("vehicleVisit.allTechnicians")}</SelectItem>{technicians.map((name: string) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent></Select>
          <Select value={location} onValueChange={setLocation}><SelectTrigger aria-label={t("vehicleVisit.location")}><SelectValue placeholder={t("vehicleVisit.location")} /></SelectTrigger><SelectContent>
            <SelectItem value="all">{t("vehicleVisit.allLocations")}</SelectItem><SelectItem value="in_workshop">{t("vehicleEntry.workshopTab")}</SelectItem><SelectItem value="with_customer">{t("vehicleEntry.customerTab")}</SelectItem><SelectItem value="needs_review">{t("vehicleEntry.reviewLocation")}</SelectItem>
          </SelectContent></Select>
          <Input type="number" min="0" value={minDays} onChange={(event) => setMinDays(event.target.value)} placeholder={t("vehicleVisit.minDays")} aria-label={t("vehicleVisit.minDays")} />
          <div className="flex flex-wrap gap-2"><Button aria-pressed={view === "list"} variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}><List className="me-1 h-4 w-4" />{t("vehicleVisit.list")}</Button>
            <Button aria-pressed={view === "kanban"} variant={view === "kanban" ? "default" : "outline"} onClick={() => setView("kanban")}><LayoutGrid className="me-1 h-4 w-4" />{t("vehicleVisit.kanban")}</Button></div>
        </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <details className="text-xs leading-relaxed text-muted-foreground"><summary className="cursor-pointer py-1">{t("vehicleCenterMobile.help")}</summary>
        <p className="mt-2">{t(activeTab === "awaiting_arrival" ? "vehicleEntryLabels:awaitingHint" : "vehicleEntryLabels:customerHint")}</p>
        <p className="mt-1">{t("vehicleCenterUpgrade:pageHint")}</p>
        <p className="mt-1">{t("vehicleCenterUpgrade:reviewHint")}</p>
      </details>

      <Collapsible open={!isMobile || labelToolsOpen || labels.count > 0}>
        <CollapsibleContent><VehicleEntryLabelActions selection={labels} total={data?.total || 0} ready={Boolean(data && !error && !isLoading)} /></CollapsibleContent>
      </Collapsible>
      {(isMobile || view === "kanban") && rows.length > 0 && <label className="flex items-center gap-2 text-sm print:hidden"><Checkbox checked={labels.pageChecked} disabled={labels.printing} onCheckedChange={(value) => labels.togglePage(value === true)} />{t("vehicleEntryLabels:page")}</label>}

      <Card className="min-w-0 overflow-hidden" role="tabpanel" id="vehicle-entry-panel" aria-labelledby={CENTER_LOCATION_TABS.includes(activeTab) ? `vehicle-entry-tab-${activeTab}` : "vehicle-entry-secondary-label"} tabIndex={0}>
        {isLoading ? <div className="min-h-96 space-y-3 p-4 text-muted-foreground" aria-busy="true"><p role="status" className="text-center text-sm"><Loader2 className="me-2 inline h-4 w-4 animate-spin" />{t("vehicleEntry.loading")}</p><div aria-hidden="true" className="space-y-3">{Array.from({length:6},(_,index)=><div key={index} className="h-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"/>)}</div></div>
          : error ? <div role="alert" className="p-8 text-center text-destructive">{t("vehicleCenterUpgrade:unavailable")}<p className="mt-2 text-xs">{(error as Error).message}</p></div>
          : renderRows(rows)}
        {!error && !isLoading && data && <TablePaginationControls page={page} pageSize={pageSize} totalItems={data.total}
          onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </Card>

      {!error && !isLoading && data && <p className="text-sm text-muted-foreground">{t("vehicleVisit.centerCounts", { entries: data.entryCount, claims: data.claimOnlyCount })}</p>}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CarFront size={14} />
        <span>{t("vehicleEntry.noAutomaticOrder")}</span>
      </div>
    </div>
  );
}
