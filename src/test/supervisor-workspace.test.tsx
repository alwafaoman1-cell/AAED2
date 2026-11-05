// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import SupervisorApp from "@/pages/apps/SupervisorApp";
import { listSupervisorLegacyOrders, listSupervisorVisits, readSupervisorOrder, supervisorCanOpenAction, supervisorEntryPath, supervisorVehicleFromLegacy, supervisorVehicleFromVisit } from "@/lib/supervisorWorkspace";
import type { VehicleVisitItem } from "@/lib/vehicleVisitLifecycle";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { buildPartsRequestMessage, buildSupplierPartsRequest } from "@/lib/partsWhatsApp";
import { SupervisorPartsMessenger } from "@/components/supervisor/SupervisorPartsMessenger";

const mocks = vi.hoisted(() => ({ page: vi.fn(), legacy: vi.fn(), linked: vi.fn(), read: vi.fn(), from: vi.fn(), send: vi.fn(), can: true }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({
  VISIT_STAGES: ["arrived", "approved", "in_progress", "ready", "delivered", "cancelled", "needs_review"],
  listVehicleVisitCenterPage: mocks.page, getLinkedVehicleVisit: mocks.linked,
  getVehicleVisitBillingKind: (entry: any) => entry.insurance_claim_id ? "insurance" : "cash",
}));
vi.mock("@/lib/vehicleEntryService", () => ({ getVehicleEntryPresence: (entry: any) => entry.vehicle_location === "مع العميل" ? "with_customer" : "in_workshop" }));
vi.mock("@/lib/workOrdersStore", () => ({ fetchWorkOrderListPage: mocks.legacy, fetchWorkOrderFromCloudByIdentifier: mocks.read, isPartStillNeeded: () => true, NEEDED_PART_STATUS_LABELS: {} }));
vi.mock("@/lib/partsWhatsApp", async (original) => ({ ...(await original<typeof import("@/lib/partsWhatsApp")>()), sendWhatsAppAndLog: mocks.send }));
vi.mock("@/lib/messaging/messagingService", () => ({ sendUnifiedMessage: vi.fn() }));
vi.mock("@/lib/systemPreferences", () => ({ readSystemPreferences: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/rbac", () => ({ useCan: () => mocks.can }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant", role: "supervisor" }, hasRole: (...roles: string[]) => roles.includes("supervisor"), signOut: vi.fn() }) }));
vi.mock("@/hooks/useRealtimeSync", () => ({ useRealtimeSync: vi.fn() }));
vi.mock("@/lib/vehicleRearThumbnails", () => ({ getEntryRearThumbnailUrls: vi.fn().mockResolvedValue({}) }));
vi.mock("@/components/LanguageSwitcher", () => ({ default: () => <span>EN</span> }));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
function visit(overrides: Record<string, unknown> = {}): VehicleVisitItem {
  return {
    entry: { id: "entry", tenant_id: "tenant", vehicle_id: "vehicle", entry_number: "VE-1", vehicle_location: "مع العميل",
      customer: { name: "Registry owner", phone: "1" }, customer_snapshot: { name: "Actual visitor" },
      vehicle: { make: "Toyota", model: "Old" }, vehicle_snapshot: { model: "Snapshot model" },
      work_order_id: ORDER_ID,
      work_order: { id: ORDER_ID, tenant_id: "tenant", vehicle_id: "vehicle", vehicle_entry_id: "entry", work_order_type: "general_customer", order_number: "WO-1" },
      ...overrides },
    stage: "in_progress", operationalStage: "in_progress", workflow: null, reviewReason: null, hasFinalHandover: false,
  };
}
function order(id = ORDER_ID): WorkOrder { return { cloudId: id, id: "WO-1", customer: "Owner", plate: "A 123", vehicleType: "Toyota", model: "Camry", year: "2020", status: "تحت الإصلاح" } as WorkOrder; }
function projection(data: unknown, error: unknown = null) {
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(async () => ({ data, error })), or: vi.fn(async () => ({ data, error })) };
  return query;
}
beforeEach(async () => {
  vi.clearAllMocks(); mocks.can = true;
  await i18n.changeLanguage("en");
  mocks.page.mockResolvedValue({ items: [], total: 0 });
  mocks.linked.mockResolvedValue(null);
  mocks.send.mockResolvedValue({});
  mocks.legacy.mockResolvedValue({ rows: [], pagination: { page: 1, pageSize: 20, totalRows: 0, totalPages: 0 } });
});

