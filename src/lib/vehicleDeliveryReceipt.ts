import type { VehicleDeliveryReceiptData } from "@/lib/pdfGenerator";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export type VehicleHandoverRecipientType =
  | "customer"
  | "owner"
  | "representative"
  | "driver"
  | "tow_truck"
  | "insurance_representative";

export type VehicleHandoverStatus = "draft" | "finalized" | "cancelled";

export interface VehicleDeliveryReceiptDraft {
  recordId?: string | null;
  receiptNumber?: string | null;
  status?: VehicleHandoverStatus | null;
  date?: string | null;
  deliveredAt?: string | null;
  receiverType?: VehicleHandoverRecipientType | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverIdNumber?: string | null;
  receiverRelationship?: string | null;
  customerIdNumber?: string | null;
  mileageOut?: string | null;
  vehicleCondition?: string | null;
  workshopRepresentative?: string | null;
  workSummary?: string | null;
  partsReplaced?: string | null;
  warrantyNotes?: string | null;
  satisfactionNotes?: string | null;
  declarationAr?: string | null;
  declarationEn?: string | null;
  deliveryPhotoUrls?: string[] | null;
  signatureDataUrl?: string | null;
  idPhotoDataUrl?: string | null;
  finalizedAt?: string | null;
  cancellationReason?: string | null;
}

const DELIVERY_RECEIPT_METADATA_KEY = "vehicle_delivery_receipt";

interface DeliveryReceiptWorkOrderRef {
  id: string;
  orderNumber?: string | null;
}

type DeliveryReceiptWorkOrderRow = {
  id: string;
  tenant_id: string;
  claim_id: string | null;
  vehicle_id: string;
  customer_id: string | null;
  vehicle_entry_id: string | null;
  visit_number: number | null;
  metadata: unknown;
};

export const DEFAULT_HANDOVER_DECLARATION_AR =
  "أقر أنا المستلم بأنني عاينت المركبة عند خروجها من الورشة واستلمتها بالحالة الموضحة، واستلمت المفاتيح والمستندات والمحتويات المبينة، وتم شرح الأعمال المنفذة وشروط الضمان لي.";

export const DEFAULT_HANDOVER_DECLARATION_EN =
  "I acknowledge that I inspected and received the vehicle from the workshop in the condition stated, together with the listed keys, documents and contents, and that the completed work and warranty terms were explained to me.";

function isMissingHandoverTable(error: unknown): boolean {
  const text = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return text.includes("vehicle_handover_records") && (
    text.includes("schema cache") || text.includes("could not find") || text.includes("does not exist") || text.includes("pgrst")
  );
}

function rowToDraft(row: any): VehicleDeliveryReceiptDraft {
  return {
    recordId: row.id,
    receiptNumber: row.receipt_number,
    status: row.status,
    date: getDeliveredDateInputValue(row.delivered_at),
    deliveredAt: row.delivered_at,
    receiverType: row.recipient_type,
    receiverName: row.recipient_name,
    receiverPhone: row.recipient_phone,
    receiverIdNumber: row.recipient_id_number,
    receiverRelationship: row.recipient_relationship,
    mileageOut: row.mileage_out,
    vehicleCondition: row.vehicle_condition,
    workshopRepresentative: row.workshop_representative,
    workSummary: row.work_summary,
    partsReplaced: row.parts_replaced,
    warrantyNotes: row.warranty_notes,
    satisfactionNotes: row.satisfaction_notes,
    declarationAr: row.declaration_ar,
    declarationEn: row.declaration_en,
    deliveryPhotoUrls: Array.isArray(row.delivery_photo_paths) ? row.delivery_photo_paths : [],
    signatureDataUrl: row.signature_data_url,
    idPhotoDataUrl: row.receiver_id_photo_url,
    finalizedAt: row.finalized_at,
    cancellationReason: row.cancellation_reason,
  };
}

async function findDeliveryReceiptWorkOrder(ref: DeliveryReceiptWorkOrderRef) {
  const select = () => supabase
    .from("job_orders")
    .select("id, tenant_id, claim_id, vehicle_id, customer_id, vehicle_entry_id, visit_number, metadata")
    .is("deleted_at", null)
    .limit(1);

  if (isUuid(ref.id)) {
    const byId = await select().eq("id", ref.id).maybeSingle();
    if (byId.error) throw byId.error;
    if (byId.data) return byId.data;
  }

  const orderNumber = String(ref.orderNumber || ref.id || "").trim();
  if (!orderNumber) return null;
  const byNumber = await select().eq("order_number", orderNumber).maybeSingle();
  if (byNumber.error) throw byNumber.error;
  return byNumber.data as DeliveryReceiptWorkOrderRow | null;
}

