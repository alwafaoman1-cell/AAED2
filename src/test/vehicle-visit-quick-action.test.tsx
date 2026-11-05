// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleVisitQuickActionDialog } from "@/pages/vehicle-entry/VehicleVisitQuickActionDialog";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), advance: vi.fn(), markReturn: vi.fn(), reconcile: vi.fn(), staff: vi.fn(), permitted: true }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>()),
  getVehicleVisitDetail: mocks.detail,
  advanceVehicleVisit: mocks.advance,
  reconcileVehicleVisitCustody: mocks.reconcile,
  listVehicleVisitStaff: mocks.staff,
}));
vi.mock("@/lib/vehicleInspectionRelease", () => ({ markInspectionVehicleReturned: mocks.markReturn }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { tenant_id: "tenant-1" }, hasRole: (...roles: string[]) => mocks.permitted && roles.includes("admin") }),
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
    stage, operationalStage: stage, reviewReason: null, hasFinalHandover: false,
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
  mocks.detail.mockReset(); mocks.advance.mockReset(); mocks.markReturn.mockReset(); mocks.reconcile.mockReset(); mocks.staff.mockReset();
  mocks.permitted = true;
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

  it("offers only documented temporary or final release when customer custody is selected", async () => {
    mocks.detail.mockResolvedValue(visit("approved", "approved"));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "مع العميل" }));
    expect(screen.getByRole("link", { name: "خروج مؤقت بمحضر استلام" })).toHaveAttribute("href", "/vehicle-entry/entry-1/inspection-release");
    expect(screen.getByRole("link", { name: "تسليم نهائي موثّق" })).toHaveAttribute("href", "/work-orders/WO-1/delivery");
    expect(mocks.markReturn).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("keeps the custody actions English-only in the English UI", async () => {
    await i18n.changeLanguage("en");
    mocks.detail.mockResolvedValue(visit("approved", "approved"));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "With customer" }));
    expect(screen.getByRole("link", { name: "Temporary release with signed record" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Documented final handover" })).toBeTruthy();
  });

  it("requires a physical confirmation before recording return from a signed release", async () => {
    const outside = visit("approved", "approved", "مع العميل");
    outside.entry.work_order.vehicle_presence_status = "with_customer";
    outside.releases = [{ id: "release-1", status: "signed", returned_at: null }] as any;
    const inside = visit("approved", "approved");
    inside.releases = [{ id: "release-1", status: "signed", returned_at: "2026-11-03T10:00:00Z" }] as any;
    mocks.detail.mockResolvedValueOnce(outside).mockResolvedValueOnce(outside).mockResolvedValue(inside);
    mocks.markReturn.mockResolvedValue({ returned_at: "2026-11-03T10:00:00Z" });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "داخل الورشة" }));
    const button = await screen.findByRole("button", { name: "تسجيل الدخول" });
    expect(screen.getByLabelText("وقت تأكيد العودة (عُمان)")).toHaveAttribute("readonly");
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/تحققت من عودة المركبة/));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.markReturn).toHaveBeenCalledWith("release-1"));
    await waitFor(() => expect(mocks.detail.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(mocks.detail.mock.invocationCallOrder[1]).toBeLessThan(mocks.markReturn.mock.invocationCallOrder[0]);
    expect(mocks.detail.mock.invocationCallOrder[2]).toBeGreaterThan(mocks.markReturn.mock.invocationCallOrder[0]);
  });

  it("refuses a stale return when the release was already returned elsewhere", async () => {
    const outside = visit("approved", "approved", "مع العميل");
    outside.entry.work_order.vehicle_presence_status = "with_customer";
    outside.releases = [{ id: "release-1", status: "signed", returned_at: null }] as any;
    mocks.detail.mockResolvedValueOnce(outside).mockResolvedValue({ ...outside, releases: [{ id: "release-1", status: "signed", returned_at: "2026-11-04T08:00:00Z" }] });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "داخل الورشة" }));
    fireEvent.click(screen.getByLabelText(/تحققت من عودة المركبة/));
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    await waitFor(() => expect(mocks.detail.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(mocks.markReturn).not.toHaveBeenCalled();
  });

  it("does not offer a signed-release return to users without custody permission", async () => {
    mocks.permitted = false;
    const outside = visit("approved", "approved", "مع العميل");
    outside.entry.work_order.vehicle_presence_status = "with_customer";
    outside.releases = [{ id: "release-1", status: "signed", returned_at: null }] as any;
    mocks.detail.mockResolvedValue(outside);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "داخل الورشة" }));
    expect(screen.queryByRole("button", { name: "تسجيل الدخول" })).toBeNull();
    expect(mocks.markReturn).not.toHaveBeenCalled();
  });

  it("requires physical verification and a reason before manager custody reconciliation", async () => {
    const conflict = visit("approved", "approved");
    conflict.entry.claim.vehicle_presence_status = "with_customer";
    conflict.entry.work_order.vehicle_presence_status = "with_customer";
    conflict.reviewReason = "custody_conflict" as any;
    mocks.detail.mockResolvedValueOnce(conflict).mockResolvedValue(visit("approved", "approved"));
    mocks.reconcile.mockResolvedValue(undefined);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "داخل الورشة" }));
    expect(screen.getByText("مراجعة السجل والروابط قبل التصحيح")).toBeTruthy();
    expect(screen.getByText("CLAIM-1").parentElement?.textContent).toContain("مع العميل");
    const button = screen.getByRole("button", { name: "تأكيد الموقع وتوثيق التصحيح" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText("تحققت بنفسي أن المركبة داخل الورشة الآن"));
    fireEvent.change(screen.getByLabelText("سبب الإلغاء أو الرجوع"), { target: { value: "تحقق المدير من وجود المركبة في الورشة" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledWith("entry-1", "تحقق المدير من وجود المركبة في الورشة"));
    await waitFor(() => expect(mocks.detail.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
