import { useState } from "react";
import { Link } from "react-router-dom";
import { VehicleEntryInspectionAction } from "@/components/vehicle-entry/VehicleEntryInspectionAction";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ClipboardList, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryKeys } from "@/lib/queryKeys";
import { confirmVehicleEntryWorkOrderLink } from "@/lib/vehicleEntryService";
import "@/lib/i18n/vehicleEntryLinks";
import {hasConfirmedVehicleEntryWorkOrderLink} from "@/lib/vehicleEntryWorkOrderLink";
import { supabase } from "@/integrations/supabase/client";
import type { VehicleVisitTransition } from "@/lib/vehicleVisitLifecycle";
import "@/lib/i18n/supervisorWorkspace";
import { advanceVehicleVisit, canReconcileVehicleVisitCustody, getVehicleVisitBillingKind, getVehicleVisitDetail, getVehicleVisitDocumentUrl, getVehicleVisitNextBlocker, getVehicleVisitReverseBlocker, listVehicleVisitStaff, reconcileVehicleVisitCustody, type PersistedVisitStage, type VisitStage } from "@/lib/vehicleVisitLifecycle";

const ORDER: PersistedVisitStage[] = ["arrived", "approved", "in_progress", "ready", "delivered"];
function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function VehicleVisitControlPanel({ entryId, supervisor = false, onRequestWorkOrderStatus, onRequestHandover }: {
  entryId: string;
  supervisor?: boolean;
  onRequestWorkOrderStatus?: () => void;
  onRequestHandover?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, profile, hasRole } = useAuth();
  const qc = useQueryClient();
  const [target, setTarget] = useState<PersistedVisitStage | null>(null);
  const [occurredAt, setOccurredAt] = useState(localDateTime);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [requirements, setRequirements] = useState("");
  const [responsible, setResponsible] = useState(user?.id || "");
  const [customerApproved, setCustomerApproved] = useState(false);
  const [custodyOpen, setCustodyOpen] = useState(false);
  const [custodyReason, setCustodyReason] = useState("");
  const [physicallyChecked, setPhysicallyChecked] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Separate cache identity prevents an existing full operational-file query
  // from injecting invoice/expense data into the tablet's lightweight view.
  const readDetail = () => supervisor ? getVehicleVisitDetail(entryId, { includeOperationalFile: false }) : getVehicleVisitDetail(entryId);
  const detailKey = supervisor ? ["vehicle_visit", "detail", entryId, "supervisor", profile?.tenant_id] : ["vehicle_visit", "detail", entryId];
  const detail = useQuery({ queryKey: detailKey, queryFn: readDetail, staleTime: 5_000, refetchOnWindowFocus: "always" });
  const staff = useQuery({ queryKey: ["vehicle_visit", "staff", profile?.tenant_id], queryFn: listVehicleVisitStaff, staleTime: 300_000 });
  const visit = detail.data;
  const entry = visit?.entry;
  const claim = entry?.claim || entry?.converted_claim;
  const order = entry?.work_order || entry?.converted_work_order;
  const safeOrderLink=hasConfirmedVehicleEntryWorkOrderLink(entry,order);
  const billingKind = getVehicleVisitBillingKind(entry);
  // Older, consistent visits remain read-only until an explicit user action;
  // the RPC then creates their first workflow event transactionally.
  const current = visit?.workflow?.stage || (visit?.stage !== "needs_review" ? visit?.stage : undefined);
  // Lightweight detail deliberately omits history. Load only transition rows
  // when expanded (or to recover the previous stage of a cancelled visit).
  const historyQuery = useQuery({
    queryKey: ["vehicle_visit", "transitions", entryId, profile?.tenant_id],
    enabled: supervisor && Boolean(profile?.tenant_id) && (historyOpen || current === "cancelled"),
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicle_visit_transitions").select("*")
        .eq("tenant_id", profile!.tenant_id).eq("entry_id", entryId).order("revision", { ascending: false }).limit(500);
      if (error) throw error;
      return (data || []) as VehicleVisitTransition[];
    }, staleTime: 5_000,
  });
  const transitions = supervisor ? historyQuery.data || [] : visit?.transitions || [];
  const next = current ? ORDER[ORDER.indexOf(current) + 1] : undefined;
  const previous = current === "cancelled"
    ? transitions[0]?.from_stage || undefined
    : current ? ORDER[ORDER.indexOf(current) - 1] : undefined;
  const canManage = hasRole("admin", "manager");
  const canConfirmExistingOrder=canManage && visit?.reviewReason==="work_order_link_conflict"
    && entry?.__inferredOrderLink && order?.id && order.vehicle_id===entry.vehicle_id
    && order.work_order_type==="insurance" && order.claim_id===(entry.insurance_claim_id || entry.converted_claim_id)
    && (!order.vehicle_entry_id || order.vehicle_entry_id===entryId)
    && !entry.work_order_id && !entry.converted_work_order_id;
  const canAdvance = !visit?.reviewReason && Boolean(current) && current !== "cancelled" && current !== "delivered";
  const nextBlocker = getVehicleVisitNextBlocker(next, entry, hasRole, Boolean(visit?.hasFinalHandover));
  const reverseBlocker = getVehicleVisitReverseBlocker(previous, visit);
  const prerequisiteHref = supervisor ? `/supervisor/entry/${encodeURIComponent(entryId)}/complete` : nextBlocker === "claimApprovalRequired" && claim?.id ? `/insurance/${claim.id}`
    : ["cashWorkOrderRequired", "workOrderRequired", "workshopPresenceRequired"].includes(nextBlocker || "") ? `/vehicle-entry/${entryId}`
    : ["workOrderStatusInvalid", "finishWorkFirst"].includes(nextBlocker || "") && order?.order_number
      ? `/work-orders/${encodeURIComponent(order.order_number)}` : null;
  const cancelBlocker = claim && !["cancelled", "rejected"].includes(claim.status)
    ? "cancelClaimFirst" : order && order.status !== "delivered" ? "closeWorkOrderFirst" : null;
  const canReconcileCustody = canManage && canReconcileVehicleVisitCustody(visit);

  const displayError = (error: Error) => {
    const code = error.message?.match(/VEHICLE_VISIT_[A-Z_]+/)?.[0];
    if(code === "VEHICLE_VISIT_REVERSE_SOURCE_FIRST") return t("supervisorWorkspace:reverseSourceFirst");
    return code ? t(`vehicleVisit.errors.${code}`, { defaultValue: error.message }) : error.message || t("vehicleVisit.saveFailed");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!visit || !target) throw new Error("VEHICLE_VISIT_REVIEW_REQUIRED");
      const result = await advanceVehicleVisit({
        entryId,
        revision: visit.workflow?.revision ?? 0,
        stage: target,
        occurredAt: new Date(occurredAt).toISOString(),
        notes,
        reason,
        responsibleUserId: responsible || user?.id || "",
        requirements: { details: requirements.trim(), customer_approved: customerApproved },
      });
      const confirmed = await readDetail();
      if (!confirmed?.workflow || confirmed.workflow.revision !== result.revision || confirmed.workflow.stage !== result.stage) {
        throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
      }
      return confirmed;
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(detailKey, confirmed);
      void qc.invalidateQueries({ queryKey: ["vehicle_visit", "transitions", entryId] });
      void qc.invalidateQueries({ queryKey: ["vehicle_visit", "center"] });
      void qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.all });
      void qc.invalidateQueries({ queryKey: ["job_orders"] });
      void qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      setTarget(null);
      setNotes(""); setReason(""); setRequirements(""); setCustomerApproved(false);
      toast.success(t("vehicleVisit.saved"));
    },
    onError: (error: Error) => {
      void qc.invalidateQueries({ queryKey: ["vehicle_visit", "detail", entryId] });
      void qc.invalidateQueries({ queryKey: ["vehicle_visit", "center"] });
      toast.error(displayError(error));
    },
  });

  const custodyMutation = useMutation({
    mutationFn: async () => {
      if (!physicallyChecked || custodyReason.trim().length < 8) throw new Error("VEHICLE_VISIT_REASON_REQUIRED");
      await reconcileVehicleVisitCustody(entryId, custodyReason);
      const confirmed = await readDetail();
      if (!confirmed || confirmed.reviewReason === "custody_conflict") throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
      return confirmed;
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(detailKey, confirmed);
      void qc.invalidateQueries({ queryKey: ["vehicle_visit", "center"] });
      void qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.all });
      setCustodyOpen(false); setCustodyReason(""); setPhysicallyChecked(false);
      toast.success(t("vehicleVisit.custodySaved"));
    },
    onError: (error: Error) => toast.error(displayError(error)),
  });

  const linkMutation=useMutation({
    mutationFn:async()=>{
      if(!canConfirmExistingOrder || !entry.updated_at) throw new Error(t("vehicleEntryLinks.VEHICLE_ENTRY_LINK_STALE"));
      await confirmVehicleEntryWorkOrderLink(entryId,order.id,entry.updated_at);
      const fresh=await readDetail();
      if(!fresh || fresh.entry.work_order_id!==order.id || fresh.entry.converted_work_order_id!==order.id
        || fresh.reviewReason==="work_order_link_conflict") throw new Error(t("vehicleEntryLinks.failed"));
      return fresh;
    },
    onSuccess:(fresh)=>{
      qc.setQueryData(detailKey,fresh);
      for(const key of [queryKeys.vehicleEntries.all,["vehicle_visit","center"],["job_orders"],["insurance_claims"]])
        void qc.invalidateQueries({queryKey:key});
      toast.success(t("vehicleEntryLinks.confirmed"));
    },
    onError:(error:Error)=>{void qc.invalidateQueries({queryKey:["vehicle_visit","detail",entryId]});toast.error(error.message);},
  });

  async function openDocument(fileId: string) {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await getVehicleVisitDocumentUrl(fileId);
      if (tab) tab.location.href = url;
      else toast.error(t("vehicleVisit.openDocumentBlocked"));
    } catch (error) {
      tab?.close();
      toast.error((error as Error).message);
    }
  }

  if (detail.isLoading) return <Card className="p-4 text-sm text-muted-foreground"><Loader2 className="me-2 inline h-4 w-4 animate-spin" />{t("vehicleEntry.loading")}</Card>;
  if (detail.isError || !visit) return <Card className="p-4 text-sm text-destructive">{t("vehicleEntry.loadError")}: {(detail.error as Error)?.message}</Card>;

  const stageLabel = (stage: VisitStage | null | undefined) => stage ? t(`vehicleVisit.${stage}`) : "—";
  const presenceLabel = (presence: string | null | undefined) => presence === "داخل الورشة" || presence === "in_workshop"
    ? t("vehicleEntry.workshopTab") : presence === "مع العميل" || presence === "with_customer"
      ? t("vehicleEntry.customerTab") : presence || "—";
  const refs = supervisor ? [
    { label: t("vehicleVisit.entry"), value: entry.entry_number, href: `/supervisor/entry/${encodeURIComponent(entryId)}/complete` },
    { label: t("vehicleVisit.claim"), value: claim?.claim_number, href: "" },
    { label: t("vehicleVisit.workOrder"), value: safeOrderLink ? order?.order_number : "", href: "" },
  ] : [
    { label: t("vehicleVisit.entry"), value: entry.entry_number, href: `/vehicle-entry/${entryId}` },
    { label: t("vehicleVisit.claim"), value: claim?.claim_number, href: claim?.id ? `/insurance/${claim.id}` : "" },
    { label: t("vehicleVisit.workOrder"), value: order?.order_number, href: safeOrderLink && order?.order_number ? `/work-orders/${encodeURIComponent(order.order_number)}` : "" },
    { label: t("vehicleVisit.documents"), value: String((entry.vehicle_entry_documents?.length || 0) + visit.documents.length), href: `/vehicle-entry/${entryId}` },
    { label: t("vehicleVisit.photos"), value: String(visit.mediaCount), href: `/vehicle-entry/${entryId}` },
    { label: t("vehicleVisit.expenses"), value: String(visit.expenses.length), href: safeOrderLink && order?.order_number ? `/work-orders/${encodeURIComponent(order.order_number)}` : "" },
    { label: t("vehicleVisit.cashInvoices"), value: String(visit.cashInvoices.length), href: visit.cashInvoices[0]?.id ? `/sales/invoices/${visit.cashInvoices[0].id}` : "" },
    { label: t("vehicleVisit.insuranceInvoices"), value: String(visit.insuranceInvoices.length), href: claim?.id ? `/insurance/${claim.id}` : "" },
    { label: t("vehicleVisit.handover"), value: visit.handovers.find((row: any) => row.status === "finalized" && row.work_order_id === order?.id)?.receipt_number || "—", href: safeOrderLink && order?.order_number ? `/work-orders/${encodeURIComponent(order.order_number)}/delivery` : "" },
  ];

  return <Card className={`space-y-4 p-4 ${supervisor ? "[&_button]:min-h-11 [&_input]:min-h-11 [&_summary]:min-h-11 [&_select]:min-h-11" : ""}`} dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold"><ClipboardList className="h-5 w-5" />{t("vehicleVisit.operationalFile")}</h2>
        <p className="text-sm text-muted-foreground">{t("vehicleVisit.subtitle")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{stageLabel(visit.operationalStage)}</Badge>
        {visit.reviewReason && <Badge variant="destructive">{stageLabel("needs_review")}</Badge>}
      </div>
    </div>
    <p className="text-sm text-muted-foreground">{t(billingKind === "insurance" ? "vehicleVisit.insuranceFlow" : "vehicleVisit.cashFlow")}</p>
    {visit.reviewReason && <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm text-warning"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{t(`vehicleVisit.${visit.reviewReason}`, { defaultValue: visit.reviewReason })}</div>}
    {canConfirmExistingOrder && <Button variant="outline" disabled={linkMutation.isPending} onClick={()=>linkMutation.mutate()}>
      {linkMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true"/>}{t("vehicleEntryLinks.confirm")} · <bdi className="ms-1">{order.order_number}</bdi>
    </Button>}
    {canReconcileCustody && <Button variant="outline" onClick={() => setCustodyOpen(true)}>{t("vehicleVisit.reviewCustody")}</Button>}
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
      {refs.map((ref) => <div key={ref.label} className="min-w-0 rounded-lg border border-border p-3">
        <div className="text-xs text-muted-foreground">{ref.label}</div>
        {ref.href && ref.value ? <Link className="block truncate font-semibold text-primary hover:underline" to={ref.href}>{ref.value}</Link> : <div className="truncate font-semibold">{ref.value || "—"}</div>}
      </div>)}
    </div>
    {!supervisor && (visit.documentFiles.length > 0 || visit.expenses.length > 0 || visit.cashInvoices.length > 0 || visit.insuranceInvoices.length > 0) &&
      <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer font-semibold">{t("vehicleVisit.operationalFile")} · {t("vehicleVisit.documents")} / {t("vehicleVisit.expenses")}</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <section><h3 className="text-sm font-semibold">{t("vehicleVisit.documents")}</h3><div className="mt-2 space-y-1">
            {visit.documentFiles.map((file: any) => <button key={file.id} type="button" onClick={() => void openDocument(file.id)} className="block w-full truncate rounded border border-border p-2 text-start text-sm text-primary hover:bg-muted/30">{file.original_file_name}</button>)}
          </div></section>
          <section><h3 className="text-sm font-semibold">{t("vehicleVisit.expenses")}</h3><div className="mt-2 space-y-1">
            {visit.expenses.map((expense: any) => <Link key={expense.id} to={`/accounting/expenses/${expense.id}/edit`} className="block truncate rounded border border-border p-2 text-sm text-primary hover:bg-muted/30">{expense.voucher_number || expense.description || expense.id} · {expense.total ?? expense.amount ?? "—"}</Link>)}
          </div></section>
          <section><h3 className="text-sm font-semibold">{t("vehicleVisit.cashInvoices")}</h3><div className="mt-2 space-y-1">{visit.cashInvoices.map((invoice: any) => <Link key={invoice.id} to={`/sales/invoices/${invoice.id}`} className="block rounded border border-border p-2 text-sm text-primary hover:bg-muted/30">{invoice.doc_number || invoice.id} · {invoice.total ?? "—"}</Link>)}</div></section>
          <section><h3 className="text-sm font-semibold">{t("vehicleVisit.insuranceInvoices")}</h3><div className="mt-2 space-y-1">{visit.insuranceInvoices.map((invoice: any) => <Link key={invoice.id} to={claim?.id ? `/insurance/${claim.id}` : "#"} className="block rounded border border-border p-2 text-sm text-primary hover:bg-muted/30">{invoice.invoice_number || invoice.id} · {invoice.total ?? "—"}</Link>)}</div></section>
        </div>
      </details>}
    <div className="flex flex-wrap gap-2">
      {!supervisor && <VehicleEntryInspectionAction entry={visit.entry} />}
      {canAdvance && next && <Button variant="outline" disabled={Boolean(nextBlocker)} onClick={() => { setOccurredAt(localDateTime()); setResponsible(user?.id || ""); setTarget(next); }}><ArrowRight className="me-2 h-4 w-4" />{t("vehicleVisit.next")}: {stageLabel(next)}</Button>}
      {canManage && current && previous && <Button variant="outline" disabled={Boolean(reverseBlocker)} onClick={() => { setOccurredAt(localDateTime()); setResponsible(user?.id || ""); setTarget(previous); }}><ArrowDown className="me-2 h-4 w-4" />{t("vehicleVisit.back")}</Button>}
      {canManage && !visit.reviewReason && current !== "cancelled" && current !== "delivered" && current &&
        <Button variant="outline" disabled={Boolean(cancelBlocker)} onClick={() => { setOccurredAt(localDateTime()); setResponsible(user?.id || ""); setTarget("cancelled"); }}>{t("vehicleVisit.cancel")}</Button>}
      {next === "delivered" && !visit.hasFinalHandover && order?.order_number && (supervisor
        ? <Button variant="outline" disabled={!onRequestHandover} onClick={onRequestHandover}>{t("vehicleVisit.signedHandoverRequired")}</Button>
        : <Link className="text-sm text-primary underline" to={`/work-orders/${encodeURIComponent(order.order_number)}/delivery`}>{t("vehicleVisit.signedHandoverRequired")}</Link>)}
    </div>
    {canManage && reverseBlocker && <div role="status" className="space-y-2 rounded-lg border border-warning/40 p-3 text-sm">
      <p>{t("supervisorWorkspace:reverseSourceFirst")}</p>
      {supervisor && onRequestWorkOrderStatus && <Button variant="outline" onClick={onRequestWorkOrderStatus}>{t("supervisorWorkspace:reviewSource")}</Button>}
    </div>}
    {canAdvance && nextBlocker && <div role="status" className="text-sm text-warning">{t(`vehicleVisit.${nextBlocker}`)}{prerequisiteHref && <>{" "}{supervisor && ["workOrderStatusInvalid", "finishWorkFirst"].includes(nextBlocker) && onRequestWorkOrderStatus
      ? <Button variant="outline" onClick={onRequestWorkOrderStatus}>{t("vehicleVisit.openPrerequisite")}</Button>
      : <Link to={prerequisiteHref} className="inline-flex min-h-11 items-center font-semibold underline">{t("vehicleVisit.openPrerequisite")}</Link>}</>}</div>}
    {canManage && !visit.reviewReason && current !== "cancelled" && current !== "delivered" && cancelBlocker &&
      <p className="text-sm text-muted-foreground">{t(`vehicleVisit.${cancelBlocker}`)}</p>}
    {visit.reviewReason && <p className="text-sm text-muted-foreground">{t("vehicleVisit.reviewBlocked")}</p>}
    <details className="rounded-lg border border-border p-3" onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">{t("vehicleVisit.history")}{!supervisor || historyQuery.isSuccess ? ` (${transitions.length})` : ""}</summary>
      <div className="mt-3 space-y-2">
        {supervisor && historyQuery.isPending && <p role="status">{t("supervisorWorkspace:loading")}</p>}
        {supervisor && historyQuery.isError && <div role="alert"><p>{t("supervisorWorkspace:loadError")}</p><Button variant="outline" onClick={() => void historyQuery.refetch()}>{t("supervisorWorkspace:retry")}</Button></div>}
        {(!supervisor || historyQuery.isSuccess) && transitions.length === 0 && <p className="text-sm text-muted-foreground">{t("vehicleVisit.noHistory")}</p>}
        {(!supervisor || !historyQuery.isError) && transitions.map((event) => <div key={event.id} className="rounded-lg bg-muted/50 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{stageLabel(event.from_stage)} → {stageLabel(event.to_stage)}</strong><time dir="ltr">{new Date(event.occurred_at).toLocaleString(i18n.language)}</time></div>
          <div className="text-xs text-muted-foreground">{event.source} · {event.responsible_user_id || "—"}</div>
          {event.notes && <p>{event.notes}</p>}{event.reason && <p>{t("vehicleVisit.reason")}: {event.reason}</p>}
        </div>)}
      </div>
    </details>

    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !mutation.isPending) setTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("vehicleVisit.transition")}: {stageLabel(target)}</DialogTitle><DialogDescription>{t("vehicleVisit.subtitle")}</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(); }}>
          <label className="block text-sm">{t("vehicleVisit.occurredAt")}<Input type="datetime-local" required value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
          <label className="block text-sm">{t("vehicleVisit.responsible")}
            <Select value={responsible} onValueChange={setResponsible}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              {(staff.data || []).map((person) => <SelectItem key={person.user_id} value={person.user_id}>{person.full_name || person.user_id}</SelectItem>)}
            </SelectContent></Select>
          </label>
          <label className="block text-sm">{t("vehicleVisit.notes")}<Textarea value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} /></label>
          <label className="block text-sm">{t("vehicleVisit.requirements")}<Textarea value={requirements} maxLength={2000} onChange={(event) => setRequirements(event.target.value)} /></label>
          {target === "approved" && billingKind === "cash" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerApproved} onChange={(event) => setCustomerApproved(event.target.checked)} />{t("vehicleVisit.customerApproved")}</label>}
          {(target === "cancelled" || (current && target && ORDER.indexOf(target) < ORDER.indexOf(current))) && <label className="block text-sm">{t("vehicleVisit.reason")}<Textarea required value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>}
          {target === "ready" && order?.status !== "completed" && <p className="text-sm text-warning">{t("vehicleVisit.finishWorkFirst")}</p>}
          {target === "delivered" && !visit.hasFinalHandover && <p className="text-sm text-warning">{t("vehicleVisit.signedHandoverRequired")}</p>}
          <Button type="submit" disabled={mutation.isPending || !responsible || !occurredAt || (target === "approved" && billingKind === "cash" && !customerApproved) || (target === "delivered" && !visit.hasFinalHandover)}>
            {mutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("vehicleVisit.save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={custodyOpen} onOpenChange={(open) => { if (!custodyMutation.isPending) setCustodyOpen(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("vehicleVisit.reviewCustody")}</DialogTitle><DialogDescription>{t("vehicleVisit.reviewCustodyDescription")}</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{t("vehicleVisit.entryLocation")}: {presenceLabel(entry.vehicle_location)}</p>
          {claim && <p>{t("vehicleVisit.claim")}: {presenceLabel(claim.vehicle_presence_status)}</p>}
          {order && <p>{t("vehicleVisit.workOrder")}: {presenceLabel(order.vehicle_presence_status)}</p>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={physicallyChecked} onChange={(event) => setPhysicallyChecked(event.target.checked)} />{t("vehicleVisit.physicallyChecked")}</label>
          <label className="block">{t("vehicleVisit.reason")}<Textarea required minLength={8} maxLength={1000} value={custodyReason} onChange={(event) => setCustodyReason(event.target.value)} /></label>
          <Button type="button" disabled={custodyMutation.isPending || !physicallyChecked || custodyReason.trim().length < 8} onClick={() => custodyMutation.mutate()}>
            {custodyMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("vehicleVisit.confirmCustody")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </Card>;
}
