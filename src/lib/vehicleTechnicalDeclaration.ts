export type TechnicalChoice = "" | "yes" | "no";
export type TechnicalOilChoice = "" | "ok" | "no";
export type TechnicalChassisChoice = "" | "ok" | "deformed";
export type TechnicalSignerRole = "" | "technician" | "report_author";

export const TECHNICAL_GARAGE_NAME = "المركز التخصصي لصيانة السيارات";

export interface VehicleTechnicalDeclarationForm {
  claim_number: string;
  registration_number: string;
  make_model: string;
  non_gcc_vehicle: TechnicalChoice;
  towing: TechnicalChoice;
  cranking: TechnicalChoice;
  engine_oil_level: TechnicalOilChoice;
  radiator_coolant: TechnicalChoice;
  engine_other_remarks: string;
  gear_body_crack: TechnicalChoice;
  gear_oil_leak: TechnicalChoice;
  gear_other_remarks: string;
  previous_improper_repairs: TechnicalChoice;
  previous_improper_details: string;
  airbag_warning: TechnicalChoice;
  engine_warning: TechnicalChoice;
  atm_warning: TechnicalChoice;
  warning_other: string;
  chassis_status: TechnicalChassisChoice;
  chassis_damage_lh: boolean;
  chassis_damage_rh: boolean;
  chassis_replace_lh: boolean;
  chassis_replace_rh: boolean;
  chassis_notes: string;
  floor_deformation: TechnicalChoice;
  body_deformation: TechnicalChoice;
  body_floor_details: string;
  accessories_modification: TechnicalChoice;
  ppe: TechnicalChoice;
  accessories_details: string;
  other_observations: string;
  garage_name: string;
  authorized_person: string;
  signer_role: TechnicalSignerRole;
  signature_data_url: string;
  date: string;
}

