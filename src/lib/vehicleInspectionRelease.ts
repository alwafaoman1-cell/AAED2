import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { getTemplateSettings } from "@/lib/pdfGenerator";
import { generatePdfFromHtml, DEFAULT_MARGINS } from "@/lib/htmlToPdf";
import { buildTechnicalDeclarationConditionSummary } from "@/lib/vehicleTechnicalDeclaration";
import {inspectionReleaseDisplayValue} from './inspectionReleaseOptions';

export interface InspectionReleaseForm {
  inspection_summary: string;
  inspected_items: string;
  uninspected_items: string;
  visible_damage: string;
  pending_action: string;
  exit_condition: string;
  contents_handed_over: string;
  keys_handed_over: string;
  recipient_name: string;
  recipient_id_number: string;
  recipient_phone: string;
  recipient_relation: string;
  staff_name: string;
  notes: string;
}

export interface InspectionReleaseRecord {
  id: string;
  tenant_id: string;
  vehicle_entry_id: string;
  claim_id: string | null;
  work_order_id: string | null;
  release_number: string;
  status: "draft" | "awaiting_signature" | "signed";
  entry_snapshot: Record<string, any>;
  form_data: InspectionReleaseForm;
  photo_media_ids: string[];
  declaration_ar: string;
  declaration_en: string;
  signature_data_url: string | null;
  signer_name: string | null;
  signed_at: string | null;
  released_at: string | null;
  returned_at: string | null;
  updated_at?: string;
}

export const emptyInspectionReleaseForm: InspectionReleaseForm = {
  inspection_summary: "",
  inspected_items: "",
  uninspected_items: "",
  visible_damage: "",
  pending_action: "",
  exit_condition: "",
  contents_handed_over: "",
  keys_handed_over: "",
  recipient_name: "",
  recipient_id_number: "",
  recipient_phone: "",
  recipient_relation: "",
  staff_name: "",
  notes: "",
};

export function inspectionReleaseInitialForm(entry: any, language: "ar" | "en" = "ar"): InspectionReleaseForm {
  // A registry owner may not be the visitor for this visit. Use the saved
  // intake snapshot first and never reassign the vehicle/customer registry.
  const customer = { ...entry?.customer, ...entry?.customer_snapshot };
  const contents = entry?.vehicle_contents || {};
  const condition = entry?.vehicle_condition || {};
  const declaration = entry?.vehicle_technical_declaration;
  const inspected = buildTechnicalDeclarationConditionSummary(declaration, language)
    .map((section) => `${section.title}: ${section.items.map((item) => `${item.label}: ${item.value}`).join("; ")}`).join("\n");
  return {
    ...emptyInspectionReleaseForm,
    // Reuse confirmed findings only. Pending action and actual exit condition
    // remain reviewable; blank/unticked observations are not negative findings.
    inspected_items: inspected,
    inspection_summary: String(declaration?.id ? declaration.form_data?.other_observations || "" : ""),
    visible_damage: String(condition.visible_damage || ""),
    exit_condition: String(condition.condition_description || ""),
    contents_handed_over: String(contents.notes || ""),
    keys_handed_over: String(contents.keys_count ?? ""),
    recipient_name: String(customer.name || ""),
    recipient_id_number: String(customer.id_number || ""),
    recipient_phone: String(customer.phone || ""),
    // Today's visitor is not necessarily the registered owner or the person
    // collecting the vehicle. The operator confirms this at actual release.
    recipient_relation: "",
    staff_name: String(entry?.received_by_name || ""),
  };
}

export function inspectionReleaseMissingFields(form: InspectionReleaseForm): string[] {
  return (["inspection_summary", "pending_action", "exit_condition", "recipient_name", "recipient_id_number", "recipient_phone"] as const)
    .filter((key) => !form[key]?.trim());
}

