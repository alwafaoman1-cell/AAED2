import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { ensureVehicleForCustomer, normalizeVin } from "@/lib/vehicleIdentity";
import { extractPlateDigits, extractPlateLetters, formatPlate } from "@/lib/plateUtils";
import { toE164 } from "@/lib/phoneUtils";
import { getTemplateSettings } from "@/lib/pdfGenerator";

type VehicleEntryMediaKind = "entry_photo" | "damage_photo" | "document";
type VehicleEntrySignatureRole = "delivered_by" | "receiver" | "override";

export type VehicleEntryStatus =
  | "Draft"
  | "Received"
  | "Issued"
  | "Converted to Claim"
  | "Converted to Work Order"
  | "Cancelled";

export const VEHICLE_ENTRY_STATUSES: VehicleEntryStatus[] = [
  "Draft",
  "Received",
  "Issued",
  "Converted to Claim",
  "Converted to Work Order",
  "Cancelled",
];

export interface VehicleEntryFormState {
  id?: string;
  entry_number?: string;
  status: VehicleEntryStatus;
  customer_id?: string | null;
  vehicle_id?: string | null;
  insurance_company_id?: string | null;
  insurance_claim_id?: string | null;
  work_order_id?: string | null;
  arrival_date: string;
  arrival_time: string;
  vehicle_location: string;
  vehicle_location_bay: string;
  arrival_method: string;
  received_by_name: string;
  customer: {
    name: string;
    phone: string;
    alternate_phone: string;
    email: string;
    address: string;
    id_number: string;
    customer_type: "individual" | "company";
    notes: string;
  };
  vehicle: {
    plate_number: string;
    plate_letters: string;
    plate_country: string;
    make: string;
    model: string;
    year: string;
    color: string;
    vin: string;
    mileage: string;
    fuel_type: string;
    engine_number: string;
    transmission: string;
    current_owner_name: string;
  };
  insurance: {
    is_insurance_related: boolean;
    company_name: string;
    employee_name: string;
    claim_number: string;
    policy_number: string;
    police_report_number: string;
    lpo_number: string;
    surveyor_name: string;
    surveyor_phone: string;
    claim_type: string;
    notes: string;
  };
  delivered_by: {
    full_name: string;
    phone: string;
    id_number: string;
    relation: string;
    towing_company: string;
    towing_plate: string;
    towing_country: string;
    notes: string;
  };
  condition: {
    flags: string[];
    condition_description: string;
    incident_description: string;
    visible_damage: string;
    previous_damage: string;
    mechanical_notes: string;
    electrical_notes: string;
    additional_notes: string;
  };
  contents: {
    keys_count: string;
    registration_card: boolean;
    front_plate: boolean;
    rear_plate: boolean;
    spare_tire: boolean;
    tools_jack: boolean;
    fire_extinguisher: boolean;
    warning_triangle: boolean;
    personal_items: boolean;
    spare_parts_inside: boolean;
    fuel_level: string;
    notes: string;
  };
  damage_marks: VehicleEntryDamageMark[];
}

export interface VehicleEntryDamageMark {
  id?: string;
  mark_number: number;
  damage_type: string;
  vehicle_part: string;
  description: string;
  related_to_incident: boolean;
  expected_action: string;
  notes: string;
  x?: number | null;
  y?: number | null;
  color?: string | null;
}

export interface VehicleEntryListFilters {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
}

