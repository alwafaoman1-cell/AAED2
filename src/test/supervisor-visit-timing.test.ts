import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupervisorVisitTiming, supervisorClockTone, type SupervisorMilestone } from "@/lib/supervisorVisitTiming";
import type { SupervisorVehicle } from "@/lib/supervisorWorkspace";
import { getVehicleVisitManagerAdjustment, hasVehicleVisitManagerPresenceAttestation } from "@/lib/vehicleVisitManagerProjection";

const NOW = Date.parse("2026-11-06T08:00:00+04:00");
function row(overrides: Partial<SupervisorVehicle> = {}): SupervisorVehicle {
  return { key: "entry:one", entryId: "one", number: "ENT-1", customer: "Customer", vehicle: "Toyota", plate: "A 123", country: "OM",
    arrivalDate: "2026-10-22", channel: "insurance", custody: "in_workshop", stage: "in_progress", review: false, legacy: false,
    visit: { entry: { id: "one", created_at: "2026-11-05", claim: { approved_at: "2026-10-30T10:00:00+04:00" } }, workflow: null,
      stage: "in_progress", operationalStage: "in_progress", reviewReason: null, hasFinalHandover: false }, ...overrides };
}
const event = (changes: Partial<SupervisorMilestone> = {}): SupervisorMilestone => ({ entry_id: "one", from_stage: "arrived", to_stage: "approved", occurred_at: "2026-10-25T08:00:00+04:00", revision: 2, ...changes });
beforeEach(() => { mock.centerTab.mockReset(); mock.centerTab.mockReturnValue("in_workshop"); });

function managedRow() {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const current = row({ entryId: id(1) });
  current.visit!.entry = { ...current.visit!.entry, id: id(1), tenant_id: id(2), vehicle_id: id(3), vehicle_location: "داخل الورشة" };
  const state = { entry_id: id(1), tenant_id: id(2), vehicle_id: id(3), stage: "in_progress" as const, revision: 8,
    review_reason: null, changed_at: "2026-11-05T08:00:00Z", changed_by: id(4),
    manager_adjustment: { version: 1, entry_id: id(1), tenant_id: id(2), vehicle_id: id(3), actor_id: id(4), request_id: id(5),
      recorded_at: "2026-11-05T08:00:00Z", reason: "Verified operational date correction", dates_revision: 6,
      stage_dates: { arrived: "2026-10-01T04:00:00Z", approved: "2026-10-02T04:00:00Z" },
      stage: "in_progress", stage_revision: 6, stage_override: false, presence_attested: true,
      presence: "in_workshop", presence_occurred_at: "2026-11-05T08:00:00Z" },
    effective_stage_dates: { arrived: "2026-11-02T04:00:00Z", approved: "2026-11-04T04:00:00Z" } as Record<string, unknown> };
  current.visit!.workflow = state;
  return { current, state };
}

