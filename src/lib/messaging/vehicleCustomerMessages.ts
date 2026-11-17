import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { getVehicleVisitDetail, type VisitStage } from "@/lib/vehicleVisitLifecycle";
import { getVehicleEntryPresence } from "@/lib/vehicleEntryService";
import { hasConfirmedVehicleEntryWorkOrderLink } from "@/lib/vehicleEntryWorkOrderLink";
import { getReviewVisitContext, isVehicleReviewVisit } from "@/lib/vehicleReviewVisit";
import { getInspectionReleaseById, inspectionReleaseMissingFields } from "@/lib/vehicleInspectionRelease";
import { buildCustomerPortalInvitation } from "@/lib/customerPortalInvitation";
import { buildUnifiedVehiclePortalUrl, ensureVehicleCustomerPortal, getVehicleCustomerPortalContext, type StaffVehiclePortalContext } from "@/lib/unifiedVehiclePortal";
import { normalizePhone } from "@/lib/phoneUtils";
import { readSystemPreferences } from "@/lib/systemPreferences";
import { isUuid } from "@/lib/uuid";
import { sendUnifiedMessage, type SendUnifiedMessageResult } from "./messagingService";

export const CUSTOMER_MESSAGE_KINDS = ["portal", "intake_signature", "intake_documents", "review_signature", "review_documents", "approval", "order_signature", "repair_update", "ready_for_pickup", "temporary_release_signature", "temporary_release_documents", "delivery_documents", "follow_up", "custom"] as const;
export type VehicleCustomerMessageKind = typeof CUSTOMER_MESSAGE_KINDS[number];
export type VehicleCustomerMessageBlocker = "FORBIDDEN" | "IDENTITY" | "CONFLICT" | "CUSTOMER_UNAVAILABLE" | "PHONE" | "ENTRY_REQUIRED" | "ALREADY_SIGNED" | "DOCUMENT_REQUIRED" | "REVIEW_REQUIRED" | "INITIAL_VISIT_REQUIRED" | "APPROVAL_REQUIRED" | "LEGACY_APPROVAL" | "ORDER_REQUIRED" | "ORDER_ALREADY_SIGNED" | "IN_PROGRESS_REQUIRED" | "READY_REQUIRED" | "RELEASE_REQUIRED" | "RELEASE_SIGNATURE_REQUIRED" | "DELIVERY_REQUIRED" | "MANAGER_APPROVAL_REQUIRED" | "PORTAL_PAUSED" | "PORTAL_EXPIRED" | "PORTAL_REQUIRED" | "STALE" | "BODY" | "CANCELLED" | "DRAFT";
export interface VehicleCustomerMessageContext {
  tenantId: string; actorId: string; entryId: string; entryNumber: string; customerId: string; customerName: string; phone: string;
  vehicleId: string; vehicleMake?: string; vehicleModel?: string; vehicleYear?: string | number;
  stage: VisitStage; presence: "in_workshop" | "with_customer"; isReview: boolean; intakeSigned: boolean; intakeRevision: number;
  intakeDocumentAvailable: boolean; signatureId: string | null; receiptId: string | null; issued: boolean; draft: boolean; cancelled: boolean;
  claimId: string | null; workOrderId: string | null; approved: boolean; approvalEvent: string; workOrderSigned: boolean;
  legacyApprovalState: "none" | "queued" | "draft_opened" | "sent_unconfirmed";
  orderAvailable: boolean; workOrderStatus: string; workOrderUpdatedAt: string; readyEvent: string; repairEvent: string;
  handoverId: string | null; finalDeliveryApproved: boolean;
  signatureRelease: { id: string; status: string; updatedAt: string; complete: boolean; recipientName: string; recipientPhone: string } | null;
  signedRelease: { id: string; releasedAt: string } | null;
  portal: StaffVehiclePortalContext | null; updatedAt: string; workflowRevision: number | null;
}
export interface VehicleCustomerMessageDraft {
  context: VehicleCustomerMessageContext; kind: VehicleCustomerMessageKind; language: "ar" | "en";
  body: string; url: string; idempotencyKey: string; fingerprint: string; recipientPhone: string; recipientName: string;
}
export interface VehicleCustomerMessageLog {
  id: string; status: string; template_type: string; body: string | null; message?: string | null; recipient_phone: string | null;
  created_at: string; sent_at: string | null; delivered_at?: string | null; read_at?: string | null;
  error: string | null; failure_reason?: string | null; provider_message_id?: string | null; idempotency_key: string;
}