export async function loadVehicleDeliveryReceiptDraft(
  ref: DeliveryReceiptWorkOrderRef,
): Promise<VehicleDeliveryReceiptDraft | null> {
  const row = await findDeliveryReceiptWorkOrder(ref);
  if (!row) return null;
  const handover = await supabase
    .from("vehicle_handover_records" as any)
    .select("*")
    .eq("tenant_id", row.tenant_id)
    .eq("work_order_id", row.id)
    .in("status", ["draft", "finalized"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!handover.error && handover.data) return rowToDraft(handover.data);
  if (handover.error && !isMissingHandoverTable(handover.error)) throw handover.error;

  // Compatibility read only: old deployments stored the draft in job_orders.metadata.
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  const saved = metadata[DELIVERY_RECEIPT_METADATA_KEY];
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  return saved as VehicleDeliveryReceiptDraft;
}

export async function listVehicleHandoverHistory(
  ref: DeliveryReceiptWorkOrderRef,
): Promise<VehicleDeliveryReceiptDraft[]> {
  const row = await findDeliveryReceiptWorkOrder(ref);
  if (!row) return [];
  const result = await supabase
    .from("vehicle_handover_records" as any)
    .select("*")
    .eq("tenant_id", row.tenant_id)
    .eq("work_order_id", row.id)
    .in("status", ["finalized", "cancelled"])
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissingHandoverTable(result.error)) return [];
    throw result.error;
  }
  return ((result.data || []) as any[]).map(rowToDraft);
}

