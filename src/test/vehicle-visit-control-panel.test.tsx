// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleVisitControlPanel } from "@/pages/vehicle-entry/VehicleVisitControlPanel";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), advance: vi.fn(), reconcile: vi.fn(), staff: vi.fn(), roles: ["admin"] as string[] }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>();
  return {
    ...real,
    getVehicleVisitDetail: mocks.detail,
    advanceVehicleVisit: mocks.advance,
    reconcileVehicleVisitCustody: mocks.reconcile,
    listVehicleVisitStaff: mocks.staff,
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, hasRole: (...roles: string[]) => roles.some((role) => mocks.roles.includes(role)) }),
}));

function visit(stage: "arrived" | "approved", revision: number, persisted = true) {
  return {
    entry: { id: "entry-1", entry_number: "TEST-1", vehicle_id: "vehicle-1", vehicle_location: "داخل الورشة", insurance_claim_id: "claim-1",
      claim: { id: "claim-1", claim_number: "TEST-C", status: "approved", vehicle_id: "vehicle-1", vehicle_presence_status: "in_workshop" },
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
  mocks.detail.mockReset(); mocks.advance.mockReset(); mocks.reconcile.mockReset(); mocks.staff.mockReset();
  mocks.roles = ["admin"];
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
  it("does not present insurance approval as cash or allow a pending claim to advance", async () => {
    const pending = visit("arrived", 0);
    pending.entry.claim.status = "pending";
    mocks.detail.mockResolvedValue(pending);
    renderPanel();
    const next = await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ });
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/اعتمد المطالبة التأمينية أولًا/)).toBeTruthy();
    expect(screen.queryByText(/موافقة العميل على أعمال الإصلاح النقدي/)).toBeNull();
  });
  it("keeps a legacy insurance approval timestamp from starting work while the claim is still pending", async () => {
    const pending = visit("approved", 0);
    pending.entry.claim.status = "pending";
    mocks.detail.mockResolvedValue(pending);
    renderPanel();
    const next = await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ });
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "افتح السجل المطلوب" }).getAttribute("href")).toBe("/insurance/claim-1");
  });
  it("explains permission denial before presenting a transition the server would reject", async () => {
    mocks.roles = ["technician"];
    mocks.detail.mockResolvedValue(visit("arrived", 0));
    renderPanel();
    expect((await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/اعتماد هذه المرحلة متاح للمدير/)).toBeTruthy();
  });
  it("does not start work while the linked claim still says the vehicle is with the customer", async () => {
    const conflicting = visit("approved", 0);
    conflicting.entry.claim.vehicle_presence_status = "with_customer";
    mocks.detail.mockResolvedValue(conflicting);
    renderPanel();
    expect((await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/أثبت وجود المركبة داخل الورشة/)).toBeTruthy();
  });
  it("requires explicit repair consent only for a cash work order and never labels it as payment", async () => {
    const cash = visit("arrived", 0);
    cash.entry.insurance_claim_id = null as any;
    cash.entry.claim = null as any;
    (cash.entry.work_order as any).work_order_type = "general_customer";
    mocks.detail.mockResolvedValue(cash);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ }));
    const confirm = screen.getByRole("button", { name: "تأكيد الانتقال" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/هذا ليس تسجيل دفعة/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/أؤكد موافقة العميل/));
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });
  it("does not offer an impossible cash transition without a linked work order", async () => {
    const cash = visit("arrived", 0);
    cash.entry.insurance_claim_id = null as any;
    cash.entry.claim = null as any;
    cash.entry.work_order = null as any;
    mocks.detail.mockResolvedValue(cash);
    renderPanel();
    const next = await screen.findByRole("button", { name: /الانتقال للمرحلة التالية/ });
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/أنشئ أمر عمل كاش/)).toBeTruthy();
  });
  it("records a manager's physical custody correction only after a reason and cloud read-back", async () => {
    const before: any = visit("arrived", 0);
    before.reviewReason = "custody_conflict";
    before.stage = "needs_review";
    before.entry.claim.vehicle_presence_status = "with_customer";
    const after = visit("arrived", 0);
    after.entry.claim.vehicle_presence_status = "in_workshop";
    mocks.detail.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    mocks.reconcile.mockResolvedValue(undefined);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "مراجعة موقع المركبة" }));
    fireEvent.click(screen.getByLabelText(/تحققت بنفسي/));
    fireEvent.change(screen.getByLabelText("سبب الإلغاء أو الرجوع"), { target: { value: "فحصت المركبة داخل الورشة" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الموقع وتوثيق التصحيح" }));
    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledWith("entry-1", "فحصت المركبة داخل الورشة"));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
  });
});
