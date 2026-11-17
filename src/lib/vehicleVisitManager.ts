import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { workshopDateTime } from "@/lib/workshopDateTime";

export const MANAGER_ACTIVE_STAGES = ["arrived", "approved", "in_progress", "ready"] as const;
export type ManagerActiveStage = typeof MANAGER_ACTIVE_STAGES[number];
export type ManagerDateStage = ManagerActiveStage | "delivered";
export type ManagerStageDates = Partial<Record<ManagerDateStage, string | null>>;
export type ManagerVehiclePresence = "in_workshop" | "with_customer";

export interface VehicleVisitManagerContext {
  entry_id: string; tenant_id: string; vehicle_id: string;
  stage: ManagerDateStage | "cancelled" | "needs_review";
  presence: ManagerVehiclePresence;
  workflow_revision: number; entry_updated_at: string;
  stage_dates: ManagerStageDates;
  editable: boolean; is_review: boolean; intake_signed: boolean;
  manager_adjustment: Record<string, unknown> | null;
  last_changed_at: string | null;
}
export interface VehicleVisitManagerInput {
  entryId: string; expectedRevision: number; expectedUpdatedAt: string;
  stage: ManagerActiveStage; presence: ManagerVehiclePresence;
  stageDates: Partial<Record<ManagerActiveStage, string | null>>;
  presenceOccurredAt: string; reason: string; requestId: string;
}

function fail(code: string): never {
  const message = `VEHICLE_VISIT_MANAGER_${code}`;
  throw Object.assign(new Error(message), { code: message });
}
const validInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Workshop clock is always Muscat, including for staff browsers in other zones. */
export function formatWorkshopDateTimeInput(value: Date | string | number | null | undefined = Date.now()): string {
  const parts = workshopDateTime(value);
  if (!parts.date || !parts.time || value == null) return "";
  const date = value instanceof Date ? value : new Date(value);
  return `${parts.date}T${parts.time}:${String(date.getUTCSeconds()).padStart(2, "0")}`;
}
export function parseWorkshopDateTimeInput(value: string): string {
  const parts = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!parts) fail("TIME_INVALID");
  const withSeconds = `${parts[1]}T${parts[2]}:${parts[3]}:${parts[4] || "00"}`;
  const instant = new Date(`${withSeconds}.${(parts[5] || "").padEnd(3, "0")}+04:00`);
  if (!Number.isFinite(instant.getTime()) || formatWorkshopDateTimeInput(instant) !== withSeconds) fail("TIME_INVALID");
  return instant.toISOString();
}

/** Unedited fields retain the original instant, including subsecond precision. */
export function resolveVehicleVisitManagerDateInputs(
  inputs: Partial<Record<ManagerActiveStage, string>>,
  baseline: ManagerStageDates,
): Partial<Record<ManagerActiveStage, string | null>> {
  return Object.fromEntries(MANAGER_ACTIVE_STAGES.map(stage => {
    const value = inputs[stage] || "", previous = baseline[stage];
    if (!value) return [stage, null];
    if (previous && value === formatWorkshopDateTimeInput(previous)) return [stage, previous];
    const parsed = parseWorkshopDateTimeInput(value);
    return [stage, previous && Date.parse(parsed) === Date.parse(previous) ? previous : parsed];
  }));
}

function checkedContext(data: unknown, entryId: string, expectedTenant?: string): VehicleVisitManagerContext {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("RESPONSE_INVALID");
  const row = data as VehicleVisitManagerContext;
  if (row.entry_id !== entryId || !isUuid(row.entry_id) || !isUuid(row.tenant_id) || !isUuid(row.vehicle_id)
    || expectedTenant && row.tenant_id !== expectedTenant
    || ![...MANAGER_ACTIVE_STAGES, "delivered", "cancelled", "needs_review"].includes(row.stage)
    || !["in_workshop", "with_customer"].includes(row.presence)
    || !Number.isSafeInteger(row.workflow_revision) || row.workflow_revision < 0 || !validInstant(row.entry_updated_at)
    || typeof row.editable !== "boolean" || typeof row.is_review !== "boolean" || typeof row.intake_signed !== "boolean"
    || !row.stage_dates || typeof row.stage_dates !== "object" || Array.isArray(row.stage_dates)) fail("RESPONSE_INVALID");
  for (const [stage, date] of Object.entries(row.stage_dates)) {
    if (![...MANAGER_ACTIVE_STAGES, "delivered"].includes(stage as ManagerDateStage) || date != null && !validInstant(date)) fail("RESPONSE_INVALID");
  }
  return row;
}

