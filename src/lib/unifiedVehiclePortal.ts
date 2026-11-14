import { supabase } from "@/integrations/supabase/client";
import type { IntakeReceiptDocument } from "@/lib/vehicleIntakeReceipt";
import { extractPlateDigits, extractPlateLetters } from "@/lib/plateUtils";
import { buildCustomerPortalInvitation } from "@/lib/customerPortalInvitation";
import { loadUnifiedVehiclePortalMedia } from "@/lib/vehicleSignatureMedia";
import type { InspectionReleaseForm } from "@/lib/vehicleInspectionRelease";

export interface VehiclePortalRelease {
  id: string; release_number: string; status: string; declaration_ar?: string; declaration_en?: string;
  released_at?: string; signer_name?: string; signed_at?: string; signature_data_url?: string;
  recipient_name?: string; digest?: string; form_data?: Partial<InspectionReleaseForm>;
}
export interface VehiclePortalEntry {
  id: string; entry_number: string; revision: number; arrival_date: string; arrival_time: string;
  running_status?: "running" | "not_running" | "unknown"; mileage?: number | null;
  condition?: string; notes?: string; new_damage?: boolean | null; new_damage_notes?: string; review_reason?: string;
  declaration_ar?: string; declaration_en?: string;
  signed: boolean; signer_name?: string; signed_at?: string; signature_data_url?: string;
  legacy_signature?: boolean; has_frozen_document?: boolean;
  receipt_number?: string; review_source_entry_id?: string | null; releases?: VehiclePortalRelease[];
}
export interface VehiclePortalTracking {
  stage_key: string; progress_pct: number; updated_at?: string | null;
  photos?: Array<{ url: string; caption?: string | null; phase?: string | null }>;
  feedback?: { rating: number; comment?: string | null; created_at?: string | null } | null;
  messages?: Array<{ message: string; created_at?: string | null }>;
}
export interface VehiclePortalData {
  vehicle: { make?: string; model?: string; year?: number | string; plate_number?: string; plate_letters?: string };
  customer: { name?: string }; entries: VehiclePortalEntry[];
  order?: { enabled: boolean; id?: string; digest?: string; order_number?: string; status?: string; work_summary?: string; diagnosis?: string; work_items?: Array<{ title: string; note?: string }>; signed?: boolean; legacy_signature?: boolean; signer_name?: string; signed_at?: string; declaration_ar?: string; declaration_en?: string; signature_data_url?: string; tracking?: VehiclePortalTracking } | null;
  delivery?: { enabled: boolean; receipt_number?: string; delivered_at?: string; recipient_name?: string; signature_data_url?: string; work_summary?: string } | null;
}
export interface StaffVehiclePortalContext {
  token: string; enabled: boolean; expires_at: string | null; vehicle_make?: string; vehicle_model?: string;
  vehicle_year?: number | string | null; customer_name?: string; pending_handover_id?: string | null;
}
export class VehiclePortalError extends Error {
  constructor(public code: "unavailable" | "expired" | "disabled" | "credentials" | "session" | "changed" | "failed") { super(code); }
}
function portalError(error: unknown) {
  const message = typeof error === "string" ? error : String((error as { message?: string })?.message || "");
  const code = /expired/i.test(message) ? "expired" : /disabled|revoked|paused/i.test(message) ? "disabled"
    : /order_changed|release_changed|revision_changed|stale/i.test(message) ? "changed" : /plate|credential|attempt|rate.limit|locked/i.test(message) ? "credentials" : /session|unlock|unauthorized|portal_access_required/i.test(message) ? "session"
      : /portal_not_found|portal_invalid|invalid.token|portal_unavailable/i.test(message) ? "unavailable" : "failed";
  return new VehiclePortalError(code);
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as any, args as any);
  if (error) throw portalError(error);
  if (data && typeof data === "object" && "error" in data) throw portalError(String((data as { error: unknown }).error));
  return data as T;
}
export function buildUnifiedVehiclePortalUrl(token: string, origin = window.location.origin) {
  return new URL(`/customer/vehicle/${encodeURIComponent(token)}`, origin).toString();
}
export async function unlockVehiclePortal(token: string, digits: string, letters: string) {
  const result = await rpc<{ session: string; expires_at: string | null }>("customer_vehicle_portal_unlock", {
    p_token: token, p_plate_digits: extractPlateDigits(digits), p_plate_letters: extractPlateLetters(letters),
  });
  if (!result?.session) throw new VehiclePortalError("credentials");
  return result;
}
export async function readVehiclePortal(token: string, session: string) {
  const data = await rpc<VehiclePortalData>("customer_vehicle_portal_read", { p_token: token, p_session: session });
  if (!data?.vehicle || !data.customer || !Array.isArray(data.entries)) throw new VehiclePortalError("unavailable");
  return data;
}
export async function signVehiclePortalEntry(token: string, session: string, entry: VehiclePortalEntry, name: string, signature: string, consent: boolean) {
  if (entry.legacy_signature) throw new VehiclePortalError("failed");
  const result = await rpc<{ signed: boolean }>("customer_vehicle_portal_sign", { p_token: token, p_session: session, p_entry_id: entry.id, p_revision: entry.revision, p_name: name.trim(), p_signature: signature, p_consent: consent });
  if (!result?.signed) throw new VehiclePortalError("failed");
}
export async function signVehiclePortalOrder(token: string, session: string, order: NonNullable<VehiclePortalData["order"]>, name: string, signature: string, consent: boolean) {
  if (!order.enabled || !order.id || !order.digest) throw new VehiclePortalError("failed");
  const result = await rpc<{ signed: boolean }>("customer_vehicle_portal_sign_order", { p_token: token, p_session: session, p_order_id: order.id, p_order_digest: order.digest, p_name: name.trim(), p_signature: signature, p_consent: consent });
  if (!result?.signed) throw new VehiclePortalError("failed");
}
export async function signVehiclePortalRelease(token: string, session: string, release: VehiclePortalRelease, name: string, signature: string, consent: boolean) {
  if (!release.id || !release.digest || release.status !== "awaiting_signature") throw new VehiclePortalError("failed");
  const result = await rpc<{ signed: boolean }>("customer_vehicle_portal_sign_release", { p_token: token, p_session: session, p_release_id: release.id, p_release_digest: release.digest, p_name: name.trim(), p_signature: signature, p_consent: consent });
  if (!result?.signed) throw new VehiclePortalError("failed");
}
export async function submitVehiclePortalFeedback(token: string, session: string, orderId: string, rating: number, comment: string) {
  if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5) throw new VehiclePortalError("failed");
  const result = await rpc<{ ok: boolean }>("customer_vehicle_portal_feedback", { p_token: token, p_session: session, p_order_id: orderId, p_rating: rating, p_comment: comment.trim() || null });
  if (!result?.ok) throw new VehiclePortalError("failed");
}
export async function submitVehiclePortalNote(token: string, session: string, orderId: string, note: string) {
  if (!orderId || note.trim().length < 2 || note.trim().length > 2000) throw new VehiclePortalError("failed");
  const result = await rpc<{ ok: boolean }>("customer_vehicle_portal_note", { p_token: token, p_session: session, p_order_id: orderId, p_note: note.trim() });
  if (!result?.ok) throw new VehiclePortalError("failed");
}
export interface VehiclePortalMedia { id: string; url: string; category?: string; file_name?: string; caption?: string }
export async function readVehiclePortalMedia(token: string, session: string, entryId: string, revision?: number): Promise<VehiclePortalMedia[]> {
  const response = await loadUnifiedVehiclePortalMedia(token, session, entryId, revision);
  if (response.data?.error) throw portalError(response.data.error);
  if (response.error) {
    let detail: unknown = response.error;
    const context = (response.error as { context?: Response }).context;
    if (context && typeof context.clone === "function") {
      try { detail = (await context.clone().json()).error || detail; } catch { /* The original safe error is used if no JSON body is available. */ }
    }
    throw portalError(detail);
  }
  const media = response.data?.media;
  if (Number(response.data?.unavailable_count) !== 0 || revision != null && response.data?.revision !== revision || !Array.isArray(media) || media.some((item) => !item || typeof item.url !== "string" || !/^https:\/\//i.test(item.url))) throw new VehiclePortalError("failed");
  return media;
}
export async function readVehiclePortalDocument(token: string, session: string, entryId: string) {
  const document = await rpc<IntakeReceiptDocument>("customer_vehicle_portal_document", { p_token: token, p_session: session, p_entry_id: entryId });
  if (!document?.entry || !document.receipt || !Number.isInteger(document.revision)) throw new VehiclePortalError("failed");
  // Resolve exactly the signed document's image revision, never a newer mutable intake.
  const media = await readVehiclePortalMedia(token, session, entryId, document.revision);
  const images = await Promise.all(media.map(async (item) => {
    // Signed Storage URLs are deliberately short-lived. Embed only authorized image bytes
    // in this in-memory document so a later PDF export matches its preview exactly.
    const response = await fetch(item.url, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new VehiclePortalError("failed");
    const blob = await response.blob();
    if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(blob.type) || blob.size === 0) throw new VehiclePortalError("failed");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { ...item, url: `data:${blob.type};base64,${btoa(binary)}`, media_type: "image" };
  }));
  return { ...document, entry: { ...document.entry, vehicle_media: images } };
}
export const getVehicleCustomerPortalContext = (entryId: string) => rpc<StaffVehiclePortalContext | null>("vehicle_customer_portal_context", { p_entry_id: entryId });
export const ensureVehicleCustomerPortal = (entryId: string) => rpc<StaffVehiclePortalContext>("ensure_vehicle_customer_portal", { p_entry_id: entryId });
export const setVehicleCustomerPortalEnabled = (entryId: string, enabled: boolean) => rpc<StaffVehiclePortalContext>("set_vehicle_customer_portal_enabled", { p_entry_id: entryId, p_enabled: enabled });
export const approveVehicleCustomerPortalDelivery = (entryId: string) => rpc<StaffVehiclePortalContext>("approve_vehicle_customer_portal_delivery", { p_entry_id: entryId });

/** Deliberate allowlist: never include the plate password, VIN, claim/order IDs or work items. */
export function buildVehiclePortalWhatsAppMessage(context: Pick<StaffVehiclePortalContext, "customer_name" | "vehicle_make" | "vehicle_model" | "vehicle_year">, url: string, language: "ar" | "en") {
  return buildCustomerPortalInvitation({ customerName: context.customer_name, vehicleMake: context.vehicle_make, vehicleModel: context.vehicle_model, vehicleYear: context.vehicle_year, url }, language);
}