describe("reviewed supplier request", () => {
  it("produces English-only controlled template labels, including part status", () => {
    const current = { ...order(), partsNeeded: [{ id: "part", name: "Bumper", quantity: 1, status: "pending" }] } as WorkOrder;
    const customer = buildPartsRequestMessage(current, { language: "en" });
    const supplier = buildSupplierPartsRequest({ supplierName: "Supplier One", parts: current.partsNeeded!, workOrder: current, language: "en" });
    expect(customer).toContain("Pending");
    expect(supplier).toContain("Supplier One");
    expect(customer + supplier).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("requires a selected supplier and sends only to the fresh supplier phone, never the customer", async () => {
    const current = { ...order(), phone: "+96890000001", partsNeeded: [{ id: "part", name: "Bumper", quantity: 1, status: "pending" }] } as WorkOrder;
    const supplier = { id: "supplier", name: "Supplier One", phone: "+96890000002" };
    mocks.read.mockResolvedValue(current);
    mocks.from.mockImplementation(() => {
      const query: any = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: [supplier], error: null }), maybeSingle: async () => ({ data: supplier, error: null }) };
      return query;
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><SupervisorPartsMessenger row={supervisorVehicleFromLegacy(current)} order={current} target="supplier" onClose={vi.fn()} /></QueryClientProvider>);
    expect((screen.getByRole("button", { name: "Send reviewed request" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: /Supplier One/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Supplier One/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send reviewed request" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ phone: supplier.phone, recipientType: "supplier", workOrderId: ORDER_ID })));
    expect(mocks.send.mock.calls[0][0].phone).not.toBe(current.phone);
  });
});
afterEach(cleanup);

describe("supervisor identities and source contracts", () => {
  it("merges visitor/vehicle snapshots over the registry while retaining missing fields", () => {
    const row = supervisorVehicleFromVisit(visit());
    expect(row.customer).toBe("Actual visitor");
    expect(row.vehicle).toBe("Toyota Snapshot model");
    expect(row.workOrderId).toBe(ORDER_ID);
    expect(row.custody).toBe("with_customer");
    expect(row.stage).toBe("in_progress");
  });
  it("never supplies inferred or cross-vehicle orders to write-capable tools", () => {
    expect(supervisorVehicleFromVisit(visit({ __inferredOrderLink: true })).workOrderId).toBeUndefined();
    const source = visit(); source.entry.work_order.vehicle_id = "another-vehicle";
    expect(supervisorVehicleFromVisit(source).workOrderId).toBeUndefined();
  });
  it("claim-only arrivals and legacy orders cannot change canonical stages", () => {
    const claim = supervisorVehicleFromVisit(visit({ _claimOnly: true, insurance_claim_id: "claim" }));
    expect(supervisorCanOpenAction(claim, "stages")).toBe(false);
    expect(supervisorCanOpenAction(claim, "messages")).toBe(true);
    expect(supervisorEntryPath(claim)).toBe("/supervisor/entry/new?claim=claim");
    const legacy = supervisorVehicleFromLegacy(order());
    expect(legacy.custody).toBe("needs_review");
    expect(supervisorCanOpenAction(legacy, "stages")).toBe(false);
    expect(supervisorCanOpenAction(legacy, "photos")).toBe(true);
    expect(supervisorEntryPath(legacy)).toBe(`/supervisor/entry/new?work_order=${ORDER_ID}`);
  });
  it("existing visits open only supervisor routes", () => {
    const row = supervisorVehicleFromVisit(visit());
    expect(supervisorEntryPath(row)).toBe("/supervisor/entry/entry/complete");
    expect(supervisorEntryPath(row, true)).toBe("/supervisor/entry/entry/edit");
  });
  it("forwards channel and pagination to the canonical server instead of filtering a page", async () => {
    await listSupervisorVisits({ tab: "in_workshop", page: 3, filters: { channel: "insurance", search: "123" } });
    expect(mocks.page).toHaveBeenCalledWith({ tab: "in_workshop", page: 3, pageSize: 20, filters: { channel: "insurance", search: "123" } });
  });
  it("fresh-reads the UUID and rejects changed links before opening tools", async () => {
    const row = supervisorVehicleFromVisit(visit());
    mocks.read.mockResolvedValue(order()); mocks.linked.mockResolvedValue({ entryId: "another-visit" });
    await expect(readSupervisorOrder(row)).rejects.toThrow("SUPERVISOR_ORDER_LINK_CHANGED");
    expect(mocks.read).toHaveBeenCalledWith(ORDER_ID);
    mocks.linked.mockResolvedValue({ entryId: "entry", reviewReason: null });
    expect(await readSupervisorOrder(row)).toEqual(order());
  });
  it("does not resolve order codes by plate or silently accept a missing readback", async () => {
    const row = supervisorVehicleFromLegacy(order()); mocks.read.mockResolvedValue(null);
    await expect(readSupervisorOrder(row)).rejects.toThrow("SUPERVISOR_ORDER_UNAVAILABLE");
    await expect(readSupervisorOrder({ ...row, workOrderId: undefined })).rejects.toThrow("SUPERVISOR_ORDER_ID_REQUIRED");
  });
  it("checks bounded direct/reverse links in two projections, with honest candidate pagination", async () => {
    const pagination = { page: 2, pageSize: 20, totalRows: 80, totalPages: 4 };
    mocks.legacy.mockResolvedValue({ rows: [order(), order(SECOND_ID)], pagination });
    mocks.from.mockImplementation((table: string) => projection(table === "job_orders"
      ? [{ id: ORDER_ID, vehicle_entry_id: null }, { id: SECOND_ID, vehicle_entry_id: null }]
      : [{ id: "entry", work_order_id: SECOND_ID, converted_work_order_id: null }]));
    const result = await listSupervisorLegacyOrders({ tenantId: "tenant", page: 2, search: "", channel: "cash" });
    expect(result.rows.map((row) => row.workOrderId)).toEqual([ORDER_ID]);
    expect(result.pagination).toEqual(pagination);
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.linked).not.toHaveBeenCalled();
    expect(mocks.legacy).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 20, filters: { archive: "active", ownership: "cash" } }));
  });
  it("propagates failed link reads, never turning them into an empty list", async () => {
    mocks.legacy.mockResolvedValue({ rows: [order()], pagination: {} });
    mocks.from.mockImplementation((table: string) => projection([], table === "vehicle_entries" ? new Error("offline") : null));
    await expect(listSupervisorLegacyOrders({ tenantId: "tenant", page: 1, search: "", channel: "all" })).rejects.toThrow("offline");
  });
});

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><SupervisorApp /></MemoryRouter></QueryClientProvider>);
}
describe("supervisor active-tab loading", () => {
  it("loads only active visits initially and terminal/legacy data only when selected", async () => {
    renderWorkspace();
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(1));
    expect(mocks.page.mock.calls[0][0].tab).toBe("in_workshop");
    expect(mocks.legacy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delivered" }));
    await waitFor(() => expect(mocks.page).toHaveBeenCalledWith(expect.objectContaining({ tab: "delivered" })));
    expect(mocks.page.mock.calls.some(([request]) => request.tab === "cancelled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Older orders" }));
    await waitFor(() => expect(mocks.legacy).toHaveBeenCalledTimes(1));
  });
  it("renders a retry error, not a false empty result", async () => {
    mocks.page.mockRejectedValue(new Error("offline")); renderWorkspace();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not load confirmed records"));
    expect(screen.queryByText("No matching visits.")).toBeNull();
  });
  it("keeps legacy fallback and entry/expense creation behind their permissions", async () => {
    mocks.can = false; renderWorkspace();
    await waitFor(() => expect(mocks.page).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Older orders" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vehicle entry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Workshop expense" })).toBeNull();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
