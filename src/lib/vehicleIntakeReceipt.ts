import { supabase } from "@/integrations/supabase/client";
import { intakeReceiptError } from "@/lib/vehicleIntakeReceiptErrors";
import { buildVehicleEntryHtml } from "@/lib/vehicleEntryService";
import { escapeHtml as esc, safePdfImageSrc } from "@/lib/safeHtml";
import { resolveVehicleMediaUrls } from "@/lib/vehicleMediaUrls";
import { vehicleEntryArrivalTime } from "@/lib/vehicleEntryArrival";
import { vehicleRunningStatusLabel } from "@/lib/vehicleRunningStatus";
import { resolveVehicleIntakePresentation } from "@/lib/vehicleIntakePresentation";

export type IntakeReceiptAction = "Issue" | "Print" | "Verify" | "Deliver" | "Cancel" | "History" | "Legacy exception";
export type IntakeReceiptPermissions = Partial<Record<IntakeReceiptAction, boolean>>;
export interface IntakeReceiptSummary { id: string; receipt_number: string; status: "draft" | "issued" | "used" | "cancelled" | "replaced"; revision: number; issued_at: string; signer_name: string }
export interface IntakeReceiptContext { entry_id: string; revision: number; required: boolean; receipts: IntakeReceiptSummary[] }
export interface VerifiedIntakeReceipt { id: string; receipt_number: string; signer_name: string; entry_number: string; vehicle: Record<string, string>; status: string; signed_at: string }
export interface IntakeReceiptDocument { receipt: IntakeReceiptSummary & { verification_token: string; issued_by: string }; entry: Record<string, any>; revision: number; review_context?: import("@/lib/vehicleReviewVisit").ReviewVisitContext | null; delivery_confirmation?: { handover_id: string; handover_number: string; recipient_name: string; delivered_at: string; confirmed_at: string; delivered_by_name: string; signature_data_url?: string; review_notes?: string; paper_signature_confirmed?: boolean } | null }

export { intakeReceiptError } from "@/lib/vehicleIntakeReceiptErrors";
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name as any, args as any);
  if (error) throw intakeReceiptError(error);
  return data as T;
}
export const getIntakeReceiptPermissions = () => rpc<IntakeReceiptPermissions>("vehicle_intake_receipt_permissions");
export const getIntakeReceiptContext = (entryId: string) => rpc<IntakeReceiptContext>("vehicle_intake_receipt_context", { p_entry_id: entryId });
export const issueIntakeReceipt = (entryId: string) => rpc<IntakeReceiptSummary>("issue_vehicle_intake_receipt", { p_entry_id: entryId });
export async function getIntakeReceiptDocument(receiptId: string) {
  const document = await rpc<IntakeReceiptDocument>("vehicle_intake_receipt_document", { p_receipt_id: receiptId });
  document.entry = { ...document.entry, vehicle_media: await resolveVehicleMediaUrls(document.entry.vehicle_media || []) };
  return document;
}
export async function getSignedIntakeRevision(revisionId: string) {
  const entry = await rpc<Record<string, any>>("vehicle_entry_signed_revision_document", { p_revision_id: revisionId });
  return { ...entry, vehicle_media: await resolveVehicleMediaUrls(entry.vehicle_media || []) };
}
export const cancelIntakeReceipt = (receiptId: string, reason: string) => rpc<void>("cancel_vehicle_intake_receipt", { p_receipt_id: receiptId, p_reason: reason });
export const getIntakeReceiptHistory = (entryId: string) => rpc<Array<{ id: string; action: string; actor_id: string; occurred_at: string; details: Record<string, unknown> }>>("vehicle_intake_receipt_history", { p_entry_id: entryId });

