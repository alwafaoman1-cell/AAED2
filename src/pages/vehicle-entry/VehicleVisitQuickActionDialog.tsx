import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getVehicleEntryPresence } from "@/lib/vehicleEntryService";
import { markInspectionVehicleReturned } from "@/lib/vehicleInspectionRelease";
import { advanceVehicleVisit, canReconcileVehicleVisitCustody, getVehicleCenterTab, getVehicleVisitDetail, getVehicleVisitNextBlocker, listVehicleVisitStaff, reconcileVehicleVisitCustody, type PersistedVisitStage } from "@/lib/vehicleVisitLifecycle";
import "@/i18n/vehicleCenterUpgrade";

const STAGES: PersistedVisitStage[] = ["arrived", "approved", "in_progress", "ready", "delivered"];

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function omanConfirmationTime() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date()).replace(" ", "T");
}

export function VehicleVisitQuickActionDialog({ row, open, onOpenChange }: {
  row: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, hasRole, profile } = useAuth();
  const qc = useQueryClient();
  const [occurredAt, setOccurredAt] = useState(localDateTime);
  const [notes, setNotes] = useState("");
  const [requirements, setRequirements] = useState("");
  const [responsible, setResponsible] = useState(user?.id || "");
  const [customerApproved, setCustomerApproved] = useState(false);
  const [physicallyReturned, setPhysicallyReturned] = useState(false);
  const [returnConfirmationTime, setReturnConfirmationTime] = useState(omanConfirmationTime);
  const [locationTarget, setLocationTarget] = useState<"in_workshop" | "with_customer" | null>(null);
  const [physicallyChecked, setPhysicallyChecked] = useState(false);
  const [custodyReason, setCustodyReason] = useState("");
  const entryId = row && !row._claimOnly ? row.id as string : null;
  const detailKey = ["vehicle_visit", "quick_detail", profile?.tenant_id, entryId];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => getVehicleVisitDetail(entryId!, { includeOperationalFile: false }),
    enabled: open && Boolean(entryId) && Boolean(profile?.tenant_id),
    staleTime: 0,
  });
  const staff = useQuery({
    queryKey: ["vehicle_visit", "staff", profile?.tenant_id], queryFn: listVehicleVisitStaff,
    enabled: open && Boolean(entryId) && Boolean(profile?.tenant_id), staleTime: 300_000,
  });
  useEffect(() => {
    if (!open) return;
    setOccurredAt(localDateTime());
    setNotes("");
    setRequirements("");
    setResponsible(user?.id || "");
    setCustomerApproved(false);
    setPhysicallyReturned(false);
    setLocationTarget(row?._registerEntry ? "in_workshop" : null);
    setReturnConfirmationTime(omanConfirmationTime());
    setPhysicallyChecked(false);
    setCustodyReason("");
  }, [open, row?.id, row?._registerEntry, user?.id]);

  const visit = detail.data;
  const entry = visit?.entry || row;
  const claim = entry?.claim || entry?.converted_claim;
  const order = entry?.work_order || entry?.converted_work_order;
  const presence = row?._claimOnly ? getVehicleEntryPresence(row) : visit ? getVehicleEntryPresence(visit.entry) : getVehicleEntryPresence(row);
  const current = visit?.workflow?.stage || (visit?.stage !== "needs_review" ? visit?.stage : null);
  const next = current ? STAGES[STAGES.indexOf(current as PersistedVisitStage) + 1] : null;
  const openRelease = visit?.releases?.find((release: any) => release.status === "signed" && !release.returned_at);
  const nextBlocker = getVehicleVisitNextBlocker(next, entry, hasRole, Boolean(visit?.hasFinalHandover));
  const canChangeStage = Boolean(next && visit && !visit.reviewReason && !nextBlocker);
  const canReconcileCustody = hasRole("admin", "manager") && canReconcileVehicleVisitCustody(visit);
  const canManageLocation = hasRole("admin", "manager", "insurance", "supervisor");
  const canReturn = Boolean(visit && !visit.reviewReason && openRelease && canManageLocation
    && getVehicleCenterTab({ ...visit, hasSignedTemporaryRelease: true }) === "with_customer");
  const presenceLabel = (value: string | null | undefined) => value === "داخل الورشة" || value === "in_workshop"
    ? t("vehicleEntry.workshopTab") : value === "مع العميل" || value === "with_customer"
      ? t("vehicleEntry.customerTab") : t("vehicleEntry.reviewLocation");

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["vehicle_visit"] }),
      qc.invalidateQueries({ queryKey: ["vehicle_entries"] }),
      qc.invalidateQueries({ queryKey: ["insurance_claims"] }),
      qc.invalidateQueries({ queryKey: ["job_orders"] }),
    ]);
  };
  const transition = useMutation({
    mutationFn: async () => {
      if (!entryId || !visit || !next) throw new Error("VEHICLE_VISIT_REVIEW_REQUIRED");
      if (next === "approved" && !claim && !customerApproved) throw new Error("VEHICLE_VISIT_CASH_APPROVAL_REQUIRED");
      const result = await advanceVehicleVisit({
        entryId,
        revision: visit.workflow?.revision ?? 0,
        stage: next,
        occurredAt: new Date(occurredAt).toISOString(),
        notes,
        reason: "",
        responsibleUserId: responsible || user?.id || "",
        requirements: { details: requirements.trim(), customer_approved: customerApproved },
      });
      const confirmed = await getVehicleVisitDetail(entryId, { includeOperationalFile: false });
      if (!confirmed?.workflow || confirmed.workflow.revision !== result.revision || confirmed.workflow.stage !== next) {
        throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
      }
      return confirmed;
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(detailKey, confirmed);
      onOpenChange(false);
      void invalidate();
      toast.success(t("vehicleVisit.saved"));
    },
    onError: (error: Error) => {
      void invalidate();
      const code = error.message?.match(/VEHICLE_VISIT_[A-Z_]+/)?.[0];
      toast.error(code ? t(`vehicleVisit.errors.${code}`, { defaultValue: error.message }) : error.message);
    },
  });
  const returnVehicle = useMutation({
    mutationFn: async () => {
      if (!entryId || !openRelease || !physicallyReturned || !canReturn) throw new Error("VEHICLE_VISIT_SIGNED_RELEASE_REVIEW_REQUIRED");
      // Re-read immediately before the existing atomic RPC. Never create a new
      // visit or rewrite an arrival to represent return from temporary custody.
      const fresh = await getVehicleVisitDetail(entryId, { includeOperationalFile: false });
      const release = fresh?.releases?.find((item: any) => item.id === openRelease.id && item.status === "signed" && !item.returned_at);
      if (!fresh || fresh.reviewReason || !release
        || getVehicleCenterTab({ ...fresh, hasSignedTemporaryRelease: true }) !== "with_customer") {
        throw new Error("VEHICLE_CENTER_RETURN_STALE");
      }
      const saved = await markInspectionVehicleReturned(release.id);
      const confirmed = await getVehicleVisitDetail(entryId, { includeOperationalFile: false });
      if (!confirmed || getVehicleEntryPresence(confirmed.entry) !== "in_workshop"
        || !confirmed.releases.some((item: any) => item.id === release.id && item.returned_at === saved.returned_at)) {
        throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
      }
      return confirmed;
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(detailKey, confirmed);
      onOpenChange(false);
      void invalidate();
      toast.success(t("vehicleVisit.returnConfirmed"));
    },
    onError: (error: Error) => {
      void invalidate();
      toast.error(t(error.message === "VEHICLE_CENTER_RETURN_STALE"
        || /vehicle_entry_location_changed|linked_claim_not_active|linked_work_order_not_active|inspection_release_not_signed/.test(error.message)
        ? "vehicleCenterUpgrade:returnStale" : "vehicleCenterUpgrade:returnFailed"));
    },
  });
  const reconcileCustody = useMutation({
    mutationFn: async () => {
      if (!entryId || !canReconcileCustody || !physicallyChecked || custodyReason.trim().length < 8) {
        throw new Error("VEHICLE_VISIT_CUSTODY_REVIEW_REQUIRED");
      }
      await reconcileVehicleVisitCustody(entryId, custodyReason);
      const confirmed = await getVehicleVisitDetail(entryId, { includeOperationalFile: false });
      if (!confirmed || getVehicleEntryPresence(confirmed.entry) !== "in_workshop" || confirmed.reviewReason === "custody_conflict") {
        throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
      }
      return confirmed;
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(detailKey, confirmed);
      onOpenChange(false);
      void invalidate();
      toast.success(t("vehicleVisit.custodySaved"));
    },
    onError: (error: Error) => {
      void invalidate();
      const code = error.message?.match(/VEHICLE_VISIT_[A-Z_]+/)?.[0];
      toast.error(code ? t(`vehicleVisit.errors.${code}`, { defaultValue: error.message }) : error.message);
    },
  });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}>
      <DialogHeader>
        <DialogTitle>{t("vehicleVisit.quickAction")} · {row?.entry_number || claim?.claim_number || row?.claim?.claim_number || "—"}</DialogTitle>
        <DialogDescription>{t("vehicleVisit.quickActionHint")}</DialogDescription>
      </DialogHeader>
      {!row ? null : detail.isLoading && entryId ? <div className="py-6 text-center text-sm"><Loader2 className="me-2 inline h-4 w-4 animate-spin" />{t("vehicleEntry.loading")}</div>
        : detail.isError ? <p role="alert" className="text-sm text-destructive">{t("vehicleEntry.loadError")}: {(detail.error as Error).message}</p>
          : <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border p-3"><div className="text-muted-foreground">{t("vehicleVisit.location")}</div><strong>{t(presence === "in_workshop" ? "vehicleEntry.workshopTab" : presence === "with_customer" ? "vehicleEntry.customerTab" : "vehicleEntry.reviewLocation")}</strong></div>
              <div className="rounded-lg border p-3"><div className="text-muted-foreground">{t("vehicleVisit.stage")}</div><strong>{t(`vehicleVisit.${visit?.operationalStage || row?._visitStage || "needs_review"}`)}</strong></div>
            </div>
            {row._claimOnly && <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">{t("vehicleVisit.claimWithoutEntryHint")}</p>}
            {visit?.reviewReason && <section role="status" className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
              <h3 className="font-semibold">{t("vehicleVisit.reviewLinksTitle")}</h3>
              <p>{t(`vehicleVisit.${visit.reviewReason}`, { defaultValue: visit.reviewReason })}</p>
              <div className="grid gap-1 sm:grid-cols-2">
                <p>{t("vehicleVisit.entry")}: <span dir="auto">{entry.entry_number || "—"}</span> · {presenceLabel(entry.vehicle_location)}</p>
                {claim && <p>{t("vehicleVisit.claim")}: <span dir="auto">{claim.claim_number || "—"}</span> · {presenceLabel(claim.vehicle_presence_status)}</p>}
                {order && <p>{t("vehicleVisit.workOrder")}: <span dir="auto">{order.order_number || "—"}</span> · {presenceLabel(order.vehicle_presence_status)}</p>}
              </div>
              <p className="text-muted-foreground">{t("vehicleVisit.reviewBlocked")}</p>
            </section>}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("vehicleVisit.changeLocation")}</h3>
              <p className="text-sm text-muted-foreground">{t("vehicleVisit.locationActionHint")}</p>
              <div role="group" aria-label={t("vehicleVisit.changeLocation")} className="grid grid-cols-2 gap-2">
                {(["in_workshop", "with_customer"] as const).map((target) =>
                  <Button key={target} type="button" variant={locationTarget === target ? "default" : "outline"}
                    aria-pressed={locationTarget === target} disabled={returnVehicle.isPending || reconcileCustody.isPending}
                    onClick={() => setLocationTarget(target)}>
                    {t(target === "in_workshop" ? "vehicleEntry.workshopTab" : "vehicleEntry.customerTab")}
                  </Button>)}
              </div>
              {locationTarget === presence && !visit?.reviewReason && !row._claimOnly &&
                <p role="status" className="text-sm text-muted-foreground">{t("vehicleVisit.locationAlreadyRecorded")}</p>}
              {locationTarget === presence && (Boolean(visit?.reviewReason) || row._claimOnly) &&
                <p role="status" className="text-sm text-warning">{t("vehicleVisit.locationNeedsFormalReview")}</p>}
              {locationTarget === "with_customer" && presence !== "with_customer" && (
                row._claimOnly || visit?.reviewReason || presence === "needs_review"
                  ? <p role="status" className="text-sm text-warning">{t("vehicleVisit.locationNeedsFormalReview")}</p>
                  : !canManageLocation
                    ? <p role="status" className="text-sm text-warning">{t("vehicleVisit.locationPermissionRequired")}</p>
                    : <div className="flex flex-wrap gap-2 rounded-lg border p-3">
                      <p className="w-full text-sm text-muted-foreground">{t("vehicleVisit.exitDocumentationRequired")}</p>
                      {entryId && <Button variant="outline" asChild><Link to={`/vehicle-entry/${entryId}/inspection-release`}>{t("vehicleVisit.temporaryExit")}</Link></Button>}
                      {order?.order_number && <Button variant="outline" asChild><Link to={`/work-orders/${encodeURIComponent(order.order_number)}/delivery`}>{t("vehicleVisit.finalHandover")}</Link></Button>}
                    </div>
              )}
              {locationTarget === "in_workshop" && presence !== "in_workshop" && (
                row._claimOnly && claim?.id && !["cancelled", "rejected"].includes(claim.status)
                  ? <Button variant="outline" asChild><Link to={`/insurance/${claim.id}?visitAction=arrival`}>{t("vehicleVisit.recordArrivalInClaim")}</Link></Button>
                  : canReturn
                    ? <div className="space-y-2 rounded-lg border p-3">
                      <p className="text-sm">{t("vehicleCenterUpgrade:returnHint")}</p>
                      <label className="block text-sm">{t("vehicleCenterUpgrade:returnTime")}<Input type="datetime-local" value={returnConfirmationTime} readOnly /></label>
                      <p className="text-xs text-muted-foreground">{t("vehicleCenterUpgrade:returnTimeHint")}</p>
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={physicallyReturned} onCheckedChange={(checked) => setPhysicallyReturned(checked === true)} />{t("vehicleVisit.physicallyReturned")}</label>
                      <Button disabled={returnVehicle.isPending || !physicallyReturned} onClick={() => { setReturnConfirmationTime(omanConfirmationTime()); returnVehicle.mutate(); }}>{returnVehicle.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("vehicleCenterUpgrade:registerEntry")}</Button>
                    </div>
                    : canReconcileCustody
                      ? <div className="space-y-3 rounded-lg border border-warning/50 p-3 text-sm">
                        <p>{t("vehicleVisit.reviewCustodyDescription")}</p>
                        <label className="flex items-center gap-2"><Checkbox checked={physicallyChecked} onCheckedChange={(checked) => setPhysicallyChecked(checked === true)} />{t("vehicleVisit.physicallyChecked")}</label>
                        <label className="block">{t("vehicleVisit.reason")}
                          <Textarea required minLength={8} maxLength={1000} value={custodyReason} onChange={(event) => setCustodyReason(event.target.value)} />
                        </label>
                        <Button type="button" disabled={reconcileCustody.isPending || !physicallyChecked || custodyReason.trim().length < 8}
                          onClick={() => reconcileCustody.mutate()}>
                          {reconcileCustody.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("vehicleVisit.confirmCustody")}
                        </Button>
                      </div>
                      : <p role="status" className="text-sm text-warning">{t(openRelease && !canManageLocation ? "vehicleVisit.locationPermissionRequired" : "vehicleVisit.locationRequiresReview")}</p>
              )}
            </div>
            {claim?.id && claim.status === "pending" && hasRole("admin", "manager", "insurance") &&
              <Button className="w-full gap-2 bg-success text-success-foreground hover:bg-success/90" asChild>
                <Link to={`/insurance/${claim.id}?visitAction=approve`}><CheckCircle2 className="h-4 w-4" />{t("vehicleVisit.approveClaim")}</Link>
              </Button>}
            {claim?.id && claim.delivered_at && hasRole("admin", "manager") &&
              <Button variant="outline" asChild><Link to={`/insurance/${claim.id}?visitAction=undoDelivery`}>{t("vehicleVisit.undoDelivery")}</Link></Button>}
            {nextBlocker && <p role="status" className="text-sm text-warning">{t(`vehicleVisit.${nextBlocker}`)}</p>}
            {canChangeStage && <form className="space-y-2 border-t pt-3" onSubmit={(event) => { event.preventDefault(); transition.mutate(); }}>
              <h3 className="text-sm font-semibold">{t("vehicleVisit.next")}: {t(`vehicleVisit.${next}`)}</h3>
              <label className="block text-sm">{t("vehicleVisit.occurredAt")}<Input type="datetime-local" required value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
              <label className="block text-sm">{t("vehicleVisit.responsible")}
                <Select value={responsible} onValueChange={setResponsible}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  {(staff.data || []).map((person) => <SelectItem key={person.user_id} value={person.user_id}>{person.full_name || person.user_id}</SelectItem>)}
                </SelectContent></Select>
              </label>
              <label className="block text-sm">{t("vehicleVisit.notes")}<Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} /></label>
              <label className="block text-sm">{t("vehicleVisit.requirements")}<Textarea value={requirements} onChange={(event) => setRequirements(event.target.value)} maxLength={2000} /></label>
              {next === "approved" && !claim && <label className="flex items-center gap-2 text-sm"><Checkbox checked={customerApproved} onCheckedChange={(checked) => setCustomerApproved(checked === true)} />{t("vehicleVisit.customerApproved")}</label>}
              <Button type="submit" disabled={transition.isPending || !responsible || !occurredAt}>{transition.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("vehicleVisit.save")}</Button>
            </form>}
            <div className="border-t pt-3 text-sm">
              <Link className="font-semibold text-primary underline" to={row._claimOnly ? `/insurance/${claim?.id}` : `/vehicle-entry/${entryId}`}>{t("vehicleVisit.openFullRecord")}</Link>
            </div>
          </div>}
    </DialogContent>
  </Dialog>;
}
