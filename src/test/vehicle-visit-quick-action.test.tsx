// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleVisitQuickActionDialog } from "@/pages/vehicle-entry/VehicleVisitQuickActionDialog";
import i18n from "@/i18n";
import type { VehicleCenterActionRequest } from "@/lib/vehicleCenterPresentation";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), advance: vi.fn(), markReturn: vi.fn(), reconcile: vi.fn(), staff: vi.fn(), order: vi.fn(), managerContext:vi.fn(),managerAdjust:vi.fn(),role:'admin', permitted: true }));
vi.mock('@/lib/vehicleVisitManager',async original=>({...await original<object>(),getVehicleVisitManagerContext:mocks.managerContext,adjustVehicleVisitManager:mocks.managerAdjust}));
vi.mock("@/components/supervisor/SupervisorClaimApproval", () => ({ SupervisorClaimApproval: () => <p>Canonical approval form</p> }));
vi.mock("@/lib/workOrderListActions", () => ({ resolveWorkOrderListAction: mocks.order }));
vi.mock("@/components/workorders/VehicleDeliveryReceiptDialog", () => ({ default: () => <p>Canonical handover form</p> }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>()),
  getVehicleVisitDetail: mocks.detail,
  advanceVehicleVisit: mocks.advance,
  reconcileVehicleVisitCustody: mocks.reconcile,
  listVehicleVisitStaff: mocks.staff,
}));
vi.mock("@/lib/vehicleInspectionRelease", () => ({ markInspectionVehicleReturned: mocks.markReturn }));
vi.mock("@/pages/vehicle-entry/VehicleInspectionReleasePage",()=>({default:()=> <p>Embedded temporary release</p>}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { tenant_id: "tenant-1" }, hasRole: (...roles: string[]) => mocks.permitted && roles.includes(mocks.role) }),
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

