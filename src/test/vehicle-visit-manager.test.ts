import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: api.rpc } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: vi.fn() }));
import { adjustVehicleVisitManager, formatWorkshopDateTimeInput, getVehicleVisitManagerContext, parseWorkshopDateTimeInput, resolveVehicleVisitManagerDateInputs, type VehicleVisitManagerContext, type VehicleVisitManagerInput } from "@/lib/vehicleVisitManager";
import { getVehicleVisitManagerAdjustment, hasVehicleVisitManagerPresenceAttestation, hasVehicleVisitManagerStageOverride } from "@/lib/vehicleVisitManagerProjection";
import { deliverReviewVisit } from "@/lib/vehicleReviewVisit";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const instant = "2026-11-16T04:00:00.000Z";
let context: VehicleVisitManagerContext;
let input: VehicleVisitManagerInput;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-17T08:00:00Z")); api.rpc.mockReset();
  context = { entry_id: id(1), tenant_id: id(2), vehicle_id: id(3), stage: "in_progress", presence: "in_workshop", workflow_revision: 5,
    entry_updated_at: instant, stage_dates: { arrived: instant, approved: "2026-11-16T05:00:00Z", in_progress: "2026-11-16T06:00:00Z", ready: null, delivered: null },
    editable: true, is_review: false, intake_signed: true, manager_adjustment: null, last_changed_at: instant };
  input = { entryId: id(1), expectedRevision: 5, expectedUpdatedAt: instant, stage: "ready", presence: "with_customer",
    stageDates: { arrived: instant, approved: "2026-11-16T05:00:00Z", in_progress: "2026-11-16T06:00:00Z", ready: "2026-11-16T07:00:00Z" },
    presenceOccurredAt: "2026-11-16T07:10:00Z", reason: "Verified physical custody correction", requestId: id(4) };
});
afterEach(() => vi.useRealTimers());

describe("manager dates use the workshop clock", () => {
  it("formats and parses Muscat independently from the browser's offset", () => {
    expect(formatWorkshopDateTimeInput("2026-11-16T23:15:42Z")).toBe("2026-11-17T03:15:42");
    expect(parseWorkshopDateTimeInput("2026-11-17T03:15:42")).toBe("2026-11-16T23:15:42.000Z");
    expect(parseWorkshopDateTimeInput("2026-07-01T09:25")).toBe("2026-07-01T05:25:00.000Z");
    expect(parseWorkshopDateTimeInput("2026-07-01T09:25:15.000")).toBe("2026-07-01T05:25:15.000Z");
    expect(parseWorkshopDateTimeInput("2026-07-01T09:25:15.12")).toBe("2026-07-01T05:25:15.120Z");
    expect(formatWorkshopDateTimeInput(null)).toBe("");
  });
  it.each(["", "2026-02-30T12:00", "2026-13-01T12:00", "2026-11-17T24:00", "2026-11-17T12:00:61", "2026-11-17T08:00Z"])("rejects invalid wall-clock input %s", value => {
    expect(() => parseWorkshopDateTimeInput(value)).toThrow("TIME_INVALID");
  });
  it("retains untouched baseline subsecond precision and leaves unreached dates blank", () => {
    const original = "2026-11-16T04:00:00.123456+00:00";
    const dates = resolveVehicleVisitManagerDateInputs({ arrived: formatWorkshopDateTimeInput(original), approved: "2026-11-16T09:30:15" }, { arrived: original });
    expect(dates).toEqual({ arrived: original, approved: "2026-11-16T05:30:15.000Z", in_progress: null, ready: null });
    expect(resolveVehicleVisitManagerDateInputs({ arrived: "2026-11-16T08:00:00.123" }, { arrived: original }).arrived).toBe(original);
  });
});

describe("manager API verifies the canonical saved result", () => {
  it("loads read-only context without invoking a mutation", async () => {
    api.rpc.mockResolvedValue({ data: context, error: null });
    expect(await getVehicleVisitManagerContext(id(1), id(2))).toEqual(context);
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith("get_vehicle_visit_manager_context", { p_entry_id: id(1) });
  });
  it.each(["tenant", "entry", "revision", "date", "signature"])("rejects an unverified %s response", async changed => {
    const value = { ...context } as Record<string, unknown>;
    if (changed === "tenant") value.tenant_id = id(9); else if (changed === "entry") value.entry_id = id(9);
    else if (changed === "revision") value.workflow_revision = -1; else if (changed === "date") value.stage_dates = { ready: "not-a-date" }; else delete value.intake_signed;
    api.rpc.mockResolvedValue({ data: value, error: null });
    await expect(getVehicleVisitManagerContext(id(1), id(2))).rejects.toThrow("RESPONSE_INVALID");
  });
  function saved() {
    return { ...context, stage: input.stage, presence: input.presence, workflow_revision: 6, stage_dates: input.stageDates,
      manager_adjustment: { request_id: input.requestId, presence: input.presence, presence_attested: true, presence_occurred_at: input.presenceOccurredAt } };
  }
  it("sends one audited mutation and then independently verifies revision, chosen dates and location", async () => {
    api.rpc.mockResolvedValue({ data: saved(), error: null });
    expect((await adjustVehicleVisitManager(input, id(2))).workflow_revision).toBe(6);
    expect(api.rpc.mock.calls.map(call => call[0])).toEqual(["adjust_vehicle_visit_manager", "get_vehicle_visit_manager_context"]);
    expect(api.rpc.mock.calls[0][1]).toEqual({ p_entry_id: id(1), p_expected_revision: 5, p_expected_updated_at: instant,
      p_target_stage: "ready", p_presence: "with_customer", p_stage_dates: input.stageDates, p_presence_occurred_at: input.presenceOccurredAt,
      p_reason: input.reason, p_request_id: id(4) });
  });
  it.each(["revision", "stage", "presence", "request", "stage_date", "presence_date", "attestation"])("does not claim success after mismatched %s read-back", async changed => {
    const after = structuredClone(saved());
    if (changed === "revision") after.workflow_revision++; else if (changed === "stage") after.stage = "arrived";
    else if (changed === "presence") after.presence = "in_workshop"; else if (changed === "request") after.manager_adjustment.request_id = id(7);
    else if (changed === "stage_date") after.stage_dates.ready = "2026-11-16T07:01:00Z";
    else if (changed === "presence_date") after.manager_adjustment.presence_occurred_at = "2026-11-16T07:11:00Z";
    else after.manager_adjustment.presence_attested = false;
    api.rpc.mockResolvedValueOnce({ data: saved(), error: null }).mockResolvedValueOnce({ data: after, error: null });
    await expect(adjustVehicleVisitManager(input, id(2))).rejects.toThrow("SAVE_NOT_CONFIRMED");
  });
  it.each(["reason", "order", "target", "future", "terminal"])("rejects invalid %s before any request", async changed => {
    if (changed === "reason") input.reason = "short";
    else if (changed === "order") input.stageDates.approved = "2026-11-16T03:00:00Z";
    else if (changed === "target") input.stageDates.ready = null;
    else if (changed === "future") input.presenceOccurredAt = "2026-11-18T08:00:00Z";
    else input.stage = "delivered" as never;
    await expect(adjustVehicleVisitManager(input, id(2))).rejects.toThrow("VEHICLE_VISIT_MANAGER_");
    expect(api.rpc).not.toHaveBeenCalled();
  });
});