export function defaultVehicleEntryForm(): VehicleEntryFormState {
  const now = new Date();
  return {
    status: "Draft",
    arrival_date: now.toISOString().slice(0, 10),
    arrival_time: now.toTimeString().slice(0, 5),
    vehicle_location: "داخل الورشة",
    vehicle_location_bay: "",
    arrival_method: "العميل قاد المركبة",
    received_by_name: "",
    customer: {
      name: "",
      phone: "",
      alternate_phone: "",
      email: "",
      address: "",
      id_number: "",
      customer_type: "individual",
      notes: "",
    },
    vehicle: {
      plate_number: "",
      plate_letters: "",
      plate_country: "OM",
      make: "",
      model: "",
      year: "",
      color: "",
      vin: "",
      mileage: "",
      fuel_type: "",
      engine_number: "",
      transmission: "",
      current_owner_name: "",
    },
    insurance: {
      is_insurance_related: false,
      company_name: "",
      employee_name: "",
      claim_number: "",
      policy_number: "",
      police_report_number: "",
      lpo_number: "",
      surveyor_name: "",
      surveyor_phone: "",
      claim_type: "",
      notes: "",
    },
    delivered_by: {
      full_name: "",
      phone: "",
      id_number: "",
      relation: "مالك المركبة",
      towing_company: "",
      towing_plate: "",
      towing_country: "OM",
      notes: "",
    },
    condition: {
      flags: [],
      condition_description: "",
      incident_description: "",
      visible_damage: "",
      previous_damage: "",
      mechanical_notes: "",
      electrical_notes: "",
      additional_notes: "",
    },
    contents: {
      keys_count: "1",
      registration_card: false,
      front_plate: true,
      rear_plate: true,
      spare_tire: false,
      tools_jack: false,
      fire_extinguisher: false,
      warning_triangle: false,
      personal_items: false,
      spare_parts_inside: false,
      fuel_level: "نصف",
      notes: "",
    },
    damage_marks: [],
  };
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhoneKey(value: string) {
  return toE164(value).replace(/\D/g, "").slice(-8);
}

async function ensureCustomer(form: VehicleEntryFormState, tenantId: string): Promise<string | null> {
  if (form.customer_id) return form.customer_id;
  const name = cleanText(form.customer.name);
  const phone = toE164(form.customer.phone);
  const phoneKey = normalizePhoneKey(phone);

  if (phoneKey) {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,phone")
      .eq("tenant_id", tenantId)
      .ilike("phone", `%${phoneKey}%`)
      .limit(10);
    if (error) throw error;
    const match = ((data as any[]) || []).find((row) => normalizePhoneKey(row.phone || "") === phoneKey);
    if (match?.id) return match.id;
  }

  if (!name && !phone) return null;

  const { data, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      name: name || phone || "Vehicle Entry Customer",
      phone: phone || null,
      email: cleanText(form.customer.email) || null,
      address: cleanText(form.customer.address) || null,
      id_number: cleanText(form.customer.id_number) || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

async function ensureEntryNumber(existing?: string | null): Promise<string> {
  if (existing) return existing;
  const { data, error } = await supabase.rpc("next_vehicle_entry_number" as any, {
    p_year: new Date().getFullYear(),
  });
  if (error) throw error;
  return String(data);
}

export async function searchVehicleEntryCustomers(search: string) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId || search.trim().length < 2) return [];
  const pattern = `%${search.trim()}%`;
  const { data, error } = await supabase
    .from("customers")
    .select("id,name,phone,email,address,id_number,customer_code")
    .eq("tenant_id", tenantId)
    .or(`name.ilike.${pattern},phone.ilike.${pattern},customer_code.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as any[]) || [];
}

export async function searchVehicleEntryVehicles(search: string) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId || search.trim().length < 2) return [];
  const pattern = `%${search.trim()}%`;
  const { data, error } = await supabase
    .from("vehicles")
    .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin_number,vin,mileage,customers(name,phone)")
    .eq("tenant_id", tenantId)
    .or(`plate_number.ilike.${pattern},plate_letters.ilike.${pattern},vin_number.ilike.${pattern},vin.ilike.${pattern},brand.ilike.${pattern},model.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as any[]) || [];
}

export async function listVehicleEntries(filters: VehicleEntryListFilters = {}) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return [];
  let query = supabase
    .from("vehicle_entries" as any)
    .select("*,customer:customers(id,name,phone,customer_code),vehicle:vehicles(id,brand,model,year,plate_number,plate_letters,plate_country,vin_number,color),insurance_company:insurance_companies(id,name),claim:insurance_claims!vehicle_entries_insurance_claim_id_fkey(id,claim_number),work_order:job_orders!vehicle_entries_work_order_id_fkey(id,order_number)")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("arrival_date", filters.from);
  if (filters.to) query = query.lte("arrival_date", filters.to);

  const { data, error } = await query;
  if (error) throw error;
  const rows = ((data as any[]) || []);
  const q = cleanText(filters.search).toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const vehicle = row.vehicle || {};
    const haystack = [
      row.entry_number,
      row.customer?.name,
      row.customer?.phone,
      vehicle.plate_number,
      vehicle.plate_letters,
      vehicle.brand,
      vehicle.model,
      row.insurance_snapshot?.claim_number,
      row.insurance_snapshot?.company_name,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

export async function getVehicleEntry(id: string) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const { data, error } = await supabase
    .from("vehicle_entries" as any)
    .select("*,customer:customers(*),vehicle:vehicles(*),insurance_company:insurance_companies(*),claim:insurance_claims!vehicle_entries_insurance_claim_id_fkey(id,claim_number),work_order:job_orders!vehicle_entries_work_order_id_fkey(id,order_number)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: marks, error: marksError } = await supabase
    .from("vehicle_entry_damage_marks" as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", id)
    .order("mark_number", { ascending: true });
  if (marksError) throw marksError;

  const [mediaRes, docsRes, signaturesRes, auditRes] = await Promise.all([
    supabase
      .from("vehicle_media" as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("vehicle_entry_id", id)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("vehicle_entry_documents" as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("vehicle_entry_id", id)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("vehicle_entry_signatures" as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("vehicle_entry_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("vehicle_entry_audit_logs" as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("vehicle_entry_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (mediaRes.error) throw mediaRes.error;
  if (docsRes.error) throw docsRes.error;
  if (signaturesRes.error) throw signaturesRes.error;
  if (auditRes.error) throw auditRes.error;

  return {
    ...(data as any),
    damage_marks: (marks as any[]) || [],
    vehicle_media: (mediaRes.data as any[]) || [],
    vehicle_entry_documents: (docsRes.data as any[]) || [],
    vehicle_entry_signatures: (signaturesRes.data as any[]) || [],
    vehicle_entry_audit_logs: (auditRes.data as any[]) || [],
  };
}

export function formFromVehicleEntry(row: any): VehicleEntryFormState {
  const base = defaultVehicleEntryForm();
  const customerSnapshot = row?.customer_snapshot || {};
  const vehicleSnapshot = row?.vehicle_snapshot || {};
  const insuranceSnapshot = row?.insurance_snapshot || {};
  return {
    ...base,
    id: row.id,
    entry_number: row.entry_number,
    status: row.status || "Draft",
    customer_id: row.customer_id || null,
    vehicle_id: row.vehicle_id || null,
    insurance_company_id: row.insurance_company_id || null,
    insurance_claim_id: row.insurance_claim_id || null,
    work_order_id: row.work_order_id || null,
    arrival_date: row.arrival_date || base.arrival_date,
    arrival_time: String(row.arrival_time || base.arrival_time).slice(0, 5),
    vehicle_location: row.vehicle_location || "",
    vehicle_location_bay: row.vehicle_location_bay || "",
    arrival_method: row.arrival_method || "",
    received_by_name: row.received_by_name || "",
    customer: { ...base.customer, ...customerSnapshot, ...(row.customer || {}) },
    vehicle: {
      ...base.vehicle,
      ...vehicleSnapshot,
      plate_number: row.vehicle?.plate_number || vehicleSnapshot.plate_number || "",
      plate_letters: row.vehicle?.plate_letters || vehicleSnapshot.plate_letters || "",
      plate_country: row.vehicle?.plate_country || vehicleSnapshot.plate_country || "OM",
      make: row.vehicle?.brand || vehicleSnapshot.make || "",
      model: row.vehicle?.model || vehicleSnapshot.model || "",
      year: row.vehicle?.year ? String(row.vehicle.year) : String(vehicleSnapshot.year || ""),
      color: row.vehicle?.color || vehicleSnapshot.color || "",
      vin: row.vehicle?.vin_number || row.vehicle?.vin || vehicleSnapshot.vin || "",
    },
    insurance: { ...base.insurance, ...insuranceSnapshot },
    delivered_by: { ...base.delivered_by, ...(row.delivered_by || {}) },
    condition: { ...base.condition, ...(row.vehicle_condition || {}) },
    contents: { ...base.contents, ...(row.vehicle_contents || {}) },
    damage_marks: ((row.damage_marks as any[]) || []).map((mark) => ({
      id: mark.id,
      mark_number: mark.mark_number,
      damage_type: mark.damage_type || "",
      vehicle_part: mark.vehicle_part || "",
      description: mark.description || "",
      related_to_incident: mark.related_to_incident ?? true,
      expected_action: mark.expected_action || "",
      notes: mark.notes || "",
      x: mark.x ?? null,
      y: mark.y ?? null,
      color: mark.color || null,
    })),
  };
}

function entryPayload(form: VehicleEntryFormState, tenantId: string, entryNumber: string, customerId: string | null, vehicleId: string | null, userId?: string | null) {
  return {
    tenant_id: tenantId,
    entry_number: entryNumber,
    customer_id: customerId,
    vehicle_id: vehicleId,
    insurance_company_id: form.insurance_company_id || null,
    insurance_claim_id: form.insurance_claim_id || null,
    work_order_id: form.work_order_id || null,
    received_by_user_id: userId || null,
    status: form.status,
    arrival_date: form.arrival_date,
    arrival_time: form.arrival_time,
    vehicle_location: cleanText(form.vehicle_location) || null,
    vehicle_location_bay: cleanText(form.vehicle_location_bay) || null,
    arrival_method: cleanText(form.arrival_method) || null,
    received_by_name: cleanText(form.received_by_name) || null,
    delivered_by: form.delivered_by,
    customer_snapshot: form.customer,
    vehicle_snapshot: form.vehicle,
    insurance_snapshot: form.insurance,
    vehicle_condition: form.condition,
    vehicle_contents: form.contents,
    damage_map: { marks: form.damage_marks.map((m) => ({ n: m.mark_number, x: m.x ?? null, y: m.y ?? null, type: m.damage_type })) },
    declaration_ar: VEHICLE_ENTRY_DECLARATION_AR,
    declaration_en: VEHICLE_ENTRY_DECLARATION_EN,
    issued_at: form.status === "Issued" ? new Date().toISOString() : null,
    issued_by: form.status === "Issued" ? userId || null : null,
    updated_by: userId || null,
  };
}

async function assertVehicleEntryCanBeIssued(entryId: string | null | undefined, tenantId: string) {
  if (!entryId) {
    throw new Error("Cannot issue a vehicle entry before saving it as a draft and capturing both required signatures.");
  }
  const { data: signatures, error: signaturesError } = await supabase
    .from("vehicle_entry_signatures" as any)
    .select("signature_role")
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", entryId);
  if (signaturesError) throw signaturesError;
  const roles = new Set(((signatures as any[]) || []).map((signature) => signature.signature_role));
  if (!roles.has("delivered_by") || !roles.has("receiver")) {
    throw new Error("Cannot issue the vehicle entry before saving both the delivered-by signature and the receiver signature.");
  }
}

export async function saveVehicleEntry(form: VehicleEntryFormState, userId?: string | null) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");

  if (form.status === "Issued") {
    await assertVehicleEntryCanBeIssued(form.id, tenantId);
  }

  const customerId = await ensureCustomer(form, tenantId);
  let vehicleId = form.vehicle_id || null;
  if (customerId && (form.vehicle.plate_number || form.vehicle.vin)) {
    const ensured = await ensureVehicleForCustomer({
      customerId,
      vehicleId: form.vehicle_id,
      plateNumber: extractPlateDigits(form.vehicle.plate_number),
      plateLetters: extractPlateLetters(form.vehicle.plate_letters),
      plateCountry: form.vehicle.plate_country || "OM",
      vin: normalizeVin(form.vehicle.vin),
      make: form.vehicle.make,
      model: form.vehicle.model || "-",
      year: form.vehicle.year,
      color: form.vehicle.color,
      allowDifferentCustomer: true,
    });
    vehicleId = ensured.vehicleId;
  }

  const entryNumber = await ensureEntryNumber(form.entry_number);
  const payload = entryPayload(form, tenantId, entryNumber, customerId, vehicleId, userId);
  let saved: any;

  if (form.id) {
    const { data, error } = await supabase
      .from("vehicle_entries" as any)
      .update(payload as any)
      .eq("tenant_id", tenantId)
      .eq("id", form.id)
      .select("*")
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const { data, error } = await supabase
      .from("vehicle_entries" as any)
      .insert({ ...payload, created_by: userId || null } as any)
      .select("*")
      .single();
    if (error) throw error;
    saved = data;
  }

  await saveDamageMarks(saved.id, tenantId, form.damage_marks);
  await insertVehicleEntryAudit({
    tenantId,
    vehicleEntryId: saved.id,
    userId,
    action: form.id ? "vehicle_entry.updated" : "vehicle_entry.created",
    newValue: { status: form.status, entry_number: saved.entry_number },
  });
  return saved;
}

async function saveDamageMarks(entryId: string, tenantId: string, marks: VehicleEntryDamageMark[]) {
  const { error: deleteError } = await supabase
    .from("vehicle_entry_damage_marks" as any)
    .delete()
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", entryId);
  if (deleteError) throw deleteError;
  if (!marks.length) return;
  const rows = marks.map((mark, index) => ({
    tenant_id: tenantId,
    vehicle_entry_id: entryId,
    mark_number: mark.mark_number || index + 1,
    damage_type: mark.damage_type || null,
    vehicle_part: mark.vehicle_part || null,
    description: mark.description || null,
    related_to_incident: mark.related_to_incident,
    expected_action: mark.expected_action || null,
    notes: mark.notes || null,
    x: mark.x ?? null,
    y: mark.y ?? null,
    color: mark.color || null,
  }));
  const { error } = await supabase.from("vehicle_entry_damage_marks" as any).insert(rows as any);
  if (error) throw error;
}

export async function cancelVehicleEntry(id: string) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const { error } = await supabase
    .from("vehicle_entries" as any)
    .update({ status: "Cancelled", deleted_at: new Date().toISOString() } as any)
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) throw error;
}

export async function issueVehicleEntry(id: string, userId?: string | null) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const { data: signatures, error: signaturesError } = await supabase
    .from("vehicle_entry_signatures" as any)
    .select("signature_role")
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", id);
  if (signaturesError) throw signaturesError;
  const roles = new Set(((signatures as any[]) || []).map((signature) => signature.signature_role));
  if (!roles.has("delivered_by") || !roles.has("receiver")) {
    throw new Error("لا يمكن إصدار نموذج دخول المركبة قبل حفظ توقيع مسلّم المركبة وتوقيع موظف الاستلام");
  }
  const { data, error } = await supabase
    .from("vehicle_entries" as any)
    .update({ status: "Issued", issued_at: new Date().toISOString(), issued_by: userId || null } as any)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await insertVehicleEntryAudit({
    tenantId,
    vehicleEntryId: id,
    userId,
    action: "vehicle_entry.issued",
    newValue: { status: "Issued" },
  });
  return data;
}

async function insertVehicleEntryAudit(args: {
  tenantId: string;
  vehicleEntryId: string;
  userId?: string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}) {
  const { error } = await supabase.from("vehicle_entry_audit_logs" as any).insert({
    tenant_id: args.tenantId,
    vehicle_entry_id: args.vehicleEntryId,
    user_id: args.userId || null,
    action: args.action,
    old_value: args.oldValue ?? null,
    new_value: args.newValue ?? null,
    reason: args.reason || null,
  } as any);
  if (error) {
    console.warn("[vehicle-entry audit] skipped", error);
  }
}

function fileExt(file: File) {
  const fromName = file.name.includes(".") ? file.name.split(".").pop() : "";
  const fromMime = file.type.split("/").pop() || "";
  return (fromName || fromMime || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export async function uploadVehicleEntryFiles(args: {
  entryId: string;
  files: File[];
  kind: VehicleEntryMediaKind;
  category?: string;
  notes?: string;
  uploadedBy?: string | null;
}) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const entry = await getVehicleEntry(args.entryId);
  if (!entry) throw new Error("نموذج الدخول غير موجود");
  if (!entry.vehicle_id) throw new Error("يجب ربط المركبة قبل رفع الصور أو المستندات");
  if (!args.files.length) return [];

  const bucket = "insurance-docs";
  const uploaded: any[] = [];
  for (const file of args.files) {
    const isImage = file.type.startsWith("image/");
    const mediaType = args.kind === "document" || !isImage ? "document" : "image";
    const ext = fileExt(file);
    const safeName = file.name.replace(/[^\p{L}\p{N}_. -]/gu, "_").slice(0, 100);
    const path = `${tenantId}/vehicle-entry/${args.entryId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
    const publicUrl = publicData?.publicUrl || null;

    const { data: media, error: mediaError } = await supabase
      .from("vehicle_media" as any)
      .upsert({
        tenant_id: tenantId,
        vehicle_entry_id: args.entryId,
        vehicle_id: entry.vehicle_id,
        claim_id: entry.insurance_claim_id || entry.converted_claim_id || null,
        work_order_id: entry.work_order_id || entry.converted_work_order_id || null,
        storage_bucket: bucket,
        storage_path: path,
        public_url: publicUrl,
        media_type: mediaType,
        category: args.category || args.kind,
        stage: "vehicle_entry",
        caption: args.notes || null,
        source: "vehicle_entry",
        file_name: safeName,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: args.uploadedBy || null,
        uploaded_at: new Date().toISOString(),
      } as any, { onConflict: "tenant_id,storage_bucket,storage_path" })
      .select("*")
      .single();
    if (mediaError) throw mediaError;

    if (mediaType === "document") {
      const { error: docError } = await supabase.from("vehicle_entry_documents" as any).insert({
        tenant_id: tenantId,
        vehicle_entry_id: args.entryId,
        vehicle_media_id: (media as any).id,
        document_type: args.category || "other",
        file_name: safeName,
        notes: args.notes || null,
        uploaded_by: args.uploadedBy || null,
      } as any);
      if (docError) throw docError;
    }
    uploaded.push(media);
  }

  await insertVehicleEntryAudit({
    tenantId,
    vehicleEntryId: args.entryId,
    userId: args.uploadedBy,
    action: args.kind === "document" ? "vehicle_entry.document_uploaded" : "vehicle_entry.photo_uploaded",
    newValue: { count: uploaded.length, category: args.category || args.kind },
  });
  return uploaded;
}

export async function softDeleteVehicleEntryMedia(entryId: string, mediaId: string, userId?: string | null) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const now = new Date().toISOString();
  const { data: media, error } = await supabase
    .from("vehicle_media" as any)
    .update({ deleted_at: now } as any)
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", entryId)
    .eq("id", mediaId)
    .select("id,storage_path,category")
    .single();
  if (error) throw error;
  await supabase
    .from("vehicle_entry_documents" as any)
    .update({ deleted_at: now } as any)
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", entryId)
    .eq("vehicle_media_id", mediaId);
  await insertVehicleEntryAudit({
    tenantId,
    vehicleEntryId: entryId,
    userId,
    action: "vehicle_entry.media_deleted",
    newValue: media,
  });
}

export async function saveVehicleEntrySignature(args: {
  entryId: string;
  role: VehicleEntrySignatureRole;
  signatureDataUrl: string;
  signerName?: string;
  signerPhone?: string;
  signerTitle?: string;
  overrideReason?: string;
  userId?: string | null;
}) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  if (!args.signatureDataUrl?.startsWith("data:image/")) throw new Error("التوقيع غير صالح");
  const { data, error } = await supabase
    .from("vehicle_entry_signatures" as any)
    .insert({
      tenant_id: tenantId,
      vehicle_entry_id: args.entryId,
      signature_role: args.role,
      signer_name: args.signerName || null,
      signer_phone: args.signerPhone || null,
      signer_title: args.signerTitle || null,
      signature_data_url: args.signatureDataUrl,
      signed_at: new Date().toISOString(),
      signed_by: args.userId || null,
      override_reason: args.overrideReason || null,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  await insertVehicleEntryAudit({
    tenantId,
    vehicleEntryId: args.entryId,
    userId: args.userId,
    action: "vehicle_entry.signature_saved",
    newValue: { role: args.role, signer_name: args.signerName || null },
  });
  return data;
}

async function allocateWorkOrderNumber(tenantId: string) {
  const year = new Date().getFullYear().toString();
  const { data, error } = await supabase
    .from("job_orders" as any)
    .select("order_number")
    .eq("tenant_id", tenantId)
    .ilike("order_number", `WO-${year}-%`)
    .limit(10000);
  if (error) throw error;
  let max = 0;
  for (const row of ((data as any[]) || [])) {
    const match = String(row.order_number || "").match(/^WO-(\d{4})-(\d+)$/i);
    if (match?.[1] === year) max = Math.max(max, Number(match[2]) || 0);
  }
  return `WO-${year}-${String(max + 1).padStart(4, "0")}`;
}

export async function createWorkOrderFromVehicleEntry(entryId: string, userId?: string | null) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const entry = await getVehicleEntry(entryId);
  if (!entry) throw new Error("نموذج الدخول غير موجود");
  if (!entry.customer_id || !entry.vehicle_id) throw new Error("يجب ربط العميل والمركبة قبل إنشاء أمر العمل");
  if (entry.work_order_id || entry.converted_work_order_id) {
    return { existing: true, work_order_id: entry.work_order_id || entry.converted_work_order_id, order_number: entry.work_order?.order_number || null };
  }
  const existing = await supabase
    .from("job_orders" as any)
    .select("id,order_number")
    .eq("tenant_id", tenantId)
    .eq("vehicle_entry_id", entryId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if ((existing.data as any)?.id) {
    await supabase.from("vehicle_entries" as any).update({ work_order_id: (existing.data as any).id, converted_work_order_id: (existing.data as any).id } as any).eq("tenant_id", tenantId).eq("id", entryId);
    return { existing: true, work_order_id: (existing.data as any).id, order_number: (existing.data as any).order_number };
  }

  const orderNumber = await allocateWorkOrderNumber(tenantId);
  const vehicle = entry.vehicle || entry.vehicle_snapshot || {};
  const customer = entry.customer || entry.customer_snapshot || {};
  const arrivalAt = `${entry.arrival_date}T${String(entry.arrival_time || "00:00").slice(0, 5)}:00`;
  const payload = {
    tenant_id: tenantId,
    order_number: orderNumber,
    customer_id: entry.customer_id,
    vehicle_id: entry.vehicle_id,
    claim_id: entry.insurance_claim_id || entry.converted_claim_id || null,
    vehicle_entry_id: entryId,
    work_order_type: entry.insurance_snapshot?.is_insurance_related ? "insurance" : "general_customer",
    status: "received",
    service_type: "Vehicle Entry",
    description: `Created from vehicle entry ${entry.entry_number}`,
    notes: entry.notes || null,
    entry_date: entry.arrival_date,
    received_at: arrivalAt,
    reception_notes: entry.vehicle_condition?.condition_description || null,
    reception_damage_markers: entry.damage_map || { marks: entry.damage_marks || [] },
    vehicle_belongings: entry.vehicle_contents || {},
    metadata: {
      source: "vehicle_entry",
      vehicle_entry_id: entryId,
      entry_number: entry.entry_number,
      customer_name: customer.name || null,
      vehicle: [vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" "),
      vehicle_location: entry.vehicle_location || null,
      vehicle_location_bay: entry.vehicle_location_bay || null,
    },
  };
  const { data, error } = await supabase.from("job_orders" as any).insert(payload as any).select("id,order_number").single();
  if (error) throw error;
  await supabase
    .from("vehicle_entries" as any)
    .update({ status: "Converted to Work Order", work_order_id: (data as any).id, converted_work_order_id: (data as any).id } as any)
    .eq("tenant_id", tenantId)
    .eq("id", entryId);
  await insertVehicleEntryAudit({
    tenantId,
    vehicleEntryId: entryId,
    userId,
    action: "vehicle_entry.work_order_created",
    newValue: data,
  });
  return { existing: false, work_order_id: (data as any).id, order_number: (data as any).order_number };
}

export async function convertVehicleEntryToClaim(entryId: string, userId?: string | null) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const entry = await getVehicleEntry(entryId);
  if (!entry) throw new Error("نموذج الدخول غير موجود");
  if (!entry.customer_id || !entry.vehicle_id) throw new Error("يجب ربط العميل والمركبة قبل إنشاء المطالبة");
  const insurance = entry.insurance_snapshot || {};
  const claimNumber = cleanText(insurance.claim_number) || entry.entry_number;
  if (entry.insurance_claim_id || entry.converted_claim_id) {
    return { existing: true, claim_id: entry.insurance_claim_id || entry.converted_claim_id, claim_number: entry.claim?.claim_number || claimNumber };
  }
  const existing = await supabase
    .from("insurance_claims" as any)
    .select("id,claim_number")
    .eq("tenant_id", tenantId)
    .eq("claim_number", claimNumber)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if ((existing.data as any)?.id) {
    await supabase.from("vehicle_entries" as any).update({ insurance_claim_id: (existing.data as any).id, converted_claim_id: (existing.data as any).id } as any).eq("tenant_id", tenantId).eq("id", entryId);
    return { existing: true, claim_id: (existing.data as any).id, claim_number: (existing.data as any).claim_number };
  }
  const vehicle = entry.vehicle || entry.vehicle_snapshot || {};
  const customer = entry.customer || entry.customer_snapshot || {};
  const payload = {
    tenant_id: tenantId,
    claim_number: claimNumber,
    customer_id: entry.customer_id,
    vehicle_id: entry.vehicle_id,
    vehicle_entry_id: entryId,
    insurance_company: insurance.company_name || "Insurance",
    insurance_company_id: entry.insurance_company_id || null,
    policy_number: insurance.policy_number || null,
    incident_description: insurance.notes || entry.vehicle_condition?.incident_description || null,
    workshop_arrival_date: entry.arrival_date,
    vehicle_plate: formatPlate({ plate_letters: vehicle.plate_letters, plate_number: vehicle.plate_number }),
    vehicle_make: vehicle.brand || vehicle.make || null,
    vehicle_model: vehicle.model || null,
    vehicle_color: vehicle.color || null,
    vehicle_vin: vehicle.vin_number || vehicle.vin || null,
    vehicle_year: vehicle.year ? Number(vehicle.year) || null : null,
    vehicle_owner_name: customer.name || null,
    vehicle_owner_phone: customer.phone || null,
    receiver_name: entry.delivered_by?.full_name || null,
    receiver_id_number: entry.delivered_by?.id_number || null,
    estimated_amount: 0,
    estimation_type: "lump_sum",
    status: "pending",
    notes: `Created from vehicle entry ${entry.entry_number}`,
  };
  const { data, error } = await supabase.from("insurance_claims" as any).insert(payload as any).select("id,claim_number").single();
  if (error) throw error;
  await supabase
    .from("vehicle_entries" as any)
    .update({ status: "Converted to Claim", insurance_claim_id: (data as any).id, converted_claim_id: (data as any).id } as any)
    .eq("tenant_id", tenantId)
    .eq("id", entryId);
  await insertVehicleEntryAudit({
    tenantId,
    vehicleEntryId: entryId,
    userId,
    action: "vehicle_entry.claim_created",
    newValue: data,
  });
  return { existing: false, claim_id: (data as any).id, claim_number: (data as any).claim_number };
}

export const VEHICLE_ENTRY_DECLARATION_AR =
  "أقر بأن المركبة تم تسليمها إلى شركة الوفاء للأعمال المتكاملة ش.م.م بالحالة والأضرار والمحتويات الموضحة في هذا النموذج والصور المرفقة. ويعد هذا النموذج إثباتًا لحالة المركبة وقت وصولها إلى الورشة فقط، ولا يمثل تقديرًا نهائيًا لتكاليف الإصلاح أو حصرًا نهائيًا لجميع الأضرار. وقد تظهر أضرار إضافية بعد الفحص أو الفك، ويتم التعامل معها بعد الحصول على الموافقات اللازمة من العميل أو شركة التأمين.";

export const VEHICLE_ENTRY_DECLARATION_EN =
  "I acknowledge that the vehicle has been delivered to Al Wafa Integrated Business Company LLC in the condition, damages and contents recorded in this form and attached photos. This form documents the vehicle condition at workshop arrival only and is not a final repair estimate or a final damage list. Additional damage may appear after inspection or dismantling and will be handled after obtaining the required approvals from the customer or insurance company.";

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function info(label: string, value: unknown) {
  return `<div class="info"><span>${htmlEscape(label)}</span><b>${htmlEscape(value || "—")}</b></div>`;
}

export function buildVehicleEntryHtml(entry: any) {
  const settings = getTemplateSettings();
  const customer = entry.customer || entry.customer_snapshot || {};
  const vehicle = entry.vehicle || entry.vehicle_snapshot || {};
  const insurance = entry.insurance_snapshot || {};
  const deliveredBy = entry.delivered_by || {};
  const condition = entry.vehicle_condition || {};
  const contents = entry.vehicle_contents || {};
  const marks = (entry.damage_marks || []) as any[];
  const plate = formatPlate({ plate_letters: vehicle.plate_letters, plate_number: vehicle.plate_number });
  const logo = settings.logoUrl ? `<img src="${settings.logoUrl}" />` : "";
  const stamp = settings.stampUrl ? `<img src="${settings.stampUrl}" />` : "";

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
  <title>${htmlEscape(entry.entry_number)}</title>
  <style>
    @page{size:A4;margin:10mm 12mm 14mm}
    *{box-sizing:border-box} body{font-family:Arial,Tahoma,sans-serif;color:#0f2440;background:#fff;margin:0;font-size:11px}
    .page{width:186mm;min-height:273mm;margin:0 auto;display:flex;flex-direction:column;gap:4mm}
    .header{display:grid;grid-template-columns:45mm 1fr 32mm;gap:6mm;align-items:start;border-bottom:1px solid #d6a229;padding-bottom:3mm}
    .badge{background:#09243f;color:#fff;border-radius:3mm;padding:5mm;text-align:center}.badge h1{font-size:14px;margin:0 0 3mm}.badge b{font-size:20px;letter-spacing:.5px}
    .company{text-align:center}.company h2{margin:0;font-size:16px}.company p{margin:1mm 0;color:#334155;line-height:1.45}.logo img{max-width:24mm;max-height:24mm;object-fit:contain}
    .section{border:1px solid #14365d;border-radius:2mm;padding:3mm;break-inside:avoid}.section h3{margin:0 0 2.5mm;color:#a87400;font-size:12px;border-bottom:1px solid #e5e7eb;padding-bottom:1mm}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.info span{display:block;color:#64748b;font-size:9px}.info b{display:block;margin-top:1mm;font-size:11px}
    table{width:100%;border-collapse:collapse;break-inside:auto} th{background:#09243f;color:#fff} th,td{border:1px solid #cbd5e1;padding:2mm;text-align:center}
    .declaration{line-height:1.7;background:#fff9e6;border-color:#e2b044}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8mm;margin-top:auto;break-inside:avoid}.sig{min-height:24mm;border:1px dashed #94a3b8;border-radius:2mm;text-align:center;padding:3mm}.sig .line{height:12mm;border-bottom:1px solid #0f2440;margin-top:5mm}.sig img{max-width:35mm;max-height:18mm;object-fit:contain}
    .footer{border-top:1px solid #d6a229;text-align:center;color:#64748b;padding-top:2mm;font-size:9px}
    @media print{body{background:#fff}.page{margin:0;box-shadow:none}}
  </style></head><body><main class="page">
    <section class="header">
      <div class="badge"><h1>دخول واستلام مركبة<br/><small>Vehicle Entry & Receipt</small></h1><b>${htmlEscape(entry.entry_number)}</b><p>${htmlEscape(entry.arrival_date)} ${htmlEscape(String(entry.arrival_time || "").slice(0,5))}</p></div>
      <div class="company"><h2>${htmlEscape(settings.companyName)}</h2><p>${htmlEscape(settings.companyNameEn)}</p><p>${htmlEscape(settings.phone)} · ${htmlEscape(settings.email)}<br/>CR: ${htmlEscape(settings.commercialReg)} · VAT: ${htmlEscape(settings.vatNumber)}</p></div>
      <div class="logo">${logo}</div>
    </section>
    <section class="section"><h3>بيانات الوصول / Arrival</h3><div class="grid">${info("رقم الدخول", entry.entry_number)}${info("الحالة", entry.status)}${info("طريقة الوصول", entry.arrival_method)}${info("موقع المركبة", `${entry.vehicle_location || ""} ${entry.vehicle_location_bay || ""}`.trim())}</div></section>
    <section class="section"><h3>العميل والمركبة / Customer & Vehicle</h3><div class="grid">${info("العميل", customer.name)}${info("الهاتف", customer.phone)}${info("اللوحة", plate)}${info("المركبة", `${vehicle.brand || vehicle.make || ""} ${vehicle.model || ""} ${vehicle.year || ""}`.trim())}${info("اللون", vehicle.color)}${info("VIN", vehicle.vin_number || vehicle.vin)}${info("العداد", vehicle.mileage)}${info("المالك الحالي", vehicle.current_owner_name || customer.name)}</div></section>
    <section class="section"><h3>التأمين / Insurance</h3><div class="grid">${info("مطالبة تأمين", insurance.is_insurance_related ? "نعم" : "لا")}${info("شركة التأمين", insurance.company_name)}${info("رقم المطالبة", insurance.claim_number)}${info("رقم LPO", insurance.lpo_number)}${info("المعاين", insurance.surveyor_name)}${info("هاتف المعاين", insurance.surveyor_phone)}</div></section>
    <section class="section"><h3>مسلّم المركبة / Delivered By</h3><div class="grid">${info("الاسم", deliveredBy.full_name)}${info("الهاتف", deliveredBy.phone)}${info("الصفة", deliveredBy.relation)}${info("شركة الرافعة", deliveredBy.towing_company)}</div></section>
    <section class="section"><h3>حالة المركبة / Condition</h3><p>${htmlEscape(condition.condition_description || "—")}</p><p>${htmlEscape(condition.visible_damage || "")}</p></section>
    <section class="section"><h3>تفاصيل الأضرار / Damage Details</h3><table><thead><tr><th>#</th><th>النوع</th><th>الجزء</th><th>الوصف</th><th>الإجراء</th></tr></thead><tbody>${marks.length ? marks.map((m) => `<tr><td>${m.mark_number}</td><td>${htmlEscape(m.damage_type)}</td><td>${htmlEscape(m.vehicle_part)}</td><td>${htmlEscape(m.description)}</td><td>${htmlEscape(m.expected_action)}</td></tr>`).join("") : `<tr><td colspan="5">لا توجد علامات مسجلة</td></tr>`}</tbody></table></section>
    <section class="section"><h3>محتويات المركبة / Contents</h3><div class="grid">${info("عدد المفاتيح", contents.keys_count)}${info("استمارة المركبة", contents.registration_card ? "نعم" : "لا")}${info("مستوى الوقود", contents.fuel_level)}${info("ملاحظات", contents.notes)}</div></section>
    <section class="section declaration"><h3>الإقرار / Declaration</h3><p>${VEHICLE_ENTRY_DECLARATION_AR}</p><p dir="ltr">${VEHICLE_ENTRY_DECLARATION_EN}</p></section>
    <section class="signatures"><div class="sig"><b>توقيع مسلّم المركبة</b><div class="line"></div></div><div class="sig"><b>توقيع موظف الاستلام</b><div class="line"></div></div><div class="sig"><b>ختم الشركة</b><div>${stamp}</div></div></section>
    <footer class="footer">${htmlEscape(settings.companyNameEn)} · ${new Date().getFullYear()}</footer>
  </main></body></html>`;
}