export async function getInspectionRelease(entryId: string): Promise<InspectionReleaseRecord | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const { data, error } = await supabase
    .from("vehicle_inspection_releases" as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", entryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as InspectionReleaseRecord) || null;
}

export async function listInspectionReleases(entryId: string): Promise<InspectionReleaseRecord[]> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const { data, error } = await supabase
    .from("vehicle_inspection_releases" as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", entryId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as unknown as InspectionReleaseRecord[]) || [];
}

export async function markInspectionVehicleReturned(releaseId: string): Promise<InspectionReleaseRecord> {
  const before=await getInspectionReleaseById(releaseId);
  const { data, error } = await supabase.rpc("mark_vehicle_inspection_return" as any, {
    p_release_id: releaseId,
  } as any);
  if (error) throw error;
  if (!data || typeof data !== "object" || !(data as any).returned_at) throw new Error("لم يتم تأكيد عودة المركبة في السحابة");
  const verified=await getInspectionReleaseById(releaseId);
  if(verified.tenant_id!==before.tenant_id||!verified.returned_at||verified.returned_at!==(data as any).returned_at)throw new Error('INSPECTION_RELEASE_RETURN_UNCONFIRMED');
  return verified;
}

export async function getInspectionReleaseById(releaseId:string):Promise<InspectionReleaseRecord>{
  const tenantId=await getCurrentTenantId();
  if(!tenantId)throw new Error('INSPECTION_RELEASE_TENANT_REQUIRED');
  const {data,error}=await supabase.from('vehicle_inspection_releases' as any).select('*').eq('tenant_id',tenantId).eq('id',releaseId).single();
  if(error)throw error;
  const record=data as unknown as InspectionReleaseRecord|null;
  if(!record||record.id!==releaseId||record.tenant_id!==tenantId||await getCurrentTenantId()!==tenantId)throw new Error('INSPECTION_RELEASE_READ_UNCONFIRMED');
  return record;
}

export function inspectionReleaseSignatureMethod(record:InspectionReleaseRecord|null|undefined):'paper'|'electronic'{
  return record?.entry_snapshot?.release_acknowledgement?.method==='paper'?'paper':'electronic';
}

export async function finalizeInspectionReleasePaper(releaseId:string,expectedUpdatedAt:string,releasedAt:string,paperConfirmed:boolean):Promise<InspectionReleaseRecord>{
  if(!paperConfirmed||!expectedUpdatedAt||!Number.isFinite(Date.parse(releasedAt)))throw new Error('INSPECTION_RELEASE_PAPER_EVIDENCE_REQUIRED');
  const before=await getInspectionReleaseById(releaseId);
  const {data,error}=await supabase.rpc('finalize_vehicle_inspection_release_paper' as any,{
    p_release_id:releaseId,p_expected_updated_at:expectedUpdatedAt,p_released_at:releasedAt,p_paper_confirmed:true,
  } as any);
  if(error)throw error;
  if(!(data as any)?.id||(data as any).id!==releaseId)throw new Error('INSPECTION_RELEASE_EXIT_UNCONFIRMED');
  const saved=await getInspectionReleaseById(releaseId);
  if(saved.tenant_id!==before.tenant_id||saved.vehicle_entry_id!==before.vehicle_entry_id||saved.status!=='signed'||saved.returned_at
    ||saved.signature_data_url||inspectionReleaseSignatureMethod(saved)!=='paper'||saved.entry_snapshot?.release_acknowledgement?.confirmed!==true
    ||Date.parse(saved.released_at||'')!==Date.parse(releasedAt))throw new Error('INSPECTION_RELEASE_EXIT_UNCONFIRMED');
  return saved;
}

