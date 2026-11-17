// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  load: vi.fn(), logs: vi.fn(), availability: vi.fn(), prepare: vi.fn(), verify: vi.fn(), send: vi.fn(), clipboard: vi.fn(),
  language: "en", translate: (key: string, _options?: Record<string, unknown>) => key,
  profile: { tenant_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", role: "manager" },
}));
vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return { ...actual, useTranslation: () => ({ i18n: { language: api.language }, t: (key: string, options?: Record<string, unknown>) => api.translate(key, options) }) };
});
vi.mock("@/contexts/useAuth", () => ({ useAuth: () => ({ profile: api.profile, hasRole: (...roles: string[]) => roles.includes(api.profile.role) }) }));
vi.mock("@/lib/messaging/vehicleCustomerMessages", () => ({
  CUSTOMER_MESSAGE_KINDS: ["portal", "intake_signature", "intake_documents", "review_signature", "review_documents", "approval", "order_signature", "repair_update", "ready_for_pickup", "temporary_release_signature", "temporary_release_documents", "delivery_documents", "follow_up", "custom"],
  loadVehicleCustomerMessageContext: api.load, listVehicleCustomerMessageLogs: api.logs,
  vehicleCustomerMessageAvailability: api.availability, prepareVehicleCustomerMessage: api.prepare,
  verifyVehicleCustomerMessageDraft: api.verify, sendVehicleCustomerMessage: api.send,
}));

import i18n from "@/i18n";
import VehicleCustomerMessageCenter from "@/components/vehicle-entry/VehicleCustomerMessageCenter";
import type { VehicleCustomerMessageContext, VehicleCustomerMessageDraft, VehicleCustomerMessageKind } from "@/lib/messaging/vehicleCustomerMessages";

const entryId = "33333333-3333-4333-8333-333333333333";
const nextEntryId = "44444444-4444-4444-8444-444444444444";
const reviewLabel = "I reviewed the recipient, message and customer portal link.";
const clients: QueryClient[] = [];
let context: VehicleCustomerMessageContext;

function makeContext(id = entryId): VehicleCustomerMessageContext {
  return {
    tenantId: api.profile.tenant_id, actorId: api.profile.user_id, entryId: id, entryNumber: id === entryId ? "ENT-SYNTHETIC-1" : "ENT-SYNTHETIC-2",
    customerId: "55555555-5555-4555-8555-555555555555", customerName: "Synthetic Customer", phone: "96897000001",
    vehicleId: "66666666-6666-4666-8666-666666666666", vehicleMake: "Test Make", vehicleModel: "Test Model", vehicleYear: 2026,
    stage: "in_progress", presence: "in_workshop", isReview: false, intakeSigned: true, intakeRevision: 3,
    intakeDocumentAvailable: true, signatureId: "signature-synthetic", receiptId: "receipt-synthetic", issued: true, draft: false, cancelled: false,
    claimId: "77777777-7777-4777-8777-777777777777", workOrderId: "88888888-8888-4888-8888-888888888888", approved: true,
    approvalEvent: "2026-11-17T08:00:00Z", legacyApprovalState: "none", workOrderSigned: false, orderAvailable: true,
    workOrderStatus: "in_progress", workOrderUpdatedAt: "2026-11-17T08:00:00Z", readyEvent: "ready-synthetic", repairEvent: "repair-synthetic",
    handoverId: null, finalDeliveryApproved: false, signatureRelease: null, signedRelease: null,
    portal: { token: "synthetic-customer-token", enabled: true, expires_at: null, customer_name: "Synthetic Customer", vehicle_make: "Test Make", vehicle_model: "Test Model", vehicle_year: 2026 },
    updatedAt: "2026-11-17T08:00:00Z", workflowRevision: 2,
  };
}

