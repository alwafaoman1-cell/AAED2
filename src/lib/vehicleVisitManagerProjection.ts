import { isUuid } from "@/lib/uuid";

export interface VehicleVisitManagerAdjustment {
  version: 1; entry_id: string; tenant_id: string; vehicle_id: string;
  request_id: string; actor_id: string; recorded_at: string; reason: string;
  stage_override: boolean; stage: string; stage_revision: number;
  stage_dates?: Record<string, string | null>; dates_revision?: number;
  presence_attested: boolean; presence: "in_workshop" | "with_customer";
  presence_occurred_at: string;
}
interface Workflow {
  entry_id: string; tenant_id: string; vehicle_id: string;
  stage: string; revision: number; manager_adjustment?: unknown;
  effective_stage_dates?: unknown;
}
interface Entry { id?: string; tenant_id?: string; vehicle_id?: string; status?: string }
const ACTIVE = ["arrived", "approved", "in_progress", "ready"];

/** The metadata is cloud-owned; authenticated table access is SELECT-only.
 * Binding checks prevent an unrelated or old terminal visit from borrowing it. */
function boundAdjustment(entry: Entry | null | undefined, workflow: Workflow | null | undefined, historical = false): VehicleVisitManagerAdjustment | null {
  const raw = workflow?.manager_adjustment;
  if (!entry || !workflow || !raw || typeof raw !== "object" || Array.isArray(raw)
    || entry.id !== workflow.entry_id || entry.vehicle_id !== workflow.vehicle_id
    || entry.tenant_id != null && entry.tenant_id !== workflow.tenant_id
    || !historical && entry.status === "Cancelled"
    || !(historical ? [...ACTIVE, "delivered", "cancelled"] : ACTIVE).includes(workflow.stage)) return null;
  const value = raw as VehicleVisitManagerAdjustment;
  if (value.version !== 1 || value.entry_id !== workflow.entry_id || value.tenant_id !== workflow.tenant_id || value.vehicle_id !== workflow.vehicle_id
    || !isUuid(value.actor_id) || !isUuid(value.request_id) || !Number.isFinite(Date.parse(value.recorded_at))
    || typeof value.reason !== "string" || value.reason.trim().length < 8) return null;
  return value;
}

export function getVehicleVisitManagerAdjustment(entry: Entry | null | undefined, workflow: Workflow | null | undefined): VehicleVisitManagerAdjustment | null {
  return boundAdjustment(entry, workflow);
}

type ManagerDateStage = "arrived" | "approved" | "in_progress" | "ready" | "delivered";

/** Live operational projection from the bounded center response, separate from
 * signed intake and financial dates. Raw stored overlays can become stale after
 * canonical re-entry; only the server's effective map is authoritative here. */
export function getVehicleVisitManagerOperationalDate(
  entry: Entry | null | undefined, workflow: Workflow | null | undefined, stage: ManagerDateStage,
): string | null | undefined {
  const adjustment = boundAdjustment(entry, workflow, true);
  const dates = workflow?.effective_stage_dates;
  if (!adjustment || !Number.isSafeInteger(workflow?.revision) || workflow!.revision < 0
    || !Number.isSafeInteger(adjustment.dates_revision) || adjustment.dates_revision! < 0
    || adjustment.dates_revision! > workflow!.revision || !dates || typeof dates !== "object" || Array.isArray(dates)) return undefined;
  const values = dates as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    if (![...ACTIVE, "delivered"].includes(key)
      || value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) return undefined;
  }
  return Object.prototype.hasOwnProperty.call(values, stage) ? values[stage] as string | null : undefined;
}

export function hasVehicleVisitManagerPresenceAttestation(
  entry: Entry | null | undefined, workflow: Workflow | null | undefined,
  presence: string | null | undefined, hasFinalHandover = false,
): boolean {
  const value = getVehicleVisitManagerAdjustment(entry, workflow);
  return !hasFinalHandover && !!value && value.presence_attested === true
    && ["in_workshop", "with_customer"].includes(value.presence) && value.presence === presence
    && Number.isFinite(Date.parse(value.presence_occurred_at));
}

export function hasVehicleVisitManagerStageOverride(entry: Entry | null | undefined, workflow: Workflow | null | undefined): boolean {
  const value = getVehicleVisitManagerAdjustment(entry, workflow);
  return !!value && value.stage_override === true && value.stage === workflow?.stage
    && Number.isSafeInteger(value.stage_revision) && value.stage_revision === workflow?.revision;
}
