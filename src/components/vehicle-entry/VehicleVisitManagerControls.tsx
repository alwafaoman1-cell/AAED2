import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarClock, ChevronDown, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveDialog, ResponsiveDialogDescription, ResponsiveDialogHeader, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog";
import { adjustVehicleVisitManager, formatWorkshopDateTimeInput, getVehicleVisitManagerContext, parseWorkshopDateTimeInput, resolveVehicleVisitManagerDateInputs } from "@/lib/vehicleVisitManager";
import "@/lib/i18n/vehicleVisitManager";

const ACTIVE_STAGES = ["arrived", "approved", "in_progress", "ready"] as const;
type ActiveStage = typeof ACTIVE_STAGES[number];
type ManagerContext = Awaited<ReturnType<typeof getVehicleVisitManagerContext>>;
type Props = { visit: any; onChanged: () => Promise<unknown> | void };
type InitialChoice = { presence?: "in_workshop" | "with_customer"; stage?: ActiveStage };
export type VehicleVisitManagerControlsHandle = { open: (choice?: InitialChoice) => void };
const dateLabels = { arrived: "arrivalDate", approved: "approvalDate", in_progress: "workDate", ready: "readyDate" } as const;
const selectClassName = "min-h-11 w-full appearance-none rounded-md border border-input bg-background py-2 pe-9 ps-3 text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60";
const selectIconClassName = "pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";

export const VehicleVisitManagerControls = forwardRef<VehicleVisitManagerControlsHandle, Props>(function VehicleVisitManagerControls({ visit, onChanged }, ref) {
  const { profile, user, hasRole } = useAuth();
  const { i18n, t } = useTranslation("vehicleVisitManager");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [initialChoice, setInitialChoice] = useState<InitialChoice>({});
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  const entryId = visit?.entry?.id;
  const closed = Boolean(visit?.hasFinalHandover || [visit?.workflow?.stage, visit?.operationalStage, visit?.stage].some(value => ["delivered", "cancelled"].includes(value)));
  const allowed = Boolean(entryId && profile?.tenant_id && hasRole("admin", "manager"));
  useImperativeHandle(ref, () => ({ open: choice => { if (allowed) { setInitialChoice(choice || {}); setOpen(true); } } }), [allowed]);
  if (!allowed) return null;
  return <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3" aria-label={t("title")} dir={language === "en" ? "ltr" : "rtl"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 shrink-0" />{t("title")}</h3><p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t(closed ? "closed" : "subtitle")}</p></div>
      <Button type="button" variant="outline" className="min-h-11 w-full gap-2 sm:w-auto" onClick={() => { setInitialChoice({}); setOpen(true); }}><CalendarClock className="h-4 w-4" />{t(closed ? "view" : "open")}</Button>
    </div>
    <ResponsiveDialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }} className="max-h-[95dvh] overflow-y-auto sm:max-w-3xl [&>button]:z-20 [&>button]:min-h-11 [&>button]:min-w-11">
      <div className="min-w-0 space-y-4" dir={language === "en" ? "ltr" : "rtl"}>
        <ResponsiveDialogHeader className="sticky top-0 z-10 bg-background pb-3 pr-12"><ResponsiveDialogTitle className="text-start">{t("title")}</ResponsiveDialogTitle><ResponsiveDialogDescription className="text-start">{t(closed ? "closed" : "subtitle")}</ResponsiveDialogDescription></ResponsiveDialogHeader>
        {open && <ManagerSession key={`${entryId}:${profile.tenant_id}:${user?.id || profile.user_id}:${profile.role}:${language}:${JSON.stringify(initialChoice)}`} entryId={entryId} tenantId={profile.tenant_id} closed={closed} initialChoice={initialChoice} onChanged={onChanged} onBusyChange={setBusy} onClose={() => setOpen(false)} />}
      </div>
    </ResponsiveDialog>
  </section>;
});

