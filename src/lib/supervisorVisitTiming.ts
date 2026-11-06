import { workshopDateTime } from "@/lib/workshopDateTime";
import type { SupervisorVehicle } from "@/lib/supervisorWorkspace";

export interface SupervisorMilestone {
  entry_id: string;
  from_stage: string | null;
  to_stage: string;
  occurred_at: string;
  revision: number;
}
export type SupervisorClockTone = "normal" | "overdue" | "critical" | "unknown";
export interface SupervisorVisitClock {
  days: number | null;
  start: string | null;
  stopped: boolean;
  tone: SupervisorClockTone;
  issue: "missing" | "invalid" | "future" | "unconfirmed" | null;
}

/** Wall-clock dates without offsets are workshop-local, never the device timezone. */
function instant(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(raw);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const timestamp = raw.length === 10 ? `${raw}T00:00:00+04:00`
    : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw.replace(" ", "T")}+04:00`;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function supervisorClockTone(days: number | null): SupervisorClockTone {
  if (days === null || days < 0 || !Number.isFinite(days)) return "unknown";
  return days > 25 ? "critical" : days > 15 ? "overdue" : "normal";
}

function clock(start: unknown, end: number | null, now: number, stopped: boolean, unconfirmed = false): SupervisorVisitClock {
  const base = { days: null, start: typeof start === "string" ? start : null, stopped, tone: "unknown" as const };
  if (unconfirmed) return { ...base, issue: "unconfirmed" };
  if (!start) return { ...base, issue: "missing" };
  const from = instant(start);
  if (from === null || end === null || !Number.isFinite(now)) return { ...base, issue: "invalid" };
  if (from > now || end > now || end < from) return { ...base, issue: "future" };
  const dateOrdinal = (time: number) => Date.parse(`${workshopDateTime(time).date}T00:00:00Z`) / 86_400_000;
  const days = Math.round(dateOrdinal(end) - dateOrdinal(from));
  return { days, start: String(start), stopped, tone: supervisorClockTone(days), issue: null };
}

/** Read-only timing. Never substitute creation/update/work-start dates for approval. */
export function getSupervisorVisitTiming(row: SupervisorVehicle, milestones: SupervisorMilestone[] | undefined, now = Date.now()) {
  const entry = row.visit?.entry;
  const claim = entry?.claim || entry?.converted_claim;
  const order = entry?.work_order || entry?.converted_work_order;
  const events = (milestones || []).filter(event => event.entry_id === row.entryId).sort((a, b) => b.revision - a.revision);
  // Restoring a cancelled visit to Approved is not a new approval date.
  const approvalEvent = events.find(event => event.to_stage === "approved" && event.from_stage === "arrived");
  const approval = row.channel === "insurance" ? claim?.insurance_approved_at || claim?.approved_at || approvalEvent?.occurred_at
    : approvalEvent?.occurred_at;
  const terminal = row.stage === "delivered" || row.stage === "cancelled";
  const terminalEvent = terminal ? events.find(event => event.to_stage === row.stage) : undefined;
  const end = !terminal ? now : instant(terminalEvent?.occurred_at || (row.stage === "delivered"
    ? order?.vehicle_delivered_at || claim?.vehicle_delivered_at || claim?.delivered_at : claim?.cancelled_at));
  // Claim-only projections may contain a registration date, but no confirmed arrival.
  const arrival = row.legacy || row.visit?.entry?._claimOnly ? undefined : row.arrivalDate;
  return {
    arrival: clock(arrival, end, now, terminal, terminal && end === null),
    approval: clock(approval, end, now, terminal, !approval && Boolean(row.entryId) && milestones === undefined),
  };
}
