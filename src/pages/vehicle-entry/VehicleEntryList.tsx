import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CarFront, FileSpreadsheet, LayoutGrid, List, Loader2, MapPin, Plus, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getVehicleEntryPresence, getVehicleEntryVisitPurpose, vehicleEntryStatusKey, VEHICLE_ENTRY_STATUSES } from "@/lib/vehicleEntryService";
import { listAllMatchingVehicleCenter, listVehicleVisitCenterPage, VEHICLE_CENTER_TABS, VISIT_STAGES, type VehicleCenterFilters, type VehicleCenterTab, type VisitStage } from "@/lib/vehicleVisitLifecycle";
import { TablePaginationControls } from "@/components/ui/table-pagination-controls";
import "@/i18n/vehicleCenterUpgrade";
import { getEntryRearThumbnailUrls } from "@/lib/vehicleRearThumbnails";
import { VehicleRearThumbnail } from "@/components/vehicles/VehicleRearThumbnail";
import { VehicleVisitQuickActionDialog } from "./VehicleVisitQuickActionDialog";
import { VehicleEntryStartChoices } from "@/components/vehicle-entry/VehicleEntryStartChoices";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { VehicleEntryInspectionAction } from "@/components/vehicle-entry/VehicleEntryInspectionAction";

export default function VehicleEntryList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { profile, hasRole } = useAuth();
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
  const [quickActionRow, setQuickActionRow] = useState<any | null>(null);
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const [pageSize, setPageSize] = useState(30);
  const filters: VehicleCenterFilters = useMemo(() => ({
    search: search.trim(), status, from, to, technician,
    location: location as VehicleCenterFilters["location"],
    minDays: Math.max(0, Math.floor(Number(minDays) || 0)), stage: stageFilter,
  }), [search, status, from, to, technician, location, minDays, stageFilter]);
  const scopeKey = JSON.stringify([profile?.tenant_id, activeTab, filters, pageSize]);
  const page = pageState.key === scopeKey ? pageState.page : 1;
  const setPage = (value: number) => setPageState({ key: scopeKey, page: value });
  const { data, isLoading, error } = useQuery({
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
    ...visit.entry, _visitStage: visit.operationalStage, _reviewReason: visit.reviewReason,
    _canRegisterEntry: activeTab === "with_customer" && visit.hasSignedTemporaryRelease && !visit.reviewReason,
  })), [data, activeTab]);
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

  function chooseTab(value: string) {
    const next = new URLSearchParams(params);
    next.set("location", value);
    setParams(next);
    setStageFilter("all");
  }

  const tabLabel = (tab: VehicleCenterTab) => t(tab === "in_workshop" ? "vehicleEntry.workshopTab"
    : tab === "with_customer" ? "vehicleEntry.customerTab"
      : `vehicleCenterUpgrade:${tab === "needs_review" ? "reviewTab" : `${tab}Tab`}`);

  function registerEntryAction(row: any) {
    if (!row._canRegisterEntry || !hasRole("admin", "manager", "insurance", "supervisor")) return null;
    return <Button className="mt-2 h-auto min-h-9 w-full gap-2 whitespace-normal" size="sm"
      aria-label={t("vehicleCenterUpgrade:registerEntryFor", { number: row.entry_number })}
      onClick={() => setQuickActionRow({ ...row, _registerEntry: true })}>
      <Plus className="h-4 w-4" aria-hidden="true" />{t("vehicleCenterUpgrade:registerEntry")}
    </Button>;
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
        t("vehicleEntry.entryNumber"), t("vehicleVisit.recordType"), t("vehicleEntry.arrival"), t("vehicleEntry.plate"),
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
          [row.arrival_date, String(row.arrival_time || "").slice(0, 5)].filter(Boolean).join(" "),
          [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" "),
          [vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" "),
          customer.name || "", customer.phone || "",
          row.insurance_snapshot?.company_name || row.insurance_company?.name || "",
          row.delivered_by?.full_name || "",
          t(getVehicleEntryPresence(row) === "in_workshop" ? "vehicleEntry.workshopTab" : getVehicleEntryPresence(row) === "with_customer" ? "vehicleEntry.customerTab" : "vehicleEntry.reviewLocation"),
          purposeLabel(row), row._claimOnly ? t(`vehicleVisit.claimStatus.${row.status}`, { defaultValue: row.status }) : statusLabel(row.status),
          row.claim?.claim_number || row.converted_claim?.claim_number || row.insurance_snapshot?.claim_number || "",
          row.work_order?.order_number || row.converted_work_order?.order_number || "", row.issued_at || "",
          t(`vehicleVisit.${row._visitStage}`), row.work_order?.technician_name || row.converted_work_order?.technician_name || "",
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
    if (view === "kanban") {
      const stages = stageFilter === "all" || stageFilter === "needs_review" ? VISIT_STAGES : [stageFilter];
      return <div className="flex min-w-0 snap-x gap-3 overflow-x-auto p-3">{stages.map((stage) => <section key={stage} className="min-w-[260px] max-w-[340px] flex-1 shrink-0 snap-start rounded-xl bg-muted/40 p-3">
        <h3 className="mb-3 flex justify-between gap-2 font-semibold">{t(`vehicleVisit.${stage}`)} <span>{stageCounts?.[stage] ?? "—"}</span></h3>
        <div className="space-y-2">{displayRows.filter((row) => row._visitStage === stage).map((row) => {
          const vehicle = row.vehicle || row.vehicle_snapshot || {};
          const customer = row.customer || row.customer_snapshot || {};
          return <div key={row.id} className="min-w-0 rounded-lg border border-border bg-card p-3 hover:border-primary/50">
            <div className="flex flex-wrap justify-between gap-2"><Link to={row._claimOnly ? `/insurance/${row.claim.id}` : `/vehicle-entry/${row.id}`} className="min-w-0 break-all font-mono font-semibold text-primary hover:underline">{row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard")}</Link><span className="text-xs text-muted-foreground" dir="ltr">{row.arrival_date || "—"}</span></div>
            {row._claimOnly && <div className="mt-1 text-xs text-warning">{t("vehicleVisit.claimOnlyCard")}{row._arrivalSource === "claim_registration" ? ` · ${t("vehicleVisit.arrivalFromClaimRegistration")}` : ""}</div>}
            {row._reviewReason && !row._claimOnly && <div className="mt-1 text-xs text-warning" role="status">{t(`vehicleVisit.${row._reviewReason}`, { defaultValue: row._reviewReason })}</div>}
            <div className="mt-2 flex items-center gap-2">
              <VehicleRearThumbnail url={rearPhotoByEntry[row.id]} alt={t("vehicleEntry.rearPhoto", { vehicle: [vehicle.brand || vehicle.make, vehicle.model].filter(Boolean).join(" ") || row.entry_number })} />
              <div className="min-w-0">
                <div className="font-semibold" dir="auto">{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—"}</div>
                <div className="truncate text-sm" dir="auto">{[vehicle.brand || vehicle.make, vehicle.model].filter(Boolean).join(" ")} · {customer.name || "—"}</div>
              </div>
            </div>
            <div className="mt-2 break-words text-xs text-muted-foreground">{row.work_order?.order_number || row.converted_work_order?.order_number || row.claim?.claim_number || row.converted_claim?.claim_number || purposeLabel(row)}</div>
            <Button aria-label={`${t("vehicleVisit.manageLocationAndStage")} · ${row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard")}`} className="mt-2 h-auto min-h-9 w-full gap-2 whitespace-normal" variant="outline" size="sm" onClick={() => setQuickActionRow(row)}><MapPin className="h-4 w-4" aria-hidden="true" />{t("vehicleVisit.manageLocationAndStage")}</Button>
            {registerEntryAction(row)}
            <div className="mt-2"><VehicleEntryInspectionAction entry={row} /></div>
          </div>;
        })}</div>
      </section>)}</div>;
    }
    if (isMobile) return <div className="grid min-w-0 gap-3 p-3">{displayRows.map((row) => {
      const vehicle = row.vehicle || row.vehicle_snapshot || {};
      const customer = row.customer || row.customer_snapshot || {};
      const presence = getVehicleEntryPresence(row);
      const recordUrl = row._claimOnly ? `/insurance/${row.claim.id}` : `/vehicle-entry/${row.id}`;
      return <article key={row.id} className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Link to={recordUrl} className="break-all font-mono font-semibold text-primary hover:underline">{row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard")}</Link>
          <span className="text-xs text-muted-foreground" dir="ltr">{row.arrival_date || "—"} {String(row.arrival_time || "").slice(0, 5)}</span>
        </div>
        {row._arrivalSource === "claim_registration" && <p className="text-xs text-warning">{t("vehicleVisit.arrivalFromClaimRegistration")}</p>}
        <div className="mt-3 flex items-center gap-3">
          <VehicleRearThumbnail url={rearPhotoByEntry[row.id]} alt={t("vehicleEntry.rearPhoto", { vehicle: [vehicle.brand || vehicle.make, vehicle.model].filter(Boolean).join(" ") || row.entry_number })} />
          <div className="min-w-0"><div className="font-semibold" dir="auto">{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—"}</div>
            <div className="truncate text-sm text-muted-foreground" dir="auto">{[vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "—"}</div></div>
        </div>
        <p className="mt-2 truncate text-sm" dir="auto">{customer.name || "—"}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">{t(`vehicleVisit.${row._visitStage}`)}</span>
          <span className="rounded-full bg-muted px-2 py-1">{t(presence === "in_workshop" ? "vehicleEntry.workshopTab" : presence === "with_customer" ? "vehicleEntry.customerTab" : "vehicleEntry.reviewLocation")}</span>
          <span className="rounded-full bg-muted px-2 py-1">{row._claimOnly ? t(`vehicleVisit.claimStatus.${row.status}`, { defaultValue: row.status }) : statusLabel(row.status)}</span>
        </div>
        {row._reviewReason && <p role="status" className="mt-2 text-xs text-warning">{t(`vehicleVisit.${row._reviewReason}`, { defaultValue: row._reviewReason })}</p>}
        <details className="mt-2 rounded-lg border border-border p-2 text-xs"><summary className="cursor-pointer font-medium">{t("vehicleVisit.operationalFile")}</summary>
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 break-words text-muted-foreground">
            <span>{t("vehicleEntry.insurance")}: {row.insurance_snapshot?.company_name || row.insurance_company?.name || "—"}</span>
            <span>{t("vehicleEntry.deliveredBy")}: {row.delivered_by?.full_name || "—"}</span>
            <span>{t("vehicleEntry.purpose")}: {purposeLabel(row)}</span>
            <span>{t("vehicleVisit.technician")}: {row.work_order?.technician_name || row.converted_work_order?.technician_name || "—"}</span>
            <span className="col-span-2">{t("vehicleEntry.workOrder")}: {row.work_order?.order_number || row.converted_work_order?.order_number || "—"}</span>
          </div>
        </details>
        <Button aria-label={`${t("vehicleVisit.manageLocationAndStage")} · ${row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard")}`} className="mt-3 h-auto min-h-9 w-full gap-2 whitespace-normal" size="sm" variant="outline" onClick={() => setQuickActionRow(row)}><MapPin className="h-4 w-4" aria-hidden="true" />{t("vehicleVisit.manageLocationAndStage")}</Button>
        {registerEntryAction(row)}
        <div className="mt-2"><VehicleEntryInspectionAction entry={row} /></div>
      </article>;
    })}</div>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-start">
              {["entryNumber", "arrival", "vehicle", "customer", "insurance", "deliveredBy", "location", "purpose", "status"].map((key) =>
                <th key={key} scope="col" className="p-3 text-start">{t(`vehicleEntry.${key}`)}</th>)}
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
                  <td className="p-3 font-mono font-semibold text-primary"><Link to={row._claimOnly ? `/insurance/${row.claim.id}` : `/vehicle-entry/${row.id}`}>{row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard")}</Link>{row._claimOnly && <div className="text-xs font-normal text-warning">{t("vehicleVisit.claimOnlyCard")}</div>}</td>
                  <td className="p-3 whitespace-nowrap" dir="ltr">{row.arrival_date || "—"} {String(row.arrival_time || "").slice(0, 5)}{row._arrivalSource === "claim_registration" && <div className="text-xs text-warning" dir="auto">{t("vehicleVisit.arrivalFromClaimRegistration")}</div>}</td>
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
                  <td className="p-3">{t(`vehicleVisit.${row._visitStage}`)}{row._reviewReason && !row._claimOnly && <div className="max-w-44 text-xs text-warning" role="status">{t(`vehicleVisit.${row._reviewReason}`, { defaultValue: row._reviewReason })}</div>}</td>
                  <td className="p-3">{row.work_order?.technician_name || row.converted_work_order?.technician_name || "—"}</td>
                  <td className="p-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" aria-label={`${t("vehicleVisit.manageLocationAndStage")} · ${row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard")}`} className="gap-2 whitespace-nowrap" onClick={() => setQuickActionRow(row)}><MapPin className="h-4 w-4" aria-hidden="true" />{t("vehicleVisit.manageLocationAndStage")}</Button>{registerEntryAction(row)}<VehicleEntryInspectionAction entry={row} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-5" dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}>
      <VehicleVisitQuickActionDialog row={quickActionRow} open={Boolean(quickActionRow)} onOpenChange={(open) => { if (!open) setQuickActionRow(null); }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("vehicleVisit.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("vehicleEntry.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()} className="gap-2"><Printer size={16} /> {t("vehicleEntry.printLoaded")}</Button>
          <Button variant="outline" onClick={() => void exportExcel()} disabled={exporting} className="gap-2">{exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {t(exporting ? "vehicleEntry.exporting" : "vehicleEntry.export")}</Button>
          <Button onClick={() => { setEntryChannel(null); setEntryPurpose(null); setChoosePurposeOpen(true); }} className="gap-2"><Plus size={16} /> {t("vehicleEntry.new")}</Button>
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {VISIT_STAGES.map((stage) => <button key={stage} type="button" aria-pressed={stageFilter === stage}
          onClick={() => setStageFilter(stageFilter === stage ? "all" : stage)}
          className={`rounded-xl border p-3 text-start transition-colors hover:border-primary/50 ${stageFilter === stage ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
          <span className="block text-xs text-muted-foreground">{t(`vehicleVisit.${stage}`)}</span>
          <strong className="mt-2 block text-2xl">{stageCounts?.[stage] ?? "—"}</strong>
        </button>)}
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input aria-label={t("vehicleVisit.search")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("vehicleVisit.search")} className="pe-9" />
          </div>
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
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
      </Card>

      <div role="tablist" aria-label={t("vehicleEntry.location")} className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-1 sm:grid-cols-5"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const direction = (event.key === "ArrowRight" ? 1 : -1) * (i18n.language.startsWith("ar") ? -1 : 1);
          const next = event.key === "Home" ? VEHICLE_CENTER_TABS[0] : event.key === "End" ? VEHICLE_CENTER_TABS[VEHICLE_CENTER_TABS.length - 1]
            : VEHICLE_CENTER_TABS[(VEHICLE_CENTER_TABS.indexOf(activeTab) + direction + VEHICLE_CENTER_TABS.length) % VEHICLE_CENTER_TABS.length];
          chooseTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#vehicle-entry-tab-${next}`)?.focus();
        }}>
        {VEHICLE_CENTER_TABS.map((presence) => (
          <button key={presence} id={`vehicle-entry-tab-${presence}`} type="button" role="tab" aria-selected={activeTab === presence} aria-controls="vehicle-entry-panel" tabIndex={activeTab === presence ? 0 : -1}
            className={`rounded-md px-4 py-3 text-sm font-semibold transition-colors ${activeTab === presence ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => chooseTab(presence)}>
            {tabLabel(presence)}
            <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs">{data?.tabs[presence] ?? "—"}</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("vehicleCenterUpgrade:tabsHint")}</p>
      <p className="text-xs text-muted-foreground">{t("vehicleCenterUpgrade:pageHint")}</p>

      <Card className="min-w-0 overflow-hidden" role="tabpanel" id="vehicle-entry-panel" aria-labelledby={`vehicle-entry-tab-${activeTab}`} tabIndex={0}>
        {isLoading ? <div className="p-8 text-center text-muted-foreground"><Loader2 className="me-2 inline h-4 w-4 animate-spin" />{t("vehicleEntry.loading")}</div>
          : error ? <div role="alert" className="p-8 text-center text-destructive">{t("vehicleCenterUpgrade:unavailable")}<p className="mt-2 text-xs">{(error as Error).message}</p></div>
          : renderRows(rows)}
        {!error && !isLoading && data && <TablePaginationControls page={page} pageSize={pageSize} totalItems={data.total}
          onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </Card>

      {!error && !isLoading && activeTab !== "needs_review" && Boolean(data?.tabs.needs_review) && (
        <Card className="border-warning/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-warning">{t("vehicleEntry.reviewLocation")} ({data?.tabs.needs_review})</h2>
              <p className="text-sm text-muted-foreground">{t("vehicleCenterUpgrade:reviewHint")}</p>
            </div>
            <Button variant="outline" onClick={() => chooseTab("needs_review")}>{t("vehicleEntry.showReview")}</Button>
          </div>
        </Card>
      )}

      {!error && !isLoading && data && <p className="text-sm text-muted-foreground">{t("vehicleVisit.centerCounts", { entries: data.entryCount, claims: data.claimOnlyCount })}</p>}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CarFront size={14} />
        <span>{t("vehicleEntry.noAutomaticOrder")}</span>
      </div>
    </div>
  );
}