function makeDraft(current: VehicleCustomerMessageContext, kind: VehicleCustomerMessageKind = "portal", language: "ar" | "en" = "en"): VehicleCustomerMessageDraft {
  const url = "https://example.invalid/customer/vehicle/synthetic-customer-token";
  return { context: structuredClone(current), kind, language,
    body: language === "en" ? `Prepared ${kind} message for ${current.customerName}.\n${url}` : `رسالة للعميل التجريبي.\n${url}`,
    url, idempotencyKey: `vehicle-customer:v2:${current.tenantId}:${current.entryId}:${kind}:event-synthetic`,
    fingerprint: JSON.stringify(current), recipientPhone: current.phone, recipientName: current.customerName };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderCenter(initial: { entryId?: string; open?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const onOpenChange = vi.fn();
  let props = { entryId: initial.entryId || entryId, open: initial.open ?? true, onOpenChange };
  const content = () => <QueryClientProvider client={client}><VehicleCustomerMessageCenter {...props} /></QueryClientProvider>;
  const view = render(content());
  return { client, onOpenChange, rerender(next: Partial<typeof props> = {}) { props = { ...props, ...next }; view.rerender(content()); } };
}

async function loaded() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Prepare preview" })).toBeEnabled());
  await waitFor(() => expect(api.logs).toHaveBeenCalled());
}

async function preparePreview() {
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  return await screen.findByRole("textbox", { name: "Message text" });
}

async function review() {
  fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send WhatsApp message" })).toBeEnabled());
}

function selectCase(name: RegExp) {
  fireEvent.click(within(screen.getByRole("group", { name: "Message case" })).getByRole("button", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.language = "en"; api.profile.tenant_id = "11111111-1111-4111-8111-111111111111"; api.profile.user_id = "22222222-2222-4222-8222-222222222222"; api.profile.role = "manager";
  api.translate = (key, options) => String(i18n.t(key, { ...options, lng: api.language, ns: "vehicleCustomerMessages" }));
  context = makeContext();
  api.load.mockImplementation(async () => structuredClone(context));
  api.logs.mockResolvedValue([]);
  api.availability.mockReturnValue({ available: true, reason: null });
  api.prepare.mockImplementation(async (_id: string, kind: VehicleCustomerMessageKind, language: "ar" | "en") => makeDraft(context, kind, language));
  api.verify.mockImplementation(async (draft: VehicleCustomerMessageDraft) => structuredClone(draft.context));
  api.send.mockResolvedValue({ ok: true, status: "sent", logId: "log-synthetic", providerMessageId: "provider-synthetic" });
  api.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: api.clipboard } });
});

afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); vi.restoreAllMocks(); });

