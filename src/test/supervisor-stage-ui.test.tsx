// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { VehicleVisitControlPanel } from "@/pages/vehicle-entry/VehicleVisitControlPanel";
import "@/lib/i18n/supervisorWorkspace";

const m = vi.hoisted(() => ({ detail: vi.fn(), staff: vi.fn(), advance: vi.fn(), blocker: null as string | null, manager: true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "staff" }, profile: { tenant_id: "tenant" }, hasRole: (...roles: string[]) => roles.includes(m.manager ? "manager" : "supervisor") }) }));
vi.mock("@/lib/vehicleVisitLifecycle", async original => ({ ...await original<typeof import("@/lib/vehicleVisitLifecycle")>(),
  getVehicleVisitDetail: m.detail, listVehicleVisitStaff: m.staff, advanceVehicleVisit: m.advance,
  getVehicleVisitNextBlocker: () => m.blocker, getVehicleVisitReverseBlocker: () => null, canReconcileVehicleVisitCustody: () => false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(() => { throw new Error("Unexpected history prefetch"); }) } }));
vi.mock("@/lib/vehicleEntryService", () => ({ confirmVehicleEntryWorkOrderLink: vi.fn(), getVehicleEntry: vi.fn(), getVehicleEntryPresence: () => "in_workshop", getVehicleVisitBillingKind: () => "insurance", listVehicleEntries: vi.fn() }));
vi.mock("@/lib/documentExtraction/persistence", () => ({ getPrivateDocumentUrl: vi.fn() }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: vi.fn() }));
vi.mock("@/components/vehicle-entry/VehicleEntryInspectionAction", () => ({ VehicleEntryInspectionAction: () => null }));

const visit = () => ({ entry: { id: "one", entry_number: "ENT-1", vehicle_id: "car", work_order_id: "order",
  claim: { id: "claim", claim_number: "CLAIM-1", status: "pending", vehicle_id: "car" },
  work_order: { id: "order", vehicle_id: "car", vehicle_entry_id: "one", order_number: "WO-I-26-0001", status: "received" } },
  stage: "approved", operationalStage: "approved", workflow: { stage: "approved", revision: 2 }, reviewReason: null,
  hasFinalHandover: false, transitions: [], documents: [], documentFiles: [], expenses: [], cashInvoices: [], insuranceInvoices: [], handovers: [] });
function mount(props: Partial<Parameters<typeof VehicleVisitControlPanel>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><VehicleVisitControlPanel entryId="one" supervisor {...props} /></MemoryRouter></QueryClientProvider>);
}
beforeEach(async () => {
  vi.clearAllMocks(); m.manager = true; m.blocker = null; await i18n.changeLanguage("en");
  m.detail.mockResolvedValue(visit()); m.staff.mockResolvedValue([{ user_id: "staff", full_name: "Manager" }]);
});
afterEach(cleanup);
describe("in-app compact stage actions", () => {
  it("opens insurance approval in the current workspace rather than navigating to the insurance site", async () => {
    m.blocker = "claimApprovalRequired";
    const onApproval = vi.fn(); const { container } = mount({ onRequestClaimApproval: onApproval });
    await waitFor(() => expect(screen.getByRole("button", { name: "Review insurance approval" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Review insurance approval" }));
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(container.querySelector('a[href^="/insurance/"]')).toBeNull();
    expect(container.querySelectorAll('details[open]')).toHaveLength(0);
  });
  it("keeps approval unavailable for a role without approval authority", async () => {
    m.manager = false; m.blocker = "claimApprovalRequired"; mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review insurance approval" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Review insurance approval" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("preserves responsible user/date, optional notes, exact revision and cloud readback", async () => {
    const fresh = visit();
    m.advance.mockImplementation(async () => { fresh.workflow = { stage: "in_progress", revision: 3 }; fresh.stage = fresh.operationalStage = "in_progress"; m.detail.mockResolvedValue(fresh); return { stage: "in_progress", revision: 3 }; });
    mount();
    const next = await screen.findByRole("button", { name: /next stage.*Work in progress/i });
    fireEvent.click(next);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector('input[type="datetime-local"]')).toBeTruthy();
    expect(dialog.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm transition" }));
    await waitFor(() => expect(m.advance).toHaveBeenCalledWith(expect.objectContaining({ entryId: "one", revision: 2, stage: "in_progress", responsibleUserId: "staff" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.detail.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