describe("supervisor day bands", () => {
  it.each([[0, "normal"], [1, "normal"], [15, "normal"], [16, "overdue"], [25, "overdue"], [26, "critical"], [90, "critical"], [null, "unknown"], [-1, "unknown"]] as const)("%s days is %s", (days, tone) => {
    expect(supervisorClockTone(days)).toBe(tone);
  });
});
describe("actual arrival and approval clocks", () => {
  it("does not count a prepared inspection date as arrival but keeps a real approval date", () => {
    mock.centerTab.mockReturnValue("awaiting_arrival");
    const current = row({ custody: "with_customer", stage: "arrived" });
    current.visit!.entry.vehicle_location = "مع العميل";
    current.visit!.entry.vehicle_condition = { visit_purpose: "inspection", arrival_confirmation: "pending" };
    const timing = getSupervisorVisitTiming(current, [], NOW);
    expect(timing.arrival).toMatchObject({ days: null, issue: "unconfirmed", tone: "unknown" });
    expect(timing.approval.days).toBe(7);
  });
  it("does not replace approval with entry creation, order creation or last workflow change", () => {
    const current = row();
    current.visit!.entry.work_order = { created_at: "2026-11-05", work_started_at: "2026-11-04" };
    const timing = getSupervisorVisitTiming(current, [], NOW);
    expect(timing.arrival.days).toBe(15);
    expect(timing.approval.days).toBe(7);
  });
  it("prefers the recorded insurer approval date over the later status-update timestamp", () => {
    const current = row(); current.visit!.entry.claim.insurance_approved_at = "2026-10-22";
    expect(getSupervisorVisitTiming(current, [], NOW).approval.days).toBe(15);
  });
  it("counts Oman calendar days even across UTC midnight, not browser timezone or 24-hour rounding", () => {
    const current = row({ arrivalDate: "2026-11-05" });
    expect(getSupervisorVisitTiming(current, [], Date.parse("2026-11-05T20:01:00Z")).arrival.days).toBe(1);
    expect(getSupervisorVisitTiming(current, [], Date.parse("2026-11-05T19:59:00Z")).arrival.days).toBe(0);
  });
  it("uses a cash approval event, not a linked insurer or a restored-cancellation timestamp", () => {
    const current = row({ channel: "cash" });
    expect(getSupervisorVisitTiming(current, [event(), event({ from_stage: "cancelled", revision: 5, occurred_at: "2026-11-05" })], NOW).approval.days).toBe(12);
  });
  it("ignores other visits and does not mutate the event collection", () => {
    const events = [event({ entry_id: "other", revision: 100 }), event()];
    const before = structuredClone(events);
    expect(getSupervisorVisitTiming(row({ channel: "cash" }), events, NOW).approval.days).toBe(12);
    expect(events).toEqual(before);
  });
  it("uses the latest legitimate reapproval but does not reset on subsequent repair stages", () => {
    const events = [event(), event({ revision: 5, occurred_at: "2026-11-01" }), event({ to_stage: "in_progress", revision: 6, occurred_at: "2026-11-05" })];
    expect(getSupervisorVisitTiming(row({ channel: "cash" }), events, NOW).approval.days).toBe(5);
  });
  it("shows missing/unconfirmed dates as unknown, never green zero", () => {
    expect(getSupervisorVisitTiming(row({ channel: "cash" }), [], NOW).approval).toMatchObject({ days: null, tone: "unknown", issue: "missing" });
    expect(getSupervisorVisitTiming(row({ channel: "cash" }), undefined, NOW).approval).toMatchObject({ days: null, issue: "unconfirmed" });
  });
  it("does not turn a claim-only registration date into arrival evidence", () => {
    const current = row(); current.visit!.entry._claimOnly = true;
    expect(getSupervisorVisitTiming(current, [], NOW).arrival.days).toBeNull();
  });
  it("does not treat a legacy order's entry-date field as a confirmed visit arrival", () => {
    expect(getSupervisorVisitTiming(row({ legacy: true, entryId: undefined }), [], NOW).arrival.days).toBeNull();
  });
  it.each(["2026-02-30", "invalid", "2026-11-07"])("flags invalid/future arrival %s instead of negative or normalized counts", arrivalDate => {
    expect(getSupervisorVisitTiming(row({ arrivalDate }), [], NOW).arrival).toMatchObject({ days: null, tone: "unknown" });
  });
  it("stops both clocks at the actual delivery event and not the current date", () => {
    const current = row({ stage: "delivered" });
    const delivered = event({ to_stage: "delivered", from_stage: "ready", occurred_at: "2026-11-02", revision: 8 });
    expect(getSupervisorVisitTiming(current, [delivered], NOW).arrival).toMatchObject({ days: 11, stopped: true });
    expect(getSupervisorVisitTiming(current, [delivered], NOW).approval).toMatchObject({ days: 3, stopped: true });
  });
  it("never keeps an undated historical cancellation clock running", () => {
    const timing = getSupervisorVisitTiming(row({ stage: "cancelled" }), [], NOW);
    expect(timing.arrival.days).toBeNull(); expect(timing.approval.days).toBeNull();
  });
  it("uses the server's operative manager dates without changing signed intake or insurer dates", () => {
    const { current } = managedRow();
    const before = structuredClone(current);
    const timing = getSupervisorVisitTiming(current, [], NOW);
    expect(timing.arrival).toMatchObject({ days: 4, start: "2026-11-02T04:00:00Z" });
    expect(timing.approval).toMatchObject({ days: 2, start: "2026-11-04T04:00:00Z" });
    expect(current).toEqual(before);
  });
  it("falls back to source dates when the effective server map is absent, never to stale raw manager dates", () => {
    const { current, state } = managedRow();
    delete (state as Partial<typeof state>).effective_stage_dates;
    const timing = getSupervisorVisitTiming(current, [], NOW);
    expect(timing.arrival.days).toBe(15);
    expect(timing.approval.days).toBe(7);
  });
  it("accepts a newer canonical approval projected by the server even when raw manager metadata is older", () => {
    const { current, state } = managedRow();
    state.revision = 10;
    state.effective_stage_dates.approved = "2026-11-05T04:00:00Z";
    const latest = event({ entry_id: current.entryId!, revision: 10, occurred_at: "2026-11-05T04:00:00Z" });
    expect(getSupervisorVisitTiming(current, [latest], NOW).approval.days).toBe(1);
    expect(state.manager_adjustment.stage_dates.approved).toBe("2026-10-02T04:00:00Z");
  });
  it("keeps an authoritative pending approval empty instead of resurrecting the insurer date", () => {
    const { current, state } = managedRow();
    state.effective_stage_dates.approved = null;
    expect(getSupervisorVisitTiming(current, undefined, NOW).approval).toMatchObject({ days: null, issue: "missing" });
    expect(current.visit!.entry.claim.approved_at).toBe("2026-10-30T10:00:00+04:00");
  });
  it.each(["tenant", "entry", "vehicle", "revision", "date", "unknown-key"])("rejects unverified %s manager projections", kind => {
    const { current, state } = managedRow();
    if (kind === "tenant") state.manager_adjustment.tenant_id = "another-tenant";
    else if (kind === "entry") state.manager_adjustment.entry_id = "another-entry";
    else if (kind === "vehicle") state.manager_adjustment.vehicle_id = "another-vehicle";
    else if (kind === "revision") state.manager_adjustment.dates_revision = state.revision + 1;
    else if (kind === "date") state.effective_stage_dates.arrived = "not-a-date";
    else state.effective_stage_dates.invalid = "2026-11-04T04:00:00Z";
    const timing = getSupervisorVisitTiming(current, [], NOW);
    expect(timing.arrival.days).toBe(15);
    expect(timing.approval.days).toBe(7);
  });
  it.each(["delivered", "cancelled"] as const)("stops historical manager clocks on %s without reactivating custody authority", stage => {
    const { current, state } = managedRow();
    current.stage = stage;
    current.visit!.workflow = { ...state, stage };
    current.visit!.entry.status = stage === "cancelled" ? "Cancelled" : "Issued";
    const terminal = event({ entry_id: current.entryId!, revision: 12, from_stage: "ready", to_stage: stage, occurred_at: "2026-11-05T04:00:00Z" });
    const timing = getSupervisorVisitTiming(current, [terminal], NOW);
    expect(timing.arrival).toMatchObject({ days: 3, stopped: true });
    expect(timing.approval).toMatchObject({ days: 1, stopped: true });
    expect(getVehicleVisitManagerAdjustment(current.visit!.entry, current.visit!.workflow)).toBeNull();
    expect(hasVehicleVisitManagerPresenceAttestation(current.visit!.entry, current.visit!.workflow, "in_workshop")).toBe(false);
  });
  it("stops at the selected finalized delivery time rather than its later synchronization event", () => {
    const { current, state } = managedRow();
    current.stage = "delivered";
    current.visit!.workflow = { ...state, stage: "delivered", revision: 12 };
    state.effective_stage_dates.delivered = "2026-11-05T04:00:00Z";
    const before = structuredClone(current.visit!.entry);
    const recorded = event({ entry_id: current.entryId!, revision: 12, from_stage: "ready", to_stage: "delivered", occurred_at: "2026-11-06T04:00:00Z" });
    const timing = getSupervisorVisitTiming(current, [recorded], NOW);
    expect(timing.arrival).toMatchObject({ days: 3, stopped: true });
    expect(timing.approval).toMatchObject({ days: 1, stopped: true });
    expect(current.visit!.entry).toEqual(before);
    state.effective_stage_dates.delivered = null;
    expect(getSupervisorVisitTiming(current, [recorded], NOW).arrival).toMatchObject({ days: null, stopped: true });
  });
  it.each(["in_workshop", "with_customer"])("counts a confirmed manager arrival despite the frozen pending marker at %s", tab => {
    const { current, state } = managedRow();
    current.visit!.entry.vehicle_condition = { visit_purpose: "inspection", arrival_confirmation: "pending" };
    current.visit!.entry.vehicle_location = tab === "with_customer" ? "مع العميل" : "داخل الورشة";
    state.manager_adjustment.presence = tab;
    mock.centerTab.mockReturnValue(tab);
    expect(getSupervisorVisitTiming(current, [], NOW).arrival).toMatchObject({ days: 4, issue: null });
    expect(mock.centerTab).toHaveBeenCalledWith(current.visit);
    expect(current.visit!.entry.vehicle_condition.arrival_confirmation).toBe("pending");
  });
  it("honors central signed-release custody precedence over a historical pending marker", () => {
    const current = row({ stage: "arrived", custody: "with_customer" });
    current.visit!.entry.vehicle_location = "مع العميل";
    current.visit!.entry.vehicle_condition = { visit_purpose: "inspection", arrival_confirmation: "pending" };
    current.visit!.hasSignedTemporaryRelease = true;
    mock.centerTab.mockReturnValue("with_customer");
    expect(getSupervisorVisitTiming(current, [], NOW).arrival).toMatchObject({ days: 15, issue: null });
  });
  it("does not count manager-only phase changes as new canonical cash approvals", () => {
    const events = [event(), event({ revision: 10, occurred_at: "2026-11-05", action: "manager_adjustment" })];
    expect(getSupervisorVisitTiming(row({ channel: "cash" }), events, NOW).approval.days).toBe(12);
  });
});

