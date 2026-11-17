import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Clock3, Copy, FileText, History, Loader2, MessageCircle, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveDialog, ResponsiveDialogDescription, ResponsiveDialogHeader, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog";
import {
  CUSTOMER_MESSAGE_KINDS,
  listVehicleCustomerMessageLogs,
  loadVehicleCustomerMessageContext,
  prepareVehicleCustomerMessage,
  sendVehicleCustomerMessage,
  vehicleCustomerMessageAvailability,
  verifyVehicleCustomerMessageDraft,
  type VehicleCustomerMessageDraft,
  type VehicleCustomerMessageKind,
} from "@/lib/messaging/vehicleCustomerMessages";
import "@/lib/i18n/vehicleCustomerMessages";

interface Props { entryId: string; open: boolean; onOpenChange: (open: boolean) => void }
const categories = {
  intake: ["portal", "intake_signature", "intake_documents", "review_signature", "review_documents"],
  repair: ["approval", "order_signature", "repair_update"],
  delivery: ["temporary_release_signature", "temporary_release_documents", "ready_for_pickup", "delivery_documents"],
  general: ["follow_up", "custom"],
} satisfies Record<string, VehicleCustomerMessageKind[]>;
type Category = keyof typeof categories;

export default function VehicleCustomerMessageCenter({ entryId, open, onOpenChange }: Props) {
  const { profile, hasRole } = useAuth();
  const { i18n, t } = useTranslation("vehicleCustomerMessages");
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  if (!hasRole("admin", "manager", "supervisor", "insurance")) return null;
  return <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="max-h-[95dvh] overflow-y-auto sm:max-w-5xl [&>button]:min-h-11 [&>button]:min-w-11">
    <div dir={language === "en" ? "ltr" : "rtl"} className="min-w-0 space-y-4">
      <ResponsiveDialogHeader className="pr-12">
        <ResponsiveDialogTitle className="flex items-center gap-2 text-start"><MessageCircle className="h-5 w-5 shrink-0 text-emerald-600" />{t("title")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="text-start">{t("subtitle")}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {open && <MessageSession key={`${entryId}:${profile?.tenant_id}:${profile?.user_id}:${profile?.role}:${language}`} entryId={entryId} />}
    </div>
  </ResponsiveDialog>;
}

function MessageSession({ entryId }: { entryId: string }) {
  const { profile } = useAuth();
  const { i18n, t } = useTranslation("vehicleCustomerMessages");
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  const qc = useQueryClient();
  const tr = (key: string) => String(t(key));
  const caseTitle = (kind: VehicleCustomerMessageKind) => String(t(`cases.${kind}.0`));
  const [category, setCategory] = useState<Category>("intake");
  const [kind, setKind] = useState<VehicleCustomerMessageKind>("portal");
  const [prepared, setPrepared] = useState<VehicleCustomerMessageDraft | null>(null);
  const [edited, setEdited] = useState<{ identity: string; body: string }>({ identity: "", body: "" });
  const [reviewed, setReviewed] = useState("");
  const [busy, setBusy] = useState<"prepare" | "send" | "copy" | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; key: string } | null>(null);
  const active = useRef(true);
  const working = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const scope = `${profile?.tenant_id}:${profile?.user_id}:${profile?.role}:${entryId}:${language}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const contextKey = ["vehicle-customer-messages", profile?.tenant_id, profile?.user_id, entryId];
  const query = useQuery({ queryKey: contextKey,
    queryFn: () => loadVehicleCustomerMessageContext(entryId, profile!.tenant_id),
    enabled: Boolean(profile?.tenant_id && entryId), staleTime: 0, retry: false, refetchOnWindowFocus: true });
  const context = query.data;
  const logs = useQuery({ queryKey: ["message_logs", "vehicle_customer", profile?.tenant_id, entryId, context?.customerId, context?.vehicleId],
    queryFn: () => listVehicleCustomerMessageLogs(context!), enabled: Boolean(context && !query.isError), staleTime: 0, retry: false });
  const draft = prepared && context && !query.isError && prepared.kind === kind && prepared.language === language
    && prepared.fingerprint === JSON.stringify(context) ? prepared : null;
  const identity = draft ? `${draft.fingerprint}:${draft.kind}:${draft.language}:${draft.idempotencyKey}` : "";
  const body = draft ? edited.identity === identity ? edited.body : draft.body : "";
  const reviewIdentity = `${scope}:${identity}:${body}`;
  const currentReview = useRef(reviewIdentity);
  currentReview.current = reviewIdentity;
  const availability = context ? vehicleCustomerMessageAvailability(context, kind) : null;
  const blockText = (reason: string | null | undefined) => String(t(`blocks.${reason || "UNKNOWN"}`, { defaultValue: tr("blocks.UNKNOWN") }));
  const eventRecorded = Boolean(draft && logs.data?.some(log => log.idempotency_key === draft.idempotencyKey && log.status !== "failed"));
  const isCurrent = () => active.current && currentScope.current === scope;
  const isReviewedCurrent = () => isCurrent() && currentReview.current === reviewIdentity;
  const ready = Boolean(draft && body.trim() && reviewed === reviewIdentity && !eventRecorded && logs.isSuccess && !logs.isFetching && !query.isFetching && availability?.available);

  function clearDraft() { setPrepared(null); setEdited({ identity: "", body: "" }); setReviewed(""); setFeedback(null); }
  function selectCase(next: VehicleCustomerMessageKind) { setKind(next); clearDraft(); }
  function errorKey(error: unknown) {
    const code = String((error as { code?: string })?.code || (error instanceof Error ? error.message : ""));
    return /STALE|CHANGED|PORTAL_|EXPIRED|PAUSED/.test(code) ? "stale" : "providerError";
  }
  async function prepare() {
    if (working.current || !profile?.tenant_id || !availability?.available || query.isFetching) return;
    working.current = true; setBusy("prepare"); setFeedback(null); setReviewed("");
    try {
      const next = await prepareVehicleCustomerMessage(entryId, kind, language, profile.tenant_id);
      if (!isCurrent()) return;
      qc.setQueryData(contextKey, next.context); setPrepared(next); setEdited({ identity: "", body: "" });
      void qc.invalidateQueries({ queryKey: ["vehicle-customer-portal", profile.tenant_id, entryId] });
    } catch (error) { if (isCurrent()) setFeedback({ error: true, key: errorKey(error) }); }
    finally { working.current = false; if (isCurrent()) setBusy(null); }
  }
  async function copy() {
    if (working.current || !draft || !body.trim()) return;
    working.current = true; setBusy("copy"); setFeedback(null);
    try {
      await verifyVehicleCustomerMessageDraft(draft);
      if (!isReviewedCurrent()) return;
      await navigator.clipboard.writeText(body);
      if (isReviewedCurrent()) setFeedback({ error: false, key: "copied" });
    } catch (error) { if (isCurrent()) { setReviewed(""); setFeedback({ error: true, key: errorKey(error) }); } }
    finally { working.current = false; if (isCurrent()) setBusy(null); }
  }
  async function send() {
    if (working.current || !draft || !ready) return;
    working.current = true; setBusy("send"); setFeedback(null);
    try {
      const result = await sendVehicleCustomerMessage(draft, body, isReviewedCurrent);
      if (!isCurrent()) return;
      const key = result.status === "queued" ? "queuedFeedback" : result.status === "sent" ? "sentFeedback"
        : result.status === "delivered" ? "deliveredFeedback" : result.status === "read" ? "readFeedback"
          : result.status === "dry_run" ? "dryRunFeedback" : "unknownFeedback";
      setFeedback({ error: !result.ok || result.status === "failed", key }); setReviewed("");
    } catch (error) { if (isCurrent()) { setReviewed(""); setFeedback({ error: true, key: errorKey(error) }); } }
    finally { working.current = false; if (isCurrent()) { setBusy(null); void qc.invalidateQueries({ queryKey: ["message_logs"] }); } }
  }
  function refresh() {
    clearDraft(); void query.refetch(); if (context) void logs.refetch();
  }
  const portal = context?.portal;
  const portalExpired = Boolean(portal?.expires_at && !(Date.parse(portal.expires_at) > Date.now()));
  const statusLabel = (status: string) => tr(["queued", "sent", "delivered", "read", "failed", "dry_run", "draft_opened", "skipped"].includes(status) ? status : status === "sending" ? "sendingStatus" : "unknown");
  const historyTitle = (template: string | null) => {
    const candidate = String(template || "").replace(/^(vehicle_customer_|vehicle_visit_)/, "");
    return CUSTOMER_MESSAGE_KINDS.includes(candidate as VehicleCustomerMessageKind) ? caseTitle(candidate as VehicleCustomerMessageKind) : caseTitle("custom");
  };
  const pendingFeedback = Boolean(feedback && !feedback.error && ["queuedFeedback", "dryRunFeedback", "unknownFeedback"].includes(feedback.key));

  return <section className="min-w-0 space-y-4" aria-label={tr("title")}>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
      <div className="min-w-0 space-y-1 text-sm">
        <p className="break-words font-semibold">{context?.customerName || tr("customer")}</p>
        {context && <p className="break-words text-muted-foreground">{[context.vehicleMake, context.vehicleModel, context.vehicleYear].filter(Boolean).join(" ")} · {tr("visit")} <bdi>{context.entryNumber}</bdi></p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {context && <Badge variant={portal?.enabled && !portalExpired ? "secondary" : "outline"} className="max-w-full gap-1 whitespace-normal"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />{tr(!portal ? "portalUnprepared" : !portal.enabled ? "portalPaused" : portalExpired ? "portalExpired" : "portalActive")}</Badge>}
        <Button type="button" variant="outline" size="sm" className="min-h-11 gap-2" disabled={Boolean(busy) || query.isFetching} onClick={refresh}><RefreshCw className="h-4 w-4" />{tr("refresh")}</Button>
      </div>
    </div>
    {query.isPending && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{tr("loading")}</p>}
    {query.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{tr("contextError")}</p>}
    <Tabs defaultValue="templates" dir={language === "en" ? "ltr" : "rtl"} className="min-w-0">
      <TabsList className="grid h-auto w-full grid-cols-2">
        <TabsTrigger value="templates" className="min-h-11 gap-2"><MessageCircle className="h-4 w-4" />{tr("templates")}</TabsTrigger>
        <TabsTrigger value="history" className="min-h-11 gap-2"><History className="h-4 w-4" />{tr("history")}</TabsTrigger>
      </TabsList>
      <TabsContent value="templates" className="mt-4 space-y-4">
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="min-w-0 space-y-3">
            <label className="block space-y-2 text-sm font-medium"><span>{tr("category")}</span>
              <select aria-label={tr("category")} value={category} disabled={Boolean(busy)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={event => { const next = event.target.value as Category; setCategory(next); selectCase(categories[next][0]); }}>
                {(Object.keys(categories) as Category[]).map(value => <option key={value} value={value}>{tr(value)}</option>)}
              </select>
            </label>
            <div role="group" aria-label={tr("case")} className="grid gap-2">
              {categories[category].map(value => {
                const option = context ? vehicleCustomerMessageAvailability(context, value) : null;
                return <button key={value} type="button" disabled={Boolean(busy)} aria-pressed={value === kind}
                  className={`min-h-11 rounded-xl border p-3 text-start transition-colors ${value === kind ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/60"} disabled:opacity-60`}
                  onClick={() => selectCase(value)}>
                  <span className="flex flex-wrap items-start justify-between gap-2"><span className="text-sm font-semibold">{caseTitle(value)}</span><span className={`text-xs ${option?.available ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{tr(option?.available ? "available" : "unavailable")}</span></span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{String(t(`cases.${value}.1`))}</span>
                </button>;
              })}
            </div>
          </div>
          <div className="min-w-0 space-y-3 rounded-xl border p-3 sm:p-4">
            <h3 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 shrink-0" />{caseTitle(kind)}</h3>
            {context && availability && !availability.available && <p role="status" className="rounded-lg bg-muted p-3 text-sm leading-6">{blockText(availability.reason)}</p>}
            {!draft && <div className="space-y-3 py-3">
              <p className="text-sm font-medium">{tr("placeholder")}</p><p className="text-sm leading-6 text-muted-foreground">{tr("prepareHint")}</p>
              {context && !portal && <p className="text-xs text-muted-foreground">{tr("portalMissing")}</p>}
              <Button type="button" className="min-h-11 w-full gap-2" disabled={Boolean(busy) || query.isFetching || query.isError || !availability?.available} onClick={() => void prepare()}>{busy === "prepare" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{tr(busy === "prepare" ? "preparing" : "prepare")}</Button>
            </div>}
            {draft && <>
              <div className="rounded-lg bg-muted/50 p-3 text-sm"><p className="text-xs text-muted-foreground">{tr("recipient")}</p><p className="mt-1 break-words font-semibold">{draft.recipientName}</p><p className="mt-1"><span className="sr-only">{tr("phone")}: </span><bdi>{draft.recipientPhone}</bdi></p></div>
              <label className="block space-y-2 text-sm font-medium"><span>{tr("body")}</span><Textarea aria-label={tr("body")} value={body} rows={9} maxLength={4000} disabled={Boolean(busy)} className="min-h-52 resize-y text-sm leading-6" onChange={event => { setEdited({ identity, body: event.target.value }); setReviewed(""); setFeedback(null); }} /></label>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{body.length} / 4000</span><Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={Boolean(busy)} onClick={() => { setEdited({ identity: "", body: "" }); setReviewed(""); setFeedback(null); }}>{tr("restore")}</Button></div>
              <Input aria-label={language === "en" ? "Customer portal link" : "رابط بوابة العميل"} value={draft.url} readOnly dir="ltr" className="text-xs" />
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={reviewed === reviewIdentity} disabled={Boolean(busy) || query.isFetching} onChange={event => setReviewed(event.target.checked ? reviewIdentity : "")} /><span>{tr("reviewed")}</span></label>
              {eventRecorded && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{tr("recorded")}</p>}
              {logs.isError && <p role="alert" className="text-sm text-destructive">{tr("historyError")}</p>}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Button type="button" className="min-h-11 gap-2" disabled={Boolean(busy) || !ready} onClick={() => void send()}>{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{tr(busy === "send" ? "sending" : "send")}</Button>
                <Button type="button" variant="outline" className="min-h-11 gap-2" disabled={Boolean(busy) || query.isFetching || !body.trim()} onClick={() => void copy()}><Copy className="h-4 w-4" />{tr("copy")}</Button>
              </div>
            </>}
          </div>
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{tr("privacy")}</p>
      </TabsContent>
      <TabsContent value="history" className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{tr("historyScope")}</p><Button type="button" variant="outline" className="min-h-11 gap-2" disabled={!context || logs.isFetching || Boolean(busy)} onClick={() => void logs.refetch()}><RefreshCw className="h-4 w-4" />{tr("retryHistory")}</Button></div>
        {logs.isPending && context && <p role="status">{tr("historyLoading")}</p>}
        {logs.isError && <p role="alert" className="text-sm text-destructive">{tr("historyError")}</p>}
        {logs.isSuccess && !logs.data.length && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{tr("emptyHistory")}</p>}
        {logs.data?.map(log => <article key={log.id} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{historyTitle(log.template_type)}</h3><Badge variant={log.status === "failed" ? "destructive" : "secondary"} className="whitespace-normal">{statusLabel(log.status)}</Badge></div>
          <p className="text-xs text-muted-foreground">{tr("recordedAt")}: <time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString(language === "en" ? "en-GB" : "ar-OM")}</time></p>
          {log.recipient_phone && <p><bdi>{log.recipient_phone}</bdi></p>}
          {log.body && <details><summary className="min-h-11 cursor-pointer py-3 font-medium">{tr("original")}</summary><p className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 leading-6">{log.body}</p></details>}
        </article>)}
      </TabsContent>
    </Tabs>
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border p-3 text-sm leading-6 ${feedback.error ? "border-destructive/30 text-destructive" : pendingFeedback ? "border-amber-500/40 text-amber-800 dark:text-amber-300" : "border-emerald-600/30"}`}>{feedback.error ? <AlertCircle className="mt-1 h-4 w-4 shrink-0" /> : pendingFeedback ? <Clock3 className="mt-1 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />}{tr(feedback.key)}</p>}
  </section>;
}
