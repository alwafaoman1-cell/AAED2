import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { History, Loader2, RefreshCw, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkflowRequirements } from "@/hooks/useWorkflowRequirements";
import { listWorkflowRequirementAudit, setWorkflowRequirementPolicy, WORKFLOW_REQUIREMENT_QUERY_KEY } from "@/lib/workflowRequirements";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import "@/lib/i18n/workflowRequirements";

const actionLabels: Record<string, string> = {
  requirements_enabled: "enabledEvent",
  requirements_disabled: "disabledEvent",
  save_vehicle_entry: "actionSaveEntry",
  create_review_return: "actionCreateReview",
  create_claim_with_incomplete_operational_details: "actionCreateClaim",
  create_order_without_claim_approval: "actionCreateOrder",
  advance_order_without_claim_approval: "actionAdvanceOrder",
  complete_order_with_workflow_exception: "actionCompleteOrder",
  advance_vehicle_visit: "actionAdvanceVisit",
  advance_review_visit: "actionAdvanceReview",
  adjust_vehicle_visit_manager: "actionManagerAdjustment",
  finalize_handover: "actionFinalizeHandover",
};

export default function WorkflowRequirementsSettingsPanel() {
  const { profile } = useAuth();
  if (profile?.role !== "admin" || !profile.tenant_id || !profile.user_id) return null;
  return <WorkflowRequirementsPanelContent key={`${profile.tenant_id}:${profile.user_id}`} tenantId={profile.tenant_id} userId={profile.user_id} />;
}

