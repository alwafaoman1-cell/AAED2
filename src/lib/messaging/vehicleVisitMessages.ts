import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { getLinkedVehicleVisit, getVehicleVisitDetail } from "@/lib/vehicleVisitLifecycle";
import { createVehicleEntryCustomerSignatureLink, getVehicleEntryPresence } from "@/lib/vehicleEntryService";
import { createInspectionReleaseViewLink } from "@/lib/vehicleInspectionRelease";
import { hasConfirmedVehicleEntryWorkOrderLink } from "@/lib/vehicleEntryWorkOrderLink";
import { normalizePhone } from "@/lib/phoneUtils";
import { readSystemPreferences } from "@/lib/systemPreferences";
import { isUuid } from "@/lib/uuid";
import { sendUnifiedMessage } from "./messagingService";
import i18n from "@/i18n";
import "@/lib/i18n/vehicleVisitMessages";

export interface VehicleVisitMessageSelection { entryId?: string; claimId?: string }
export type VehicleVisitMessageKind = "approval" | "entry_receipt" | "temporary_release";
export interface VehicleVisitMessageContext {
  tenantId: string; entryId: string | null; claimId: string | null; workOrderId: string | null;
  customerId: string | null; vehicleId: string; customerName: string; phone: string;
  entryNumber: string; claimNumber: string; workOrderNumber: string; plate: string; vehicle: string;
  presence: "in_workshop" | "with_customer"; claimStatus: string; approved: boolean;
  approvedAmount: number; estimatedAmount: number; approvalEvent: string;
  entryIssued: boolean; entryUpdatedAt: string; claimUpdatedAt: string;
  releaseId: string | null; releaseNumber: string; releaseFinalized: boolean; noEntry: boolean;
  legacyApprovalState: "none" | "queued" | "draft_opened" | "sent_unconfirmed";
}
export interface VehicleVisitMessageDraft {
  context: VehicleVisitMessageContext; kind: VehicleVisitMessageKind; language: "ar" | "en";
  body: string; url: string | null; idempotencyKey: string; fingerprint: string;
}
const STAFF = ["admin", "manager", "insurance", "supervisor"];
const fail = (code: string): never => { throw Object.assign(new Error(code), { code: `VISIT_MESSAGE_${code}` }); };

/** Fresh authority, not user metadata or a cached role. RLS/backend guards remain authoritative. */
async function messageTenant(expectedTenant?: string): Promise<string> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) fail("FORBIDDEN");
  const { data: row, error } = await supabase.from("profiles").select("user_id,tenant_id,role,account_status,disabled_at")
    .eq("user_id", auth.user.id).maybeSingle();
  if (error) throw error;
  if (!row || row.user_id !== auth.user.id || row.account_status !== "active" || row.disabled_at != null || !STAFF.includes(row.role)
    || !row.tenant_id || (expectedTenant && row.tenant_id !== expectedTenant)) fail("FORBIDDEN");
  if (await getCurrentTenantId() !== row.tenant_id) fail("STALE");
  return row.tenant_id;
}