function renderDialog(initialAction?: VehicleCenterActionRequest, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <VehicleVisitQuickActionDialog row={{ id: "entry-1", entry_number: "ENT-1", vehicle_location: "داخل الورشة" }} initialAction={initialAction} open onOpenChange={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  mocks.detail.mockReset(); mocks.advance.mockReset(); mocks.markReturn.mockReset(); mocks.reconcile.mockReset(); mocks.staff.mockReset(); mocks.order.mockReset();
  mocks.permitted = true;
  mocks.role='admin';mocks.managerContext.mockReset();mocks.managerAdjust.mockReset();
  mocks.staff.mockResolvedValue([{ user_id: "user-1", full_name: "Manager" }]);
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(() => ({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});

describe("vehicle visit quick action", () => {
  it("opens the existing next-stage form without submitting from a card shortcut", async () => {
    mocks.detail.mockResolvedValue(visit("approved", "approved"));
    renderDialog({ intent: "next", expectedStage: "approved" });
    expect(await screen.findByRole("button", { name: "تأكيد الانتقال" })).toBeTruthy();
    expect(mocks.advance).not.toHaveBeenCalled();
    expect(mocks.detail).toHaveBeenCalledWith("entry-1", { includeOperationalFile: false });
  });
  it("opens the canonical claim approval UI, never an approval mutation on mount", async () => {
    mocks.detail.mockResolvedValue(visit("pending", "arrived"));
    renderDialog({ intent: "approval", expectedStage: "arrived" });
    expect(await screen.findByText("Canonical approval form")).toBeTruthy();
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("opens physical-arrival confirmation without registering a return", async () => {
    mocks.role='supervisor';
    const outside = visit("approved", "approved", "مع العميل");
    outside.entry.work_order.vehicle_presence_status = "with_customer";
    outside.releases = [{ id: "release-1", status: "signed", returned_at: null }] as any;
    mocks.detail.mockResolvedValue(outside);
    renderDialog({ intent: "arrival", expectedStage: "approved" });
    expect(await screen.findByRole("button", { name: "تسجيل دخول المركبة للورشة" })).toBeDisabled();
    expect(mocks.markReturn).not.toHaveBeenCalled();
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("opens the audited manager arrival correction from the shortcut with a fresh context and no write",async()=>{
    const outside=visit('approved','approved','مع العميل');outside.entry.work_order.vehicle_presence_status='with_customer';outside.releases=[{id:'release-1',status:'signed',returned_at:null}] as any;mocks.detail.mockResolvedValue(outside);
    mocks.managerContext.mockResolvedValue({entry_id:'entry-1',tenant_id:'tenant-1',vehicle_id:'vehicle-1',stage:'approved',presence:'with_customer',workflow_revision:0,entry_updated_at:'2026-11-15T06:00:00Z',editable:true,is_review:false,intake_signed:true,stage_dates:{arrived:'2026-11-15T04:00:00Z',approved:'2026-11-15T05:00:00Z'},manager_adjustment:null,last_changed_at:null});
    renderDialog({intent:'arrival',expectedStage:'approved'});expect(await screen.findByLabelText('موقع المركبة الفعلي')).toHaveValue('in_workshop');
    expect(screen.getByRole('button',{name:'حفظ تصحيح المدير'})).toBeDisabled();expect(mocks.managerContext).toHaveBeenCalledWith('entry-1','tenant-1');expect(mocks.managerAdjust).not.toHaveBeenCalled();expect(mocks.markReturn).not.toHaveBeenCalled();expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("opens the original handover UI only after a fresh confirmed order link", async () => {
    const ready: any = visit("approved", "approved");
    ready.stage = ready.operationalStage = ready.workflow.stage = "ready";
    Object.assign(ready.entry, { tenant_id: "tenant-1", work_order_id: "order-1" });
    Object.assign(ready.entry.work_order, { tenant_id: "tenant-1", claim_id: "claim-1", work_order_type: "insurance", status: "completed" });
    mocks.detail.mockResolvedValue(ready);
    mocks.order.mockResolvedValue({ cloudId: "order-1", vehicleId: "vehicle-1" });
    renderDialog({ intent: "next", expectedStage: "ready" });
    expect(await screen.findByText("Canonical handover form")).toBeTruthy();
    expect(mocks.order).toHaveBeenCalledWith("order-1", "tenant-1");
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("does not act on a stale card after a stage change", async () => {
    mocks.detail.mockResolvedValue(visit("approved", "arrived"));
    renderDialog({ intent: "next", expectedStage: "approved" });
    await screen.findByText(/مسار تأمين/);
    expect(screen.queryByRole("button", { name: "تأكيد الانتقال" })).toBeNull();
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("waits for the fresh read rather than acting on a cached matching stage", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["vehicle_visit", "detail", "entry-1", "compact", "tenant-1"], visit("approved", "approved"));
    let finish!: (value: unknown) => void;
    mocks.detail.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderDialog({ intent: "next", expectedStage: "approved" }, client);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "تأكيد الانتقال" })).toBeNull();
    finish(visit("pending", "arrived"));
    await screen.findByRole("button", { name: "اعتماد المطالبة" });
    expect(screen.queryByRole("button", { name: "تأكيد الانتقال" })).toBeNull();
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("rechecks approval permission even when a stale card requested approval", async () => {
    mocks.permitted = false;
    mocks.detail.mockResolvedValue(visit("pending", "arrived"));
    renderDialog({ intent: "approval", expectedStage: "arrived" });
    await screen.findByText(/مسار تأمين/);
    expect(screen.queryByText("Canonical approval form")).toBeNull();
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("offers inline approval and cancellation without routing away or moving an unapproved stage", async () => {
    mocks.detail.mockResolvedValue(visit("pending", "arrived"));
    renderDialog();
    expect(await screen.findByRole("button", { name: "اعتماد المطالبة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "إلغاء المطالبة" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "اعتماد المطالبة" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تأكيد الانتقال" })).toBeNull();
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("records a valid stage transition through the existing RPC and cloud readback", async () => {
    mocks.detail.mockResolvedValueOnce(visit("approved", "arrived")).mockResolvedValue({
      ...visit("approved", "approved"), workflow: { entry_id: "entry-1", stage: "approved", revision: 1, review_reason: null },
    });
    mocks.advance.mockResolvedValue({ stage: "approved", revision: 1 });
    renderDialog();
    fireEvent.click(await screen.findByRole("button",{name:/الانتقال للمرحلة التالية/}));
    fireEvent.change(await screen.findByLabelText("ملاحظات"), { target: { value: "اعتماد موثق" } });
    fireEvent.change(screen.getByLabelText(/المتطلبات/), { target: { value: "مراجعة الموافقة" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الانتقال" }));
    await waitFor(() => expect(mocks.advance).toHaveBeenCalledWith(expect.objectContaining({
      entryId: "entry-1", revision: 0, stage: "approved", notes: "اعتماد موثق",
      responsibleUserId: "user-1", requirements: { details: "مراجعة الموافقة", customer_approved: false },
    })));
    await waitFor(() => expect(mocks.detail.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("opens the existing temporary release in place rather than changing custody or navigating", async () => {
    mocks.role='supervisor';
    mocks.detail.mockResolvedValue(visit("approved", "approved"));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "محضر المعاينة والخروج المؤقت" }));
    expect(await screen.findByText('Embedded temporary release')).toBeTruthy();
    expect(screen.queryByRole("link", { name: "خروج مؤقت بمحضر استلام" })).toBeNull();
    expect(mocks.markReturn).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("keeps the custody actions English-only in the English UI", async () => {
    mocks.role='supervisor';
    await i18n.changeLanguage("en");
    mocks.detail.mockResolvedValue(visit("approved", "approved"));
    renderDialog();
    expect(await screen.findByRole("button", { name: "Inspection and temporary release" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "محضر المعاينة والخروج المؤقت" })).toBeNull();
  });

  it("requires a physical confirmation before recording return from a signed release", async () => {
    mocks.role='supervisor';
    const outside = visit("approved", "approved", "مع العميل");
    outside.entry.work_order.vehicle_presence_status = "with_customer";
    outside.releases = [{ id: "release-1", status: "signed", returned_at: null }] as any;
    const inside = visit("approved", "approved");
    inside.releases = [{ id: "release-1", status: "signed", returned_at: "2026-11-03T10:00:00Z" }] as any;
    mocks.detail.mockResolvedValueOnce(outside).mockResolvedValueOnce(outside).mockResolvedValue(inside);
    mocks.markReturn.mockResolvedValue({ returned_at: "2026-11-03T10:00:00Z" });
    renderDialog();
    fireEvent.click(await screen.findByRole('button',{name:i18n.t('vehicleEntry.workshopTab')}));
    const button = await screen.findByRole("button", { name: "تسجيل دخول المركبة للورشة" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/أؤكد وصول المركبة فعليًا/));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.markReturn).toHaveBeenCalledWith("release-1"));
    await waitFor(() => expect(mocks.detail.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(mocks.detail.mock.invocationCallOrder[1]).toBeLessThan(mocks.markReturn.mock.invocationCallOrder[0]);
    expect(mocks.detail.mock.invocationCallOrder[2]).toBeGreaterThan(mocks.markReturn.mock.invocationCallOrder[0]);
  });

  it("refuses a stale return when the release was already returned elsewhere", async () => {
    mocks.role='supervisor';
    const outside = visit("approved", "approved", "مع العميل");
    outside.entry.work_order.vehicle_presence_status = "with_customer";
    outside.releases = [{ id: "release-1", status: "signed", returned_at: null }] as any;
    mocks.detail.mockResolvedValueOnce(outside).mockResolvedValue({ ...outside, releases: [{ id: "release-1", status: "signed", returned_at: "2026-11-04T08:00:00Z" }] });
    renderDialog();
    fireEvent.click(await screen.findByRole('button',{name:i18n.t('vehicleEntry.workshopTab')}));
    fireEvent.click(await screen.findByLabelText(/أؤكد وصول المركبة فعليًا/));
    fireEvent.click(screen.getByRole("button", { name: "تسجيل دخول المركبة للورشة" }));
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
    await screen.findByText(/مسار تأمين/);
    expect(screen.queryByRole("button", { name: "تسجيل دخول المركبة للورشة" })).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "مراجعة موقع المركبة" }));
    expect(screen.getByText("CLAIM-1")).toBeTruthy();
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