export interface VehicleTechnicalDeclarationRecord {
  id: string;
  tenant_id: string;
  vehicle_entry_id: string;
  form_data: VehicleTechnicalDeclarationForm;
  revision: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export const emptyVehicleTechnicalDeclaration: VehicleTechnicalDeclarationForm = {
  claim_number: "", registration_number: "", make_model: "",
  non_gcc_vehicle: "", towing: "", cranking: "", engine_oil_level: "",
  radiator_coolant: "", engine_other_remarks: "", gear_body_crack: "",
  gear_oil_leak: "", gear_other_remarks: "", previous_improper_repairs: "",
  previous_improper_details: "", airbag_warning: "", engine_warning: "",
  atm_warning: "", warning_other: "", chassis_status: "",
  chassis_damage_lh: false, chassis_damage_rh: false,
  chassis_replace_lh: false, chassis_replace_rh: false, chassis_notes: "",
  floor_deformation: "", body_deformation: "", body_floor_details: "",
  accessories_modification: "", ppe: "", accessories_details: "",
  other_observations: "", garage_name: TECHNICAL_GARAGE_NAME,
  authorized_person: "", signer_role: "", signature_data_url: "", date: "",
};

const choiceKeys = [
  "non_gcc_vehicle", "towing", "cranking", "radiator_coolant", "gear_body_crack",
  "gear_oil_leak", "previous_improper_repairs", "airbag_warning", "engine_warning",
  "atm_warning", "floor_deformation", "body_deformation", "accessories_modification", "ppe",
] as const;
const booleanKeys = ["chassis_damage_lh", "chassis_damage_rh", "chassis_replace_lh", "chassis_replace_rh"] as const;
const longTextKeys = ["previous_improper_details", "other_observations"] as const;
const fieldLengths: Partial<Record<keyof VehicleTechnicalDeclarationForm, number>> = {
  claim_number: 32, registration_number: 24, make_model: 38,
  engine_other_remarks: 24, gear_other_remarks: 24, warning_other: 24,
  previous_improper_details: 110, chassis_notes: 38, body_floor_details: 38,
  accessories_details: 80, other_observations: 240,
  garage_name: 55, authorized_person: 70, signature_data_url: 9000, date: 10,
};

export function technicalFieldMaxLength(key: keyof VehicleTechnicalDeclarationForm): number {
  return fieldLengths[key] ?? 120;
}

export function normalizeTechnicalDeclarationForm(value: Partial<VehicleTechnicalDeclarationForm> | null | undefined): VehicleTechnicalDeclarationForm {
  const result = { ...emptyVehicleTechnicalDeclaration };
  if (!value) return result;
  for (const key of Object.keys(result) as Array<keyof VehicleTechnicalDeclarationForm>) {
    const raw = value[key];
    if (typeof result[key] === "boolean") (result as Record<string, unknown>)[key] = raw === true;
    else (result as Record<string, unknown>)[key] = typeof raw === "string" ? raw : "";
  }
  // Previously saved forms may have an empty or outdated workshop name; normalize the view only.
  result.garage_name = TECHNICAL_GARAGE_NAME;
  return result;
}

export function initialTechnicalDeclarationForm(entry: any, reportAuthorName = ""): VehicleTechnicalDeclarationForm {
  const vehicle = entry?.vehicle || entry?.vehicle_snapshot || {};
  const snapshot = entry?.vehicle_snapshot || {};
  const insurance = entry?.insurance_snapshot || {};
  const plate = [
    vehicle.plate_letters || snapshot.plate_letters,
    vehicle.plate_number || snapshot.plate_number,
  ].filter(Boolean).join(" ");
  return {
    ...emptyVehicleTechnicalDeclaration,
    claim_number: String(entry?.claim?.claim_number || entry?.converted_claim?.claim_number || insurance.claim_number || ""),
    registration_number: plate,
    make_model: [vehicle.brand || vehicle.make || snapshot.brand || snapshot.make, vehicle.model || snapshot.model].filter(Boolean).join(" "),
    authorized_person: reportAuthorName,
    signer_role: reportAuthorName ? "report_author" : "",
  };
}

export function validateTechnicalDeclarationForm(form: VehicleTechnicalDeclarationForm): void {
  for (const key of choiceKeys) {
    if (!["", "yes", "no"].includes(form[key])) throw new Error(`Invalid choice: ${key}`);
  }
  if (!["", "ok", "no"].includes(form.engine_oil_level)) throw new Error("Invalid engine oil level");
  if (!["", "ok", "deformed"].includes(form.chassis_status)) throw new Error("Invalid chassis status");
  if (!["", "technician", "report_author"].includes(form.signer_role)) throw new Error("Invalid signer role");
  if (form.garage_name !== TECHNICAL_GARAGE_NAME) throw new Error("Invalid workshop name");
  if (form.signature_data_url && !/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(form.signature_data_url)) {
    throw new Error("Invalid signature image");
  }
  if (form.signature_data_url && (!form.authorized_person.trim() || !form.signer_role)) {
    throw new Error("أدخل اسم الموقّع وصفته قبل حفظ توقيعه.");
  }
  for (const key of booleanKeys) {
    if (typeof form[key] !== "boolean") throw new Error(`Invalid checkbox: ${key}`);
  }
  for (const key of Object.keys(form) as Array<keyof VehicleTechnicalDeclarationForm>) {
    if (typeof form[key] !== "string") continue;
    const max = technicalFieldMaxLength(key);
    if (String(form[key]).length > max) throw new Error(`Field too long: ${key}`);
  }
  for (const key of longTextKeys) {
    const lines = form[key].split(/\r?\n/);
    const maxLine = key === "previous_improper_details" ? 36 : 95;
    if (lines.length > 3 || lines.some((part) => part.length > maxLine)) {
      throw new Error(`Maximum three print lines, ${maxLine} characters each: ${key}`);
    }
  }
  if (form.date && !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) throw new Error("Invalid date");
  if (new TextEncoder().encode(JSON.stringify(form)).length > 15000) {
    throw new Error("النموذج أكبر من الحد المسموح للحفظ؛ اختصر النص أو أعد التوقيع.");
  }
}

export async function getVehicleTechnicalDeclaration(entryId: string): Promise<VehicleTechnicalDeclarationRecord | null> {
  const [{ supabase }, { getCurrentTenantId }] = await Promise.all([
    import("@/integrations/supabase/client"), import("@/lib/cloud/createCloudStore"),
  ]);
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const { data, error } = await supabase.from("vehicle_technical_declarations" as any)
    .select("id,tenant_id,vehicle_entry_id,form_data,revision,created_at,updated_at,updated_by")
    .eq("tenant_id", tenantId).eq("vehicle_entry_id", entryId).maybeSingle();
  if (error) throw error;
  return data ? { ...(data as unknown as VehicleTechnicalDeclarationRecord), form_data: normalizeTechnicalDeclarationForm((data as any).form_data) } : null;
}

export async function saveVehicleTechnicalDeclaration(
  entryId: string,
  form: VehicleTechnicalDeclarationForm,
  expectedRevision: number | null,
): Promise<VehicleTechnicalDeclarationRecord> {
  validateTechnicalDeclarationForm(form);
  const [{ supabase }, { getCurrentTenantId }] = await Promise.all([
    import("@/integrations/supabase/client"), import("@/lib/cloud/createCloudStore"),
  ]);
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");

  if (expectedRevision === null) {
    const { error } = await supabase.from("vehicle_technical_declarations" as any)
      .insert({ tenant_id: tenantId, vehicle_entry_id: entryId, form_data: form } as any);
    if (error) {
      if (error.code === "23505") throw new Error("النموذج موجود بالفعل. أعد تحميل الصفحة قبل التعديل.");
      throw error;
    }
  } else {
    const { data, error } = await supabase.from("vehicle_technical_declarations" as any)
      .update({ form_data: form } as any)
      .eq("tenant_id", tenantId).eq("vehicle_entry_id", entryId).eq("revision", expectedRevision)
      .select("id,revision").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("تغيّر النموذج في جلسة أخرى أو لم تُحفظ البيانات. أعد تحميل الصفحة قبل التعديل.");
  }

  const confirmed = await getVehicleTechnicalDeclaration(entryId);
  if (!confirmed || confirmed.revision !== (expectedRevision === null ? 1 : expectedRevision + 1)
    || JSON.stringify(confirmed.form_data) !== JSON.stringify(normalizeTechnicalDeclarationForm(form))) {
    throw new Error("لم يتأكد حفظ النموذج في السحابة. أعد فتحه وتحقق قبل المتابعة.");
  }
  return confirmed;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

function line(value: unknown, className = ""): string {
  return `<span class="write-line ${className}">${escapeHtml(value) || "&nbsp;"}</span>`;
}

function marked(selected: boolean): string {
  return selected ? '[<span class="tick">✓</span>]' : "[ ]";
}
function yesNo(value: TechnicalChoice): string {
  return `Yes ${marked(value === "yes")} / No ${marked(value === "no")}`;
}
function bulletLines(value: string, count: number): string {
  const lines = value.split(/\r?\n/);
  return Array.from({ length: count }, (_, index) => `<div class="bullet">• ${line(lines[index] || "", "bullet-line")}</div>`).join("");
}

/** The source sheet is English-only, A4 portrait, with its wording preserved verbatim. */
export function buildVehicleTechnicalDeclarationHtml(form: VehicleTechnicalDeclarationForm): string {
  validateTechnicalDeclarationForm(form);
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8" />
  <title>VEHICLE TECHNICAL DECLARATION</title><style>
  @page{size:A4 portrait;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#111}
  body{font-family:"Times New Roman",Times,serif;font-size:11pt;line-height:1.16}
  .page{width:210mm;height:297mm;margin:0 auto;padding:14mm 10mm 20mm;background:#fff;overflow:hidden}
  h1{font:bold 12pt Arial,sans-serif;text-align:center;margin:0 0 3mm;letter-spacing:.1px}
  .rule{border-top:1px solid #777;margin:4mm 0 6mm}
  .top{display:grid;grid-template-columns:1fr 1fr;column-gap:4mm;line-height:1.25;white-space:nowrap}
  .top .write-line{display:inline-block;width:55mm;vertical-align:baseline}
  .top .short{min-width:25mm}
  .top .right-line{width:40mm}
  .write-line{display:inline-block;border-bottom:1px solid #777;min-height:4.2mm;vertical-align:baseline;white-space:pre-wrap;overflow-wrap:anywhere}
  .vehicle-data{color:#b42318;font-weight:bold}
  .tick{color:#14532d;font-family:Arial,sans-serif;font-weight:900}
  .garage-name{font-family:Arial,"Noto Naskh Arabic",sans-serif;direction:rtl;text-align:right;font-weight:bold}
  .signer-role{display:block;margin-top:1mm;font:8pt Arial,sans-serif;color:#555}
  .top-rule{margin:8mm 0 5mm}
  .grid{display:grid;grid-template-columns:1.15fr .85fr;column-gap:10mm;row-gap:5mm}
  .section{min-width:0;break-inside:avoid}
  .heading{font-weight:bold;margin:0 0 1mm}
  .row{margin:0;white-space:nowrap}
  .row .write-line{width:35mm}
  .bullet{min-height:5mm;white-space:normal}
  .bullet-line{width:61mm}
  .wide{grid-column:1/-1}
  .wide .write-line{width:113mm}
  .remarks{margin-top:1mm}
  .remarks .bullet-line{width:163mm}
  .signature-rule{margin:22mm 0 6mm}
  .footer-row{display:grid;grid-template-columns:62mm 8mm 1fr;align-items:end;margin-bottom:8mm}
  .footer-row .write-line{width:58mm}
  .sign-row{display:flex;gap:4mm;align-items:end;margin-top:18mm}
  .signature-box{display:inline-flex;align-items:end;justify-content:center;width:55mm;height:14mm;border-bottom:1px solid #777}
  .signature-box img{display:block;max-width:55mm;max-height:13mm;object-fit:contain}
  .sign-row .date-line{width:55mm}
  .date-label{margin-left:8mm}
  @media screen{body{background:#e9e9e9}.page{box-shadow:0 2px 10px #999}}
  @media print{html,body{background:#fff}.page{box-shadow:none;margin:0;break-after:page}}
  </style></head><body><div class="page">
    <h1>VEHICLE TECHNICAL DECLARATION</h1><div class="rule"></div>
    <div class="top"><div>Claim Number: ${line(form.claim_number,"vehicle-data")}</div><div>Registration Number: ${line(form.registration_number,"right-line vehicle-data")}</div>
      <div>Make &amp; Model: ${line(form.make_model,"vehicle-data")}</div><div>Non GCC Vehicle: ${yesNo(form.non_gcc_vehicle)} Towing : ${yesNo(form.towing)}</div></div>
    <div class="rule top-rule"></div>
    <div class="grid">
      <section class="section"><div class="heading">1. Engine Status:</div>
        <div class="row">(a) Cranking: &nbsp;&nbsp;&nbsp; ${yesNo(form.cranking)}</div>
        <div class="row">(b) Engine Oil Level: OK ${marked(form.engine_oil_level === "ok")} / No ${marked(form.engine_oil_level === "no")}</div>
        <div class="row">(c) Radiator Coolant: ${yesNo(form.radiator_coolant)}</div>
        <div class="row">(d) Other Remarks: ${line(form.engine_other_remarks)}</div></section>
      <section class="section"><div class="heading">2. Gear Box Status</div>
        <div class="row">(a) Any Body crack Observed ${yesNo(form.gear_body_crack)}</div>
        <div class="row">(b) Any oil leak observed ${yesNo(form.gear_oil_leak)}</div>
        <div class="row">(c) Other Remarks: ${line(form.gear_other_remarks)}</div></section>
      <section class="section"><div class="heading">3. Previous Improper Repairs Observed: ${yesNo(form.previous_improper_repairs)}</div>
        <div>(a) If Yes, Details:</div>${bulletLines(form.previous_improper_details,3)}</section>
      <section class="section"><div class="heading">4.Dash board warning lamp</div>
        <div class="row">(a) Air bag warning: &nbsp; ${yesNo(form.airbag_warning)}</div>
        <div class="row">(b) Engine warning: &nbsp; ${yesNo(form.engine_warning)}</div>
        <div class="row">(c) ATM warning: &nbsp;&nbsp; ${yesNo(form.atm_warning)}</div>
        <div class="row">(d) Other: ${line(form.warning_other)}</div></section>
      <section class="section"><div class="heading">5. Chassis Status Observation:</div>
        <div class="row">(a) Chassis Status: OK ${marked(form.chassis_status === "ok")} / Deformed ${marked(form.chassis_status === "deformed")}</div>
        <div class="row">(b) Chassis Damages Area Details: LH ${marked(form.chassis_damage_lh)} / RH ${marked(form.chassis_damage_rh)}</div>
        <div class="row">(c)Chassis recommend replace : LH ${marked(form.chassis_replace_lh)} / RH ${marked(form.chassis_replace_rh)}</div>
        <div class="bullet">• ${line(form.chassis_notes,"bullet-line")}</div></section>
      <section class="section"><div class="heading">6. Body&amp;Floor Deformation Observed:</div>
        <div class="row">(a) Floor deformation: ${yesNo(form.floor_deformation)}</div>
        <div class="row">(b) Body Deformation: ${yesNo(form.body_deformation)}</div>
        <div class="row">(c) If Yes, Details:</div>
        <div class="bullet">• ${line(form.body_floor_details,"bullet-line")}</div></section>
      <section class="section wide"><div class="heading">7. Any extra accessories/Modification: ${yesNo(form.accessories_modification)} PPE: ${yesNo(form.ppe)}</div>
        <div>(a) If Yes, Details: ${line(form.accessories_details)}</div></section>
      <section class="section wide"><div class="heading">8. Other Observations and Remarks:</div>
        <div class="remarks">${bulletLines(form.other_observations,3)}</div></section>
    </div>
    <div class="rule signature-rule"></div>
    <div class="footer-row"><strong>Garage Name</strong><span>:</span>${line(TECHNICAL_GARAGE_NAME,"garage-name")}</div>
    <div class="footer-row"><div><strong>Authorized Person</strong>${form.signer_role ? `<small class="signer-role">${form.signer_role === "technician" ? "Technician" : "Report Author"}</small>` : ""}</div><span>:</span>${line(form.authorized_person)}</div>
    <div class="sign-row"><strong>Signature</strong><span>:</span><span class="signature-box">${form.signature_data_url ? `<img src="${escapeHtml(form.signature_data_url)}" alt="Authorized person signature" />` : ""}</span><span class="date-label">Date:</span>${line(form.date,"date-line")}</div>
  </div></body></html>`;
}