export function normalizeInspectionReleaseForm(form:InspectionReleaseForm):InspectionReleaseForm{
  return Object.fromEntries(Object.keys(emptyInspectionReleaseForm).map(key=>{
    const limit=key==='notes'?1500:['pending_action','exit_condition','contents_handed_over'].includes(key)?1000:key==='keys_handed_over'?100:['recipient_id_number','recipient_phone','recipient_relation'].includes(key)?80:['recipient_name','staff_name'].includes(key)?160:2000;
    return [key,String(form[key as keyof InspectionReleaseForm]??'').trim().slice(0,limit)];
  })) as unknown as InspectionReleaseForm;
}

export async function saveInspectionRelease(entryId: string, form: InspectionReleaseForm): Promise<InspectionReleaseRecord> {
  const tenantId=await getCurrentTenantId();
  if(!tenantId)throw new Error('INSPECTION_RELEASE_TENANT_REQUIRED');
  const expected=normalizeInspectionReleaseForm(form);
  const { data, error } = await supabase.rpc("save_vehicle_inspection_release" as any, {
    p_vehicle_entry_id: entryId,
    p_form: expected,
  } as any);
  if (error) throw error;
  if (!data || typeof data !== "object" || !(data as any).id) throw new Error("لم يتم تأكيد حفظ محضر المعاينة في السحابة");
  const saved=data as unknown as InspectionReleaseRecord;
  if(saved.tenant_id!==tenantId||saved.vehicle_entry_id!==entryId||saved.status!=='draft')throw new Error('INSPECTION_RELEASE_SAVE_UNCONFIRMED');
  const verified=await getInspectionReleaseById(saved.id);
  if(verified.tenant_id!==tenantId||verified.vehicle_entry_id!==entryId||verified.status!=='draft'
    ||Object.keys(expected).some(key=>verified.form_data?.[key as keyof InspectionReleaseForm]!==expected[key as keyof InspectionReleaseForm]))throw new Error('INSPECTION_RELEASE_SAVE_UNCONFIRMED');
  return verified;
}

export async function createInspectionReleaseLink(releaseId: string): Promise<{ url: string; expires_at: string }> {
  const before=await getInspectionReleaseById(releaseId);
  const { data, error } = await supabase.rpc("create_vehicle_inspection_release_link" as any, {
    p_release_id: releaseId,
    p_expires_hours: 168,
  } as any);
  if (error) throw error;
  const response = data as any;
  if (!/^[a-f0-9]{64}$/.test(response?.token||'')||response.release_id!==releaseId||!response.expires_at||!(new Date(response.expires_at).getTime()>Date.now())) throw new Error("تعذر إنشاء رابط التوقيع");
  const verified=await getInspectionReleaseById(releaseId);
  if(verified.tenant_id!==before.tenant_id||verified.vehicle_entry_id!==before.vehicle_entry_id||verified.status!=='awaiting_signature')throw new Error('INSPECTION_RELEASE_LINK_UNCONFIRMED');
  const {data:publicRecord,error:publicError}=await supabase.rpc('get_vehicle_inspection_release_for_signature' as any,{p_token:response.token} as any);
  if(publicError)throw publicError;
  if(!(publicRecord as any)|| (publicRecord as any).error ||(publicRecord as any).release_number!==verified.release_number||(publicRecord as any).signed!==false)throw new Error('INSPECTION_RELEASE_LINK_UNCONFIRMED');
  return {
    url: `${window.location.origin}/vehicle-entry/inspection-release/sign/${encodeURIComponent(response.token)}`,
    expires_at: response.expires_at,
  };
}

/** Issue a customer read capability for a completed release, never a new
 * signature request. The server keeps the signed report unchanged. */
export async function createInspectionReleaseViewLink(releaseId: string): Promise<{ url: string; expires_at: string }> {
  const {data,error}=await supabase.rpc("create_vehicle_inspection_release_view_link",{p_release_id:releaseId,p_expires_hours:168});
  if(error) throw error;
  const response=data as any;
  if(response?.view_only!==true || response.release_id!==releaseId || !/^[a-f0-9]{64}$/.test(response.token || "") || !response.expires_at) throw new Error("INSPECTION_RELEASE_VIEW_LINK_UNCONFIRMED");
  return {url:`${window.location.origin}/vehicle-entry/inspection-release/sign/${encodeURIComponent(response.token)}`,expires_at:response.expires_at};
}

