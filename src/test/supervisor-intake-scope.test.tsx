// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVehicleEntryEditor } from "@/hooks/useVehicleEntryEditor";
import { defaultVehicleEntryForm } from "@/lib/vehicleEntryService";
import type { SupervisorIntakeSource } from "@/lib/supervisorIntakeSource";

const mock = vi.hoisted(() => ({
  tenant: "tenant-a" as string | null, params: {} as { id?: string }, search: "",
  source: vi.fn(), save: vi.fn(), get: vi.fn(), upload: vi.fn(), link: vi.fn(),
  navigate: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(),
  createUrl: vi.fn(), revokeUrl: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useParams: () => mock.params, useSearchParams: () => [new URLSearchParams(mock.search)], useNavigate: () => mock.navigate }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "staff" }, profile: { tenant_id: mock.tenant, full_name: "Test supervisor" } }) }));
vi.mock("@/hooks/useInsuranceEmployees", () => ({ useInsuranceEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useVehicleMakesModels", () => ({ useVehicleMakes: () => ({ data: [] }) }));
vi.mock("@/lib/supervisorIntakeSource", () => ({ loadSupervisorIntakeSource: mock.source }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getVehicleVisitDetail: async () => null }));
vi.mock("@/lib/pdfGenerator", () => ({ getTemplateSettings: () => ({}) }));
vi.mock("@/lib/safePdfWindow", () => ({ openSanitizedPdfWindow: vi.fn(), openAndPrintWindow: vi.fn(), downloadSanitizedPdf: vi.fn() }));
vi.mock("@/lib/vehicleEntryService", async original => ({ ...await original<typeof import("@/lib/vehicleEntryService")>(), saveVehicleEntry: mock.save, getVehicleEntry: mock.get, uploadVehicleEntryFiles: mock.upload }));
vi.mock("@/lib/documentExtraction/persistence", () => ({ linkDocumentFile: mock.link }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(() => { throw new Error("Unexpected backend access"); }), rpc: vi.fn(() => { throw new Error("Unexpected RPC"); }) } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: vi.fn(async () => mock.tenant) }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error, warning: mock.warning } }));

