import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), tenant: vi.fn(), visit: vi.fn(), custody: vi.fn(), portal: vi.fn(), ensure: vi.fn(), release: vi.fn(), review: vi.fn(), send: vi.fn(), queries: [] as Array<{ table: string; calls: Array<[string, ...unknown[]]> }> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getVehicleVisitDetail: mocks.visit }));
vi.mock("@/lib/vehicleEntryService", () => ({ getVehicleEntryPresence: (entry: any) => entry.vehicle_location === "داخل الورشة" ? "in_workshop" : entry.vehicle_location === "مع العميل" ? "with_customer" : "needs_review" }));
vi.mock("@/lib/vehicleReviewVisit", () => ({ isVehicleReviewVisit: (entry: any) => Boolean(entry.vehicle_condition?.review_return?.source_handover_id), getReviewVisitContext: mocks.review }));
vi.mock("@/lib/vehicleInspectionRelease", () => ({ getInspectionReleaseById: mocks.release, inspectionReleaseMissingFields: (form: any) => form.complete === false ? ["pending_action"] : [] }));
vi.mock("@/lib/vehicleIntakeReceipt", () => ({ getIntakeReceiptContext: mocks.custody }));
vi.mock("@/lib/unifiedVehiclePortal", () => ({ getVehicleCustomerPortalContext: mocks.portal, ensureVehicleCustomerPortal: mocks.ensure, buildUnifiedVehiclePortalUrl: (token: string) => `https://example.invalid/customer/vehicle/${token}` }));
vi.mock("@/lib/systemPreferences", () => ({ readSystemPreferences: async () => ({ defaultCountryCode: "968" }) }));
vi.mock("@/lib/messaging/messagingService", () => ({ sendUnifiedMessage: mocks.send }));
import { CUSTOMER_MESSAGE_KINDS, listVehicleCustomerMessageLogs, loadVehicleCustomerMessageContext, prepareVehicleCustomerMessage, sendVehicleCustomerMessage, vehicleCustomerMessageAvailability, vehicleCustomerMessagePrefix, verifyVehicleCustomerMessageDraft, type VehicleCustomerMessageKind } from "@/lib/messaging/vehicleCustomerMessages";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1), entryId = id(2), customerId = id(3), vehicleId = id(4), claimId = id(5), orderId = id(6), actorId = id(7);
let entry: any, customer: any, claim: any, order: any, profile: any, visit: any, portal: any;
let signatures: any[], receipts: any[], orderToken: any, legacy: any[], logs: any[];
function query(table: string) {
  // Actual Production grants deny these SELECTs even for staff. Test doubles
  // must not fabricate access that only the canonical metadata RPC provides.
  if (["vehicle_entry_signed_revisions", "vehicle_entry_custody_receipts"].includes(table)) {
    throw Object.assign(new Error("permission denied for protected custody table"), { code: "42501" });
  }
  const captured = { table, calls: [] as Array<[string, ...unknown[]]> }; mocks.queries.push(captured);
  const q: any = { then: (resolve: (value: unknown) => unknown) => {
    const data = table === "profiles" ? profile : table === "customers" ? customer : table === "insurance_claims" ? claim
      : table === "job_orders" ? order : table === "vehicle_entry_signatures" ? signatures : table === "customer_portal_tokens" ? orderToken
          : table === "customer_notifications" ? legacy : table === "message_logs" ? logs : null;
    return Promise.resolve(resolve({ data, error: null }));
  } };
  for (const method of ["select", "eq", "is", "maybeSingle", "order", "limit", "or", "like"]) q[method] = (...args: unknown[]) => { captured.calls.push([method, ...args]); return q; };
  return q;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
beforeEach(() => {
  vi.clearAllMocks(); mocks.queries = [];
  profile = { user_id: actorId, tenant_id: tenant, role: "supervisor", account_status: "active", disabled_at: null };
  customer = { id: customerId, name: "Current visit customer", phone: "+96897000001" };
  claim = { id: claimId, tenant_id: tenant, customer_id: customerId, vehicle_id: vehicleId, status: "approved", approved_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z" };
  order = { id: orderId, tenant_id: tenant, customer_id: customerId, vehicle_id: vehicleId, vehicle_entry_id: entryId, claim_id: claimId, work_order_type: "insurance", status: "in_progress", updated_at: "2026-11-17T08:00:00Z" };
  entry = { id: entryId, tenant_id: tenant, customer_id: customerId, vehicle_id: vehicleId, entry_number: "QA-ENTRY", intake_revision: 4,
    status: "Converted to Work Order", issued_at: "2026-11-01T07:00:00Z", updated_at: "2026-11-17T07:00:00Z", insurance_claim_id: claimId, work_order_id: orderId,
    vehicle_location: "داخل الورشة", vehicle_snapshot: { make: "Toyota", model: "Corolla", year: 2026, plate_number: "65432", plate_letters: "QA", vin: "PRIVATE-VIN-TEST", total_amount: 9876 },
    customer_snapshot: { name: "Historical owner", phone: "96899999999", id_number: "PRIVATE-ID-TEST" } };
  visit = { entry, stage: "in_progress", operationalStage: "in_progress", reviewReason: null, hasFinalHandover: false,
    workflow: { stage: "in_progress", revision: 5, changed_at: "2026-11-17T08:00:00Z" }, releases: [], handovers: [] };
  portal = { token: "canonical-protected-token", enabled: true, expires_at: null, pending_handover_id: null };
  signatures = []; receipts = []; orderToken = null; legacy = []; logs = [];
  mocks.from.mockImplementation(query);
  mocks.getUser.mockResolvedValue({ data: { user: { id: actorId } }, error: null }); mocks.tenant.mockResolvedValue(tenant);
  mocks.visit.mockImplementation(async () => clone(visit)); mocks.portal.mockImplementation(async () => clone(portal));
  mocks.custody.mockReset().mockImplementation(async () => ({ entry_id: entry.id, revision: entry.intake_revision, required: entry.custody_receipt_required !== false, receipts: clone(receipts) }));
  mocks.ensure.mockImplementation(async () => { portal = { token: "prepared-on-explicit-request", enabled: true, expires_at: null }; return clone(portal); });
  mocks.send.mockResolvedValue({ ok: true, status: "queued", logId: id(90) }); mocks.review.mockResolvedValue(null);
});
async function context() { return loadVehicleCustomerMessageContext(entryId, tenant); }
function signed() { signatures = [{ id: id(20), intake_revision: entry.intake_revision }]; receipts = [{ id: id(22), receipt_number: "VIR-TEST-1", revision: entry.intake_revision, status: "issued", issued_at: "2026-11-17T07:00:00Z", signer_name: "Saved intake signer" }]; }
function delivered() { visit.stage = "delivered"; visit.workflow.stage = "delivered"; entry.vehicle_location = "مع العميل"; order.status = "delivered"; visit.hasFinalHandover = true; visit.handovers = [{ id: id(30), work_order_id: orderId, status: "finalized", finalized_at: "2026-11-17T10:00:00Z" }]; }

describe("customer vehicle message center: canonical context and bounded reads", () => {
  it("opens with fresh tenant/customer metadata only and no link, provider, document or write action", async () => {
    expect(await context()).toMatchObject({ tenantId: tenant, actorId, entryId, customerId, customerName: customer.name, phone: "96897000001", intakeRevision: 4, intakeSigned: false, stage: "in_progress" });
    expect(mocks.visit).toHaveBeenCalledExactlyOnceWith(entryId, { includeOperationalFile: false });
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.queries.flatMap(row => row.calls).some(([method]) => ["insert", "update", "delete", "upsert"].includes(method))).toBe(false);
    expect(mocks.queries.find(row => row.table === "vehicle_entry_signatures")?.calls).toContainEqual(["select", "id,intake_revision,created_at"]);
    expect(mocks.custody).toHaveBeenCalledExactlyOnceWith(entryId);
    expect(mocks.from.mock.calls.some(([table]) => ["vehicle_entry_signed_revisions", "vehicle_entry_custody_receipts"].includes(table))).toBe(false);
  });
  it.each(["issued", "used"])("loads a signed visit from authorized %s receipt metadata while private SELECTs remain forbidden", async status => {
    signed(); receipts[0].status = status;
    const current = await context();
    expect(current).toMatchObject({ intakeSigned: true, intakeDocumentAvailable: true, intakeRevision: 4, signatureId: id(20), receiptId: id(22) });
    expect(mocks.custody).toHaveBeenCalledExactlyOnceWith(entryId);
    // The actual RPC exposes joined metadata, never signature_id/revision_id
    // or a frozen document. A successful read must work with that exact DTO.
    expect(receipts[0]).not.toHaveProperty("signature_id"); expect(receipts[0]).not.toHaveProperty("revision_id");
    expect(mocks.from.mock.calls.some(([table]) => ["vehicle_entry_signed_revisions", "vehicle_entry_custody_receipts"].includes(table))).toBe(false);
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it.each(["42501", "P0001", "PGRST202"])("keeps a real custody metadata RPC failure closed (%s) without creating a link or sending", async code => {
    const failure = Object.assign(new Error(code === "P0001" ? "CUSTODY_FORBIDDEN" : "custody metadata unavailable"), { code });
    mocks.custody.mockRejectedValue(failure);
    await expect(context()).rejects.toBe(failure);
    await expect(prepareVehicleCustomerMessage(entryId, "portal", "en", tenant)).rejects.toBe(failure);
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.queries.flatMap(row => row.calls).some(([method]) => ["insert", "update", "delete", "upsert"].includes(method))).toBe(false);
  });
  it.each([
    ["wrong entry", (value: any) => { value.entry_id = id(99); }],
    ["missing receipts", (value: any) => { delete value.receipts; }],
    ["invalid receipt id", (value: any) => { value.receipts[0].id = "not-a-uuid"; }],
    ["invalid receipt revision", (value: any) => { value.receipts[0].revision = 0; }],
    ["unknown receipt status", (value: any) => { value.receipts[0].status = "unexpected"; }],
    ["duplicate receipt ids", (value: any) => { value.receipts.push({ ...value.receipts[0] }); }],
  ])("rejects contradictory custody metadata: %s", async (_name, change) => {
    signed(); const metadata = { entry_id: entryId, revision: 4, required: true, receipts: clone(receipts) };
    change(metadata); mocks.custody.mockResolvedValueOnce(metadata);
    await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CONFLICT" });
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["revision", "required"])("rejects a changed custody %s snapshot", async field => {
    entry.custody_receipt_required = true;
    mocks.custody.mockResolvedValueOnce({ entry_id: entryId, revision: field === "revision" ? 5 : 4, required: field !== "required", receipts: [] });
    await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_STALE" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not accept a current receipt backed only by a signature from an older revision", async () => {
    signed(); signatures[0].intake_revision = 3;
    await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_STALE" });
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it("rejects two current signatures or two active receipts instead of guessing", async () => {
    signed(); signatures.push({ id: id(23), intake_revision: 4 });
    await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CONFLICT" });
    signatures.pop(); receipts.push({ ...receipts[0], id: id(24), receipt_number: "VIR-TEST-2", status: "used" });
    await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CONFLICT" });
  });
  it("never substitutes historical owner/snapshot contact for a deleted canonical visit customer", async () => {
    customer = null; await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CUSTOMER_UNAVAILABLE" }); expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it.each(["invited", "disabled"])("denies %s staff and does not load the visit", async status => {
    profile.account_status = status; await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_FORBIDDEN" }); expect(mocks.visit).not.toHaveBeenCalled();
  });
  it("rejects changed tenant, disabled profile and malformed identities", async () => {
    await expect(loadVehicleCustomerMessageContext("not-an-id", tenant)).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_IDENTITY" });
    await expect(loadVehicleCustomerMessageContext(entryId, id(99))).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_FORBIDDEN" });
    profile.disabled_at = "2026-11-17"; await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_FORBIDDEN" });
    profile.disabled_at = null; mocks.tenant.mockResolvedValue(id(99)); await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_STALE" });
  });
  it("rejects cross-customer claims, stale work-order back-links, and review conflicts", async () => {
    claim.customer_id = id(88); await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CONFLICT" });
    claim.customer_id = customerId; order.vehicle_entry_id = id(89); await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CONFLICT" });
    order.vehicle_entry_id = entryId; visit.reviewReason = "custody_conflict"; await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CONFLICT" });
  });
  it("permits a review's explicitly attested original order without relinking or new approval", async () => {
    const sourceEntry = id(50), sourceHandover = id(51);
    entry.vehicle_condition = { review_return: { source_entry_id: sourceEntry, source_handover_id: sourceHandover } }; order.vehicle_entry_id = sourceEntry;
    entry.work_order_id = null; entry.insurance_claim_id = null;
    mocks.review.mockResolvedValue({ source_entry_id: sourceEntry, source_handover_id: sourceHandover, source_claim_id: claimId, source_work_order_id: orderId });
    const current = await context(); expect(current).toMatchObject({ isReview: true, claimId, workOrderId: orderId }); expect(vehicleCustomerMessageAvailability(current, "review_signature").available).toBe(true);
    await listVehicleCustomerMessageLogs(current);
    const history = [...mocks.queries].reverse().find(row => row.table === "message_logs")!.calls;
    expect(history).toContainEqual(["like", "idempotency_key", `${vehicleCustomerMessagePrefix(current)}%`]);
    expect(history.some(([method]) => method === "or")).toBe(false);
    expect(entry.work_order_id).toBeNull(); expect(entry.insurance_claim_id).toBeNull();
    order.vehicle_entry_id = null; expect((await context()).workOrderId).toBe(orderId);
    expect(vehicleCustomerMessageAvailability(current, "approval").available).toBe(false); expect(mocks.ensure).not.toHaveBeenCalled();
    mocks.review.mockResolvedValue({ source_entry_id: sourceEntry, source_handover_id: id(99), source_claim_id: claimId, source_work_order_id: orderId });
    await expect(context()).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_CONFLICT" });
  });
});

describe("customer message case eligibility and protected portal", () => {
  it("uses intake-signature versus saved-document cases, with exact current frozen evidence", async () => {
    const unsigned = await context(); expect(vehicleCustomerMessageAvailability(unsigned, "intake_signature").available).toBe(true);
    expect(vehicleCustomerMessageAvailability(unsigned, "intake_documents").reason).toBe("DOCUMENT_REQUIRED");
    signed(); const current = await context(); expect(vehicleCustomerMessageAvailability(current, "intake_signature").reason).toBe("ALREADY_SIGNED");
    expect(vehicleCustomerMessageAvailability(current, "intake_documents").available).toBe(true);
    receipts[0].revision = 3; expect((await context()).intakeDocumentAvailable).toBe(false);
  });
  it("does not copy legacy ink into new revision or promise missing frozen documents", async () => {
    entry.intake_revision = 1; entry.custody_receipt_required = false; signatures = [{ id: id(20), intake_revision: null }];
    const current = await context(); expect(current.intakeSigned).toBe(true); expect(current.intakeDocumentAvailable).toBe(false);
    expect(vehicleCustomerMessageAvailability(current, "intake_signature").reason).toBe("ALREADY_SIGNED");
    entry.intake_revision = 2; expect((await context()).intakeSigned).toBe(false);
  });
  it.each(["draft", "cancelled", "replaced"])("retains a %s receipt as history without treating it as a current document", async status => {
    signed(); receipts[0].status = status;
    const current = await context();
    expect(current.intakeSigned).toBe(true); expect(current.intakeDocumentAvailable).toBe(false); expect(current.receiptId).toBeNull();
    expect(vehicleCustomerMessageAvailability(current, "intake_documents").reason).toBe("DOCUMENT_REQUIRED");
  });
  it("blocks drafts, cancelled visits and approval based only on a historical timestamp", async () => {
    entry.status = "Draft"; expect(vehicleCustomerMessageAvailability(await context(), "portal").reason).toBe("DRAFT");
    entry.status = "Issued"; claim.status = "cancelled"; expect(vehicleCustomerMessageAvailability(await context(), "custom").reason).toBe("CANCELLED");
    claim.status = "pending"; expect(vehicleCustomerMessageAvailability(await context(), "approval").reason).toBe("APPROVAL_REQUIRED");
  });
  it("only prepares a missing portal on explicit Prepare, never paused or expired portals", async () => {
    portal = null; await context(); expect(mocks.ensure).not.toHaveBeenCalled();
    const draft = await prepareVehicleCustomerMessage(entryId, "portal", "en", tenant); expect(draft.url).toContain("/customer/vehicle/prepared-on-explicit-request"); expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith(entryId);
    mocks.ensure.mockClear(); portal.enabled = false; await expect(prepareVehicleCustomerMessage(entryId, "portal", "en", tenant)).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_PORTAL_PAUSED" });
    portal.enabled = true; portal.expires_at = "2000-01-01"; await expect(prepareVehicleCustomerMessage(entryId, "portal", "en", tenant)).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_PORTAL_EXPIRED" }); expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it("checks signed work orders and current-stage ready/repair messages", async () => {
    let current = await context(); expect(vehicleCustomerMessageAvailability(current, "order_signature").available).toBe(true);
    expect(vehicleCustomerMessageAvailability(current, "repair_update").available).toBe(true); expect(vehicleCustomerMessageAvailability(current, "ready_for_pickup").reason).toBe("READY_REQUIRED");
    orderToken = { id: id(33), signed_at: "2026-11-17" }; current = await context(); expect(vehicleCustomerMessageAvailability(current, "order_signature").reason).toBe("ORDER_ALREADY_SIGNED");
    visit.stage = "ready"; order.status = "completed"; current = await context(); expect(vehicleCustomerMessageAvailability(current, "ready_for_pickup").available).toBe(true); expect(vehicleCustomerMessageAvailability(current, "repair_update").available).toBe(false);
  });
  it("requires completed awaiting temporary-release state and uses its saved actual recipient", async () => {
    const release = { id: id(40), tenant_id: tenant, vehicle_entry_id: entryId, status: "draft", updated_at: "r1", form_data: { recipient_name: "Named recipient", recipient_phone: "+96897000008" } };
    visit.releases = [{ id: release.id, status: release.status }]; mocks.release.mockImplementation(async () => clone(release));
    expect(vehicleCustomerMessageAvailability(await context(), "temporary_release_signature").reason).toBe("RELEASE_SIGNATURE_REQUIRED");
    release.status = "awaiting_signature"; const draft = await prepareVehicleCustomerMessage(entryId, "temporary_release_signature", "en", tenant);
    expect(draft.recipientName).toBe("Named recipient"); expect(draft.recipientPhone).toBe("96897000008"); expect(draft.body).toContain("Named recipient");
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    release.form_data = { ...release.form_data, complete: false } as any; expect(vehicleCustomerMessageAvailability(await context(), "temporary_release_signature").available).toBe(false);
  });
  it("requires signed temporary-release evidence, recorded exit and no return", async () => {
    visit.releases = [{ id: id(41), status: "signed", released_at: "2026-11-17T08:00:00Z", returned_at: null }];
    expect(vehicleCustomerMessageAvailability(await context(), "temporary_release_documents").available).toBe(false);
    entry.vehicle_location = "مع العميل"; expect(vehicleCustomerMessageAvailability(await context(), "temporary_release_documents").available).toBe(true);
    visit.releases[0].returned_at = "2026-11-17T09:00:00Z"; expect(vehicleCustomerMessageAvailability(await context(), "temporary_release_documents").reason).toBe("RELEASE_REQUIRED");
  });
  it("requires finalized handover plus manager visibility approval for delivery/follow-up", async () => {
    delivered(); portal.pending_handover_id = id(30); let current = await context(); expect(vehicleCustomerMessageAvailability(current, "delivery_documents").reason).toBe("MANAGER_APPROVAL_REQUIRED");
    portal.pending_handover_id = null; current = await context(); expect(vehicleCustomerMessageAvailability(current, "delivery_documents").available).toBe(true); expect(vehicleCustomerMessageAvailability(current, "follow_up").available).toBe(true);
    visit.handovers = []; expect(vehicleCustomerMessageAvailability(await context(), "delivery_documents").reason).toBe("DELIVERY_REQUIRED");
  });
  it("does not infer manager approval from a missing pending-handover field", async () => {
    delivered(); delete portal.pending_handover_id;
    const current = await context(); expect(current.finalDeliveryApproved).toBe(false);
    expect(vehicleCustomerMessageAvailability(current, "delivery_documents").reason).toBe("MANAGER_APPROVAL_REQUIRED");
    expect(vehicleCustomerMessageAvailability(current, "follow_up").reason).toBe("MANAGER_APPROVAL_REQUIRED");
  });
});

describe("customer drafts: privacy, manual sending and history", () => {
  it.each(["ar", "en"] as const)("builds private %s templates with only one protected customer link", async language => {
    const draft = await prepareVehicleCustomerMessage(entryId, "intake_signature", language, tenant);
    expect(draft.body).toContain("Toyota Corolla 2026"); expect(draft.body).toContain(customer.name); expect(draft.body).toContain(draft.url);
    expect(draft.body).not.toMatch(/65432|PRIVATE-VIN|PRIVATE-ID|9876|QA-ENTRY|vehicle-entry\/sign|sales\/|insurance\//);
    expect(draft.body.match(/https:\/\//g)).toHaveLength(1); if (language === "en") expect(draft.body).not.toMatch(/[\u0600-\u06ff]/);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("maintains one semantic event key across prepares, language and text edits", async () => {
    const ar = await prepareVehicleCustomerMessage(entryId, "intake_signature", "ar", tenant), en = await prepareVehicleCustomerMessage(entryId, "intake_signature", "en", tenant);
    expect(ar.idempotencyKey).toBe(en.idempotencyKey); expect(ar.idempotencyKey).toContain(`vehicle-customer:v2:${tenant}:${entryId}:intake_signature:revision-4`);
    await sendVehicleCustomerMessage(en, en.body + " Reviewed note."); expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: en.idempotencyKey }));
  });
  it("retains a custom draft key through retries and allows a separate explicitly prepared draft", async () => {
    const first = await prepareVehicleCustomerMessage(entryId, "custom", "en", tenant), second = await prepareVehicleCustomerMessage(entryId, "custom", "en", tenant);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey); await sendVehicleCustomerMessage(first, "First text"); await sendVehicleCustomerMessage(first, "Edited text");
    expect(mocks.send.mock.calls[0][0].idempotencyKey).toBe(mocks.send.mock.calls[1][0].idempotencyKey);
  });
  it("shares the existing supervisor approval idempotency event and blocks legacy queued/draft state", async () => {
    const draft = await prepareVehicleCustomerMessage(entryId, "approval", "en", tenant);
    expect(draft.idempotencyKey).toBe(`vehicle-visit:v1:${tenant}:${claimId}:approval:${claimId}:${claim.approved_at}`);
    legacy = [{ id: id(60), status: "queued" }]; expect(vehicleCustomerMessageAvailability(await context(), "approval").reason).toBe("LEGACY_APPROVAL");
    legacy = [{ id: id(61), status: "sent", payload: { wa_url: "https://wa.me/" } }]; expect((await context()).legacyApprovalState).toBe("draft_opened");
    await expect(sendVehicleCustomerMessage(draft, draft.body)).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_STALE" }); expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["phone", "name", "stage", "portal", "revision"])("revalidates %s before Copy/Send and refuses stale drafts", async change => {
    const draft = await prepareVehicleCustomerMessage(entryId, "portal", "en", tenant);
    if (change === "phone") customer.phone = "+96897000009"; else if (change === "name") customer.name = "Another customer name";
    else if (change === "stage") visit.stage = "ready"; else if (change === "portal") portal.enabled = false; else entry.intake_revision++;
    await expect(verifyVehicleCustomerMessageDraft(draft)).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_STALE" }); await expect(sendVehicleCustomerMessage(draft, draft.body)).rejects.toThrow(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rechecks dialog scope, bounds body, and reports provider status truthfully", async () => {
    const draft = await prepareVehicleCustomerMessage(entryId, "portal", "en", tenant);
    await expect(sendVehicleCustomerMessage(draft, draft.body, () => false)).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_STALE" });
    await expect(sendVehicleCustomerMessage(draft, " ")).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_BODY" });
    await expect(sendVehicleCustomerMessage(draft, "x".repeat(4001))).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_BODY" }); expect(mocks.send).not.toHaveBeenCalled();
    for (const status of ["queued", "sent", "delivered", "read", "dry_run"]) { mocks.send.mockResolvedValueOnce({ ok: true, status }); expect((await sendVehicleCustomerMessage(draft, draft.body)).status).toBe(status); }
    expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({ customerId, vehicleId, workOrderId: orderId, claimId, recipientPhone: "96897000001", templateType: "vehicle_customer_portal", shortLink: draft.url }));
  });
  it("queries cloud history with tenant/customer/vehicle/channel and exact visit-prefix or approval-event scope", async () => {
    const current = await context(); await listVehicleCustomerMessageLogs(current);
    const calls = [...mocks.queries].reverse().find(row => row.table === "message_logs")!.calls;
    expect(calls).toContainEqual(["eq", "tenant_id", tenant]); expect(calls).toContainEqual(["eq", "customer_id", customerId]); expect(calls).toContainEqual(["eq", "vehicle_id", vehicleId]); expect(calls).toContainEqual(["eq", "channel", "whatsapp"]);
    expect(calls).toContainEqual(["or", `idempotency_key.like.${vehicleCustomerMessagePrefix(current)}%,idempotency_key.eq.vehicle-visit:v1:${tenant}:${claimId}:approval:${claimId}:${claim.approved_at}`]);
    expect(calls.some(([method, value]) => method === "or" && String(value).includes("claim_id.eq"))).toBe(false); expect(calls).toContainEqual(["limit", 50]);
  });
  it("has an explicit guarded definition for every exposed customer message kind", async () => {
    const current = await context(); expect(CUSTOMER_MESSAGE_KINDS).toHaveLength(14);
    for (const kind of CUSTOMER_MESSAGE_KINDS) expect(vehicleCustomerMessageAvailability(current, kind)).toEqual(expect.objectContaining({ available: expect.any(Boolean) }));
    expect(vehicleCustomerMessageAvailability({ ...current, phone: "" }, "portal").reason).toBe("PHONE");
    await expect(prepareVehicleCustomerMessage(entryId, "not-real" as VehicleCustomerMessageKind, "en", tenant)).rejects.toMatchObject({ code: "CUSTOMER_MESSAGE_IDENTITY" });
  });
});
