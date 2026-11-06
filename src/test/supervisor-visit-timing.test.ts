import { describe, expect, it, vi } from "vitest";
import { getSupervisorVisitTiming, supervisorClockTone, type SupervisorMilestone } from "@/lib/supervisorVisitTiming";
import type { SupervisorVehicle } from "@/lib/supervisorWorkspace";

const NOW = Date.parse("2026-11-06T08:00:00+04:00");
function row(overrides: Partial<SupervisorVehicle> = {}): SupervisorVehicle {
  return { key: "entry:one", entryId: "one", number: "ENT-1", customer: "Customer", vehicle: "Toyota", plate: "A 123", country: "OM",
    arrivalDate: "2026-10-22", channel: "insurance", custody: "in_workshop", stage: "in_progress", review: false, legacy: false,
    visit: { entry: { id: "one", created_at: "2026-11-05", claim: { approved_at: "2026-10-30T10:00:00+04:00" } }, workflow: null,
      stage: "in_progress", operationalStage: "in_progress", reviewReason: null, hasFinalHandover: false }, ...overrides };
}
const event = (changes: Partial<SupervisorMilestone> = {}): SupervisorMilestone => ({ entry_id: "one", from_stage: "arrived", to_stage: "approved", occurred_at: "2026-10-25T08:00:00+04:00", revision: 2, ...changes });

describe("supervisor day bands", () => {
  it.each([[0, "normal"], [1, "normal"], [15, "normal"], [16, "overdue"], [25, "overdue"], [26, "critical"], [90, "critical"], [null, "unknown"], [-1, "unknown"]] as const)("%s days is %s", (days, tone) => {
    expect(supervisorClockTone(days)).toBe(tone);
  });
});
describe("actual arrival and approval clocks", () => {
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
});

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/lib/vehicleEntryService", () => ({ getVehicleEntryPresence: vi.fn() }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getLinkedVehicleVisit: vi.fn(), getVehicleVisitBillingKind: vi.fn(), listVehicleVisitCenterPage: vi.fn() }));
vi.mock("@/lib/workOrdersStore", () => ({ fetchWorkOrderFromCloudByIdentifier: vi.fn(), fetchWorkOrderListPage: vi.fn() }));
describe("bounded milestone read", () => {
  it("scopes one page to its tenant, and does not return foreign rows or truncated history", async () => {
    const { listSupervisorMilestones } = await import("@/lib/supervisorWorkspace");
    const q: any = { select: vi.fn(() => q), eq: vi.fn(() => q), in: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(async () => ({ data: [{ ...event(), tenant_id: "tenant" }], error: null })) };
    mock.from.mockReturnValue(q);
    expect(await listSupervisorMilestones("tenant", ["one", "one"])).toHaveLength(1);
    expect(q.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(q.in).toHaveBeenCalledWith("entry_id", ["one"]);
    q.limit.mockResolvedValue({ data: [{ ...event(), tenant_id: "foreign" }], error: null });
    await expect(listSupervisorMilestones("tenant", ["one"])).rejects.toThrow("SUPERVISOR_TIMING_UNCONFIRMED");
    q.limit.mockResolvedValue({ data: Array.from({ length: 501 }, () => ({ ...event(), tenant_id: "tenant" })), error: null });
    await expect(listSupervisorMilestones("tenant", ["one"])).rejects.toThrow("SUPERVISOR_TIMING_UNCONFIRMED");
    await expect(listSupervisorMilestones("tenant", Array.from({ length: 21 }, (_, n) => String(n)))).rejects.toThrow("SUPERVISOR_TIMING_SCOPE_INVALID");
  });
});
