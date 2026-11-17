// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ read: vi.fn(), adjust: vi.fn(), changed: vi.fn(), success: vi.fn(), info: vi.fn(),
  language: "en", translate: (key: string, _options?: Record<string, unknown>) => key,
  profile: { tenant_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", role: "manager" },
}));
vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return { ...actual, useTranslation: () => ({ i18n: { language: api.language }, t: (key: string, options?: Record<string, unknown>) => api.translate(key, options) }) };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: api.profile, user: { id: api.profile.user_id }, hasRole: (...roles: string[]) => roles.includes(api.profile.role) }) }));
vi.mock("sonner", () => ({ toast: { success: api.success, info: api.info } }));
vi.mock("@/lib/vehicleVisitManager", async original => ({ ...await original<object>(), getVehicleVisitManagerContext: api.read, adjustVehicleVisitManager: api.adjust }));

import i18n from "@/i18n";
import { VehicleVisitManagerControls } from "@/components/vehicle-entry/VehicleVisitManagerControls";
import type { VehicleVisitManagerContext } from "@/lib/vehicleVisitManager";

const entryId = "33333333-3333-4333-8333-333333333333", nextEntryId = "44444444-4444-4444-8444-444444444444";
const physicalLabel = "I checked the vehicle's actual location and reviewed the selected stage and dates.";
const clients: QueryClient[] = [];
let context: VehicleVisitManagerContext;
function freshContext(id = entryId): VehicleVisitManagerContext {
  return { entry_id: id, tenant_id: api.profile.tenant_id, vehicle_id: "55555555-5555-4555-8555-555555555555", stage: "arrived", presence: "in_workshop",
    workflow_revision: 3, entry_updated_at: "2026-11-15T07:00:00.987Z", editable: true, is_review: false, intake_signed: true,
    manager_adjustment: null, last_changed_at: "2026-11-15T07:00:00.987Z",
    stage_dates: { arrived: "2026-11-15T04:00:00.123Z", approved: "2026-11-15T05:00:00.456Z", in_progress: "2026-11-15T06:00:00.789Z", ready: "2026-11-15T07:00:00.987Z", delivered: null } };
}
function visit(id = entryId, stage = "arrived", finalized = false) { return { entry: { id }, workflow: { stage }, operationalStage: stage, stage, hasFinalHandover: finalized }; }
function show(initialVisit = visit()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } }); clients.push(client);
  let current = initialVisit;
  const element = () => <QueryClientProvider client={client}><VehicleVisitManagerControls visit={current} onChanged={api.changed}/></QueryClientProvider>;
  const view = render(element());
  return { client, rerender(next = current) { current = next; view.rerender(element()); } };
}
async function open(readOnly = false) {
  fireEvent.click(screen.getByRole("button", { name: readOnly ? "View saved dates" : "Edit location, stage and dates" }));
  await screen.findByLabelText("Operational stage");
}
function confirm(reason = "Physical position and milestone dates verified") {
  fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: reason } });
  fireEvent.click(screen.getByLabelText(physicalLabel));
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeEach(async () => {
  vi.clearAllMocks(); api.language = "en"; api.profile = { tenant_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", role: "manager" };
  api.translate = (key, options) => String(i18n.t(key, { ns: "vehicleVisitManager", lng: api.language, ...options }));
  await i18n.changeLanguage("en"); context = freshContext(); api.read.mockImplementation(async id => structuredClone(id === context.entry_id ? context : freshContext(id)));
  api.adjust.mockImplementation(async () => structuredClone(context)); api.changed.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.useRealTimers(); });

describe("manager-only administrative visit controls", () => {
  it.each(["admin", "manager"])("opens a fresh read without a write for %s", async role => {
    api.profile.role = role; show(); expect(api.read).not.toHaveBeenCalled(); expect(api.adjust).not.toHaveBeenCalled();
    await open(); expect(api.read).toHaveBeenCalledWith(entryId, api.profile.tenant_id); expect(api.adjust).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Actual vehicle location"), { target: { value: "with_customer" } });
    fireEvent.change(screen.getByLabelText("Operational stage"), { target: { value: "ready" } }); expect(api.adjust).not.toHaveBeenCalled();
  });
  it.each(["supervisor", "insurance", "technician"])("offers no manager action or query to %s", role => {
    api.profile.role = role; show(); expect(screen.queryByRole("button", { name: "Edit location, stage and dates" })).toBeNull(); expect(api.read).not.toHaveBeenCalled(); expect(api.adjust).not.toHaveBeenCalled();
  });
  it.each([["arrived", "ready"], ["ready", "arrived"]] as const)("permits an explicit %s to %s correction independent of custody", async (from, to) => {
    context.stage = from; show(visit(entryId, from)); await open();
    fireEvent.change(screen.getByLabelText("Operational stage"), { target: { value: to } });
    fireEvent.change(screen.getByLabelText("Actual vehicle location"), { target: { value: "with_customer" } });
    fireEvent.change(screen.getByLabelText("Date and time of actual location"), { target: { value: "2026-11-17T10:30:45" } }); confirm();
    fireEvent.click(screen.getByRole("button", { name: "Save manager correction" }));
    await waitFor(() => expect(api.adjust).toHaveBeenCalledTimes(1));
    expect(api.adjust).toHaveBeenCalledWith(expect.objectContaining({ entryId, expectedRevision: 3, expectedUpdatedAt: context.entry_updated_at, stage: to, presence: "with_customer",
      stageDates: { arrived: context.stage_dates.arrived, approved: context.stage_dates.approved, in_progress: context.stage_dates.in_progress, ready: context.stage_dates.ready }, presenceOccurredAt: "2026-11-17T06:30:45.000Z", reason: "Physical position and milestone dates verified", requestId: expect.any(String) }), api.profile.tenant_id);
    await waitFor(() => expect(api.success).toHaveBeenCalledWith("Manager correction saved and verified."));
    expect(api.changed).toHaveBeenCalledTimes(1);
  });
  it("requires reason, selected-stage date and physical confirmation and resets confirmation after an edit", async () => {
    show(); await open(); const save = screen.getByRole("button", { name: "Save manager correction" }); expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "short" } }); fireEvent.click(screen.getByLabelText(physicalLabel)); expect(save).toBeDisabled();
    confirm(); expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Actual vehicle location"), { target: { value: "with_customer" } }); expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(physicalLabel)); expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Arrival date and time"), { target: { value: "" } }); expect(save).toBeDisabled(); expect(api.adjust).not.toHaveBeenCalled();
  });
  it("does not fabricate missing milestone or final-delivery dates", async () => {
    context.stage_dates = { arrived: context.stage_dates.arrived }; show(); await open();
    expect(screen.getByLabelText("Approval date and time")).toHaveValue(""); expect(screen.getByLabelText("Work start date and time")).toHaveValue("");
    expect(screen.getByLabelText("Ready date and time")).toHaveValue(""); expect(screen.getByLabelText("Final delivery date and time")).toHaveValue(""); expect(screen.getByLabelText("Final delivery date and time")).toBeDisabled();
  });
  it("keeps milestone ordering errors visible without reporting a successful save",async()=>{
    api.adjust.mockRejectedValue(Object.assign(new Error("VEHICLE_VISIT_MANAGER_DATE_ORDER"),{code:"VEHICLE_VISIT_MANAGER_DATE_ORDER"}));show();await open();confirm();
    fireEvent.click(screen.getByRole("button",{name:"Save manager correction"}));expect(await screen.findByRole("alert")).toHaveTextContent("Milestone dates must follow arrival");expect(api.changed).not.toHaveBeenCalled();expect(api.success).not.toHaveBeenCalled();
  });
  it("converts an edited milestone using Muscat while retaining untouched subsecond instants", async () => {
    show(); await open(); fireEvent.change(screen.getByLabelText("Work start date and time"), { target: { value: "2026-11-15T10:10:11" } }); confirm();
    fireEvent.click(screen.getByRole("button", { name: "Save manager correction" })); await waitFor(() => expect(api.adjust).toHaveBeenCalled());
    expect(api.adjust.mock.calls[0][0].stageDates).toEqual({ arrived: "2026-11-15T04:00:00.123Z", approved: "2026-11-15T05:00:00.456Z", in_progress: "2026-11-15T06:10:11.000Z", ready: "2026-11-15T07:00:00.987Z" });
  });
  it("retains opening and auto-filled stage milliseconds after an arrival recorded within the same second",async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-17T08:00:00.950Z'));
    context.stage_dates={arrived:'2026-11-17T08:00:00.900Z'};context.entry_updated_at='2026-11-17T08:00:00.900Z';show();await open();
    fireEvent.change(screen.getByLabelText('Operational stage'),{target:{value:'in_progress'}});confirm();
    vi.setSystemTime(new Date('2026-11-17T08:00:01.500Z'));fireEvent.click(screen.getByRole('button',{name:'Save manager correction'}));
    await waitFor(()=>expect(api.adjust).toHaveBeenCalledWith(expect.objectContaining({presenceOccurredAt:'2026-11-17T08:00:00.950Z',stageDates:{arrived:'2026-11-17T08:00:00.900Z',approved:null,in_progress:'2026-11-17T08:00:00.950Z',ready:null}}),api.profile.tenant_id));
  });
  it("parses an edited auto-filled milestone explicitly instead of restoring its generated subsecond time",async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-17T08:00:00.950Z'));context.stage_dates={arrived:'2026-11-17T08:00:00.900Z'};show();await open();
    fireEvent.change(screen.getByLabelText('Operational stage'),{target:{value:'in_progress'}});
    fireEvent.change(screen.getByLabelText('Work start date and time'),{target:{value:'2026-11-17T12:00:01'}});confirm();
    vi.setSystemTime(new Date('2026-11-17T08:00:01.500Z'));fireEvent.click(screen.getByRole('button',{name:'Save manager correction'}));
    await waitFor(()=>expect(api.adjust).toHaveBeenCalled());expect(api.adjust.mock.calls[0][0].stageDates.in_progress).toBe('2026-11-17T08:00:01.000Z');
    expect(api.adjust.mock.calls[0][0].presenceOccurredAt).toBe('2026-11-17T08:00:00.950Z');
  });
  it("guards double clicks and retains one request ID after an unconfirmed failure", async () => {
    const pending = deferred<VehicleVisitManagerContext>(); api.adjust.mockReturnValueOnce(pending.promise); show(); await open(); confirm();
    const save = screen.getByRole("button", { name: "Save manager correction" }); fireEvent.click(save); fireEvent.click(save); expect(api.adjust).toHaveBeenCalledTimes(1);
    const first = api.adjust.mock.calls[0][0]; await act(async () => pending.reject(new Error("VEHICLE_VISIT_MANAGER_SAVE_NOT_CONFIRMED")));
    expect(await screen.findByRole("alert")).toHaveTextContent("The correction could not be verified"); expect(api.success).not.toHaveBeenCalled(); expect(api.changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save manager correction" })); await waitFor(() => expect(api.adjust).toHaveBeenCalledTimes(2)); expect(api.adjust.mock.calls[1][0].requestId).toBe(first.requestId);
  });
  it("reports a verified save separately from failure to refresh the enclosing visit", async () => {
    api.changed.mockRejectedValue(new Error("refresh failed")); show(); await open(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Save manager correction" }));
    await waitFor(() => expect(api.info).toHaveBeenCalledWith("The correction was saved, but the page could not be refreshed. Reload the visit before another action."));
    expect(api.adjust).toHaveBeenCalledTimes(1); expect(api.success).not.toHaveBeenCalled(); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("keeps completed visits and their signed delivery date read-only without a duplicate return action", async () => {
    context.stage = "delivered"; context.editable = false; context.stage_dates.delivered = "2026-11-16T08:25:30.444Z"; show(visit(entryId, "delivered", true)); await open(true);
    expect(screen.getByLabelText("Operational stage")).toBeDisabled(); expect(screen.getByLabelText("Actual vehicle location")).toBeDisabled();
    expect((screen.getByLabelText("Final delivery date and time") as HTMLInputElement).value.slice(0,19)).toBe("2026-11-16T12:25:30"); expect(screen.getByLabelText("Final delivery date and time")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save manager correction" })).toBeNull(); expect(screen.queryByRole("button", { name: /return|review visit/i })).toBeNull(); expect(api.adjust).not.toHaveBeenCalled();
  });
  it("keeps a visit that became closed during the fresh read read-only", async () => {
    context.stage = "delivered"; context.editable = false; show(); await open(); expect(screen.queryByRole("button", { name: "Save manager correction" })).toBeNull(); expect(api.adjust).not.toHaveBeenCalled();
  });
  it("preserves the review-intake signature gate for new work while permitting location-only correction at the same stage", async () => {
    context.is_review = true; context.intake_signed = false; context.stage = "in_progress"; context.stage_dates.approved = null; show(visit(entryId, "in_progress")); await open();
    expect(screen.queryByLabelText("Approval date and time")).toBeNull(); expect(screen.queryByRole("option", { name: "Approved" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Actual vehicle location"), { target: { value: "with_customer" } }); confirm(); expect(screen.getByRole("button", { name: "Save manager correction" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Operational stage"), { target: { value: "ready" } }); confirm(); expect(screen.getByRole("button", { name: "Save manager correction" })).toBeDisabled(); expect(screen.getByText(/current review intake must be signed/)).toBeVisible(); expect(api.adjust).not.toHaveBeenCalled();
  });
  it("shows a review's recorded historical approval date without adding a new approval action",async()=>{
    context.is_review=true;show();await open();expect(screen.getByLabelText("Approval date and time")).toBeVisible();expect(screen.queryByRole("option",{name:"Approved"})).toBeNull();
  });
  it("renders Arabic manager labels and RTL layout when the active language is Arabic",async()=>{
    api.language="ar";await i18n.changeLanguage("ar");show();fireEvent.click(screen.getByRole("button",{name:"تعديل الموقع والمرحلة والتواريخ"}));
    expect(await screen.findByLabelText("موقع المركبة الفعلي")).toBeVisible();expect(screen.getByRole("dialog").querySelector('[dir="rtl"]')).not.toBeNull();expect(screen.getByRole("button",{name:"حفظ تصحيح المدير"})).toBeDisabled();
  });
  it("does not apply a resolved old-context read to another visit", async () => {
    const old = deferred<VehicleVisitManagerContext>(); api.read.mockReturnValueOnce(old.promise); const view = show(); fireEvent.click(screen.getByRole("button", { name: "Edit location, stage and dates" }));
    view.rerender(visit(nextEntryId)); await screen.findByLabelText("Operational stage"); await act(async () => old.resolve(freshContext())); confirm();
    fireEvent.click(screen.getByRole("button", { name: "Save manager correction" })); await waitFor(() => expect(api.adjust).toHaveBeenCalled()); expect(api.adjust.mock.calls[0][0].entryId).toBe(nextEntryId);
  });
  it("suppresses old save feedback after the selected visit changes", async () => {
    const pending = deferred<VehicleVisitManagerContext>(); api.adjust.mockReturnValueOnce(pending.promise); const view = show(); await open(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Save manager correction" }));
    view.rerender(visit(nextEntryId)); await screen.findByLabelText("Operational stage"); await act(async () => pending.resolve(freshContext())); expect(api.success).not.toHaveBeenCalled(); expect(api.changed).not.toHaveBeenCalled();
  });
  it("fails closed on a context read error and retries without a write", async () => {
    api.read.mockRejectedValueOnce(new Error("unavailable")); show(); fireEvent.click(screen.getByRole("button", { name: "Edit location, stage and dates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The visit could not be verified"); expect(api.adjust).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); await screen.findByLabelText("Operational stage"); expect(api.adjust).not.toHaveBeenCalled();
  });
});
