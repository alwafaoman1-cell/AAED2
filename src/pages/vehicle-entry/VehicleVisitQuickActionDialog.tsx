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
import { advanceVehicleVisit, getVehicleVisitDetail, getVehicleVisitNextBlocker, listVehicleVisitStaff, type PersistedVisitStage } from "@/lib/vehicleVisitLifecycle";

const STAGES: PersistedVisitStage[] = ["arrived", "approved", "in_progress", "ready", "delivered"];

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function VehicleVisitQuickActionDialog({ row, open, onOpenChange }: {
  row: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const [occurredAt, setOccurredAt] = useState(localDateTime);
  const [notes, setNotes] = useState("");
  const [requirements, setRequirements] = useState("");
  const [responsible, setResponsible] = useState(user?.id || "");
  const [customerApproved, setCustomerApproved] = useState(false);
  const [physicallyReturned, setPhysicallyReturned] = useState(false);
  const entryId = row && !row._claimOnly ? row.id as string : null;
  const detail = useQuery({
    queryKey: ["vehicle_visit", "detail", entryId],
    queryFn: () => getVehicleVisitDetail(entryId!),
    enabled: open && Boolean(entryId),
    staleTime: 0,
  });
  const staff = useQuery({
    queryKey: ["vehicle_visit", "staff"], queryFn: listVehicleVisitStaff,
    enabled: open && Boolean(entryId), staleTime: 300_000,
  });
  useEffect(() => {
    if (!open) return;
    setOccurredAt(localDateTime());
    setNotes("");
    setRequirements("");
    setResponsible(user?.id || "");
    setCustomerApproved(false);
    setPhysicallyReturned(false);
  }, [open, row?.id, user?.id]);

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
      const confirmed = await getVehicleVisitDetail(entryId);
      if (!confirmed?.workflow || confirmed.workflow.revision !== result.revision || confirmed.workflow.stage !== next) {
        throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
      }
      return confirmed;
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(["vehicle_visit", "detail", entryId], confirmed);
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
      if (!entryId || !openRelease || !physicallyReturned) throw new Error("VEHICLE_VISIT_SIGNED_RELEASE_REVIEW_REQUIRED");
      await markInspectionVehicleReturned(openRelease.id);
      const confirmed = await getVehicleVisitDetail(entryId);
      if (!confirmed || getVehicleEntryPresence(confirmed.entry) !== "in_workshop") {
        throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
      }
      return confirmed;
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(["vehicle_visit", "detail", entryId], confirmed);
      onOpenChange(false);
      void invalidate();
      toast.success(t("vehicleVisit.returnConfirmed"));
    },
    onError: (error: Error) => {
      void invalidate();
      toast.error(error.message);
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
            {visit?.reviewReason && <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">{t(`vehicleVisit.${visit.reviewReason}`, { defaultValue: visit.reviewReason })}</p>}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("vehicleVisit.changeLocation")}</h3>
              <div className="flex flex-wrap gap-2">
                {presence === "in_workshop" && entryId && hasRole("admin", "manager", "insurance", "supervisor") &&
                  <Button variant="outline" asChild><Link to={`/vehicle-entry/${entryId}/inspection-release`}>{t("vehicleVisit.temporaryExit")}</Link></Button>}
                {presence === "in_workshop" && order?.order_number &&
                  <Button variant="outline" asChild><Link to={`/work-orders/${encodeURIComponent(order.order_number)}/delivery`}>{t("vehicleVisit.finalHandover")}</Link></Button>}
                {presence === "with_customer" && openRelease && hasRole("admin", "manager", "insurance", "supervisor") &&
                  <div className="w-full space-y-2">
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={physicallyReturned} onCheckedChange={(checked) => setPhysicallyReturned(checked === true)} />{t("vehicleVisit.physicallyReturned")}</label>
                    <Button variant="outline" disabled={returnVehicle.isPending || !physicallyReturned} onClick={() => returnVehicle.mutate()}>{returnVehicle.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("vehicleVisit.recordReturn")}</Button>
                  </div>}
                {row._claimOnly && claim?.id && claim.vehicle_presence_status === "in_workshop"
                  && !claim.workshop_arrival_date && !["cancelled", "rejected", "paid"].includes(claim.status) &&
                  <Button variant="outline" asChild><Link to={`/insurance/${claim.id}?visitAction=arrival`}>{t("vehicleVisit.recordArrivalInClaim")}</Link></Button>}
                {presence === "with_customer" && !openRelease && !row._claimOnly &&
                  <p className="text-sm text-muted-foreground">{t("vehicleVisit.locationRequiresReview")}</p>}
              </div>
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