export async function reopenInspectionRelease(releaseId: string): Promise<InspectionReleaseRecord> {
  const before=await getInspectionReleaseById(releaseId);
  const { data, error } = await supabase.rpc("reopen_vehicle_inspection_release" as any, {
    p_release_id: releaseId,
  } as any);
  if (error) throw error;
  if (!data || typeof data !== "object" || !(data as any).id) throw new Error("لم يتم تأكيد إلغاء رابط التوقيع");
  const verified=await getInspectionReleaseById(releaseId);
  if(verified.tenant_id!==before.tenant_id||verified.vehicle_entry_id!==before.vehicle_entry_id||verified.status!=='draft')throw new Error('INSPECTION_RELEASE_REOPEN_UNCONFIRMED');
  return verified;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

function text(value: unknown): string {
  return escapeHtml(value || "—").replace(/\n/g, "<br/>");
}

function row(label: string, value: unknown) {
  return `<div class="field"><small>${escapeHtml(label)}</small><strong>${text(value)}</strong></div>`;
}

function formatOmanDateTime(value: string | null | undefined, language: "ar" | "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-OM", {
    timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(date);
}

export function buildInspectionReleaseHtml(
  release: InspectionReleaseRecord,
  photos: Array<{ id: string; url?: string; public_url?: string; file_name?: string; category?: string }> = [],
  language: "ar" | "en" = "ar",
): string {
  const en = language === "en";
  const settings = getTemplateSettings();
  const snapshot = release.entry_snapshot || {};
  const customer = snapshot.customer || {};
  const vehicle = snapshot.vehicle || {};
  const insurance = snapshot.insurance || {};
  const condition = snapshot.condition || {};
  const contents = snapshot.contents || {};
  const form = Object.fromEntries(Object.entries(release.form_data || emptyInspectionReleaseForm).map(([key,value])=>[key,inspectionReleaseDisplayValue(key as keyof InspectionReleaseForm,String(value||''),language)])) as unknown as InspectionReleaseForm;
  const marks = Array.isArray(snapshot.damage_marks) ? snapshot.damage_marks : [];
  const selected = photos.filter((photo) => release.photo_media_ids?.includes(photo.id) && (photo.url || photo.public_url));
  const plate = [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ");
  const heading = en ? "VEHICLE INSPECTION & TEMPORARY RELEASE" : "محضر معاينة وفحص وتسليم مؤقت للمركبة";
  const field = (ar: string, english: string, value: unknown) => row(en ? english : ar, value);
  const section = (ar: string, english: string) => `<h2>${en ? english : ar}</h2>`;
  const paperSigned=release.status==='signed'&&inspectionReleaseSignatureMethod(release)==='paper';
  const status = release.status === "signed"
    ? (paperSigned?(en?'Paper signature acknowledged — temporary exit recorded':'توقيع ورقي معتمد — خروج مؤقت مسجل'):(en ? "Signed — Temporary release" : "موقّع — خروج مؤقت"))
    : (en ? "Draft / Not signed" : "مسودة / غير موقّع");
  const logo = settings.logoUrl ? `<img class="logo" src="${escapeHtml(settings.logoUrl)}" alt="" />` : "";
  const photoHtml = selected.map((photo) => `<figure><img src="${escapeHtml(photo.url || photo.public_url)}" alt="" /><figcaption>${escapeHtml(photo.category || photo.file_name || "")}</figcaption></figure>`).join("");
  const markRows = marks.map((mark: any) => `<tr><td>${text(mark.mark_number)}</td><td>${text(mark.vehicle_part)}</td><td>${text(mark.damage_type)}</td><td>${text(mark.description || mark.notes)}</td></tr>`).join("");
  const signature = paperSigned?`<p>${en?'Signature on the retained paper original':'التوقيع على الأصل الورقي المحفوظ'}</p>`:release.status === "signed" && release.signature_data_url?.startsWith("data:image/png;base64,")
    ? `<img class="signature" src="${escapeHtml(release.signature_data_url)}" alt="" />` : "";
  const company = en ? settings.companyNameEn : settings.companyName;
  return `<!doctype html><html lang="${language}" dir="${en ? "ltr" : "rtl"}"><head><meta charset="utf-8" />
    <title>${escapeHtml(release.release_number)}</title><style>
    @page { size:A4; margin:10mm; } * { box-sizing:border-box; }
    body { margin:0; background:#fff; color:#14213d; font-family:Arial,Tahoma,sans-serif; font-size:10.5px; line-height:1.45; }
    .page { width:190mm; min-height:275mm; margin:0 auto; padding:2mm 1mm; page-break-after:always; }
    .page:last-child { page-break-after:auto; } header { display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:2px solid #173460; padding-bottom:8px; }
    .brand { display:flex; align-items:center; gap:10px; } .logo { width:42px; height:42px; object-fit:contain; }
    .brand strong { font-size:13px; } .brand small { display:block; color:#596579; }
    h1 { font-size:17px; text-align:center; margin:10px 0 2px; color:#173460; }
    h2 { font-size:11px; background:#173460; color:#fff; margin:9px 0 5px; padding:4px 7px; }
    .meta { text-align:center; margin:0 0 7px; color:#4d5b73; }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
    .field { min-height:37px; padding:5px 7px; border:1px solid #d8dce4; overflow-wrap:anywhere; }
    .field small { display:block; color:#64748b; font-size:8.5px; } .field strong { font-size:10.5px; font-weight:700; }
    .note { border:1px solid #d8dce4; padding:6px 8px; min-height:32px; white-space:normal; overflow-wrap:anywhere; }
    .declaration { border:1px solid #aab8c9; padding:8px; background:#f5f7fa; }
    .bottom { display:flex; justify-content:space-between; gap:12px; margin-top:8px; }
    .signbox { border:1px solid #d8dce4; padding:6px; width:50%; min-height:82px; }
    .signature { width:150px; height:55px; object-fit:contain; }
    table { width:100%; border-collapse:collapse; } th,td { border:1px solid #d8dce4; padding:4px; text-align:start; } th { background:#edf2f7; }
    .photos { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; } figure { margin:0; border:1px solid #d8dce4; padding:3px; }
    figure img { display:block; width:100%; height:100px; object-fit:contain; } figcaption { text-align:center; font-size:8px; }
    footer { border-top:1px solid #cbd5e1; margin-top:8px; padding-top:4px; color:#64748b; font-size:8px; }
    .watermark { position:fixed; top:43%; left:10%; transform:rotate(-25deg); color:#d93636; opacity:.15; font-size:50px; font-weight:900; pointer-events:none; }
    </style></head><body>
    ${release.status !== "signed" ? `<div class="watermark">${en ? "UNSIGNED" : "غير موقّع"}</div>` : ""}
    <main class="page"><header><div class="brand">${logo}<div><strong>${escapeHtml(company)}</strong><small>${escapeHtml(settings.commercialReg)} · ${escapeHtml(settings.phone)}</small></div></div><div>${escapeHtml(release.release_number)}<br/><small>${escapeHtml(status)}</small></div></header>
    <h1>${heading}</h1><p class="meta">${en ? "Related entry" : "مرتبط بالدخول"}: ${escapeHtml(snapshot.entry_number || "—")} · ${en ? "Released" : "الخروج المؤقت"}: ${escapeHtml(formatOmanDateTime(release.released_at, language))}</p>
    ${section("المركبة والعميل", "Vehicle & Customer")}
    <div class="grid">${field("اسم العميل", "Customer", customer.name)}${field("رقم اللوحة", "Plate", plate)}${field("المركبة", "Vehicle", [vehicle.make || vehicle.brand,vehicle.model,vehicle.year].filter(Boolean).join(" "))}${field("رقم الهيكل", "VIN", vehicle.vin || vehicle.vin_number)}${field("رقم المطالبة", "Claim No.", insurance.claim_number)}${field("تاريخ الدخول", "Entry date", snapshot.arrival_date)}</div>
    ${section("نتيجة المعاينة", "Inspection findings")}
    <div class="grid">${field("ملخص الفحص", "Inspection summary", form.inspection_summary)}${field("ما تم فحصه", "Inspected", form.inspected_items)}${field("ما لم يُفحص", "Not inspected", form.uninspected_items)}${field("الأضرار الظاهرة", "Visible damage", form.visible_damage || condition.visible_damage)}${field("الإجراء المنتظر", "Pending action", form.pending_action)}${field("حالة المركبة عند الخروج", "Condition at exit", form.exit_condition)}</div>
    ${section("المحتويات والمستلم", "Contents & Recipient")}
    <div class="grid">${field("المفاتيح المسلّمة", "Keys handed over", form.keys_handed_over || contents.keys_count)}${field("المحتويات المسلّمة", "Contents handed over", form.contents_handed_over || contents.notes)}${field("اسم المستلم", "Recipient", form.recipient_name)}${field("رقم الهوية", "ID No.", form.recipient_id_number)}${field("الهاتف", "Phone", form.recipient_phone)}${field("صفته", "Relationship", form.recipient_relation)}</div>
    ${section("الإقرار", "Acknowledgement")}<div class="declaration">${text(en ? release.declaration_en : release.declaration_ar)}</div>
    ${form.notes ? `${section("ملاحظات", "Notes")}<div class="note">${text(form.notes)}</div>` : ""}
    <div class="bottom"><div class="signbox"><strong>${en ? "Recipient signature" : "توقيع المستلم"}</strong><br/>${signature}<br/>${escapeHtml(release.signer_name || form.recipient_name || "—")}<br/><small>${escapeHtml(formatOmanDateTime(release.signed_at, language))}</small></div><div class="signbox"><strong>${en ? "Workshop representative" : "ممثل الورشة"}</strong><br/><br/>${escapeHtml(form.staff_name || "—")}</div></div>
    <footer>${en ? "Inspection and temporary release only — not final delivery or an invoice." : "معاينة وخروج مؤقت فقط — ليس تسليمًا نهائيًا أو فاتورة."}</footer></main>
    ${(marks.length || selected.length) ? `<section class="page"><header><strong>${escapeHtml(company)}</strong><span>${escapeHtml(release.release_number)}</span></header><h1>${en ? "Inspection evidence" : "ملحق المعاينة والصور"}</h1>
    ${marks.length ? `${section("الأضرار المسجلة عند الدخول", "Damage recorded at entry")}<table><thead><tr><th>#</th><th>${en ? "Part" : "الجزء"}</th><th>${en ? "Type" : "النوع"}</th><th>${en ? "Description" : "الوصف"}</th></tr></thead><tbody>${markRows}</tbody></table>` : ""}
    ${selected.length ? `${section("صور الدخول المرتبطة", "Linked entry photos")}<div class="photos">${photoHtml}</div>` : ""}
    <footer>${en ? "Existing entry photos are referenced, not copied." : "الصور مرتبطة بسجل الدخول الأصلي، ولا تُخزن نسخة مكررة."}</footer></section>` : ""}
    </body></html>`;
}

export async function downloadInspectionReleasePdf(html: string, number: string): Promise<void> {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, ADD_TAGS: ["style", "meta"] });
  await generatePdfFromHtml({
    htmlContent: clean,
    fileName: number,
    download: true,
    margins: DEFAULT_MARGINS,
  });
}