/** No plate search, owner fallback, writes, automatic relinking or fabricated arrival. */
export async function loadVehicleVisitMessageContext(selection: VehicleVisitMessageSelection, expectedTenant?: string): Promise<VehicleVisitMessageContext> {
  if ((!selection.entryId && !selection.claimId) || (selection.entryId && !isUuid(selection.entryId))
    || (selection.claimId && !isUuid(selection.claimId))) fail("IDENTITY");
  const tenantId = await messageTenant(expectedTenant);
  const linked = !selection.entryId && selection.claimId ? await getLinkedVehicleVisit("claim", selection.claimId) : null;
  const claimOnlyProjection = !linked?.entryId && linked?.reviewReason === "claim_without_entry";
  if ((linked?.presence === "needs_review" && !claimOnlyProjection) || (linked?.reviewReason && !claimOnlyProjection)) fail("CONFLICT");
  const entryId = selection.entryId || linked?.entryId || null;
  const visit = entryId ? await getVehicleVisitDetail(entryId, { includeOperationalFile: false }) : null;
  if (entryId && (!visit || visit.entry.tenant_id !== tenantId || visit.reviewReason || visit.hasFinalHandover
    || visit.entry.status === "Cancelled" || visit.entry.status === "Draft")) fail("CONFLICT");
  const entry = visit?.entry;
  if (entry?.insurance_claim_id && entry?.converted_claim_id && entry.insurance_claim_id !== entry.converted_claim_id) fail("CONFLICT");
  const claimId = entry?.insurance_claim_id || entry?.converted_claim_id || selection.claimId || null;
  if (selection.claimId && claimId !== selection.claimId) fail("CONFLICT");
  let claim: any = null;
  if (claimId) {
    const result = await supabase.from("insurance_claims").select("id,tenant_id,customer_id,vehicle_id,claim_number,status,approved_amount,estimated_amount,approved_at,insurance_approved_at,updated_at,vehicle_presence_status,delivered_at,vehicle_delivered_at,vehicle_owner_name,vehicle_owner_phone")
      .eq("tenant_id", tenantId).eq("id", claimId).is("deleted_at", null).maybeSingle();
    if (result.error) throw result.error;
    claim = result.data;
    if (!claim || (entry && entry.vehicle_id !== claim.vehicle_id) || ["cancelled", "rejected", "paid"].includes(claim.status)
      || claim.delivered_at || claim.vehicle_delivered_at) fail("CONFLICT");
  }
  let claimOnlyOrder: any = null;
  if (!entry && claim) {
    const result = await supabase.from("job_orders").select("id,tenant_id,vehicle_id,claim_id,vehicle_entry_id,work_order_type,vehicle_presence_status,vehicle_delivered_at,status,order_number")
      .eq("tenant_id", tenantId).eq("claim_id", claim.id).is("deleted_at", null).limit(2);
    if (result.error) throw result.error;
    const orders = result.data || [];
    if (orders.length > 1) fail("CONFLICT");
    claimOnlyOrder = orders[0] || null;
    if (claimOnlyOrder && (claimOnlyOrder.tenant_id !== tenantId || claimOnlyOrder.vehicle_id !== claim.vehicle_id
      || claimOnlyOrder.claim_id !== claim.id || claimOnlyOrder.vehicle_entry_id || claimOnlyOrder.work_order_type !== "insurance"
      || claimOnlyOrder.vehicle_delivered_at || ["delivered", "cancelled", "closed", "تم التسليم", "مغلق"].includes(claimOnlyOrder.status)
      || (claimOnlyOrder.vehicle_presence_status && claimOnlyOrder.vehicle_presence_status !== claim.vehicle_presence_status))) fail("CONFLICT");
  }
  const presence = entry ? getVehicleEntryPresence(entry)
    : claimOnlyProjection && claim?.vehicle_presence_status === "with_customer" ? "with_customer" : linked?.presence;
  if (presence !== "in_workshop" && presence !== "with_customer") fail("CONFLICT");
  const confirmedPresence: "in_workshop" | "with_customer" = presence === "in_workshop" ? "in_workshop"
    : presence === "with_customer" ? "with_customer" : fail("CONFLICT");
  if (claim?.vehicle_presence_status && claim.vehicle_presence_status !== presence) fail("CONFLICT");
  const customerId = entry ? entry.customer_id : claim?.customer_id;
  let customer = { name: claim?.vehicle_owner_name || "", phone: claim?.vehicle_owner_phone || "" };
  if (customerId) {
    const result = await supabase.from("customers").select("id,name,phone").eq("tenant_id", tenantId)
      .eq("id", customerId).is("deleted_at", null).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) fail("CUSTOMER_UNAVAILABLE");
    customer = result.data;
  } else if (entry) fail("CUSTOMER_UNAVAILABLE");
  const prefs = await readSystemPreferences();
  const phone = normalizePhone(customer.phone, prefs.defaultCountryCode);
  const order = entry?.work_order || entry?.converted_work_order || claimOnlyOrder;
  if (entry && order && !hasConfirmedVehicleEntryWorkOrderLink(entry, order)) fail("CONFLICT");
  const activeReleases = (visit?.releases || []).filter(r => r.status === "signed" && !r.returned_at);
  if (activeReleases.length > 1) fail("CONFLICT");
  const release = activeReleases[0];
  const vehicleId = entry?.vehicle_id || claim?.vehicle_id;
  if (!isUuid(vehicleId)) fail("IDENTITY");
  let vehicle = { ...entry?.vehicle, ...entry?.vehicle_snapshot };
  if (!entry) {
    const result = await supabase.from("vehicles").select("id,tenant_id,plate_number,plate_letters,plate_country,brand,model,year")
      .eq("tenant_id", tenantId).eq("id", vehicleId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || result.data.id !== vehicleId || result.data.tenant_id !== tenantId) fail("CONFLICT");
    vehicle = result.data;
  }
  let legacyApprovalState: VehicleVisitMessageContext["legacyApprovalState"] = "none";
  if (claim?.status === "approved" && order?.id) {
    const legacy = await supabase.from("customer_notifications").select("id,status,channel,payload")
      .eq("tenant_id", tenantId).eq("job_order_id", order.id).eq("event_type", "insurance_approved")
      .eq("channel", "whatsapp").order("created_at", { ascending: false }).limit(20);
    if (legacy.error) throw legacy.error;
    if (legacy.data?.some(row => row.status === "queued")) legacyApprovalState = "queued";
    else if (legacy.data?.some(row => row.status === "sent" && (row.payload as any)?.wa_url)) legacyApprovalState = "draft_opened";
    else if (legacy.data?.some(row => row.status === "sent")) legacyApprovalState = "sent_unconfirmed";
  }
  const context: VehicleVisitMessageContext = {
    tenantId, entryId, claimId, workOrderId: order?.id || null, customerId: customerId || null, vehicleId,
    customerName: customer.name || "", phone, entryNumber: entry?.entry_number || "", claimNumber: claim?.claim_number || "",
    workOrderNumber: order?.order_number || "", presence: confirmedPresence, claimStatus: claim?.status || "", approved: claim?.status === "approved",
    plate: [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" "),
    vehicle: [vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" "),
    approvedAmount: Number(claim?.approved_amount || 0), estimatedAmount: Number(claim?.estimated_amount || 0),
    approvalEvent: claim?.approved_at || claim?.insurance_approved_at || "approved",
    entryIssued: Boolean(entry && ["Issued", "Converted to Claim", "Converted to Work Order"].includes(entry.status) && entry.issued_at),
    entryUpdatedAt: entry?.updated_at || "", claimUpdatedAt: claim?.updated_at || "", releaseId: release?.id || null, releaseNumber: release?.release_number || "",
    releaseFinalized: Boolean(release?.released_at && presence === "with_customer"), noEntry: !entryId,
    legacyApprovalState,
  };
  await messageTenant(tenantId);
  return context;
}