const CLAIM_A = "11111111-1111-4111-8111-111111111111";
const CLAIM_B = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const query = (claim = CLAIM_A) => `claim=${claim}&channel=insurance&purpose=inspection`;
function sourceForm(claimId: string | null, orderId: string | null = null): SupervisorIntakeSource {
  const base = defaultVehicleEntryForm();
  return { existingEntryId: null, channel: claimId ? "insurance" : "cash", form: {
    ...base, customer_id: `customer-${mock.tenant}`, vehicle_id: `vehicle-${mock.tenant}`,
    insurance_claim_id: claimId, work_order_id: orderId, arrival_date: "2026-11-05", arrival_time: "10:30",
    customer: { ...base.customer, name: "Visit customer", phone: "+96899112233" },
    vehicle: { ...base.vehicle, plate_number: "24680", make: "Toyota", model: "Prado" },
    delivered_by: { ...base.delivered_by, full_name: "Visit customer", phone: "+96899112233" },
  } };
}
function entry(id = "saved-entry", tenant = mock.tenant) {
  return { id, tenant_id: tenant, customer_id: "customer", vehicle_id: "vehicle", status: "Issued", entry_number: "VE-TEST",
    arrival_date: "2026-11-05", arrival_time: "10:30", vehicle_location: "داخل الورشة",
    customer_snapshot: { name: "Visit customer", phone: "+96899112233" },
    vehicle_snapshot: { plate_number: "24680", make: "Toyota", model: "Prado" }, vehicle_condition: { visit_purpose: "inspection" } };
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const clients: QueryClient[] = [];
function editor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  const renders: Array<{ tenant: string | null; search: string; canSave: boolean }> = [];
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => { const value = useVehicleEntryEditor({ workspace: "supervisor" }); renders.push({ tenant: mock.tenant, search: mock.search, canSave: value.canSave }); return value; }, { wrapper }), client, renders };
}
function stageAttachments(result: ReturnType<typeof editor>["result"]) {
  act(() => {
    result.current.stageEntryPhoto("rear_view", new File(["synthetic"], "old-scope.jpg", { type: "image/jpeg" }));
    result.current.setPendingDocumentFileId("old-scope-document");
    result.current.setCustomerSearch("old customer"); result.current.setVehicleSearch("old vehicle"); result.current.setStep(4);
  });
  expect(result.current.pendingPhotos).toHaveLength(1);
}
beforeEach(() => {
  vi.resetAllMocks(); mock.tenant = "tenant-a"; mock.params = {}; mock.search = query();
  mock.createUrl.mockReturnValue("blob:old-scope");
  vi.stubGlobal("URL", class extends URL { static createObjectURL = mock.createUrl; static revokeObjectURL = mock.revokeUrl; });
  mock.source.mockImplementation(async ({ claimId, workOrderId }) => sourceForm(claimId || null, workOrderId || (claimId ? ORDER : null)));
  mock.save.mockImplementation(async () => entry()); mock.get.mockImplementation(async (id: string) => entry(id));
  mock.link.mockResolvedValue(undefined); mock.upload.mockResolvedValue([]);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

describe("supervisor intake scope isolation", () => {
  it.each(["tenant", "claim", "source removal", "work-order removal"] as const)("clears old links, pending photos and document IDs on %s change", async change => {
    if (change === "work-order removal") mock.search = `work_order=${ORDER}&channel=cash&purpose=inspection`;
    const previousSearch = mock.search; const needsHydration = change === "tenant" || change === "claim";
    const h = editor(); await waitFor(() => expect(h.result.current.canSave).toBe(true)); stageAttachments(h.result);
    expect(h.result.current.form.work_order_id).toBe(ORDER);
    const waiting = deferred<SupervisorIntakeSource>();
    if (needsHydration) mock.source.mockReturnValueOnce(waiting.promise);
    act(() => {
      if (change === "tenant") mock.tenant = "tenant-b";
      else mock.search = change === "claim" ? query(CLAIM_B) : "channel=cash&purpose=inspection";
      h.rerender();
    });
    expect(h.result.current.pendingPhotos).toEqual([]); expect(mock.revokeUrl).toHaveBeenCalledWith("blob:old-scope");
    expect(h.result.current.form.insurance_claim_id).toBeFalsy(); expect(h.result.current.form.work_order_id).toBeFalsy();
    expect(h.result.current.form.id).toBeUndefined(); expect(h.result.current.customerSearch).toBe(""); expect(h.result.current.vehicleSearch).toBe("");
    expect(h.result.current.step).toBe(1); expect(h.result.current.activePhotoCategory).toBe("front_view"); expect(h.result.current.canSave).toBe(false);
    if (needsHydration) {
      await act(async () => { waiting.resolve(sourceForm(change === "claim" ? CLAIM_B : CLAIM_A)); });
      await waitFor(() => expect(h.result.current.canSave).toBe(true));
      expect(h.result.current.form.customer_id).toBe(`customer-${mock.tenant}`);
    } else {
      expect(h.result.current.needsSource).toBe(false); expect(h.result.current.channel).toBe("cash");
      act(() => { h.result.current.selectCustomer({ id: "fresh-customer", name: "Fresh visitor", phone: "99112233" }); h.result.current.patchVehicle({ plate_number: "9876", make: "Toyota" }); });
    }
    await waitFor(() => expect(h.result.current.canSave).toBe(true));
    await act(async () => { await h.result.current.handleSave("Issued"); });
    expect(mock.save).toHaveBeenCalledOnce(); expect(mock.link).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.navigate).toHaveBeenCalledWith("/supervisor/entry/saved-entry/complete", { replace: true });
    const next = h.renders.find(render => change === "tenant" ? render.tenant === "tenant-b" : render.search !== previousSearch);
    expect(next?.canSave).toBe(false);
  });

  it("resets pending attachments when an edit route changes entry IDs", async () => {
    mock.params = { id: "entry-a" }; mock.search = "channel=cash&purpose=inspection";
    const h = editor(); await waitFor(() => expect(h.result.current.form.id).toBe("entry-a")); stageAttachments(h.result);
    act(() => { mock.params = { id: "entry-b" }; h.rerender(); });
    await waitFor(() => expect(h.result.current.form.id).toBe("entry-b"));
    expect(h.result.current.pendingPhotos).toEqual([]); expect(mock.revokeUrl).toHaveBeenCalledWith("blob:old-scope");
    await act(async () => { await h.result.current.handleSave("Issued"); });
    expect(mock.link).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled();
  });

  it("does not hydrate a wrong-tenant detail response or reuse the previous tenant's cache", async () => {
    mock.params = { id: "entry-a" }; mock.search = "channel=cash&purpose=inspection";
    const h = editor(); await waitFor(() => expect(h.result.current.form.id).toBe("entry-a"));
    mock.get.mockResolvedValue(entry("entry-a", "tenant-a"));
    act(() => { mock.tenant = "tenant-b"; h.rerender(); });
    await waitFor(() => expect(h.result.current.detail.isError).toBe(true));
    expect(h.result.current.form.id).toBeUndefined(); expect(h.result.current.form.customer_id).toBeFalsy(); expect(h.result.current.canSave).toBe(false);
    expect(mock.get).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)("ignores a late %s from the previous scope without attachments or navigation", async outcome => {
    const h = editor(); await waitFor(() => expect(h.result.current.canSave).toBe(true)); stageAttachments(h.result);
    const waiting = deferred<ReturnType<typeof entry>>(); mock.save.mockReturnValueOnce(waiting.promise);
    let pending!: Promise<void>; act(() => { pending = h.result.current.handleSave("Issued"); }); expect(mock.save).toHaveBeenCalledOnce();
    act(() => { mock.tenant = "tenant-b"; mock.search = query(CLAIM_B); h.rerender(); });
    await waitFor(() => expect(h.result.current.form.insurance_claim_id).toBe(CLAIM_B));
    await act(async () => {
      if (outcome === "resolve") waiting.resolve(entry("old-saved-entry", "tenant-a"));
      else waiting.reject(Object.assign(new Error("old failure"), { savedEntry: entry("old-saved-entry", "tenant-a") }));
      await pending;
    });
    expect(h.result.current.form.id).toBeUndefined(); expect(h.result.current.form.insurance_claim_id).toBe(CLAIM_B);
    expect(h.result.current.pendingPhotos).toEqual([]); expect(h.result.current.saving).toBe(false);
    expect(mock.link).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled(); expect(mock.get).not.toHaveBeenCalled();
    expect(mock.navigate).not.toHaveBeenCalled(); expect(mock.success).not.toHaveBeenCalled(); expect(mock.error).not.toHaveBeenCalled();
  });

  it("ignores a late read-back after a source is removed", async () => {
    const h = editor(); await waitFor(() => expect(h.result.current.canSave).toBe(true));
    const waiting = deferred<ReturnType<typeof entry>>(); mock.get.mockReturnValueOnce(waiting.promise);
    let pending!: Promise<void>; act(() => { pending = h.result.current.handleSave("Issued"); });
    await waitFor(() => expect(mock.get).toHaveBeenCalledWith("saved-entry"));
    act(() => { mock.search = "channel=cash&purpose=inspection"; h.rerender(); });
    await act(async () => { waiting.resolve(entry()); await pending; });
    expect(h.result.current.form.id).toBeUndefined(); expect(h.result.current.form.insurance_claim_id).toBeFalsy();
    expect(mock.navigate).not.toHaveBeenCalled(); expect(mock.success).not.toHaveBeenCalled();
  });

  it("does not load a source or permit saving without a tenant", () => {
    mock.tenant = null; const h = editor(); expect(h.result.current.canSave).toBe(false); expect(mock.source).not.toHaveBeenCalled();
  });
});