export function intakeReceiptReference(raw: string, expectedEntryId?: string) {
  const text = raw.trim();
  if (!/^https?:\/\//i.test(text)) return text;
  const url = new URL(text);
  if (url.pathname !== "/vehicle-entry/receipt/verify" || (expectedEntryId && url.searchParams.get("entry") !== expectedEntryId)) throw intakeReceiptError({ message: "CUSTODY_WRONG_VISIT" });
  return url.searchParams.get("reference") || "";
}
export const verifyIntakeReceipt = (entryId: string, reference: string) => rpc<VerifiedIntakeReceipt>("verify_vehicle_intake_receipt", { p_entry_id: entryId, p_reference: intakeReceiptReference(reference, entryId) });
export function intakeReceiptVerifyUrl(entryId: string, token: string, origin = window.location.origin) {
  const url = new URL("/vehicle-entry/receipt/verify", origin);
  url.searchParams.set("entry", entryId); url.searchParams.set("reference", token);
  return url.toString();
}
export function receiptDateTime(value: unknown, language: "ar" | "en") {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(language === "ar" ? "ar-OM" : "en-GB", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** Same frozen entry/signature for receipt, preview, print and combined export. */
export async function buildIntakeReceiptHtml(document: IntakeReceiptDocument, language: "ar" | "en", combined = false) {
  const { default: QRCode } = await import("qrcode");
  const { receipt, entry, revision } = document;
  const intakePresentation = resolveVehicleIntakePresentation(entry, language);
  const qr = await QRCode.toDataURL(intakeReceiptVerifyUrl(String(entry.id), receipt.verification_token), { width: 240, margin: 1, errorCorrectionLevel: "M" });
  const text = (ar: string, en: string) => language === "en" ? en : ar;
  const signature = (entry.vehicle_entry_signatures || []).find((s: any) => s.id === (receipt as any).signature_id) || (entry.vehicle_entry_signatures || []).find((s: any) => s.signature_role === "delivered_by");
  const vehicle = entry.vehicle_snapshot || {}; const person = entry.delivered_by || {}; const settings = entry.custody_print_settings || {};
  const field = (label: string, value: unknown) => `<div class="vir-field"><span>${esc(label)}</span><strong style="white-space:pre-wrap">${esc(value === null || value === undefined || value === "" ? "—" : value)}</strong></div>`;
  const review = entry.vehicle_condition?.review_return;
  const reviewFields = review ? `<h3>${text("زيارة مراجعة بعد التسليم", "Review visit after delivery")}</h3><div class="vir-fields">${field(text("الدخول / التسليم السابق", "Previous entry / handover"), `${review.source_entry_number} / ${review.source_handover_number}`)}${field(text("المطالبة السابقة", "Previous claim"), document.review_context?.source_claim_number)}${field(text("أمر العمل السابق", "Previous work order"), document.review_context?.source_work_order_number)}${field(text("سبب الرجوع", "Reason for return"), review.reason)}${field(text("الحالة عند الرجوع", "Condition on return"), review.arrival_condition)}${field(text("ملاحظات المراجعة", "Review notes"), review.notes)}${field(text("أضرار جديدة واضحة", "Clear new visible damage"), review.new_damage === true ? text("نعم", "Yes") : review.new_damage === false ? text("لا", "No") : text("غير مسجل", "Not recorded"))}${field(text("تفاصيل الأضرار الجديدة", "New visible damage details"), review.new_damage_notes)}</div>` : "";
  const delivery = receipt.status === "used" ? document.delivery_confirmation : null;
  const deliverySection = delivery ? `<section class="vir-delivery"><h3>${text("تأكيد تسليم المركبة", "Vehicle delivery confirmation")}</h3><div class="vir-fields">${field(text("محضر التسليم", "Handover record"), delivery.handover_number)}${field(text("المستلم الفعلي", "Actual recipient"), delivery.recipient_name)}${field(text("وقت التسليم", "Delivered at"), receiptDateTime(delivery.delivered_at, language))}${field(text("وقت اعتماد المحضر", "Handover finalized at"), receiptDateTime(delivery.confirmed_at, language))}${field(text("الموظف المسلّم", "Delivering employee"), delivery.delivered_by_name)}${review ? field(text("نتيجة المراجعة", "Review findings"), delivery.review_notes) : ""}</div><div class="vir-sign">${delivery.signature_data_url ? `<div>${text("توقيع مستلم المركبة", "Vehicle recipient signature")}<br><img src="${safePdfImageSrc(delivery.signature_data_url)}" alt="Delivery signature"></div>` : `<p>${text("تم تأكيد التوقيع الورقي في المحضر النهائي", "Paper signature confirmed in the finalized handover")}</p>`}</div></section>` : "";
  const body = `<section class="vir-receipt${review ? " vir-review" : ""}" dir="${language === "ar" ? "rtl" : "ltr"}">
    <header>${settings.logoUrl ? `<img class="vir-logo" src="${safePdfImageSrc(settings.logoUrl)}" alt="Logo">` : ""}<div><h2>${esc(language === "en" ? settings.companyNameEn : settings.companyName)}</h2><h1>${text("وصل استلام مركبة", "Vehicle Intake Receipt")}</h1><b dir="ltr">${esc(receipt.receipt_number)}</b></div><img class="vir-qr" src="${safePdfImageSrc(qr)}" alt="QR"></header>
    <div class="vir-fields">
    ${field(text("رقم الدخول / الإصدار", "Entry / Revision"), `${entry.entry_number} / ${revision}`)}
    ${field(text("صدر باسم مُسلّم المركبة", "Issued to vehicle intake signer"), signature?.signer_name)}
    ${field(text("الهاتف", "Phone"), signature?.signer_phone || (person.full_name === signature?.signer_name ? person.phone : ""))}
    ${field(text("الهوية", "Identity number"), person.full_name === signature?.signer_name ? person.id_number : "")}
    ${field(text("الصفة", "Relationship"), signature?.signer_title || (person.full_name === signature?.signer_name ? person.relation : ""))}
    ${field(text("المركبة", "Vehicle"), [vehicle.make || vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" "))}
    ${field(text("اللوحة / الدولة", "Plate / Country"), [vehicle.plate_number, vehicle.plate_letters, vehicle.plate_country].filter(Boolean).join(" "))}
    ${field(text("رقم الشاصي", "VIN"), vehicle.vin || vehicle.vin_number)}
    ${field(text("قراءة العداد (كم)", "Odometer (km)"), intakePresentation.odometer)}
    ${field(text("موقع المركبة عند الدخول", "Vehicle location at intake"), intakePresentation.locationAtIntake)}
    ${field(text("حالة التشغيل", "Running condition"), vehicleRunningStatusLabel(entry.vehicle_condition?.running_status ?? review?.running_status, language))}
    ${field(text("تاريخ ووقت الدخول", "Arrival date and time"), `${entry.arrival_date} ${vehicleEntryArrivalTime(entry, language, "second")}`)}
    ${field(text("المطالبة", "Claim"), entry.claim?.claim_number || entry.insurance_snapshot?.claim_number)}
    ${field(text("أمر العمل", "Work order"), entry.work_order?.order_number)}
    ${field(text("الموظف المستلم", "Receiving employee"), entry.received_by_name)}
    ${field(text("وقت التوقيع — مسقط", "Signed at — Muscat"), receiptDateTime(signature?.signed_at, language))}
    ${field(text("وقت إصدار الوصل — مسقط", "Issued at — Muscat"), receiptDateTime(receipt.issued_at, language))}
    </div>${reviewFields}<div class="vir-sign"><div><b>${text("توقيع مُسلّم المركبة", "Vehicle intake signer signature")}</b><br><img src="${safePdfImageSrc(signature?.signature_data_url)}" alt="Signature"></div>${settings.stampUrl ? `<img src="${safePdfImageSrc(settings.stampUrl)}" alt="Company stamp">` : ""}</div>
    ${deliverySection}<p>${text("هذا الوصل مرتبط بمركبة واحدة وزيارة واحدة، ويُستخدم مرة واحدة عند التسليم. تعتمد صلاحيته الحالية على التحقق في النظام.", "This receipt is bound to one vehicle and one visit and is used once at delivery. Verify its current validity in the system.")}</p>
    <small>${text("رمز التحقق مخصص للموظف المخوّل ولا يعرض بيانات العميل للعامة.", "Verification requires authorized staff access. Customer details are not public.")}</small>
    </section>`;
  const css = `<style>.vir-receipt{font:14px/1.5 Arial,Tahoma,sans-serif;color:#10243a;background:white;width:190mm;margin:0 auto;padding:5mm;border:1px solid #a8b3bf;break-inside:avoid}.vir-receipt header{display:flex;align-items:center;justify-content:space-between;gap:4mm;border-bottom:2px solid #10243a;padding-bottom:3mm}.vir-receipt h1{font-size:22px;margin:1mm 0}.vir-receipt h2{font-size:15px;margin:0}.vir-logo,.vir-qr{width:25mm;height:25mm;object-fit:contain}.vir-fields{display:grid;grid-template-columns:1fr 1fr;gap:2mm 5mm;padding:4mm 0}.vir-field{border-bottom:1px solid #d4dce5;padding:1mm;overflow-wrap:anywhere}.vir-field span{display:block;color:#526176;font-size:11px}.vir-field strong{display:block;font-weight:600}.vir-sign{display:flex;align-items:center;justify-content:space-around;text-align:center}.vir-sign img{height:20mm;max-width:65mm;object-fit:contain}html.pdf-export .vir-sign img{height:20mm!important;width:auto!important;max-width:65mm!important;object-fit:contain}html.pdf-export .vir-qr,html.pdf-export .vir-logo{width:25mm!important;height:25mm!important;object-fit:contain}.vir-receipt p{font-size:12px}.vir-receipt small{font-size:10px}.vir-review{font-size:12px;line-height:1.3}.vir-review .vir-fields{gap:1mm 4mm;padding:2mm 0}.vir-review .vir-field{padding:.5mm}.vir-review h3{font-size:13px;margin:2mm 0}.vir-review .vir-sign>div{min-width:70mm}.vir-review .vir-sign img,html.pdf-export .vir-review .vir-sign img{height:15mm!important;max-width:60mm!important}.vir-combined .page{min-height:0!important}.vir-combined .vir-receipt{margin-top:3mm;font-size:12px}.vir-combined .vir-receipt h1{font-size:17px}@page{size:A4 portrait;margin:7mm}body{margin:0;background:white}</style>`;
  if (!combined) return `<!doctype html><html lang="${language}" dir="${language === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(receipt.receipt_number)}</title>${css}<style>.page{width:210mm;min-height:297mm;padding:10mm;margin:0 auto;box-sizing:border-box}.vir-receipt{width:100%}</style></head><body><main class="page">${body}</main></body></html>`;
  // The existing intake form is a full A4 sheet (photos, condition diagram and
  // declarations). Preserve its legibility; the receipt is page two of one PDF.
  // Both must be inside .page because the canonical renderer captures pages.
  return buildVehicleEntryHtml(entry, language).replace("</head>", `${css}</head>`).replace("<body>", '<body class="vir-combined">').replace("</body>", `<main class="page">${body}</main></body>`);
}
