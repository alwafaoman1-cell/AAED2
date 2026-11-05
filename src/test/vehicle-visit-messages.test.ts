import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), tenant: vi.fn(), linked: vi.fn(), visit: vi.fn(), link: vi.fn(), viewLink: vi.fn(), send: vi.fn(), bundles: {} as Record<string, any> }));
vi.mock("@/i18n", () => ({ default: {
  addResourceBundle: (language: string, _namespace: string, resources: object) => { mocks.bundles[language] = { ...mocks.bundles[language], ...resources }; },
  t: (key: string, params: Record<string, string> = {}) => {
    const value = key.split(".").reduce((current, part) => current?.[part], mocks.bundles[params.lng || "en"]);
    return typeof value === "string" ? value.replace(/{{(\w+)}}/g, (_match, name) => params[name] || "") : key;
  },
} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getLinkedVehicleVisit: mocks.linked, getVehicleVisitDetail: mocks.visit }));
vi.mock("@/lib/vehicleEntryService", () => ({ createVehicleEntryCustomerSignatureLink: mocks.link,
  getVehicleEntryPresence: (entry: any) => entry.vehicle_location === "داخل الورشة" ? "in_workshop" : entry.vehicle_location === "مع العميل" ? "with_customer" : "needs_review" }));
vi.mock("@/lib/vehicleInspectionRelease", () => ({ createInspectionReleaseViewLink: mocks.viewLink }));
vi.mock("@/lib/systemPreferences", () => ({ readSystemPreferences: async () => ({ defaultCountryCode: "968" }) }));
vi.mock("@/lib/messaging/messagingService", () => ({ sendUnifiedMessage: mocks.send }));
import { buildVehicleVisitMessageDraft, loadVehicleVisitMessageContext, prepareVehicleVisitMessage, sendVehicleVisitMessage,
  listVehicleVisitMessageLogs, vehicleVisitMessageKey, type VehicleVisitMessageContext } from "@/lib/messaging/vehicleVisitMessages";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1), entryId = id(2), claimId = id(3), customerId = id(4), vehicleId = id(5), userId = id(6);
let claim: any, entry: any, customer: any, profile: any;
const query = (data: unknown) => {
  const q: any = { then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data, error: null })) };
  for (const name of ["select", "eq", "is", "maybeSingle", "order", "limit", "like", "or"]) q[name] = vi.fn(() => q);
  return q;
};
beforeEach(() => {
  vi.clearAllMocks();
  claim = { id: claimId, tenant_id: tenant, customer_id: customerId, vehicle_id: vehicleId, claim_number: "TEST-CLAIM", status: "approved",
    approved_at: "2026-11-05T12:00:00Z", updated_at: "2026-11-05T12:00:00Z", vehicle_presence_status: "in_workshop", approved_amount: 100,
    vehicle_owner_phone: "+96899999999", vehicle_owner_name: "Do not substitute" };
  entry = { id: entryId, tenant_id: tenant, customer_id: customerId, vehicle_id: vehicleId, insurance_claim_id: claimId,
    entry_number: "TEST-ENTRY", status: "Issued", issued_at: "2026-11-05T10:00:00Z", updated_at: "2026-11-05T10:00:00Z", vehicle_location: "داخل الورشة",
    vehicle_snapshot: { plate_number: "1234", plate_letters: "QA", make: "Toyota", model: "Corolla", year: 2026 } };
  customer = { id: customerId, name: "Visit customer", phone: "+96897000001" };
  profile = { user_id: userId, tenant_id: tenant, role: "supervisor", account_status: "active", disabled_at: null };
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.tenant.mockResolvedValue(tenant);
  mocks.linked.mockResolvedValue({ entryId, presence: "in_workshop", reviewReason: null });
  mocks.visit.mockImplementation(async () => ({ entry, reviewReason: null, hasFinalHandover: false, releases: [] }));
  mocks.from.mockImplementation((table: string) => query(table === "profiles" ? profile : table === "insurance_claims" ? claim : table === "customers" ? customer
    : table === "vehicles" ? { id: vehicleId, tenant_id: tenant, ...entry.vehicle_snapshot } : []));
  mocks.link.mockResolvedValue({ url: "https://example.invalid/vehicle-entry/sign/test-token" });
  mocks.viewLink.mockResolvedValue({ url: "https://example.invalid/vehicle-entry/inspection-release/sign/view-token", expires_at: "2026-11-12" });
  mocks.send.mockResolvedValue({ ok: true, status: "sent", logId: id(9) });
});
async function context() { return loadVehicleVisitMessageContext({ entryId, claimId }, tenant); }