export function vehicleVisitMessageFingerprint(context: VehicleVisitMessageContext): string { return JSON.stringify(context); }
export function vehicleVisitMessagePrefix(context: Pick<VehicleVisitMessageContext, "tenantId" | "entryId" | "claimId">): string {
  return `vehicle-visit:v1:${context.tenantId}:${context.entryId || context.claimId}:`;
}
export function vehicleVisitMessageKey(context: VehicleVisitMessageContext, kind: VehicleVisitMessageKind): string {
  // Language, edits, URL rotation and double clicks do not create a new business event.
  const event = kind === "approval" ? `${context.claimId}:${context.approvalEvent}` : kind === "temporary_release" ? context.releaseId : context.entryId;
  const anchor = kind === "approval" ? { ...context, entryId: null } : context;
  return `${vehicleVisitMessagePrefix(anchor)}${kind}:${event}`;
}
export function buildVehicleVisitMessageDraft(context: VehicleVisitMessageContext, kind: VehicleVisitMessageKind, language: "ar" | "en", url: string | null = null): VehicleVisitMessageDraft {
  if (!/^[1-9]\d{7,14}$/.test(context.phone)) fail("PHONE");
  if (kind === "approval" && (!context.claimId || !context.approved)) fail("PENDING_APPROVAL");
  if (kind === "entry_receipt" && (!context.entryId || !context.entryIssued || context.presence !== "in_workshop" || !url)) fail("ENTRY_REQUIRED");
  if (kind === "temporary_release" && (!context.entryId || !context.releaseId || !context.releaseFinalized || context.presence !== "with_customer" || !url)) fail("RELEASE_REQUIRED");
  const key = kind === "approval" ? `approval_${context.presence}` : kind;
  const body = i18n.t(`vehicleVisitMessages.bodies.${key}`, { lng: language, customer: context.customerName,
    claim: context.claimNumber, entry: context.entryNumber, release: context.releaseNumber, order: context.workOrderNumber || "—", link: url || "",
    plate: context.plate || "—", vehicle: context.vehicle || "—" });
  return { context, kind, language, body, url, idempotencyKey: vehicleVisitMessageKey(context, kind), fingerprint: vehicleVisitMessageFingerprint(context) };
}
export async function prepareVehicleVisitMessage(selection: VehicleVisitMessageSelection, kind: VehicleVisitMessageKind, language: "ar" | "en", expectedTenant: string): Promise<VehicleVisitMessageDraft> {
  const context = await loadVehicleVisitMessageContext(selection, expectedTenant);
  if (kind === "approval") return buildVehicleVisitMessageDraft(context, kind, language);
  if (kind === "entry_receipt" && (!context.entryIssued || context.presence !== "in_workshop" || !context.entryId)) fail("ENTRY_REQUIRED");
  if (kind === "temporary_release" && (!context.entryId || !context.releaseId || !context.releaseFinalized || context.presence !== "with_customer")) fail("RELEASE_REQUIRED");
  if (!/^[1-9]\d{7,14}$/.test(context.phone)) fail("PHONE");
  const link = kind === "entry_receipt" ? await createVehicleEntryCustomerSignatureLink(context.entryId!)
    : await createInspectionReleaseViewLink(context.releaseId!);
  const current = await loadVehicleVisitMessageContext(selection, expectedTenant);
  if (vehicleVisitMessageFingerprint(context) !== vehicleVisitMessageFingerprint(current)) fail("STALE");
  return buildVehicleVisitMessageDraft(current, kind, language, link.url);
}
export async function sendVehicleVisitMessage(draft: VehicleVisitMessageDraft, reviewedBody: string, isCurrent: () => boolean = () => true) {
  if (!reviewedBody.trim() || reviewedBody.length > 4000) fail("BODY");
  const current = await loadVehicleVisitMessageContext({ entryId: draft.context.entryId || undefined, claimId: draft.context.claimId || undefined }, draft.context.tenantId);
  if (!isCurrent() || vehicleVisitMessageFingerprint(current) !== draft.fingerprint) fail("STALE");
  if (draft.kind === "approval" && current.legacyApprovalState !== "none") fail("LEGACY_APPROVAL");
  // Re-run eligibility, preserving the reviewed stable event key.
  buildVehicleVisitMessageDraft(current, draft.kind, draft.language, draft.url);
  const result = await sendUnifiedMessage({ channel: "whatsapp", body: reviewedBody.trim(), recipientPhone: current.phone,
    templateType: `vehicle_visit_${draft.kind}`, idempotencyKey: draft.idempotencyKey,
    customerId: current.customerId, vehicleId: current.vehicleId, workOrderId: current.workOrderId, claimId: current.claimId,
    shortLink: draft.url });
  if (!result.ok || !["sent", "delivered", "read"].includes(result.status || "")) throw new Error(result.error || "VISIT_MESSAGE_PROVIDER_UNCONFIRMED");
  return result;
}
export async function listVehicleVisitMessageLogs(context: VehicleVisitMessageContext) {
  await messageTenant(context.tenantId);
  let query = supabase.from("message_logs" as any).select("id,status,template_type,created_at,sent_at,claim_id,work_order_id,idempotency_key")
    .eq("tenant_id", context.tenantId).eq("channel", "whatsapp");
  if (context.entryId && context.claimId) query = query.or(`idempotency_key.like.${vehicleVisitMessagePrefix(context)}%,claim_id.eq.${context.claimId}`);
  else if (context.entryId) query = query.like("idempotency_key", `${vehicleVisitMessagePrefix(context)}%`);
  else query = query.eq("claim_id", context.claimId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(10);
  if (error) throw error;
  return (data || []) as unknown as Array<{ id: string; status: string; template_type: string; created_at: string; sent_at: string | null; idempotency_key: string }>;
}
