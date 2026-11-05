import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { buildVehicleVisitMessageDraft, listVehicleVisitMessageLogs, loadVehicleVisitMessageContext,
  prepareVehicleVisitMessage, sendVehicleVisitMessage, type VehicleVisitMessageDraft, type VehicleVisitMessageKind,
  type VehicleVisitMessageSelection } from "@/lib/messaging/vehicleVisitMessages";
import { SupervisorClaimApproval } from "./SupervisorClaimApproval";
import "@/lib/i18n/vehicleVisitMessages";

export function SupervisorVisitMessages({ entryId, claimId }: VehicleVisitMessageSelection) {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const tr = (key: string) => t(`vehicleVisitMessages.${key}`);
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  const [kind, setKind] = useState<VehicleVisitMessageKind>("approval");
  const [prepared, setPrepared] = useState<VehicleVisitMessageDraft | null>(null);
  const [edited, setEdited] = useState({ identity: "", body: "" });
  const [reviewed, setReviewed] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; cause?: unknown; key?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const scope = JSON.stringify([profile?.tenant_id, profile?.user_id, profile?.role, entryId, claimId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => () => { currentScope.current = ""; }, []);
  const contextKey = ["vehicle_visit", "messages", profile?.tenant_id, profile?.user_id, entryId, claimId];
  const query = useQuery({ queryKey: contextKey,
    queryFn: () => loadVehicleVisitMessageContext({ entryId, claimId }, profile!.tenant_id),
    enabled: Boolean(profile?.tenant_id && (entryId || claimId)), staleTime: 0, retry: false, refetchOnWindowFocus: true });
  const context = query.data;
  const logs = useQuery({ queryKey: ["message_logs", "vehicle_visit", profile?.tenant_id, entryId, claimId],
    queryFn: () => listVehicleVisitMessageLogs(context!), enabled: Boolean(context && !query.isError), staleTime: 0, retry: false });
  const draft = useMemo(() => {
    if (!context || query.isError || query.isFetching) return null;
    if (prepared && prepared.kind === kind && prepared.language === language
      && prepared.fingerprint === JSON.stringify(context)) return prepared;
    if (kind === "approval" && context.approved) {
      try { return buildVehicleVisitMessageDraft(context, kind, language); } catch { return null; }
    }
    return null;
  }, [context, query.isError, query.isFetching, prepared, kind, language]);
  const identity = draft ? `${draft.fingerprint}:${draft.kind}:${draft.language}:${draft.url || ""}` : "";
  const body = draft ? edited.identity === identity ? edited.body : draft.body : "";
  const reviewIdentity = `${scope}:${identity}:${body}`;
  const eventRecorded = Boolean(draft && logs.data?.some(log => log.idempotency_key === draft.idempotencyKey));
  const legacyBlocked = kind === "approval" && context?.legacyApprovalState !== undefined && context.legacyApprovalState !== "none";
  function errorText(error: unknown) {
    const code = String((error as { code?: string })?.code || "");
    if (code.startsWith("VISIT_MESSAGE_")) return tr(`errors.${code.slice(14)}`);
    return `${tr("provider")} ${error instanceof Error ? error.message : ""}`.trim();
  }
  async function prepare() {
    if (busyRef.current || !profile?.tenant_id) return;
    busyRef.current = true; setBusy(true); setFeedback(null); setReviewed("");
    try {
      const next = await prepareVehicleVisitMessage({ entryId, claimId }, kind, language, profile.tenant_id);
      if (currentScope.current !== scope) return;
      qc.setQueryData(contextKey, next.context); setPrepared(next); setEdited({ identity: "", body: "" });
    } catch (error) { if (currentScope.current === scope) setFeedback({ error: true, cause: error }); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function send() {
    if (busyRef.current || !draft || reviewed !== reviewIdentity || !body.trim() || legacyBlocked || eventRecorded) return;
    busyRef.current = true; setBusy(true); setFeedback(null);
    try {
      await sendVehicleVisitMessage(draft, body, () => currentScope.current === scope);
      if (currentScope.current === scope) { setReviewed(""); setFeedback({ error: false, key: "sent" }); }
    } catch (error) {
      if (currentScope.current === scope) { setReviewed(""); setFeedback({ error: true, cause: error }); }
    } finally {
      busyRef.current = false; setBusy(false);
      void qc.invalidateQueries({ queryKey: ["message_logs"] });
    }
  }
  if (!profile?.tenant_id || (!entryId && !claimId)) return <p role="alert">{tr("errors.IDENTITY")}</p>;
  return <section className="space-y-4" dir={language === "en" ? "ltr" : "rtl"} aria-label={tr("title")}>
    <h2 className="text-lg font-semibold">{tr("title")}</h2>
    <p className="text-sm text-muted-foreground">{tr("manual")}</p>
    {query.isPending && <p role="status">{tr("loading")}</p>}
    {query.isError && <p role="alert" className="text-destructive">{errorText(query.error)}</p>}
    <Button type="button" variant="outline" className="min-h-11" disabled={busy || query.isFetching} onClick={() => {
      setPrepared(null); setReviewed(""); setFeedback(null); void query.refetch(); void logs.refetch();
    }}>{tr("retry")}</Button>
    {context && !query.isError && <>
      <p>{tr(context.presence)} · {context.customerName} · <bdi>{context.phone}</bdi></p>
      {context.noEntry && <p className="text-sm">{tr("noEntry")}</p>}
      {context.claimId && !context.approved && <>
        <p role="status">{tr("pending")}</p>
        <SupervisorClaimApproval claimId={context.claimId} onApproved={() => {
          setKind("approval"); setPrepared(null); setReviewed(""); setFeedback({error:false,key:"approved"});
          void qc.invalidateQueries({ queryKey: ["vehicle_visit", "messages"] });
        }} />
      </>}
      <div className="flex flex-wrap gap-2" role="group" aria-label={tr("title")}>
        {(["approval", "entry_receipt", "temporary_release"] as const).map(action => <Button key={action} type="button"
          variant={kind === action ? "default" : "outline"} className="min-h-11 whitespace-normal" disabled={busy}
          aria-pressed={kind === action} onClick={() => { setKind(action); setPrepared(null); setReviewed(""); setFeedback(null); }}>{tr(action)}</Button>)}
      </div>
      {kind === "approval" && !context.approved && <p>{tr("errors.PENDING_APPROVAL")}</p>}
      {legacyBlocked && <p role="status">{tr("errors.LEGACY_APPROVAL")}</p>}
      {eventRecorded && <p role="status">{tr("eventRecorded")}</p>}
      {kind === "temporary_release" && !context.releaseFinalized && <p role="status">{tr("errors.RELEASE_REQUIRED")}</p>}
      {kind === "entry_receipt" && (!context.entryIssued || context.presence !== "in_workshop") && <p>{tr("errors.ENTRY_REQUIRED")}</p>}
      <Button type="button" className="min-h-11" variant="outline" disabled={busy || query.isFetching
        || (kind === "approval" && !context.approved) || (kind === "entry_receipt" && (!context.entryIssued || context.presence !== "in_workshop" || !!draft))
        || (kind === "temporary_release" && (!context.releaseFinalized || !!draft))}
        onClick={() => void prepare()}>{tr(kind === "entry_receipt" ? "prepareLink" : kind === "temporary_release" ? "prepareViewLink" : "prepare")}</Button>
      {draft && <div className="space-y-3">
        <label className="block space-y-2"><span>{tr("body")}</span><Textarea aria-label={tr("body")} value={body} maxLength={4000} rows={7} disabled={busy}
          onChange={event => { setEdited({ identity, body: event.target.value }); setReviewed(""); }} /></label>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={reviewed === reviewIdentity}
          disabled={busy} onChange={event => setReviewed(event.target.checked ? reviewIdentity : "")} /><span>{tr("reviewed")}</span></label>
        <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={busy || query.isFetching || reviewed !== reviewIdentity || !body.trim() || legacyBlocked || eventRecorded || logs.isError || logs.isPending} onClick={() => void send()}>{tr(busy ? "sending" : "send")}</Button>
      </div>}
    </>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-destructive" : "text-success"}>{feedback.error ? errorText(feedback.cause) : tr(feedback.key!)}</p>}
    <div className="space-y-2 border-t pt-3"><h3 className="font-semibold">{tr("recent")}</h3>
      {logs.isError && <p role="alert">{tr("logsFailed")}</p>}
      {logs.isSuccess && !logs.data.length && <p>{tr("empty")}</p>}
      {logs.data?.map(log => <div key={log.id} className="flex flex-wrap justify-between gap-2 text-sm">
        <span>{tr(`statuses.${["queued", "sent", "delivered", "read", "failed", "dry_run"].includes(log.status) ? log.status : "unknown"}`)}</span>
        <time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString(language === "en" ? "en-GB" : "ar-OM")}</time>
      </div>)}
    </div>
  </section>;
}
export default SupervisorVisitMessages;
