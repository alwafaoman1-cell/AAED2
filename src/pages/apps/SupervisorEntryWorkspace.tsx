import { lazy, Suspense, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, FileSearch, LoaderCircle, MapPin, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Can from "@/components/Can";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { queryKeys } from "@/lib/queryKeys";
import { getVehicleVisitDetail } from "@/lib/vehicleVisitLifecycle";
import { buildVehicleEntryHtml, getVehicleEntry } from "@/lib/vehicleEntryService";
import { getTemplateSettingsAsync } from "@/lib/pdfGenerator";
import { downloadSanitizedPdf, openAndPrintWindow, openSanitizedPdfWindow } from "@/lib/safePdfWindow";
import "@/lib/i18n/supervisorEntry";
import "@/lib/i18n/supervisorWorkspace";
import {hasUnsavedWork} from "@/lib/unsavedWork";
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from "@/components/ui/alert-dialog";

const EntryForm = lazy(() => import("@/pages/vehicle-entry/VehicleEntryForm"));
const ReleasePage = lazy(() => import("@/pages/vehicle-entry/VehicleInspectionReleasePage"));
const TechnicalPage = lazy(() => import("@/pages/vehicle-entry/VehicleTechnicalDeclarationPage"));
const Messages = lazy(() => import("@/components/supervisor/SupervisorVisitMessages").then(m => ({ default: m.SupervisorVisitMessages })));

export default function SupervisorEntryWorkspace({ view = "form" }: { view?: "form" | "complete" | "release" | "technical" }) {
  useRealtimeSync();
  const { t, i18n } = useTranslation();
  const navigate=useNavigate();
  const [entryBusy,setEntryBusy]=useState(false);
  const [leaveOpen,setLeaveOpen]=useState(false);
  const pending=useIsMutating()>0 || entryBusy;
  const back=()=>{if(pending)return;if(hasUnsavedWork())setLeaveOpen(true);else navigate("/supervisor");};
  const loading = <p role="status" className="flex items-center justify-center gap-2 p-8 text-sm"><LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />{t("supervisorEntry:loading")}</p>;
  return <div className="min-h-dvh bg-background text-foreground" dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}>
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
        <Button variant="outline" disabled={pending} onClick={back} className="min-h-11 gap-2"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("supervisorEntry:back")}</Button>
        <p className="hidden text-sm font-semibold sm:block">{t("supervisorEntry:title")}</p>
        <LanguageSwitcher />
      </div>
    </header>
    <main className="mx-auto max-w-screen-2xl p-4 pb-16 md:p-6 [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11">
      <Can module="Vehicles" action="Create/Edit" fallback={<p role="alert">{t("supervisorEntry:denied")}</p>}>
        <Suspense fallback={loading}>
          {view === "complete" ? <SupervisorEntryReceipt /> : view === "release" ? <ReleasePage workspace="supervisor" />
            : view === "technical" ? <TechnicalPage workspace="supervisor" /> : <EntryForm workspace="supervisor" onBusyChange={setEntryBusy} />}
        </Suspense>
      </Can>
    </main>
    <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}><AlertDialogContent dir={i18n.dir()}><AlertDialogHeader>
      <AlertDialogTitle>{t("supervisorWorkspace:discardTitle")}</AlertDialogTitle><AlertDialogDescription>{t("supervisorWorkspace:discardDescription")}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>{t("supervisorWorkspace:keepEditing")}</AlertDialogCancel>
      <AlertDialogAction disabled={pending} onClick={()=>{if(!pending)navigate("/supervisor")}}>{t("supervisorWorkspace:discard")}</AlertDialogAction>
    </AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function SupervisorEntryReceipt() {
  const { id } = useParams();
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [pdfBusy, setPdfBusy] = useState(false);
  const detail = useQuery({ queryKey: [...queryKeys.vehicleEntries.detail(id),profile?.tenant_id], queryFn: () => getVehicleEntry(id!), enabled: !!id && !!profile?.tenant_id, staleTime: 0 });
  const visit = useQuery({ queryKey: ["vehicle_visit", "supervisor_receipt", profile?.tenant_id, id], queryFn: () => getVehicleVisitDetail(id!, { includeOperationalFile: false }), enabled: !!id && !!profile?.tenant_id, staleTime: 0 });
  if (detail.isLoading || visit.isLoading) return <p role="status">{t("supervisorEntry:loading")}</p>;
  if (detail.error || visit.error || !detail.data || !visit.data) return <div role="alert" className="space-y-3 text-destructive">
    <p>{t("supervisorEntry:failed")}</p><Button variant="outline" onClick={() => { void detail.refetch(); void visit.refetch(); }}>{t("supervisorEntry:retry")}</Button>
  </div>;
  const entry = detail.data;
  const vehicle = { ...entry.vehicle, ...entry.vehicle_snapshot };
  const customer = { ...entry.customer, ...entry.customer_snapshot };
  const draft = entry.status === "Draft";
  const location = visit.data.operationalStage === "delivered" ? "delivered" : visit.data.reviewReason ? "review"
    : visit.data.entry.vehicle_location === "داخل الورشة" ? "inside"
      : visit.data.entry.vehicle_location === "مع العميل" && visit.data.hasSignedTemporaryRelease ? "withCustomer" : "review";
  const base = `/supervisor/entry/${id}`;

  async function pdf(action: "preview" | "print" | "download") {
    if (pdfBusy) return;
    const preview = action === "preview" ? window.open("", "_blank") : null;
    if (action === "preview" && !preview) { toast.error(t("supervisorEntry:failed")); return; }
    if (preview) preview.opener = null;
    setPdfBusy(true);
    try {
      const [fresh] = await Promise.all([detail.refetch(), getTemplateSettingsAsync()]);
      if (fresh.error || !fresh.data) throw fresh.error || new Error(t("supervisorEntry:failed"));
      const html = buildVehicleEntryHtml(fresh.data);
      if (action === "preview" && preview) openSanitizedPdfWindow(html, preview);
      else if (action === "print") await openAndPrintWindow(html);
      else await downloadSanitizedPdf(html, fresh.data.entry_number || "vehicle-entry");
    } catch (error) {
      preview?.close();
      toast.error(error instanceof Error ? error.message : t("supervisorEntry:failed"));
    } finally { setPdfBusy(false); }
  }

  return <div className="space-y-5">
    <header className="space-y-2"><h1 className="text-xl font-bold">{t("supervisorEntry:receipt")} · <bdi>{entry.entry_number}</bdi></h1><p className="text-sm text-muted-foreground">{t("supervisorEntry:saved")}</p></header>
    {draft && <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">{t("supervisorEntry:draft")}</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <p className="text-lg font-semibold"><bdi>{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ")}</bdi> · {[vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}</p>
        <p className="text-sm">{t("supervisorEntry:customer")}: {customer.name || "—"} · <bdi>{customer.phone || "—"}</bdi></p>
        <p className="text-sm">{t("supervisorEntry:arrival")}: <bdi>{entry.arrival_date} {String(entry.arrival_time || "").slice(0, 5)}</bdi></p>
        <p className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4" aria-hidden="true" />{t("supervisorEntry:location")}: <strong>{t(`supervisorEntry:${location}`)}</strong></p>
        <p className="text-sm">{t("supervisorEntry:stage")}: <strong>{t(`vehicleVisit.${visit.data.operationalStage}`)}</strong></p>
      </Card>
      <Card className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="min-h-11" asChild><Link to={`${base}/edit`}>{t("supervisorEntry:edit")}</Link></Button>
          <Button variant="outline" className="min-h-11" asChild><Link to={`${base}/technical-declaration`}>{t("supervisorEntry:technical")}</Link></Button>
          {!draft && !["delivered", "cancelled"].includes(visit.data.operationalStage) && <Button variant="outline" className="min-h-11 whitespace-normal sm:col-span-2" asChild><Link to={`${base}/inspection-release`}>{t("supervisorEntry:temporaryExit")}</Link></Button>}
        </div>
        <p className="text-sm text-muted-foreground">{t("supervisorEntry:exitHint")}</p>
        <div className="flex flex-wrap gap-2">
          {(["preview", "print", "download"] as const).map((action) => <Button key={action} disabled={pdfBusy} variant="outline" className="min-h-11 gap-2" onClick={() => void pdf(action)}>
            {pdfBusy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : action === "preview" ? <FileSearch aria-hidden="true" className="h-4 w-4" /> : action === "print" ? <Printer aria-hidden="true" className="h-4 w-4" /> : <Download aria-hidden="true" className="h-4 w-4" />}{t(`supervisorEntry:${action}`)}
          </Button>)}
        </div>
      </Card>
    </div>
    {!draft && <Messages entryId={entry.id} />}
  </div>;
}