export async function saveVehicleDeliveryReceiptDraft(
  ref: DeliveryReceiptWorkOrderRef,
  draft: VehicleDeliveryReceiptDraft,
): Promise<VehicleDeliveryReceiptDraft> {
  const row = await findDeliveryReceiptWorkOrder(ref);
  if (!row) throw new Error("أمر العمل غير موجود في Supabase");

  const { data: authData } = await supabase.auth.getUser();
  const deliveredAt = draft.deliveredAt || `${getDeliveredDateInputValue(draft.date)}T12:00:00+04:00`;
  const payload = {
    tenant_id: row.tenant_id,
    work_order_id: row.id,
    claim_id: row.claim_id,
    vehicle_id: row.vehicle_id,
    customer_id: row.customer_id,
    vehicle_entry_id: row.vehicle_entry_id,
    visit_number: row.visit_number,
    delivered_at: deliveredAt,
    mileage_out: draft.mileageOut || null,
    vehicle_condition: draft.vehicleCondition || null,
    recipient_type: draft.receiverType || "customer",
    recipient_name: draft.receiverName?.trim() || "",
    recipient_phone: draft.receiverPhone?.trim() || null,
    recipient_id_number: draft.receiverIdNumber?.trim() || null,
    recipient_relationship: draft.receiverRelationship?.trim() || null,
    workshop_representative: draft.workshopRepresentative?.trim() || null,
    work_summary: draft.workSummary || null,
    parts_replaced: draft.partsReplaced || null,
    warranty_notes: draft.warrantyNotes || null,
    satisfaction_notes: draft.satisfactionNotes || null,
    declaration_ar: draft.declarationAr || DEFAULT_HANDOVER_DECLARATION_AR,
    declaration_en: draft.declarationEn || DEFAULT_HANDOVER_DECLARATION_EN,
    delivery_photo_paths: draft.deliveryPhotoUrls || [],
    signature_data_url: draft.signatureDataUrl || null,
    receiver_id_photo_url: draft.idPhotoDataUrl || null,
    snapshot_json: draft as any,
    updated_by: authData.user?.id || null,
  };

  const existingDraftRow = draft.recordId ? null : await supabase
    .from("vehicle_handover_records" as any)
    .select("id")
    .eq("tenant_id", row.tenant_id)
    .eq("work_order_id", row.id)
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();
  const existingId = draft.recordId || (existingDraftRow?.data as any)?.id;

  const handover = existingId
    ? await supabase.from("vehicle_handover_records" as any).update(payload).eq("id", existingId).eq("status", "draft").select("*").single()
    : await supabase.from("vehicle_handover_records" as any).insert({ ...payload, created_by: authData.user?.id || null }).select("*").single();
  if (!handover.error && handover.data) return rowToDraft(handover.data);
  if (handover.error && !isMissingHandoverTable(handover.error)) throw handover.error;

  // Compatibility fallback until the SSOT migration reaches the target environment.
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  const saved = {
    ...draft,
    savedAt: new Date().toISOString(),
    savedBy: authData.user?.id || null,
  };
  const { error } = await supabase
    .from("job_orders")
    .update({
      metadata: {
        ...metadata,
        [DELIVERY_RECEIPT_METADATA_KEY]: saved,
      } as never,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw error;
  return saved;
}

export async function finalizeVehicleDeliveryReceipt(
  ref: DeliveryReceiptWorkOrderRef,
  draft: VehicleDeliveryReceiptDraft,
): Promise<VehicleDeliveryReceiptDraft> {
  const saved = await saveVehicleDeliveryReceiptDraft(ref, draft);
  if (!saved.recordId) {
    throw new Error("يلزم تطبيق ترحيل سجل خروج وتسليم المركبة قبل اعتماد التسليم النهائي");
  }
  const { data, error } = await supabase.rpc("finalize_vehicle_handover" as any, { p_record_id: saved.recordId } as any);
  if (error) throw error;
  return rowToDraft(data);
}

export async function cancelLatestFinalizedVehicleHandover(params: {
  workOrderId?: string | null;
  claimId?: string | null;
  reason: string;
}): Promise<VehicleDeliveryReceiptDraft | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  let query = supabase
    .from("vehicle_handover_records" as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "finalized")
    .order("finalized_at", { ascending: false })
    .limit(1);
  if (params.workOrderId) query = query.eq("work_order_id", params.workOrderId);
  else if (params.claimId) query = query.eq("claim_id", params.claimId);
  else return null;
  const found = await query.maybeSingle();
  if (found.error) {
    if (isMissingHandoverTable(found.error)) return null;
    throw found.error;
  }
  if (!found.data) return null;
  const { data, error } = await supabase.rpc("cancel_vehicle_handover" as any, {
    p_record_id: (found.data as any).id,
    p_reason: params.reason,
  } as any);
  if (error) throw error;
  return rowToDraft(data);
}

export function formatDeliveryReceiptNumber(orderDisplay?: string): string {
  const source = String(orderDisplay || "").trim();
  const woMatch = source.match(/(?:WO|W)-\d{2,4}-(\d{1,6})$/i);
  const trailingMatch = source.match(/(?:^|[-/])(\d{1,6})$/);
  const raw = woMatch?.[1] || trailingMatch?.[1] || "";
  const sequence = raw ? Number(raw) : 1;
  return `DR-${String(Number.isFinite(sequence) && sequence > 0 ? sequence : 1).padStart(5, "0")}`;
}

export function getDefaultDeliveryWarrantyNotes(): string {
  return "ضمان لمدة 7 أيام أو 500 كم على الأعمال المنفذة فقط — لا يشمل الأعطال غير المرتبطة بالإصلاح.";
}

export function getDeliveredDateInputValue(value?: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10) || new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export function buildDeliveryReceiptData(order: WorkOrder, draft: VehicleDeliveryReceiptDraft = {}): VehicleDeliveryReceiptData {
  const orderDisplay = order.displayNumber || order.id;
  return {
    receiptNumber: draft.receiptNumber || formatDeliveryReceiptNumber(orderDisplay),
    date: getDeliveredDateInputValue(draft.date),
    workOrderNumber: orderDisplay,
    customerName: order.customer || "—",
    customerPhone: order.phone || undefined,
    customerIdNumber: draft.customerIdNumber || undefined,
    recipientType: draft.receiverType || "customer",
    receiverName: draft.receiverName || undefined,
    receiverPhone: draft.receiverPhone || undefined,
    receiverIdNumber: draft.receiverIdNumber || undefined,
    receiverRelationship: draft.receiverRelationship || undefined,
    vehicleType: order.vehicleType || "—",
    model: order.model || undefined,
    year: order.year || undefined,
    plateNumber: order.plate || "—",
    vin: order.vin || undefined,
    color: order.color || undefined,
    mileageOut: draft.mileageOut || order.mileage || undefined,
    vehicleCondition: draft.vehicleCondition || undefined,
    workshopRepresentative: draft.workshopRepresentative || undefined,
    workSummary: draft.workSummary || order.diagnosis || order.description || undefined,
    partsReplaced: draft.partsReplaced || buildPartsReplacedText(order),
    warrantyNotes: draft.warrantyNotes || getDefaultDeliveryWarrantyNotes(),
    satisfactionNotes: draft.satisfactionNotes || undefined,
    declarationAr: draft.declarationAr || DEFAULT_HANDOVER_DECLARATION_AR,
    declarationEn: draft.declarationEn || DEFAULT_HANDOVER_DECLARATION_EN,
    deliveryPhotoUrls: draft.deliveryPhotoUrls || undefined,
    signatureDataUrl: draft.signatureDataUrl || undefined,
    idPhotoDataUrl: draft.idPhotoDataUrl || undefined,
  };
}

export function buildPartsReplacedText(order: WorkOrder): string | undefined {
  const lines = (order.partsNeeded || [])
    .filter((part) => part.fulfilled !== false)
    .map((part) => `• ${part.name}${part.quantity > 1 ? ` ×${part.quantity}` : ""}`);
  return lines.length ? lines.join("\n") : undefined;
}