function WorkflowRequirementsPanelContent({ tenantId, userId }: { tenantId: string; userId: string }) {
  const { t, i18n } = useTranslation();
  const { policy, loading, error, refresh } = useWorkflowRequirements();
  const client = useQueryClient();
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const tx = (key: string) => t(`workflowRequirements.${key}`);
  const recordUrl = (event: { entity_type: string; entity_id: string; details: Record<string, unknown> }) => {
    const id = encodeURIComponent(event.entity_id);
    if (["vehicle_entry", "vehicle_visit"].includes(event.entity_type)) return `/vehicle-entry/${id}`;
    if (event.entity_type === "vehicle_review_return" && typeof event.details.source_entry_id === "string") return `/vehicle-entry/${encodeURIComponent(event.details.source_entry_id)}`;
    if (event.entity_type === "job_order") return `/work-orders/${id}`;
    if (event.entity_type === "insurance_claim") return `/insurance/claims/${id}`;
    if (event.entity_type === "vehicle_handover" && typeof event.details.work_order_id === "string") return `/work-orders/${encodeURIComponent(event.details.work_order_id)}/delivery`;
    return null;
  };
  const history = useQuery({
    queryKey: ["workflow_requirement_audit", tenantId, userId],
    queryFn: () => listWorkflowRequirementAudit(tenantId),
    enabled: historyOpen,
    retry: false,
  });
  useEffect(() => {
    if (policy && !touched) {
      setDraftEnabled(policy.requirements_enabled);
      setEditingRevision(policy.revision);
    }
  }, [policy, touched]);
  const dirty = !!policy && draftEnabled !== policy.requirements_enabled;
  const conflict = !!policy && editingRevision !== null && editingRevision !== policy.revision && touched;
  const save = async () => {
    if (!policy || loading || saving || !dirty || !reason.trim() || conflict || editingRevision === null) return;
    setSaving(true);
    try {
      const confirmed = await setWorkflowRequirementPolicy(tenantId, draftEnabled, reason, editingRevision);
      if (!active.current) return;
      client.setQueryData([WORKFLOW_REQUIREMENT_QUERY_KEY, tenantId, userId], confirmed);
      setTouched(false);
      setReason("");
      setEditingRevision(confirmed.revision);
      await client.invalidateQueries({ queryKey: ["workflow_requirement_audit", tenantId, userId], exact: true });
      if (!active.current) return;
      toast.success(tx("saved"));
    } catch (failure) {
      if (!active.current) return;
      const message = failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "";
      toast.error(tx(message.includes("WORKFLOW_POLICY_CHANGED") ? "conflict" : "saveFailed"));
      await refresh().catch(() => undefined);
    } finally { if (active.current) setSaving(false); }
  };
  const reread = async () => {
    if (saving) return;
    setTouched(false);
    setReason("");
    await refresh().catch(() => undefined);
  };

  return <Card className="overflow-hidden" aria-label={tx("title")}>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-5 w-5 text-primary" />{tx("title")}</CardTitle>
      <CardDescription>{tx("description")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="workflow-requirements-enabled">{tx("switchLabel")}</Label>
          <div className="text-xs text-muted-foreground">{tx("current")}: {loading ? tx("loading") : policy ? tx(policy.requirements_enabled ? "enforced" : "relaxed") : tx("enforced")}</div>
        </div>
        <Switch id="workflow-requirements-enabled" checked={draftEnabled} disabled={loading || !!error || !policy || saving}
          onCheckedChange={value => { setDraftEnabled(value); setTouched(true); }} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{tx("failed")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border bg-secondary/30 p-3 text-sm"><h3 className="mb-1 font-semibold">{tx("covered")}</h3><p className="text-xs leading-relaxed text-muted-foreground">{tx("coveredText")}</p></div>
        <div className="rounded-lg border p-3 text-sm"><h3 className="mb-1 flex items-center gap-1 font-semibold"><ShieldCheck className="h-4 w-4" />{tx("protected")}</h3><p className="text-xs leading-relaxed text-muted-foreground">{tx("protectedText")}</p></div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="workflow-requirements-reason">{tx("reason")}</Label>
        <Textarea id="workflow-requirements-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={loading || !policy || saving}
          maxLength={1000} rows={2} aria-describedby="workflow-requirements-reason-hint" />
        <p id="workflow-requirements-reason-hint" className="text-xs text-muted-foreground">{tx("reasonHint")}</p>
      </div>
      {dirty && <Badge variant="outline">{tx("pending")}</Badge>}
      {conflict && <p role="alert" className="text-sm text-destructive">{tx("conflict")}</p>}
      {policy && <p className="break-words text-xs text-muted-foreground">{tx("version")}: {policy.revision}{policy.updated_by_name ? ` · ${tx("actor")}: ${policy.updated_by_name}` : ""}{policy.updated_at ? ` · ${new Date(policy.updated_at).toLocaleString(i18n.language)}` : ""}{policy.reason ? ` · ${policy.reason}` : ""}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={loading || !!error || !policy || saving || !dirty || !reason.trim() || conflict} className="min-h-11 gap-2 whitespace-normal">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{tx("save")}
        </Button>
        <Button variant="outline" onClick={() => void reread()} disabled={saving || loading} className="min-h-11 gap-2"><RefreshCw className="h-4 w-4" />{tx("refresh")}</Button>
        <Button variant="ghost" onClick={() => setHistoryOpen(value => !value)} aria-expanded={historyOpen} className="min-h-11 gap-2"><History className="h-4 w-4" />{tx("history")}</Button>
      </div>
      {historyOpen && <section aria-label={tx("history")} className="space-y-2 border-t pt-3">
        {history.isPending ? <p className="text-sm text-muted-foreground">{tx("loading")}</p> : history.error ? <p role="alert" className="text-sm text-destructive">{tx("historyFailed")}</p> :
          history.data?.length ? history.data.map(event => <article key={event.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><strong>{tx(event.action === "requirements_enabled" ? "enabledEvent" : event.action === "requirements_disabled" ? "disabledEvent" : "overrideEvent")}</strong><time className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString(i18n.language)}</time></div>
            <p className="mt-1 break-words text-xs">{event.actor_name} · {tx("version")}: {event.policy_revision} · {event.reason}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{tx("eventAction")}: {tx(actionLabels[event.action] || "overrideEvent")}</p>
            {event.entity_type !== "workflow_policy" && <p className="mt-1 break-words text-xs">{tx("record")}: <span dir="ltr" className="font-mono">{event.entity_id}</span>{recordUrl(event) && <Link className="ms-2 underline" to={recordUrl(event)!}>{tx("openRecord")}</Link>}</p>}
          </article>) : <p className="text-sm text-muted-foreground">{tx("historyEmpty")}</p>}
        <p className="text-xs text-muted-foreground">{tx("historyLimit")}</p>
      </section>}
    </CardContent>
  </Card>;
}