const mock = vi.hoisted(() => ({ from: vi.fn(), centerTab: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/lib/vehicleEntryService", () => ({ getVehicleEntryPresence: vi.fn() }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getLinkedVehicleVisit: vi.fn(), getVehicleVisitBillingKind: vi.fn(), listVehicleVisitCenterPage: vi.fn(), getVehicleCenterTab: mock.centerTab }));
vi.mock("@/lib/workOrdersStore", () => ({ fetchWorkOrderFromCloudByIdentifier: vi.fn(), fetchWorkOrderListPage: vi.fn() }));
describe("bounded milestone read", () => {
  it("scopes one page to its tenant, and does not return foreign rows or truncated history", async () => {
    const { listSupervisorMilestones } = await import("@/lib/supervisorWorkspace");
    const q: any = { select: vi.fn(() => q), eq: vi.fn(() => q), in: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(async () => ({ data: [{ ...event(), tenant_id: "tenant" }], error: null })) };
    mock.from.mockReturnValue(q);
    expect(await listSupervisorMilestones("tenant", ["one", "one"])).toHaveLength(1);
    expect(q.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(q.in).toHaveBeenCalledWith("entry_id", ["one"]);
    expect(q.select).toHaveBeenCalledWith("tenant_id,entry_id,from_stage,to_stage,occurred_at,revision,action:requirements->>action");
    q.limit.mockResolvedValue({ data: [{ ...event(), tenant_id: "foreign" }], error: null });
    await expect(listSupervisorMilestones("tenant", ["one"])).rejects.toThrow("SUPERVISOR_TIMING_UNCONFIRMED");
    q.limit.mockResolvedValue({ data: Array.from({ length: 501 }, () => ({ ...event(), tenant_id: "tenant" })), error: null });
    await expect(listSupervisorMilestones("tenant", ["one"])).rejects.toThrow("SUPERVISOR_TIMING_UNCONFIRMED");
    await expect(listSupervisorMilestones("tenant", Array.from({ length: 21 }, (_, n) => String(n)))).rejects.toThrow("SUPERVISOR_TIMING_SCOPE_INVALID");
  });
});