describe("manager custody attestation is bound to one active visit", () => {
  function setup() {
    const entry = { id: id(1), tenant_id: id(2), vehicle_id: id(3), status: "Issued" };
    const adjustment = { version: 1, entry_id: id(1), tenant_id: id(2), vehicle_id: id(3), request_id: id(4), actor_id: id(5),
      reason: "Physical location checked", recorded_at: instant, stage_override: true, stage: "ready", stage_revision: 6,
      presence_attested: true, presence: "with_customer", presence_occurred_at: instant };
    const workflow = { entry_id: id(1), tenant_id: id(2), vehicle_id: id(3), stage: "ready", revision: 6, manager_adjustment: adjustment };
    return { entry, workflow, adjustment };
  }
  it("keeps custody acknowledgement independent of a later ordinary stage revision", () => {
    const { entry, workflow } = setup();
    expect(hasVehicleVisitManagerStageOverride(entry, workflow)).toBe(true);
    workflow.revision++;
    expect(hasVehicleVisitManagerStageOverride(entry, workflow)).toBe(false);
    expect(hasVehicleVisitManagerPresenceAttestation(entry, workflow, "with_customer")).toBe(true);
    expect(hasVehicleVisitManagerPresenceAttestation(entry, workflow, "in_workshop")).toBe(false);
  });
  it.each(["entry", "vehicle", "tenant", "terminal", "final_handover", "not_attested", "reason", "version"])("refuses unrelated or inactive %s metadata", changed => {
    const { entry, workflow, adjustment } = setup();
    if (changed === "entry") adjustment.entry_id = id(8); else if (changed === "vehicle") adjustment.vehicle_id = id(8);
    else if (changed === "tenant") adjustment.tenant_id = id(8); else if (changed === "terminal") workflow.stage = "delivered";
    else if (changed === "not_attested") adjustment.presence_attested = false; else if (changed === "reason") adjustment.reason = "";
    else if (changed === "version") adjustment.version = 2;
    expect(hasVehicleVisitManagerPresenceAttestation(entry, workflow, "with_customer", changed === "final_handover")).toBe(false);
  });
  it("does not manufacture an attestation from a non-object or unversioned value", () => {
    const { entry, workflow } = setup();
    expect(getVehicleVisitManagerAdjustment(entry, { ...workflow, manager_adjustment: {} })).toBeNull();
    expect(getVehicleVisitManagerAdjustment(entry, { ...workflow, manager_adjustment: [] })).toBeNull();
  });
});

describe("new review delivery can choose its actual date without breaking existing callers", () => {
  const request = () => ({ entryId: id(1), requestId: id(4), receiptId: id(6), recipient: "QA Recipient", signature: "data:image/png;base64,QA", notes: "QA review findings" });
  it("retains the six-argument legacy payload when no chosen time was supplied", async () => {
    api.rpc.mockResolvedValue({ data: { id: id(7), vehicle_entry_id: id(1), status: "finalized" }, error: null });
    await deliverReviewVisit(request()); expect(Object.keys(api.rpc.mock.calls[0][1])).toHaveLength(6);
  });
  it("uses and verifies the selected delivery time on the new overload", async () => {
    api.rpc.mockResolvedValue({ data: { id: id(7), vehicle_entry_id: id(1), status: "finalized", delivered_at: instant }, error: null });
    await deliverReviewVisit({ ...request(), occurredAt: instant }); expect(api.rpc.mock.calls[0][1].p_occurred_at).toBe(instant);
    api.rpc.mockResolvedValue({ data: { id: id(7), vehicle_entry_id: id(1), status: "finalized", delivered_at: "2026-11-16T04:01:00Z" }, error: null });
    await expect(deliverReviewVisit({ ...request(), occurredAt: instant })).rejects.toThrow("SAVE_NOT_CONFIRMED");
  });
});
