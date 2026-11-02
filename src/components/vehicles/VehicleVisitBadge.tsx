import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import type { VisitStage } from "@/lib/vehicleVisitLifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getLinkedVisit(source: "claim" | "work_order", id: string) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId || !UUID.test(id)) return null;
  const fields = source === "claim" ? ["insurance_claim_id", "converted_claim_id"] : ["work_order_id", "converted_work_order_id"];
  const { data: entries, error } = await supabase.from("vehicle_entries" as any)
    .select("id,entry_number").eq("tenant_id", tenantId).is("deleted_at", null)
    .or(fields.map((field) => `${field}.eq.${id}`).join(",")).limit(2);
  if (error) throw error;
  if (!entries?.length) return null;
  if (entries.length > 1) return { entryId: null, number: null, stage: "needs_review" as VisitStage };
  const entry = entries[0] as any;
  const { data: workflow, error: workflowError } = await supabase.from("vehicle_visit_workflows" as any)
    .select("stage,review_reason").eq("tenant_id", tenantId).eq("entry_id", entry.id).maybeSingle();
  if (workflowError) throw workflowError;
  const state = workflow as unknown as { stage?: VisitStage; review_reason?: string | null } | null;
  return { entryId: entry.id as string, number: entry.entry_number as string,
    stage: state ? (state.review_reason ? "needs_review" : state.stage || "needs_review") as VisitStage : null };
}

export function VehicleVisitBadge({ source, id }: { source: "claim" | "work_order"; id?: string | null }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["vehicle_visit", "linked", source, id], queryFn: () => getLinkedVisit(source, id!), enabled: Boolean(id), staleTime: 30_000 });
  if (!query.data) return null;
  const label = `${query.data.number || ""} · ${query.data.stage ? t(`vehicleVisit.${query.data.stage}`) : t("vehicleVisit.legacyUnrecorded")}`;
  return query.data.entryId
    ? <Link className="inline-flex rounded-full border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10" to={`/vehicle-entry/${query.data.entryId}`}>{label}</Link>
    : <span className="inline-flex rounded-full border border-warning/40 bg-warning/5 px-2 py-1 text-xs font-semibold text-warning">{t("vehicleVisit.needs_review")}</span>;
}
