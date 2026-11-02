import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CarFront, ClipboardCheck, FileSpreadsheet, LayoutGrid, List, Loader2, Plus, Printer, Search, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getVehicleEntryPresence, getVehicleEntryVisitPurpose, vehicleEntryMatchesSearch, vehicleEntryStatusKey, VEHICLE_ENTRY_STATUSES, type VehicleEntryPresence } from "@/lib/vehicleEntryService";
import { listVehicleVisitCenter, VISIT_STAGES, type VisitStage } from "@/lib/vehicleVisitLifecycle";
import { toast } from "sonner";

export default function VehicleEntryList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const activeTab = params.get("location") === "with_customer" ? "with_customer" : "in_workshop";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [choosePurposeOpen, setChoosePurposeOpen] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stageFilter, setStageFilter] = useState<VisitStage | "all">("all");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [technician, setTechnician] = useState("all");
  const [location, setLocation] = useState("all");
  const [minDays, setMinDays] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["vehicle_visit", "center"], queryFn: listVehicleVisitCenter,
    staleTime: 30_000, refetchOnWindowFocus: true,
  });

  const loadedRows = useMemo(() => (data || []).map((visit) => ({ ...visit.entry, _visitStage: visit.stage, _reviewReason: visit.reviewReason })), [data]);
  const technicians = useMemo(() => [...new Set(loadedRows.map((row) => row.work_order?.technician_name || row.converted_work_order?.technician_name).filter(Boolean))].sort(), [loadedRows]);
  const matchingRows = useMemo(() => loadedRows.filter((row) => {
    const days = Math.max(0, Math.floor((Date.now() - Date.parse(`${row.arrival_date}T00:00:00+04:00`)) / 86_400_000));
    return vehicleEntryMatchesSearch(row, search)
      && (status === "all" || row.status === status)
      && (!from || row.arrival_date >= from) && (!to || row.arrival_date <= to)
      && (technician === "all" || (row.work_order?.technician_name || row.converted_work_order?.technician_name) === technician)
      && (location === "all" || getVehicleEntryPresence(row) === location)
      && (!minDays || days >= Number(minDays));
  }), [loadedRows, search, status, from, to, technician, location, minDays]);
  const stageCounts = useMemo(() => Object.fromEntries(VISIT_STAGES.map((stage) => [stage, matchingRows.filter((row) => row._visitStage === stage).length])) as Record<VisitStage, number>, [matchingRows]);
  const rowsByPresence = useMemo(() => {
    const groups: Record<VehicleEntryPresence, any[]> = { in_workshop: [], with_customer: [], needs_review: [] };
    matchingRows.forEach((row) => groups[row._visitStage === "needs_review" ? "needs_review" : getVehicleEntryPresence(row)].push(row));
    return groups;
  }, [matchingRows]);
  const rows = stageFilter === "all" ? rowsByPresence[activeTab] : matchingRows.filter((row) => row._visitStage === stageFilter);
  const statusLabel = (value: string) => {
    const key = vehicleEntryStatusKey(value);
    return key ? t(`vehicleEntry.statuses.${key}`) : value;
  };
  const purposeLabel = (row: any) => {
    const purpose = getVehicleEntryVisitPurpose(row);
    return t(purpose === "inspection" ? "vehicleEntry.inspectionPurpose" : purpose === "workshop" ? "vehicleEntry.workshopPurpose" : "vehicleEntry.unknownPurpose");
  };

  function chooseTab(value: string) {
    const next = new URLSearchParams(params);
    next.set("location", value);
    setParams(next);
    setStageFilter("all");
  }

  function startEntry(purpose: "workshop" | "inspection") {
    setChoosePurposeOpen(false);
    navigate(`/vehicle-entry/new?purpose=${purpose}`);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      // The dashboard query has loaded the complete (bounded) result set;
      // export the exact rows visible under stage/location and advanced filters.
      const exportMatches = rows;
      const XLSX = await import("xlsx");
      const header = [
        t("vehicleEntry.entryNumber"), t("vehicleEntry.arrival"), t("vehicleEntry.plate"),
        t("vehicleEntry.vehicle"), t("vehicleEntry.customer"), t("vehicleEntry.phone"),
        t("vehicleEntry.insurance"), t("vehicleEntry.deliveredBy"), t("vehicleEntry.location"),
        t("vehicleEntry.purpose"), t("vehicleEntry.status"), t("unifiedInvoices.claim"),
        t("vehicleEntry.workOrder"), t("vehicleEntry.issuedAt"), t("vehicleVisit.stage"), t("vehicleVisit.technician"), "VIN",
      ];
      const exportRows = exportMatches.map((row) => {
        const vehicle = row.vehicle || row.vehicle_snapshot || {};
        const customer = row.customer || row.customer_snapshot || {};
        return [
          row.entry_number,
          [row.arrival_date, String(row.arrival_time || "").slice(0, 5)].filter(Boolean).join(" "),
          [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" "),
          [vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" "),
          customer.name || "", customer.phone || "",
          row.insurance_snapshot?.company_name || row.insurance_company?.name || "",
          row.delivered_by?.full_name || "",
          t(getVehicleEntryPresence(row) === "in_workshop" ? "vehicleEntry.workshopTab" : getVehicleEntryPresence(row) === "with_customer" ? "vehicleEntry.customerTab" : "vehicleEntry.reviewLocation"),
          purposeLabel(row), statusLabel(row.status),
          row.claim?.claim_number || row.converted_claim?.claim_number || row.insurance_snapshot?.claim_number || "",
          row.work_order?.order_number || row.converted_work_order?.order_number || "", row.issued_at || "",
          t(`vehicleVisit.${row._visitStage}`), row.work_order?.technician_name || row.converted_work_order?.technician_name || "",
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
      toast.error((cause as Error)?.message || t("vehicleEntry.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  function renderRows(displayRows: any[]) {
    if (displayRows.length === 0) return <div className="p-8 text-center text-muted-foreground">{t("vehicleEntry.noMatching")}</div>;
    if (view === "kanban") {
      const stages = stageFilter === "all" ? VISIT_STAGES : [stageFilter];
      return <div className="flex snap-x gap-3 overflow-x-auto p-3">{stages.map((stage) => <section key={stage} className="min-w-[260px] max-w-[340px] flex-1 shrink-0 snap-start rounded-xl bg-muted/40 p-3">
        <h3 className="mb-3 flex justify-between gap-2 font-semibold">{t(`vehicleVisit.${stage}`)} <span>{displayRows.filter((row) => row._visitStage === stage).length}</span></h3>
        <div className="space-y-2">{displayRows.filter((row) => row._visitStage === stage).map((row) => {
          const vehicle = row.vehicle || row.vehicle_snapshot || {};
          const customer = row.customer || row.customer_snapshot || {};
          return <Link key={row.id} to={`/vehicle-entry/${row.id}`} className="block rounded-lg border border-border bg-card p-3 hover:border-primary/50">
            <div className="flex justify-between gap-2"><strong className="font-mono text-primary">{row.entry_number}</strong><span className="text-xs text-muted-foreground" dir="ltr">{row.arrival_date}</span></div>
            <div className="mt-2 font-semibold" dir="auto">{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—"}</div>
            <div className="truncate text-sm" dir="auto">{[vehicle.brand || vehicle.make, vehicle.model].filter(Boolean).join(" ")} · {customer.name || "—"}</div>
            <div className="mt-2 text-xs text-muted-foreground">{row.work_order?.order_number || row.converted_work_order?.order_number || row.claim?.claim_number || row.converted_claim?.claim_number || purposeLabel(row)}</div>
          </Link>;
        })}</div>
      </section>)}</div>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-start">
              {["entryNumber", "arrival", "vehicle", "customer", "insurance", "deliveredBy", "location", "purpose", "status"].map((key) =>
                <th key={key} className="p-3">{t(`vehicleEntry.${key}`)}</th>)}
              <th className="p-3">{t("vehicleVisit.stage")}</th>
              <th className="p-3">{t("vehicleVisit.technician")}</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const vehicle = row.vehicle || row.vehicle_snapshot || {};
              const customer = row.customer || row.customer_snapshot || {};
              const presence = getVehicleEntryPresence(row);
              return (
                <tr key={row.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-3 font-mono font-semibold text-primary"><Link to={`/vehicle-entry/${row.id}`}>{row.entry_number}</Link></td>
                  <td className="p-3 whitespace-nowrap" dir="ltr">{row.arrival_date} {String(row.arrival_time || "").slice(0, 5)}</td>
                  <td className="p-3">
                    <div className="font-semibold" dir="auto">{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—"}</div>
                    <div className="text-xs text-muted-foreground" dir="auto">{[vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}</div>
                  </td>
                  <td className="p-3" dir="auto">{customer.name || "—"}<div className="text-xs text-muted-foreground" dir="ltr">{customer.phone || ""}</div></td>
                  <td className="p-3" dir="auto">{row.insurance_snapshot?.company_name || row.insurance_company?.name || "—"}</td>
                  <td className="p-3" dir="auto">{row.delivered_by?.full_name || "—"}</td>
                  <td className="p-3">{presence === "needs_review" ? t("vehicleEntry.reviewLocation") : t(presence === "in_workshop" ? "vehicleEntry.workshopTab" : "vehicleEntry.customerTab")}</td>
                  <td className="p-3">{purposeLabel(row)}</td>
                  <td className="p-3"><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{statusLabel(row.status)}</span></td>
                  <td className="p-3">{t(`vehicleVisit.${row._visitStage}`)}</td>
                  <td className="p-3">{row.work_order?.technician_name || row.converted_work_order?.technician_name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("vehicleVisit.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("vehicleEntry.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()} className="gap-2"><Printer size={16} /> {t("vehicleEntry.printLoaded")}</Button>
          <Button variant="outline" onClick={() => void exportExcel()} disabled={exporting} className="gap-2">{exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {t(exporting ? "vehicleEntry.exporting" : "vehicleEntry.export")}</Button>
          <Button onClick={() => setChoosePurposeOpen(true)} className="gap-2"><Plus size={16} /> {t("vehicleEntry.new")}</Button>
        </div>
      </div>

      <Dialog open={choosePurposeOpen} onOpenChange={setChoosePurposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("vehicleEntry.choosePurpose")}</DialogTitle>
            <DialogDescription>{t("vehicleEntry.choosePurposeDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Button variant="outline" className="h-auto justify-start gap-3 whitespace-normal p-4 text-start" onClick={() => startEntry("workshop")}>
              <Wrench className="h-5 w-5 shrink-0" />
              <span><span className="block font-semibold">{t("vehicleEntry.workshopPurpose")}</span><span className="block text-sm font-normal text-muted-foreground">{t("vehicleEntry.workshopPurposeDescription")}</span></span>
            </Button>
            <Button variant="outline" className="h-auto justify-start gap-3 whitespace-normal p-4 text-start" onClick={() => startEntry("inspection")}>
              <ClipboardCheck className="h-5 w-5 shrink-0" />
              <span><span className="block font-semibold">{t("vehicleEntry.inspectionPurpose")}</span><span className="block text-sm font-normal text-muted-foreground">{t("vehicleEntry.inspectionPurposeDescription")}</span></span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {VISIT_STAGES.map((stage) => <button key={stage} type="button" aria-pressed={stageFilter === stage}
          onClick={() => setStageFilter(stageFilter === stage ? "all" : stage)}
          className={`rounded-xl border p-3 text-start transition-colors hover:border-primary/50 ${stageFilter === stage ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
          <span className="block text-xs text-muted-foreground">{t(`vehicleVisit.${stage}`)}</span>
          <strong className="mt-2 block text-2xl">{stageCounts[stage]}</strong>
        </button>)}
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("vehicleVisit.search")} className="pe-9" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder={t("vehicleEntry.statusFilter")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("vehicleEntry.allStatuses")}</SelectItem>
              {VEHICLE_ENTRY_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" aria-label={t("unifiedInvoices.from")} value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label={t("unifiedInvoices.to")} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Select value={technician} onValueChange={setTechnician}><SelectTrigger><SelectValue placeholder={t("vehicleVisit.technician")} /></SelectTrigger><SelectContent>
            <SelectItem value="all">{t("vehicleVisit.allTechnicians")}</SelectItem>{technicians.map((name: string) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent></Select>
          <Select value={location} onValueChange={setLocation}><SelectTrigger><SelectValue placeholder={t("vehicleVisit.location")} /></SelectTrigger><SelectContent>
            <SelectItem value="all">{t("vehicleVisit.allLocations")}</SelectItem><SelectItem value="in_workshop">{t("vehicleEntry.workshopTab")}</SelectItem><SelectItem value="with_customer">{t("vehicleEntry.customerTab")}</SelectItem><SelectItem value="needs_review">{t("vehicleEntry.reviewLocation")}</SelectItem>
          </SelectContent></Select>
          <Input type="number" min="0" value={minDays} onChange={(event) => setMinDays(event.target.value)} placeholder={t("vehicleVisit.minDays")} aria-label={t("vehicleVisit.minDays")} />
          <div className="flex gap-2"><Button variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}><List className="me-1 h-4 w-4" />{t("vehicleVisit.list")}</Button>
            <Button variant={view === "kanban" ? "default" : "outline"} onClick={() => setView("kanban")}><LayoutGrid className="me-1 h-4 w-4" />{t("vehicleVisit.kanban")}</Button></div>
        </div>
      </Card>

      <div role="tablist" aria-label={t("vehicleEntry.location")} className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-1">
        {(["in_workshop", "with_customer"] as const).map((presence) => (
          <button key={presence} type="button" role="tab" aria-selected={activeTab === presence} aria-controls={`vehicle-entry-panel-${presence}`}
            className={`rounded-md px-4 py-3 text-sm font-semibold transition-colors ${activeTab === presence ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => chooseTab(presence)}>
            {t(presence === "in_workshop" ? "vehicleEntry.workshopTab" : "vehicleEntry.customerTab")}
            <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs">{rowsByPresence[presence].length}</span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden" role="tabpanel" id={`vehicle-entry-panel-${activeTab}`}>
        {isLoading ? <div className="p-8 text-center text-muted-foreground"><Loader2 className="me-2 inline h-4 w-4 animate-spin" />{t("vehicleEntry.loading")}</div>
          : error ? <div className="p-8 text-center text-destructive">{t("vehicleEntry.loadError")}: {(error as Error).message}</div>
          : renderRows(rows)}
      </Card>

      {!error && !isLoading && stageFilter === "all" && rowsByPresence.needs_review.length > 0 && (
        <Card className="border-warning/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-warning">{t("vehicleEntry.reviewLocation")} ({rowsByPresence.needs_review.length})</h2>
              <p className="text-sm text-muted-foreground">{t("vehicleEntry.reviewDescription")}</p>
            </div>
            <Button variant="outline" onClick={() => setShowReview((previous) => !previous)}>{t(showReview ? "vehicleEntry.hideReview" : "vehicleEntry.showReview")}</Button>
          </div>
          {showReview && <div className="mt-4">{renderRows(rowsByPresence.needs_review)}</div>}
        </Card>
      )}

      {!error && !isLoading && <p className="text-sm text-muted-foreground">{t("vehicleVisit.loadedCount", { count: matchingRows.length })}</p>}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CarFront size={14} />
        <span>{t("vehicleEntry.noAutomaticOrder")}</span>
      </div>
    </div>
  );
}