describe("vehicle customer WhatsApp center", () => {
  it("does not read, prepare or send while closed or when the role is not allowed", async () => {
    const view = renderCenter({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.load).not.toHaveBeenCalled(); expect(api.logs).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
    api.profile.role = "technician"; view.rerender({ open: true });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(api.load).not.toHaveBeenCalled();
  });

  it("opens with read-only customer context and keeps every case selection free of prepare/send side effects", async () => {
    renderCenter(); await loaded();
    expect(screen.getByRole("heading", { name: "Customer WhatsApp center" })).toBeVisible();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/[\u0600-\u06ff]/);
    expect(api.load).toHaveBeenCalledWith(entryId, api.profile.tenant_id);
    selectCase(/^Sign the intake form/);
    fireEvent.change(screen.getByLabelText("Communication stage"), { target: { value: "general" } });
    selectCase(/^Custom customer message/);
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.verify).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Message text" })).toBeNull();
  });

  it("requires explicit preview and review, and clears review after editing or restoring the body", async () => {
    renderCenter(); const body = await preparePreview();
    expect(api.prepare).toHaveBeenCalledExactlyOnceWith(entryId, "portal", "en", api.profile.tenant_id);
    expect(screen.getByRole("button", { name: "Send WhatsApp message" })).toBeDisabled();
    await review();
    fireEvent.change(body, { target: { value: "Reviewed custom wording" } });
    expect(screen.getByRole("checkbox", { name: reviewLabel })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Send WhatsApp message" })).toBeDisabled();
    await review(); fireEvent.click(screen.getByRole("button", { name: "Restore template" }));
    expect(body).toHaveValue(makeDraft(context).body);
    expect(screen.getByRole("checkbox", { name: reviewLabel })).not.toBeChecked(); expect(api.send).not.toHaveBeenCalled();
  });

  it("does not carry a reviewed preview into a different case", async () => {
    renderCenter(); await preparePreview(); await review();
    selectCase(/^Intake form and receipt/);
    expect(screen.queryByRole("textbox", { name: "Message text" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: reviewLabel })).toBeNull();
    expect(api.prepare).toHaveBeenCalledTimes(1); expect(api.send).not.toHaveBeenCalled();
  });

  it("sends only the reviewed body once while a request is in flight", async () => {
    const pending = deferred<{ ok: boolean; status: string }>(); api.send.mockReturnValue(pending.promise);
    renderCenter(); const body = await preparePreview();
    fireEvent.change(body, { target: { value: "The exact reviewed customer message" } }); await review();
    const send = screen.getByRole("button", { name: "Send WhatsApp message" });
    act(() => { fireEvent.click(send); fireEvent.click(send); });
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "portal", recipientName: "Synthetic Customer", recipientPhone: context.phone }), "The exact reviewed customer message", expect.any(Function));
    await act(async () => pending.resolve({ ok: true, status: "sent" }));
    expect(await screen.findByText("WhatsApp accepted the message. Delivery and read status appear in Message history when confirmed.")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: reviewLabel })).not.toBeChecked();
  });

  it.each([
    ["queued", "The request is queued. Sending and delivery are not confirmed yet."],
    ["dry_run", "This was a test request. No message was sent."],
    ["unconfirmed", "Sending has not been confirmed. Refresh Message history before retrying."],
  ])("does not claim that a %s result was sent or delivered", async (status, feedback) => {
    api.send.mockResolvedValueOnce({ ok: true, status });
    renderCenter(); await preparePreview(); await review(); fireEvent.click(screen.getByRole("button", { name: "Send WhatsApp message" }));
    expect(await screen.findByText(feedback)).toBeVisible();
    expect(screen.queryByText("WhatsApp accepted the message. Delivery and read status appear in Message history when confirmed.")).toBeNull();
    expect(screen.queryByText("Delivery was confirmed by WhatsApp.")).toBeNull();
    expect(screen.getByRole("checkbox", { name: reviewLabel })).not.toBeChecked();
  });

  it("clears review and gives safe feedback for provider or stale-context failures", async () => {
    api.send.mockRejectedValueOnce(Object.assign(new Error("CUSTOMER_MESSAGE_STALE"), { code: "CUSTOMER_MESSAGE_STALE" }));
    renderCenter(); await preparePreview(); await review(); fireEvent.click(screen.getByRole("button", { name: "Send WhatsApp message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The customer, visit or portal changed.");
    expect(screen.getByRole("checkbox", { name: reviewLabel })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Send WhatsApp message" })).toBeDisabled();
  });

  it("refuses copying when the saved portal changes and never treats copying as sending", async () => {
    api.verify.mockRejectedValueOnce(Object.assign(new Error("CUSTOMER_MESSAGE_PORTAL_PAUSED"), { code: "CUSTOMER_MESSAGE_PORTAL_PAUSED" }));
    renderCenter(); await preparePreview(); fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The customer, visit or portal changed.");
    expect(api.verify).toHaveBeenCalledTimes(1); expect(api.clipboard).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
  });

  it("copies only after a fresh verification and keeps the review checkbox unchecked", async () => {
    renderCenter(); const body = await preparePreview(); fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(await screen.findByText("Message copied. Nothing was sent.")).toBeVisible();
    expect(api.verify).toHaveBeenCalledTimes(1); expect(api.clipboard).toHaveBeenCalledWith((body as HTMLTextAreaElement).value);
    expect(screen.getByRole("checkbox", { name: reviewLabel })).not.toBeChecked(); expect(api.send).not.toHaveBeenCalled();
  });

  it("fails closed when cloud message history cannot be verified", async () => {
    api.logs.mockRejectedValue(new Error("history unavailable"));
    renderCenter(); await preparePreview();
    expect(await screen.findByRole("alert")).toHaveTextContent("Message history could not be verified.");
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    expect(screen.getByRole("button", { name: "Send WhatsApp message" })).toBeDisabled(); expect(api.send).not.toHaveBeenCalled();
  });

  it("discards a pending preview when the visit changes instead of showing the previous customer", async () => {
    const pending = deferred<VehicleCustomerMessageDraft>(); api.prepare.mockReturnValueOnce(pending.promise);
    const view = renderCenter(); await loaded(); fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
    const previous = makeDraft(context);
    context = { ...makeContext(nextEntryId), customerName: "Next Synthetic Customer", customerId: "99999999-9999-4999-8999-999999999999" };
    view.rerender({ entryId: nextEntryId });
    await screen.findByText("Next Synthetic Customer");
    await act(async () => pending.resolve(previous));
    expect(screen.queryByRole("textbox", { name: "Message text" })).toBeNull(); expect(screen.queryByText("Synthetic Customer")).toBeNull();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("remounts into Arabic without accepting a pending English draft", async () => {
    const pending = deferred<VehicleCustomerMessageDraft>(); api.prepare.mockReturnValueOnce(pending.promise);
    const view = renderCenter(); await loaded(); fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
    api.language = "ar"; view.rerender(); await screen.findByRole("heading", { name: "مركز رسائل واتساب للعميل" });
    await act(async () => pending.resolve(makeDraft(context)));
    expect(screen.queryByRole("textbox", { name: "نص الرسالة" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Customer WhatsApp center" })).toBeNull();
    const region = screen.getByRole("region", { name: "مركز رسائل واتساب للعميل" });
    expect(region.closest("[dir]")).toHaveAttribute("dir", "rtl");
  });

  it("invalidates the send scope after closing and ignores its old success on reopen", async () => {
    const pending = deferred<{ ok: boolean; status: string }>(); api.send.mockReturnValueOnce(pending.promise);
    const view = renderCenter(); await preparePreview(); await review(); fireEvent.click(screen.getByRole("button", { name: "Send WhatsApp message" }));
    const current = api.send.mock.calls[0][2] as () => boolean;
    expect(current()).toBe(true);
    view.rerender({ open: false });
    expect(current()).toBe(false);
    await act(async () => pending.resolve({ ok: true, status: "sent" }));
    view.rerender({ open: true }); await loaded();
    expect(screen.queryByText("WhatsApp accepted the message. Delivery and read status appear in Message history when confirmed.")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Message text" })).toBeNull();
  });

  it.each(["tenant_id", "user_id", "role"] as const)("invalidates an in-flight send when the actor's %s changes", async (field) => {
    const pending = deferred<{ ok: boolean; status: string }>(); api.send.mockReturnValueOnce(pending.promise);
    const view = renderCenter(); await preparePreview(); await review(); fireEvent.click(screen.getByRole("button", { name: "Send WhatsApp message" }));
    const current = api.send.mock.calls[0][2] as () => boolean;
    expect(current()).toBe(true);
    api.profile[field] = field === "role" ? "supervisor" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    context = { ...context, tenantId: api.profile.tenant_id, actorId: api.profile.user_id };
    view.rerender();
    expect(current()).toBe(false);
    await act(async () => pending.resolve({ ok: true, status: "sent" }));
    expect(screen.queryByText("WhatsApp accepted the message. Delivery and read status appear in Message history when confirmed.")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Message text" })).toBeNull();
  });

  it("preserves reviewed edits for an unchanged refresh and invalidates them when the customer changes", async () => {
    const view = renderCenter(); const body = await preparePreview();
    fireEvent.change(body, { target: { value: "Keep these reviewed edits" } }); await review();
    act(() => view.client.setQueryData(["vehicle-customer-messages", api.profile.tenant_id, api.profile.user_id, entryId], structuredClone(context)));
    expect(body).toHaveValue("Keep these reviewed edits"); expect(screen.getByRole("checkbox", { name: reviewLabel })).toBeChecked();
    context = { ...context, phone: "96897000002" };
    act(() => view.client.setQueryData(["vehicle-customer-messages", api.profile.tenant_id, api.profile.user_id, entryId], structuredClone(context)));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Message text" })).toBeNull());
    expect(screen.queryByRole("checkbox", { name: reviewLabel })).toBeNull(); expect(api.send).not.toHaveBeenCalled();
  });

  it("explains an unavailable delivery case without preparing or sending it", async () => {
    api.availability.mockImplementation((_context: VehicleCustomerMessageContext, kind: VehicleCustomerMessageKind) => kind === "ready_for_pickup"
      ? { available: false, reason: "READY_REQUIRED" } : { available: true, reason: null });
    renderCenter(); await loaded();
    fireEvent.change(screen.getByLabelText("Communication stage"), { target: { value: "delivery" } });
    selectCase(/^Ready for pickup/);
    expect(screen.getByRole("status")).toHaveTextContent("The vehicle must be recorded as ready for pickup and still inside the workshop.");
    expect(screen.getByRole("button", { name: "Prepare preview" })).toBeDisabled();
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
  });

  it("keeps recorded events and original history read-only", async () => {
    api.logs.mockResolvedValue([{ id: "record-synthetic", status: "queued", template_type: "vehicle_customer_portal", body: "Previously reviewed message", recipient_phone: context.phone,
      created_at: "2026-11-17T08:00:00Z", sent_at: null, error: null, idempotency_key: makeDraft(context).idempotencyKey }]);
    renderCenter(); await preparePreview();
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    expect(await screen.findByText("This event already has a sending record. Check its status in Message history before sending again.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send WhatsApp message" })).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Message history" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("Queued", { selector: "div" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /delete|resend/i })).toBeNull(); expect(api.send).not.toHaveBeenCalled();
  });
});