type Row = Record<string, any>;
const STAFF = ["admin", "manager", "supervisor", "insurance"];
function fail(code: VehicleCustomerMessageBlocker): never { throw Object.assign(new Error(code), { code: `CUSTOMER_MESSAGE_${code}` }); }
async function authority(expectedTenant?: string) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) fail("FORBIDDEN");
  const result = await supabase.from("profiles").select("user_id,tenant_id,role,account_status,disabled_at").eq("user_id", data.user.id).maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (!row || row.user_id !== data.user.id || row.account_status !== "active" || row.disabled_at != null || !STAFF.includes(row.role)
    || !row.tenant_id || expectedTenant && row.tenant_id !== expectedTenant) fail("FORBIDDEN");
  if (await getCurrentTenantId() !== row.tenant_id) fail("STALE");
  return { tenantId: row.tenant_id, actorId: row.user_id, role: row.role };
}
async function readOne(table: string, columns: string, tenant: string, id: string): Promise<Row | null> {
  const { data, error } = await supabase.from(table as any).select(columns).eq("tenant_id", tenant).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (data && (data as Row).id !== id) fail("CONFLICT");
  return data as Row | null;
}
function portalBlocker(portal: StaffVehiclePortalContext | null): VehicleCustomerMessageBlocker | null {
  if (portal?.enabled === false) return "PORTAL_PAUSED";
  if (portal?.expires_at && !(Date.parse(portal.expires_at) > Date.now())) return "PORTAL_EXPIRED";
  return null;
}
function validPhone(phone: string) { return /^[1-9]\d{7,14}$/.test(phone); }
export function vehicleCustomerMessagePrefix(context: Pick<VehicleCustomerMessageContext, "tenantId" | "entryId">) {
  return `vehicle-customer:v2:${context.tenantId}:${context.entryId}:`;
}
export function vehicleCustomerMessageFingerprint(context: VehicleCustomerMessageContext) { return JSON.stringify(context); }
function approvalKey(context: VehicleCustomerMessageContext) {
  return `vehicle-visit:v1:${context.tenantId}:${context.claimId}:approval:${context.claimId}:${context.approvalEvent}`;
}

/** SELECT-only context. Opening the center never issues a link, changes a stage,
 * signs a form, logs a view, repairs a relationship, or sends a message. */