describe("vehicle visit messages: identity, review and manual delivery", () => {
  it("loads fresh canonical identity/contact without sending or issuing links", async () => {
    expect(await context()).toMatchObject({ tenantId: tenant, entryId, claimId, customerId, phone: "96897000001", approved: true });
    expect(mocks.visit).toHaveBeenCalledWith(entryId, { includeOperationalFile: false });
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.link).not.toHaveBeenCalled();
  });
  it("does not replace a deleted visit customer with the historical owner", async () => {
    customer = null;
    await expect(context()).rejects.toMatchObject({ code: "VISIT_MESSAGE_CUSTOMER_UNAVAILABLE" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["invited", "disabled"])("denies %s staff", async status => {
    profile.account_status = status;
    await expect(context()).rejects.toMatchObject({ code: "VISIT_MESSAGE_FORBIDDEN" });
  });
  it("denies disable timestamps and a foreign expected tenant", async () => {
    profile.disabled_at = "2026-11-05";
    await expect(context()).rejects.toMatchObject({ code: "VISIT_MESSAGE_FORBIDDEN" });
    profile.disabled_at = null;
    await expect(loadVehicleVisitMessageContext({ entryId }, id(99))).rejects.toMatchObject({ code: "VISIT_MESSAGE_FORBIDDEN" });
  });
  it("keeps historical link/custody conflicts blocked, without relinking", async () => {
    mocks.visit.mockResolvedValue({ entry, reviewReason: "work_order_link_conflict", releases: [] });
    await expect(context()).rejects.toMatchObject({ code: "VISIT_MESSAGE_CONFLICT" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects an explicit claim that is not the entry's claim", async () => {
    await expect(loadVehicleVisitMessageContext({ entryId, claimId: id(99) }, tenant)).rejects.toMatchObject({ code: "VISIT_MESSAGE_CONFLICT" });
  });
  it("blocks paid claims rather than manufacturing an approval notification", async () => {
    claim.status = "paid";
    await expect(context()).rejects.toMatchObject({ code: "VISIT_MESSAGE_CONFLICT" });
  });
  it("uses customer-held versus inside approval wording, with English-only output", async () => {
    const inside = await context();
    const outside = { ...inside, presence: "with_customer" as const };
    expect(buildVehicleVisitMessageDraft(inside, "approval", "en").body).toContain("inside the workshop");
    expect(buildVehicleVisitMessageDraft(inside, "approval", "en").body).toContain("Toyota Corolla 2026");
    expect(buildVehicleVisitMessageDraft(inside, "approval", "en").body).toContain("QA 1234");
    expect(buildVehicleVisitMessageDraft(outside, "approval", "en").body).toContain("schedule its arrival");
    expect(buildVehicleVisitMessageDraft(outside, "approval", "en").body).not.toMatch(/[\u0600-\u06ff]/);
    expect(buildVehicleVisitMessageDraft(inside, "approval", "ar").body).toContain("داخل الورشة");
  });
  it("permits an approved customer-held claim without inventing an entry", async () => {
    claim.vehicle_presence_status = "with_customer";
    mocks.linked.mockResolvedValue({ entryId: null, presence: "needs_review", reviewReason: "claim_without_entry" });
    const current = await loadVehicleVisitMessageContext({ claimId }, tenant);
    expect(current).toMatchObject({ noEntry: true, entryId: null, entryIssued: false });
    expect(buildVehicleVisitMessageDraft(current, "approval", "en").body).toContain("schedule its arrival");
    expect(() => buildVehicleVisitMessageDraft(current, "entry_receipt", "en")).toThrow("ENTRY_REQUIRED");
  });
  it("does not turn a claim-only custody conflict into an arrival invitation", async () => {
    claim.vehicle_presence_status = "with_customer";
    mocks.linked.mockResolvedValue({ entryId: null, presence: "needs_review", reviewReason: "claim_without_entry" });
    const previous = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation((table: string) => table === "job_orders" ? query([{ id: id(8), tenant_id: tenant,
      vehicle_id: vehicleId, claim_id: claimId, work_order_type: "insurance", vehicle_presence_status: "in_workshop" }]) : previous(table));
    await expect(loadVehicleVisitMessageContext({ claimId }, tenant)).rejects.toMatchObject({ code: "VISIT_MESSAGE_CONFLICT" });
  });
  it("never prepares fake approval or receipt messages for pending/draft state", async () => {
    const current = await context();
    expect(() => buildVehicleVisitMessageDraft({ ...current, approved: false }, "approval", "en")).toThrow("PENDING_APPROVAL");
    expect(() => buildVehicleVisitMessageDraft({ ...current, entryIssued: false }, "entry_receipt", "en", "https://example.invalid")).toThrow("ENTRY_REQUIRED");
  });
  it("keeps one approval key across edits, languages, presence and later entry creation", async () => {
    const current = await context();
    expect(vehicleVisitMessageKey(current, "approval")).toBe(vehicleVisitMessageKey({ ...current, entryId: null, presence: "with_customer" }, "approval"));
    expect(buildVehicleVisitMessageDraft(current, "approval", "en").idempotencyKey).toBe(buildVehicleVisitMessageDraft(current, "approval", "ar").idempotencyKey);
    expect(vehicleVisitMessageKey({ ...current, approvalEvent: "next-approval" }, "approval")).not.toBe(vehicleVisitMessageKey(current, "approval"));
  });
  it("creates a receipt signature link only on an explicit preparation call", async () => {
    const draft = await prepareVehicleVisitMessage({ entryId, claimId }, "entry_receipt", "en", tenant);
    expect(mocks.link).toHaveBeenCalledTimes(1); expect(mocks.link).toHaveBeenCalledWith(entryId);
    expect(draft.body).toContain("not a temporary-release or final-delivery receipt");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not rotate signature links when the visit customer has no phone", async () => {
    customer.phone = "";
    await expect(prepareVehicleVisitMessage({ entryId, claimId }, "entry_receipt", "en", tenant)).rejects.toMatchObject({ code: "VISIT_MESSAGE_PHONE" });
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it("requires a completed temporary release and a real view URL", async () => {
    const current = await context();
    expect(() => buildVehicleVisitMessageDraft(current, "temporary_release", "en")).toThrow("RELEASE_REQUIRED");
    expect(() => buildVehicleVisitMessageDraft({ ...current, releaseFinalized: true }, "temporary_release", "en")).toThrow("RELEASE_REQUIRED");
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it("uses only the parent's consumed read capability for a signed temporary release", async () => {
    entry.vehicle_location = "مع العميل"; claim.vehicle_presence_status = "with_customer";
    mocks.visit.mockImplementation(async () => ({ entry, reviewReason: null, hasFinalHandover: false, releases: [
      { id: id(10), release_number: "TEMP-TEST", status: "signed", released_at: "2026-11-05", returned_at: null },
    ] }));
    const draft = await prepareVehicleVisitMessage({ entryId, claimId }, "temporary_release", "en", tenant);
    expect(mocks.viewLink).toHaveBeenCalledWith(id(10)); expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled(); expect(draft.body).toContain("read-only"); expect(draft.body).toContain("TEMP-TEST");
    expect(draft.body).not.toMatch(/[\u0600-\u06ff]/);
    expect(buildVehicleVisitMessageDraft(draft.context, "temporary_release", "ar", draft.url).body).toContain("للقراءة فقط");
  });
  it("rejects a return/custody change while a read capability is being prepared", async () => {
    entry.vehicle_location = "مع العميل"; claim.vehicle_presence_status = "with_customer";
    const release = { id: id(10), release_number: "TEMP-TEST", status: "signed", released_at: "2026-11-05", returned_at: null as string | null };
    mocks.visit.mockImplementation(async () => ({ entry, reviewReason: null, hasFinalHandover: false, releases: [release] }));
    mocks.viewLink.mockImplementationOnce(async () => { entry.vehicle_location = "داخل الورشة"; claim.vehicle_presence_status = "in_workshop"; release.returned_at = "2026-11-05"; return { url: "https://example.invalid/view" }; });
    await expect(prepareVehicleVisitMessage({ entryId, claimId }, "temporary_release", "en", tenant)).rejects.toMatchObject({ code: "VISIT_MESSAGE_STALE" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps the read-link migration contract independent of its timestamp", () => {
    const files = readdirSync("supabase/migrations").filter(name => name.endsWith("_vehicle_inspection_release_readonly_link.sql"));
    expect(files).toHaveLength(1);
    const sql = readFileSync(`supabase/migrations/${files[0]}`, "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql).toContain("create_vehicle_inspection_release_view_link"); expect(sql).toContain("consumed_at");
    expect(sql).toContain("public.get_user_tenant_id()"); expect(sql).toContain("public.get_user_role()");
    expect(sql).toContain("p.account_status='active'"); expect(sql).toContain("p.disabled_at is null");
    expect(sql).toContain("p.tenant_id=v_tenant"); expect(sql).toMatch(/status\s*<>\s*'signed'/);
    expect(sql).toMatch(/released_at is null/); expect(sql).toMatch(/returned_at is not null/);
    expect(sql).toMatch(/from public,\s*anon,\s*authenticated/);
    expect(sql).not.toMatch(/update\s+public\.(vehicle_inspection_releases|vehicle_entries)/i);
  });
  it("rechecks phone/custody and component scope before sending", async () => {
    const draft = buildVehicleVisitMessageDraft(await context(), "approval", "en");
    customer.phone = "+96897000002";
    await expect(sendVehicleVisitMessage(draft, draft.body)).rejects.toMatchObject({ code: "VISIT_MESSAGE_STALE" });
    customer.phone = "+96897000001";
    await expect(sendVehicleVisitMessage(draft, draft.body, () => false)).rejects.toMatchObject({ code: "VISIT_MESSAGE_STALE" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sends only the reviewed draft via unified provider with canonical refs and stable key", async () => {
    const draft = buildVehicleVisitMessageDraft(await context(), "approval", "en");
    await sendVehicleVisitMessage(draft, "Reviewed message");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ body: "Reviewed message", claimId, customerId, vehicleId,
      recipientPhone: "96897000001", idempotencyKey: draft.idempotencyKey, channel: "whatsapp" }));
  });
  it("surfaces provider/template failure and never calls queued/dry-run results sent", async () => {
    const draft = buildVehicleVisitMessageDraft(await context(), "approval", "en");
    mocks.send.mockRejectedValueOnce(new Error("template_required"));
    await expect(sendVehicleVisitMessage(draft, draft.body)).rejects.toThrow("template_required");
    mocks.send.mockResolvedValueOnce({ ok: true, status: "queued" });
    await expect(sendVehicleVisitMessage(draft, draft.body)).rejects.toThrow("PROVIDER_UNCONFIRMED");
  });
  it("recognizes legacy queued approvals and does not send through a second pipeline", async () => {
    entry.work_order_id = id(8);
    entry.work_order = { id: id(8), tenant_id: tenant, vehicle_id: vehicleId, vehicle_entry_id: entryId, claim_id: claimId, work_order_type: "insurance" };
    const previous = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation((table: string) => table === "customer_notifications" ? query([{ status: "queued", channel: "whatsapp" }]) : previous(table));
    const current = await context();
    expect(current.legacyApprovalState).toBe("queued");
    const draft = buildVehicleVisitMessageDraft(current, "approval", "en");
    await expect(sendVehicleVisitMessage(draft, draft.body)).rejects.toMatchObject({ code: "VISIT_MESSAGE_LEGACY_APPROVAL" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not mistake the legacy wa.me sent flag for provider-confirmed delivery", async () => {
    entry.work_order_id = id(8);
    entry.work_order = { id: id(8), tenant_id: tenant, vehicle_id: vehicleId, vehicle_entry_id: entryId, claim_id: claimId, work_order_type: "insurance" };
    const previous = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation((table: string) => table === "customer_notifications" ? query([{ status: "sent", payload: { wa_url: "https://wa.me/example" } }]) : previous(table));
    expect((await context()).legacyApprovalState).toBe("draft_opened");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("queries tenant-scoped recent matching server logs, without preparing/sending", async () => {
    await listVehicleVisitMessageLogs(await context());
    expect(mocks.from).toHaveBeenCalledWith("message_logs"); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps manual send controls, 44px actions, and uses the existing approval hook", () => {
    const component = readFileSync("src/components/supervisor/SupervisorVisitMessages.tsx", "utf8");
    expect(component).toContain('queryKey: ["message_logs"'); expect(component).toContain("min-h-11");
    expect(component).toContain('["vehicle_visit", "messages"');
    expect(component).toContain("reviewed !== reviewIdentity"); expect(component).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*sendVehicleVisitMessage/);
    expect(component).toContain('aria-label={tr("body")}');
    const approval = readFileSync("src/components/supervisor/SupervisorClaimApproval.tsx", "utf8");
    expect(approval).toContain('profile?.role === "admin" || profile?.role === "manager"');
    expect(approval).toContain("useUpdateClaimStatus"); expect(approval).not.toContain("navigate(");
  });
});