function ManagerSession({ entryId, tenantId, closed, initialChoice, onChanged, onBusyChange, onClose }: { entryId: string; tenantId: string; closed: boolean; initialChoice: InitialChoice; onChanged: Props["onChanged"]; onBusyChange: (busy: boolean) => void; onClose: () => void }) {
  const { t } = useTranslation("vehicleVisitManager");
  const query = useQuery({ queryKey: ["vehicle-visit-manager", tenantId, entryId], queryFn: () => getVehicleVisitManagerContext(entryId, tenantId), staleTime: 0, retry: false, refetchOnMount: "always", refetchOnWindowFocus: false });
  if (query.isPending || query.isFetching) return <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>;
  if (query.isError || !query.data) return <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{t("loadFailed")}</p><Button type="button" variant="outline" className="min-h-11 gap-2" onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />{t("refresh")}</Button></div>;
  const context = query.data;
  return <ManagerForm key={JSON.stringify([context.workflow_revision, context.entry_updated_at, context.stage, context.presence, context.stage_dates, context.editable])} context={context} tenantId={tenantId} readOnly={closed || !context.editable} initialChoice={initialChoice} onChanged={onChanged} onBusyChange={onBusyChange} onClose={onClose} onRefresh={() => void query.refetch()} />;
}

function ManagerForm({ context, tenantId, readOnly, initialChoice, onChanged, onBusyChange, onClose, onRefresh }: { context: ManagerContext; tenantId: string; readOnly: boolean; initialChoice: InitialChoice; onChanged: Props["onChanged"]; onBusyChange: (busy: boolean) => void; onClose: () => void; onRefresh: () => void }) {
  const { t } = useTranslation("vehicleVisitManager");
  const qc = useQueryClient();
  const initialStage = initialChoice.stage || (ACTIVE_STAGES.includes(context.stage as ActiveStage) ? context.stage as ActiveStage : "arrived");
  const [stage, setStage] = useState<ActiveStage>(initialStage);
  const [presence, setPresence] = useState<"in_workshop" | "with_customer">(readOnly ? context.presence : initialChoice.presence || context.presence);
  const [stageDates, setStageDates] = useState<Record<ActiveStage, string>>(() => Object.fromEntries(ACTIVE_STAGES.map(value => [value, formatWorkshopDateTimeInput(context.stage_dates[value] ?? null)])) as Record<ActiveStage, string>);
  const generatedStageDates = useRef<Partial<Record<ActiveStage, string>>>({});
  const [initialPresenceInstant] = useState(() => new Date().toISOString());
  const [presenceTime, setPresenceTime] = useState(() => formatWorkshopDateTimeInput(initialPresenceInstant));
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const working = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; onBusyChange(false); }; }, [onBusyChange]);
  const requiresReviewSignature = Boolean(context.is_review && !context.intake_signed && stage !== context.stage && ["in_progress", "ready"].includes(stage));
  const stageOptions: readonly ActiveStage[] = context.is_review ? ACTIVE_STAGES.filter(value => value !== "approved") : ACTIVE_STAGES;
  const dateStages = ACTIVE_STAGES.filter(value => value !== "approved" || !context.is_review || context.stage === "approved" || context.stage_dates.approved != null);
  const valid = Boolean(presenceTime && stageDates[stage] && reason.trim().length >= 8 && reason.trim().length <= 1000 && confirmed && !requiresReviewSignature);
  const maxTime = formatWorkshopDateTimeInput(new Date(Date.now() + 300_000).toISOString());
  async function save() {
    if (readOnly || !valid || working.current) return;
    working.current = true; setSaving(true); setFailed(null); onBusyChange(true);
    try {
      const dates = resolveVehicleVisitManagerDateInputs(stageDates, { ...context.stage_dates, ...generatedStageDates.current });
      await adjustVehicleVisitManager({ entryId: context.entry_id, expectedRevision: context.workflow_revision, expectedUpdatedAt: context.entry_updated_at,
        stage, presence, stageDates: dates, presenceOccurredAt: presenceTime === formatWorkshopDateTimeInput(initialPresenceInstant) ? initialPresenceInstant : parseWorkshopDateTimeInput(presenceTime), reason: reason.trim(), requestId: requestId.current }, tenantId);
      if (!active.current) return;
      for (const queryKey of [["vehicle_visit"], ["vehicle_entries"], ["job_orders"], ["insurance_claims"], ["vehicle-customer-messages"]]) void qc.invalidateQueries({ queryKey });
      try { await onChanged(); if (active.current) toast.success(t("saved")); }
      catch { if (active.current) toast.info(t("savedRefreshFailed")); }
      if (active.current) onClose();
    } catch (error) {
      const code = (error as { code?: string; message?: string })?.code || (error as Error)?.message || "";
      if (active.current) setFailed(code === "VEHICLE_VISIT_MANAGER_DATE_ORDER" ? "dateOrder" : ["VEHICLE_VISIT_MANAGER_TIME_INVALID", "VEHICLE_VISIT_MANAGER_TARGET_DATE_REQUIRED"].includes(code) ? "invalid" : "failed");
    }
    finally { working.current = false; if (active.current) { setSaving(false); onBusyChange(false); } }
  }
  return <form className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="rounded-lg bg-muted/60 p-3 text-sm leading-6">{t(readOnly ? "closed" : "protected")}</p>
    {Boolean(context.manager_adjustment) && <p className="text-xs text-muted-foreground">{t("managerCorrection")}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-2 text-sm font-medium"><span>{t("stage")}</span><span className="relative block"><select aria-label={t("stage")} value={readOnly ? context.stage : stage} disabled={readOnly || saving} className={selectClassName} onChange={event => { const next = event.target.value as ActiveStage; setStage(next); if (!stageDates[next]) { const instant = new Date().toISOString(); generatedStageDates.current[next] = instant; setStageDates(value => ({ ...value, [next]: formatWorkshopDateTimeInput(instant) })); } setConfirmed(false); }}>
        {stageOptions.map(value => <option key={value} value={value}>{t(`stageNames.${value}`)}</option>)}{!stageOptions.includes(context.stage as ActiveStage) && <option value={context.stage} disabled>{t(`stageNames.${context.stage}`)}</option>}
      </select><ChevronDown aria-hidden="true" className={selectIconClassName}/></span></label>
      <label className="block space-y-2 text-sm font-medium"><span>{t("location")}</span><span className="relative block"><select aria-label={t("location")} value={presence} disabled={readOnly || saving} className={selectClassName} onChange={event => { setPresence(event.target.value as typeof presence); setConfirmed(false); }}><option value="in_workshop">{t("inside")}</option><option value="with_customer">{t("customer")}</option></select><ChevronDown aria-hidden="true" className={selectIconClassName}/></span></label>
    </div>
    {!readOnly && <label className="block space-y-2 text-sm font-medium"><span>{t("locationTime")}</span><Input type="datetime-local" step="1" max={maxTime} aria-label={t("locationTime")} value={presenceTime} disabled={saving} required onChange={event => { setPresenceTime(event.target.value); setConfirmed(false); }} className="min-h-11" /></label>}
    <fieldset className="min-w-0 space-y-3 rounded-xl border p-3"><legend className="px-1 font-semibold">{t("stageDates")}</legend><p className="text-xs leading-5 text-muted-foreground">{t(readOnly ? "timezone" : "dateHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">{dateStages.map(value => <label key={value} className="block min-w-0 space-y-2 text-sm"><span>{t(dateLabels[value])}</span><Input type="datetime-local" step="1" max={maxTime} aria-label={t(dateLabels[value])} value={stageDates[value]} disabled={readOnly || saving} required={!readOnly && stage === value} onChange={event => { setStageDates(dates => ({ ...dates, [value]: event.target.value })); setConfirmed(false); }} className="min-h-11" /></label>)}
        <label className="block min-w-0 space-y-2 text-sm"><span>{t("deliveryDate")}</span><Input type="datetime-local" step="1" aria-label={t("deliveryDate")} value={formatWorkshopDateTimeInput(context.stage_dates.delivered ?? null)} disabled readOnly className="min-h-11" /></label>
      </div><p className="text-xs leading-5 text-muted-foreground">{t("deliveryProtected")}</p>
    </fieldset>
    {!readOnly && <>
      {requiresReviewSignature && <p role="status" className="rounded-lg border border-warning/40 p-3 text-sm">{t("reviewSignatureRequired")}</p>}
      <p className="text-xs text-muted-foreground">{t("timezone")}</p>
      <label className="block space-y-2 text-sm font-medium"><span>{t("reason")}</span><Textarea aria-label={t("reason")} value={reason} minLength={8} maxLength={1000} required disabled={saving} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /><span className="block text-xs font-normal text-muted-foreground">{t("reasonHint")}</span></label>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)} /><span>{t("physical")}</span></label>
    </>}
    {failed && <p role="alert" className="text-sm text-destructive">{t(failed)}</p>}
    <div className="flex flex-wrap gap-2 border-t pt-3">
      {!readOnly && <Button type="submit" disabled={!valid || saving} className="min-h-11 flex-1 gap-2 sm:flex-none">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{t(saving ? "saving" : "save")}</Button>}
      <Button type="button" variant="outline" disabled={saving} className="min-h-11 gap-2" onClick={onRefresh}><RefreshCw className="h-4 w-4" />{t("refresh")}</Button>
      <Button type="button" variant="outline" disabled={saving} className="min-h-11" onClick={onClose}>{t(readOnly ? "close" : "cancel")}</Button>
    </div>
  </form>;
}