export async function loadVehicleCustomerMessageContext(entryId: string, expectedTenant?: string): Promise<VehicleCustomerMessageContext> {
  if (!isUuid(entryId)) fail("IDENTITY");
  const actor = await authority(expectedTenant);
  const visit = await getVehicleVisitDetail(entryId, { includeOperationalFile: false });
  const entry = visit?.entry;
  if (!visit || !entry || entry.id !== entryId || entry.tenant_id !== actor.tenantId || visit.reviewReason
    || !isUuid(entry.customer_id) || !isUuid(entry.vehicle_id)) fail("CONFLICT");
  if (entry.insurance_claim_id && entry.converted_claim_id && entry.insurance_claim_id !== entry.converted_claim_id
    || entry.work_order_id && entry.converted_work_order_id && entry.work_order_id !== entry.converted_work_order_id) fail("CONFLICT");
  const isReview = isVehicleReviewVisit(entry);
  const reviewContext = isReview ? await getReviewVisitContext(entryId) : null;
  if (isReview && (!reviewContext || reviewContext.source_entry_id !== entry.vehicle_condition.review_return.source_entry_id
    || reviewContext.source_handover_id !== entry.vehicle_condition.review_return.source_handover_id)) fail("CONFLICT");
  const claimId = entry.insurance_claim_id || entry.converted_claim_id || reviewContext?.source_claim_id || null;
  const workOrderId = entry.work_order_id || entry.converted_work_order_id || reviewContext?.source_work_order_id || null;
  if (reviewContext && (claimId !== reviewContext.source_claim_id || workOrderId !== reviewContext.source_work_order_id)) fail("CONFLICT");
  const [customer, prefs, claim, order] = await Promise.all([
    readOne("customers", "id,name,phone", actor.tenantId, entry.customer_id),
    readSystemPreferences(),
    claimId ? readOne("insurance_claims", "id,tenant_id,customer_id,vehicle_id,status,approved_at,insurance_approved_at,updated_at,repair_stage,work_started_at,work_completed_at,vehicle_presence_status,vehicle_delivered_at,delivered_at", actor.tenantId, claimId) : Promise.resolve(null),
    workOrderId ? readOne("job_orders", "id,tenant_id,customer_id,vehicle_id,vehicle_entry_id,claim_id,work_order_type,status,updated_at,work_started_at,work_completed_at,vehicle_presence_status,vehicle_delivered_at", actor.tenantId, workOrderId) : Promise.resolve(null),
  ]);
  if (!customer) fail("CUSTOMER_UNAVAILABLE");
  if (claimId && (!claim || claim.vehicle_id !== entry.vehicle_id || claim.customer_id !== entry.customer_id)) fail("CONFLICT");
  if (workOrderId && !hasConfirmedVehicleEntryWorkOrderLink(entry, order as Parameters<typeof hasConfirmedVehicleEntryWorkOrderLink>[1])) {
    if (!isReview || !order || order.tenant_id !== actor.tenantId || order.vehicle_id !== entry.vehicle_id || order.customer_id !== entry.customer_id || order.claim_id !== claimId
      || (claimId ? order.work_order_type !== "insurance" : order.work_order_type === "insurance")) fail("CONFLICT");
    const source = reviewContext;
    const review = entry.vehicle_condition.review_return;
    if (!source || source.source_entry_id !== review.source_entry_id || source.source_handover_id !== review.source_handover_id
      || source.source_work_order_id !== workOrderId || source.source_claim_id !== claimId
      || order.vehicle_entry_id && order.vehicle_entry_id !== source.source_entry_id) fail("CONFLICT");
  }
  if (order && order.customer_id !== entry.customer_id) fail("CONFLICT");
  const presence = getVehicleEntryPresence(entry);
  if (presence !== "in_workshop" && presence !== "with_customer") fail("CONFLICT");
  const revision = entry.intake_revision;
  if (!Number.isSafeInteger(revision) || revision < 1) fail("CONFLICT");
  const [signatures, frozen, receipts, portal, orderToken] = await Promise.all([
    supabase.from("vehicle_entry_signatures" as any).select("id,intake_revision,created_at").eq("tenant_id", actor.tenantId).eq("vehicle_entry_id", entryId).eq("signature_role", "delivered_by").order("created_at", { ascending: false }).limit(100),
    supabase.from("vehicle_entry_signed_revisions" as any).select("id,signature_id,revision").eq("tenant_id", actor.tenantId).eq("vehicle_entry_id", entryId).eq("revision", revision).maybeSingle(),
    supabase.from("vehicle_entry_custody_receipts" as any).select("id,signature_id,revision_id,status").eq("tenant_id", actor.tenantId).eq("vehicle_entry_id", entryId).eq("vehicle_id", entry.vehicle_id).order("issued_at", { ascending: false }).limit(100),
    getVehicleCustomerPortalContext(entryId),
    workOrderId ? supabase.from("customer_portal_tokens" as any).select("id,signed_at,revoked_at").eq("tenant_id", actor.tenantId).eq("job_order_id", workOrderId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [signatures, frozen, receipts, orderToken]) if (result.error) throw result.error;
  const current = ((signatures.data || []) as Row[]).filter(row => row.intake_revision === revision);
  if (current.length > 1) fail("CONFLICT");
  const legacy = entry.custody_receipt_required === false && revision === 1 ? ((signatures.data || []) as Row[]).find(row => row.intake_revision == null) : null;
  const signature = current[0] || legacy || null;
  const frozenRow = frozen.data as Row | null;
  const receipt = frozenRow && current[0] && frozenRow.signature_id === current[0].id
    ? ((receipts.data || []) as Row[]).find(row => row.revision_id === frozenRow.id && row.signature_id === current[0].id && ["issued", "used"].includes(row.status)) : null;
  const pendingReleases = (visit.releases || []).filter(row => ["draft", "awaiting_signature"].includes(row.status) && !row.returned_at);
  const signedReleases = (visit.releases || []).filter(row => row.status === "signed" && row.released_at && !row.returned_at);
  if (pendingReleases.length > 1 || signedReleases.length > 1) fail("CONFLICT");
  let signatureRelease: VehicleCustomerMessageContext["signatureRelease"] = null;
  if (pendingReleases[0]) {
    const saved = await getInspectionReleaseById(pendingReleases[0].id);
    if (saved.tenant_id !== actor.tenantId || saved.vehicle_entry_id !== entryId || saved.returned_at || !["draft", "awaiting_signature"].includes(saved.status)) fail("STALE");
    signatureRelease = { id: saved.id, status: saved.status, updatedAt: saved.updated_at || "", complete: inspectionReleaseMissingFields(saved.form_data).length === 0,
      recipientName: saved.form_data.recipient_name, recipientPhone: normalizePhone(saved.form_data.recipient_phone, prefs.defaultCountryCode) };
  }
  const handovers = (visit.handovers || []).filter(row => row.status === "finalized" && row.finalized_at && (isReview || row.work_order_id === workOrderId));
  const handover = handovers[0] || null;
  const vehicle = { ...entry.vehicle, ...entry.vehicle_snapshot };
  const approved = !!claim && ["approved", "paid"].includes(claim.status);
  const workflowApproved = !!visit.workflow && ["approved", "in_progress", "ready", "delivered"].includes(visit.workflow.stage);
  const orderAvailable = !!order && !["cancelled", "closed"].includes(order.status) && (claimId ? ["approved", "paid"].includes(claim?.status) : workflowApproved);
  const finalDeliveryApproved = !!handover && portal?.pending_handover_id === null;
  let legacyApprovalState: VehicleCustomerMessageContext["legacyApprovalState"] = "none";
  if (approved && workOrderId) {
    const legacy = await supabase.from("customer_notifications").select("id,status,channel,payload")
      .eq("tenant_id", actor.tenantId).eq("job_order_id", workOrderId).eq("event_type", "insurance_approved")
      .eq("channel", "whatsapp").order("created_at", { ascending: false }).limit(20);
    if (legacy.error) throw legacy.error;
    if (legacy.data?.some(row => row.status === "queued")) legacyApprovalState = "queued";
    else if (legacy.data?.some(row => row.status === "sent" && (row.payload as Row)?.wa_url)) legacyApprovalState = "draft_opened";
    else if (legacy.data?.some(row => row.status === "sent")) legacyApprovalState = "sent_unconfirmed";
  }
  const context: VehicleCustomerMessageContext = {
    tenantId: actor.tenantId, actorId: actor.actorId, entryId, entryNumber: String(entry.entry_number || ""), customerId: entry.customer_id,
    customerName: String(customer.name || ""), phone: normalizePhone(customer.phone, prefs.defaultCountryCode), vehicleId: entry.vehicle_id,
    vehicleMake: vehicle.brand || vehicle.make || undefined, vehicleModel: vehicle.model || undefined, vehicleYear: vehicle.year || undefined,
    stage: visit.stage, presence, isReview, intakeSigned: !!signature, intakeRevision: revision, intakeDocumentAvailable: !!receipt,
    signatureId: signature?.id || null, receiptId: receipt?.id || null,
    issued: !!entry.issued_at && ["Issued", "Converted to Claim", "Converted to Work Order"].includes(entry.status),
    draft: entry.status === "Draft", cancelled: entry.status === "Cancelled" || ["cancelled", "rejected"].includes(claim?.status) || visit.stage === "cancelled",
    claimId, workOrderId, approved, approvalEvent: claim ? String(claim.approved_at || claim.insurance_approved_at || "approved") : "", legacyApprovalState,
    workOrderSigned: !!(orderToken.data as Row | null)?.signed_at, orderAvailable: orderAvailable && !(orderToken.data as Row | null)?.revoked_at,
    workOrderStatus: order?.status || "", workOrderUpdatedAt: order?.updated_at || "",
    readyEvent: String(order?.work_completed_at || claim?.work_completed_at || visit.workflow?.changed_at || entry.updated_at || ""),
    repairEvent: String(order?.updated_at || visit.workflow?.changed_at || entry.updated_at || ""),
    handoverId: handover?.id || null, finalDeliveryApproved,
    signatureRelease, signedRelease: signedReleases[0] ? { id: signedReleases[0].id, releasedAt: signedReleases[0].released_at! } : null,
    portal: portal || null, updatedAt: String(entry.updated_at || ""), workflowRevision: visit.workflow?.revision ?? null,
  };
  const latestActor = await authority(actor.tenantId);
  if (JSON.stringify(actor) !== JSON.stringify(latestActor)) fail("STALE");
  return context;
}

export function vehicleCustomerMessageAvailability(context: VehicleCustomerMessageContext, kind: VehicleCustomerMessageKind): { available: boolean; reason: VehicleCustomerMessageBlocker | null } {
  let reason: VehicleCustomerMessageBlocker | null = context.draft ? "DRAFT" : context.cancelled ? "CANCELLED" : portalBlocker(context.portal);
  const recipient = kind === "temporary_release_signature" ? context.signatureRelease?.recipientPhone || "" : context.phone;
  reason ||= !validPhone(recipient) ? "PHONE" : null;
  if (!reason) {
    switch (kind) {
      case "intake_signature": case "review_signature":
        reason = (kind === "review_signature") !== context.isReview ? context.isReview ? "INITIAL_VISIT_REQUIRED" : "REVIEW_REQUIRED"
          : context.intakeSigned ? "ALREADY_SIGNED" : !context.issued || context.presence !== "in_workshop" || context.stage === "delivered" ? "ENTRY_REQUIRED" : null;
        break;
      case "intake_documents": case "review_documents":
        reason = (kind === "review_documents") !== context.isReview ? context.isReview ? "INITIAL_VISIT_REQUIRED" : "REVIEW_REQUIRED"
          : !context.intakeSigned || !context.intakeDocumentAvailable ? "DOCUMENT_REQUIRED" : null;
        break;
      case "approval": reason = !context.claimId || !context.approved ? "APPROVAL_REQUIRED" : context.isReview || ["delivered", "cancelled"].includes(context.stage) ? "ENTRY_REQUIRED" : context.legacyApprovalState !== "none" ? "LEGACY_APPROVAL" : null; break;
      case "order_signature": reason = !context.orderAvailable || !context.workOrderId || context.stage === "delivered" || context.workOrderStatus === "delivered" ? "ORDER_REQUIRED" : context.workOrderSigned ? "ORDER_ALREADY_SIGNED" : null; break;
      case "repair_update": reason = !context.workOrderId || context.stage !== "in_progress" || context.presence !== "in_workshop" ? "IN_PROGRESS_REQUIRED" : null; break;
      case "ready_for_pickup": reason = context.stage !== "ready" || context.presence !== "in_workshop" ? "READY_REQUIRED" : null; break;
      case "temporary_release_signature": reason = context.presence !== "in_workshop" || context.stage === "delivered" || context.signatureRelease?.status !== "awaiting_signature" || !context.signatureRelease.complete ? "RELEASE_SIGNATURE_REQUIRED" : null; break;
      case "temporary_release_documents": reason = context.presence !== "with_customer" || !context.signedRelease || context.stage === "delivered" ? "RELEASE_REQUIRED" : null; break;
      case "delivery_documents": reason = !context.handoverId || context.stage !== "delivered" || context.presence !== "with_customer" ? "DELIVERY_REQUIRED" : !context.finalDeliveryApproved ? "MANAGER_APPROVAL_REQUIRED" : null; break;
      case "follow_up": reason = !context.handoverId || context.stage !== "delivered" || context.presence !== "with_customer" ? "DELIVERY_REQUIRED" : !context.finalDeliveryApproved ? "MANAGER_APPROVAL_REQUIRED" : null; break;
    }
  }
  return { available: !reason, reason };
}

const BODIES: Record<"ar" | "en", Record<VehicleCustomerMessageKind, string>> = {
  ar: {
    portal: "يمكنكم مراجعة نماذج المركبة وتحديثات العمل والتسليم من البوابة الموحدة.",
    intake_signature: "يرجى مراجعة نموذج دخول المركبة وإدخال اسم مُسلّم المركبة ورقم بطاقته ثم التوقيع داخل البوابة. يصدر وصل الاستلام بعد حفظ التوقيع.",
    intake_documents: "نموذج دخول المركبة ووصل الاستلام الموقع متاحان للمراجعة والتنزيل داخل البوابة. لا يلزم توقيع جديد.",
    review_signature: "يرجى مراجعة نموذج زيارة المراجعة وقراءة العداد وحالة المركبة والملاحظات والأضرار المسجلة، ثم إدخال اسم مُسلّم المركبة ورقم بطاقته والتوقيع. تبقى النماذج والتواقيع السابقة محفوظة.",
    review_documents: "نموذج زيارة المراجعة ووصلها الموقع متاحان للمراجعة والتنزيل داخل قسم الدخول. تبقى النماذج والتواقيع السابقة محفوظة.",
    approval: "تمت موافقة التأمين. يمكنكم متابعة الخطوات التالية من البوابة. الموافقة وحدها لا تعني بدء الإصلاح أو اكتماله.",
    order_signature: "يرجى مراجعة تفاصيل أمر العمل المعتمد والتوقيع داخل البوابة.",
    repair_update: "أعمال المركبة قيد المتابعة. يمكنكم الاطلاع على تحديثات العمل والصور المتاحة داخل البوابة. هذه الرسالة ليست إشعار تسليم نهائي.",
    ready_for_pickup: "المركبة جاهزة لمرحلة التسليم. يرجى التواصل معنا لتنسيق موعد الاستلام وإحضار وصل الاستلام. لا تسجل هذه الرسالة تسليم المركبة.",
    temporary_release_signature: "يرجى مراجعة وتوقيع محضر المعاينة والخروج المؤقت داخل البوابة. طلب التوقيع لا يسجل خروج المركبة، وهذا ليس تسليم إصلاح نهائيًا.",
    temporary_release_documents: "محضر المعاينة والخروج المؤقت الموقع متاح للقراءة داخل البوابة. لا يُطلب توقيع جديد، وهذا ليس تسليم إصلاح نهائيًا.",
    delivery_documents: "محضر التسليم النهائي المعتمد وتأكيد التسليم متاحان للمراجعة داخل البوابة.",
    follow_up: "نشكركم على ثقتكم بعد استلام المركبة. يمكنكم مراجعة المستندات والتواصل معنا بشأن أي ملاحظات من البوابة.",
    custom: "نحن في خدمتكم لأي استفسار يتعلق بالمركبة. يمكنكم مراجعة المستندات والتحديثات من البوابة الموحدة.",
  },
  en: {
    portal: "Review your vehicle forms, work updates and delivery in the single customer portal.",
    intake_signature: "Please review the intake form, enter the actual vehicle deliverer's name and ID number, and sign inside the portal. The receipt is issued after the signature is saved.",
    intake_documents: "Your signed intake form and receipt are available to review and download inside the portal. No new signature is requested.",
    review_signature: "Please review the return-visit form, odometer, condition, notes and recorded damage, then enter the actual deliverer's name and ID number and sign. Previous forms and signatures stay preserved.",
    review_documents: "Your signed return-visit form and receipt are available to review and download in the intake section. Previous forms and signatures stay preserved.",
    approval: "Insurance approval is confirmed. Follow the next steps in the portal. Approval alone does not mean repairs have started or finished.",
    order_signature: "Please review the approved work order and sign inside the portal.",
    repair_update: "Work on your vehicle is being followed up. View available work updates and photos in the portal. This is not a final-delivery notice.",
    ready_for_pickup: "Your vehicle is ready for the delivery stage. Please contact us to arrange collection and bring your intake receipt. This message does not record vehicle delivery.",
    temporary_release_signature: "Please review and sign the inspection and temporary-release report inside the portal. Requesting a signature does not record vehicle exit and is not final repair handover.",
    temporary_release_documents: "Your signed inspection and temporary-release report is available as a read-only copy in the portal. No new signature is requested. This is not final repair handover.",
    delivery_documents: "Your approved final-delivery document and delivery confirmation are available to review inside the portal.",
    follow_up: "Thank you for your trust after collecting your vehicle. Review your documents and contact us about any observations through the portal.",
    custom: "We are available for questions about your vehicle. Review your documents and updates in the single customer portal.",
  },
};
function eventKey(context: VehicleCustomerMessageContext, kind: VehicleCustomerMessageKind) {
  switch (kind) {
    case "intake_signature": case "review_signature": return `revision-${context.intakeRevision}`;
    case "intake_documents": case "review_documents": return context.receiptId!;
    case "approval": return `${context.claimId}:${context.approvalEvent}`;
    case "order_signature": return `${context.workOrderId}:${context.workOrderUpdatedAt}`;
    case "repair_update": return context.repairEvent;
    case "ready_for_pickup": return context.readyEvent;
    case "temporary_release_signature": return `${context.signatureRelease?.id}:${context.signatureRelease?.updatedAt}`;
    case "temporary_release_documents": return context.signedRelease!.id;
    case "delivery_documents": case "follow_up": return context.handoverId!;
    case "custom": return `draft-${crypto.randomUUID()}`;
    default: return "invitation";
  }
}
function buildDraft(context: VehicleCustomerMessageContext, kind: VehicleCustomerMessageKind, language: "ar" | "en"): VehicleCustomerMessageDraft {
  const eligibility = vehicleCustomerMessageAvailability(context, kind);
  if (!eligibility.available) fail(eligibility.reason!);
  if (!context.portal?.token) fail("PORTAL_REQUIRED");
  const url = buildUnifiedVehiclePortalUrl(context.portal.token);
  const recipientName = kind === "temporary_release_signature" ? context.signatureRelease!.recipientName : context.customerName;
  const recipientPhone = kind === "temporary_release_signature" ? context.signatureRelease!.recipientPhone : context.phone;
  const invitation = buildCustomerPortalInvitation({ customerName: recipientName, vehicleMake: context.vehicleMake, vehicleModel: context.vehicleModel, vehicleYear: context.vehicleYear, url }, language);
  let body = `${invitation}\n\n${BODIES[language][kind]}`;
  if (kind === "approval" && context.presence === "with_customer") body += language === "en" ? " Please contact us to arrange bringing the vehicle to the workshop." : " يرجى التواصل معنا لتنسيق إحضار المركبة إلى الورشة.";
  // Approval is the same logical event as the existing supervisor workflow.
  // Reuse its exact claim-anchored key rather than creating a second pipeline.
  const idempotencyKey = kind === "approval" ? approvalKey(context) : `${vehicleCustomerMessagePrefix(context)}${kind}:${eventKey(context, kind)}`;
  if (idempotencyKey.length > 250) fail("IDENTITY");
  return { context, kind, language, body, url, idempotencyKey, fingerprint: vehicleCustomerMessageFingerprint(context), recipientPhone, recipientName };
}

/** The only optional write before Send is explicitly preparing a missing portal.
 * Existing paused/expired links are never enabled or rotated here. */
export async function prepareVehicleCustomerMessage(entryId: string, kind: VehicleCustomerMessageKind, language: "ar" | "en", expectedTenant: string): Promise<VehicleCustomerMessageDraft> {
  if (!CUSTOMER_MESSAGE_KINDS.includes(kind)) fail("IDENTITY");
  const context = await loadVehicleCustomerMessageContext(entryId, expectedTenant);
  const eligibility = vehicleCustomerMessageAvailability(context, kind);
  if (!eligibility.available) fail(eligibility.reason!);
  if (!context.portal) {
    const created = await ensureVehicleCustomerPortal(entryId);
    if (!created?.token) fail("PORTAL_REQUIRED");
    const fresh = await loadVehicleCustomerMessageContext(entryId, expectedTenant);
    if (vehicleCustomerMessageFingerprint({ ...fresh, portal: null }) !== vehicleCustomerMessageFingerprint(context)) fail("STALE");
    return buildDraft(fresh, kind, language);
  }
  return buildDraft(context, kind, language);
}

export async function verifyVehicleCustomerMessageDraft(draft: VehicleCustomerMessageDraft): Promise<VehicleCustomerMessageContext> {
  const context = await loadVehicleCustomerMessageContext(draft.context.entryId, draft.context.tenantId);
  if (vehicleCustomerMessageFingerprint(context) !== draft.fingerprint || !context.portal?.token
    || buildUnifiedVehiclePortalUrl(context.portal.token) !== draft.url) fail("STALE");
  const availability = vehicleCustomerMessageAvailability(context, draft.kind);
  if (!availability.available) fail(availability.reason!);
  const phone = draft.kind === "temporary_release_signature" ? context.signatureRelease!.recipientPhone : context.phone;
  const name = draft.kind === "temporary_release_signature" ? context.signatureRelease!.recipientName : context.customerName;
  if (draft.recipientPhone !== phone || draft.recipientName !== name) fail("STALE");
  return context;
}

export async function sendVehicleCustomerMessage(draft: VehicleCustomerMessageDraft, reviewedBody: string, isCurrent: () => boolean = () => true): Promise<SendUnifiedMessageResult> {
  if (!reviewedBody.trim() || reviewedBody.length > 4000) fail("BODY");
  const current = await verifyVehicleCustomerMessageDraft(draft);
  if (!isCurrent()) fail("STALE");
  // Preserve the prepared logical event across retries, edited text and language.
  return sendUnifiedMessage({ channel: "whatsapp", recipientPhone: draft.recipientPhone, body: reviewedBody.trim(),
    templateType: `vehicle_customer_${draft.kind}`, idempotencyKey: draft.idempotencyKey, customerId: current.customerId,
    vehicleId: current.vehicleId, workOrderId: current.workOrderId, claimId: current.claimId, shortLink: draft.url });
}

export async function listVehicleCustomerMessageLogs(context: VehicleCustomerMessageContext): Promise<VehicleCustomerMessageLog[]> {
  await authority(context.tenantId);
  let query = supabase.from("message_logs" as any)
    .select("id,status,template_type,body,message,recipient_phone,created_at,sent_at,delivered_at,read_at,error,failure_reason,provider_message_id,idempotency_key")
    .eq("tenant_id", context.tenantId).eq("customer_id", context.customerId).eq("vehicle_id", context.vehicleId).eq("channel", "whatsapp");
  query = context.claimId && !context.isReview ? query.or(`idempotency_key.like.${vehicleCustomerMessagePrefix(context)}%,idempotency_key.eq.${approvalKey(context)}`)
    : query.like("idempotency_key", `${vehicleCustomerMessagePrefix(context)}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data || []) as unknown as VehicleCustomerMessageLog[];
}
