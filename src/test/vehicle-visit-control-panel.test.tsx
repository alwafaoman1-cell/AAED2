// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleVisitControlPanel } from "@/pages/vehicle-entry/VehicleVisitControlPanel";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), advance: vi.fn(), staff: vi.fn() }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>();
  return {
    ...real,
    getVehicleVisitDetail: mocks.detail,
    advanceVehicleVisit: mocks.advance,
    listVehicleVisitStaff: mocks.staff,
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, hasRole: (...roles: string[]) => roles.includes("admin") }),
}));

function visit(stage: "arrived" | "approved", revision: number, persisted = true) {
  return {
    entry: { id: "entry-1", entry_number: "TEST-1", vehicle_id: "vehicle-1", vehicle_location: "داخل الورشة",
      claim: { id: "claim-1", claim_number: "TEST-C", status: "approved", vehicle_id: "vehicle-1" },
      work_order: { id: "order-1", order_number: "TEST-W", status: "received", vehicle_id: "vehicle-1" } },
    workflow: persisted ? { entry_id: "entry-1", stage, revision, review_reason: null } : null,
    stage, reviewReason: null, hasFinalHandover: false, transitions: [], handovers: [], releases: [],
    documents: [], documentFiles: [], expenses: [], cashInvoices: [], insuranceInvoices: [], mediaCount: 0,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><VehicleVisitControlPanel entryId="entry-1" /></MemoryRouter></QueryClientProvider>);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  mocks.detail.mockReset(); mocks.advance.mockReset(); mocks.staff.mockReset();
  mocks.staff.mockResolvedValue([{ user_id: "user-1", full_name: "Test Manager" }]);
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

describe("vehicle visit transition panel", () => {
  it("opens a recorded transition and confirms the cloud read-back before updating the stage", async () => {
    mocks.detail.mockResolvedValueOnce(visit("arrived", 0)).mockResolvedValueOnce(visit("approved", 1));
    mocks.advance.mockResolvedValue({ entry_id: "entry-1", stage: "approved", revision: 1 });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ملاحظات"), { target: { value: "موافقة التأمين مؤكدة" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الانتقال" }));
    await waitFor(() => expect(mocks.advance).toHaveBeenCalledWith(expect.objectContaining({
      entryId: "entry-1", revision: 0, stage: "approved", notes: "موافقة التأمين مؤكدة", responsibleUserId: "user-1",
    })));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("allows an explicit first transition for a consistent legacy visit without a silent backfill", async () => {
    mocks.detail.mockResolvedValue(visit("arrived", 0, false));
    renderPanel();
    expect(await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ })).toBeTruthy();
    expect(mocks.advance).not.toHaveBeenCalled();
  });
});