export async function getVehicleVisitManagerContext(entryId: string, expectedTenant?: string): Promise<VehicleVisitManagerContext> {
  if (!isUuid(entryId) || expectedTenant && !isUuid(expectedTenant)) fail("IDENTITY");
  const { data, error } = await supabase.rpc("get_vehicle_visit_manager_context" as any, { p_entry_id: entryId } as any);
  if (error) throw error;
  return checkedContext(data, entryId, expectedTenant);
}

function checkedInput(input: VehicleVisitManagerInput, now = Date.now()) {
  if (!isUuid(input.entryId) || !isUuid(input.requestId)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !validInstant(input.expectedUpdatedAt)) fail("IDENTITY");
  if (!MANAGER_ACTIVE_STAGES.includes(input.stage) || !["in_workshop", "with_customer"].includes(input.presence)) fail("STAGE_INVALID");
  if (input.reason.trim().length < 8 || input.reason.length > 1000) fail("REASON_REQUIRED");
  if (!validInstant(input.presenceOccurredAt) || Date.parse(input.presenceOccurredAt) > now + 300_000) fail("TIME_INVALID");
  if (!input.stageDates || typeof input.stageDates !== "object" || Array.isArray(input.stageDates)) fail("TIME_INVALID");
  let last: number | null = null;
  for (const [key, value] of Object.entries(input.stageDates)) {
    if (!MANAGER_ACTIVE_STAGES.includes(key as ManagerActiveStage) || value != null && !validInstant(value)) fail("TIME_INVALID");
  }
  for (const stage of MANAGER_ACTIVE_STAGES) {
    const value = input.stageDates[stage];
    if (value == null) continue;
    const time = Date.parse(value);
    if (time > now + 300_000) fail("TIME_INVALID");
    if (last != null && time < last) fail("DATE_ORDER");
    last = time;
  }
  if (!validInstant(input.stageDates[input.stage])) fail("TARGET_DATE_REQUIRED");
}

/** Save and read back the same revision, request, stage, custody and chosen dates. */
export async function adjustVehicleVisitManager(input: VehicleVisitManagerInput, expectedTenant?: string): Promise<VehicleVisitManagerContext> {
  checkedInput(input);
  const { data, error } = await supabase.rpc("adjust_vehicle_visit_manager" as any, {
    p_entry_id: input.entryId, p_expected_revision: input.expectedRevision, p_expected_updated_at: input.expectedUpdatedAt,
    p_target_stage: input.stage, p_presence: input.presence, p_stage_dates: input.stageDates,
    p_presence_occurred_at: input.presenceOccurredAt, p_reason: input.reason.trim(), p_request_id: input.requestId,
  } as any);
  if (error) throw error;
  const saved = checkedContext(data, input.entryId, expectedTenant);
  const fresh = await getVehicleVisitManagerContext(input.entryId, expectedTenant);
  for (const row of [saved, fresh]) {
    if (row.workflow_revision !== input.expectedRevision + 1 || row.stage !== input.stage || row.presence !== input.presence
      || String(row.manager_adjustment?.request_id || "").toLowerCase() !== input.requestId.toLowerCase()
      || row.manager_adjustment?.presence !== input.presence
      || !validInstant(row.manager_adjustment?.presence_occurred_at)
      || Date.parse(row.manager_adjustment.presence_occurred_at) !== Date.parse(input.presenceOccurredAt)
      || input.presence === "with_customer" && row.manager_adjustment.presence_attested !== true) fail("SAVE_NOT_CONFIRMED");
    for (const stage of MANAGER_ACTIVE_STAGES) {
      const date = input.stageDates[stage];
      if (date && (!validInstant(row.stage_dates[stage]) || Date.parse(row.stage_dates[stage]!) !== Date.parse(date))) fail("SAVE_NOT_CONFIRMED");
    }
  }
  return fresh;
}
