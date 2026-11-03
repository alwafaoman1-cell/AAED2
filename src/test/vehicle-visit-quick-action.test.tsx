// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleVisitQuickActionDialog } from "@/pages/vehicle-entry/VehicleVisitQuickActionDialog";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), advance: vi.fn(), markReturn: vi.fn(), staff: vi.fn() }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>()),
  getVehicleVisitDetail: mocks.detail,
  advanceVehicleVisit: mocks.advance,
  listVehicleVisitStaff: mocks.staff,
}));
vi.mock("@/lib/vehicleInspectionRelease", () => ({ markInspectionVehicleReturned: mocks.markReturn }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, hasRole: (...roles: string[]) => roles.includes("admin") }),
}));

function visit(status: string, stage: "arrived" | "approved", location = "داخل الورشة") {
  return {
    entry: {
      id: "entry-1", entry_number: "ENT-1", vehicle_id: "vehicle-1", vehicle_location: location,
      insurance_claim_id: "claim-1",
      claim: { id: "claim-1", claim_number: "CLAIM-1", status, vehicle_id: "vehicle-1",
        vehicle_presence_status: location === "داخل الورشة" ? "in_workshop" : "with_customer" },
      work_order: { id: "order-1", order_number: "WO-1", vehicle_id: "vehicle-1", status: "received", vehicle_presence_status: "in_workshop" },
    },
    workflow: { entry_id: "entry-1", stage, revision: 0, review_reason: null },
    stage, reviewReason: null, hasFinalHandover: false,
    releases: [], handovers: [], documents: [], documentFiles: [], expenses: [], cashInvoices: [], insuranceInvoices: [], mediaCount: 0,
  };
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <VehicleVisitQuickActionDialog row={{ id: "entry-1", entry_number: "ENT-1", vehicle_location: "داخل الورشة" }} open onOpenChange={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  mocks.detail.mockReset(); mocks.advance.mockReset(); mocks.markReturn.mockReset(); mocks.staff.mockReset();
  mocks.staff.mockResolvedValue([{ user_id: "user-1", full_name: "Manager" }]);
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(() => ({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});

describe("vehicle visit quick action", () => {
  it("opens the existing approval dialog route and does not move a pending claim stage", async () => {
    mocks.detail.mockResolvedValue(visit("pending", "arrived"));
    renderDialog();
    expect((await screen.findByRole("link", { name: "اعتماد المطالبة" })).getAttribute("href"))
      .toBe("/insurance/claim-1?visitAction=approve");
    expect(screen.queryByRole("button", { name: "تأكيد الانتقال" })).toBeNull();
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("records a valid stage transition through the existing RPC and cloud readback", async () => {
    mocks.detail.mockResolvedValueOnce(visit("approved", "arrived")).mockResolvedValue({
      ...visit("approved", "approved"), workflow: { entry_id: "entry-1", stage: "approved", revision: 1, review_reason: null },
    });
    mocks.advance.mockResolvedValue({ stage: "approved", revision: 1 });
    renderDialog();
    fireEvent.change(await screen.findByLabelText("ملاحظات"), { target: { value: "اعتماد موثق" } });
    fireEvent.change(screen.getByLabelText(/المتطلبات/), { target: { value: "مراجعة الموافقة" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الانتقال" }));
    await waitFor(() => expect(mocks.advance).toHaveBeenCalledWith(expect.objectContaining({
      entryId: "entry-1", revision: 0, stage: "approved", notes: "اعتماد موثق",
      responsibleUserId: "user-1", requirements: { details: "مراجعة الموافقة", customer_approved: false },
    })));
    await waitFor(() => expect(mocks.detail.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("requires a physical confirmation before recording return from a signed release", async () => {
    const outside = visit("approved", "approved", "مع العميل");
    outside.entry.work_order.vehicle_presence_status = "with_customer";
    outside.releases = [{ id: "release-1", status: "signed", returned_at: null }] as any;
    const inside = visit("approved", "approved");
    mocks.detail.mockResolvedValueOnce(outside).mockResolvedValue(inside);
    mocks.markReturn.mockResolvedValue({ returned_at: "2026-11-03T10:00:00Z" });
    renderDialog();
    const button = await screen.findByRole("button", { name: "تسجيل عودة المركبة" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/تحققت من عودة المركبة/));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.markReturn).toHaveBeenCalledWith("release-1"));
  });
});
