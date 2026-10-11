import { addMonths, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export type ComplianceKind =
  | "commercial_registration" | "lease" | "vat_registration"
  | "police_permit" | "employee_permit" | "other";
export type ComplianceStatus = "active" | "closed";

export interface ComplianceRecord {
  id: string;
  tenant_id: string;
  kind: ComplianceKind;
  title: string;
  reference_number: string | null;
  issuing_authority: string | null;
  employee_id: string | null;
  employee_name: string | null;
  issued_on: string | null;
  expires_on: string;
  status: ComplianceStatus;
  notes: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceInput {
  kind: ComplianceKind;
  title: string;
  reference_number?: string | null;
  issuing_authority?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  issued_on?: string | null;
  expires_on: string;
  status: ComplianceStatus;
  notes?: string | null;
}

export interface ComplianceAlert {
  id: string;
  title: string;
  titleEn?: string;
  expiresOn: string;
  href: string;
  source: "register" | "hr";
}

export const COMPLIANCE_KINDS: { value: ComplianceKind; ar: string; en: string }[] = [
  { value: "commercial_registration", ar: "السجل التجاري", en: "Commercial registration" },
  { value: "lease", ar: "عقد الإيجار", en: "Lease agreement" },
  { value: "vat_registration", ar: "التسجيل الضريبي", en: "Tax registration" },
  { value: "police_permit", ar: "تصريح أو موافقة الشرطة", en: "Police permit or approval" },
  { value: "employee_permit", ar: "تصريح عامل", en: "Worker permit" },
  { value: "other", ar: "وثيقة أخرى", en: "Other document" },
];

export function todayLocal(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (name: string) => parts.find((part) => part.type === name)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function complianceCutoff(today: string): string { return format(addMonths(parseISO(today), 3), "yyyy-MM-dd"); }
export function daysUntilExpiry(expiresOn: string, today = todayLocal()): number {
  return differenceInCalendarDays(parseISO(expiresOn), parseISO(today));
}
export function complianceAlertTitle(alert: ComplianceAlert, isArabic: boolean): string {
  return isArabic ? alert.title : alert.titleEn || alert.title;
}

function assertValidInput(input: ComplianceInput): void {
  if (!input.title.trim() || !input.expires_on) throw new Error("COMPLIANCE_REQUIRED_FIELDS");
  if (input.issued_on && input.issued_on > input.expires_on) throw new Error("COMPLIANCE_DATE_ORDER");
  if (input.kind === "employee_permit" && !input.employee_id?.trim()) throw new Error("COMPLIANCE_EMPLOYEE_REQUIRED");
}

export async function listComplianceRecords(tenantId: string, page = 1, kind = "all", status = "all") {
  const size = 50;
  let query = (supabase.from("compliance_records" as any) as any)
    .select("*", { count: "exact" }).eq("tenant_id", tenantId)
    .order("expires_on", { ascending: true }).range((page - 1) * size, page * size - 1);
  if (kind !== "all") query = query.eq("kind", kind);
  if (status !== "all") query = query.eq("status", status);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data || []) as ComplianceRecord[], total: count || 0, size };
}

export async function getComplianceRecord(tenantId: string, id: string): Promise<ComplianceRecord> {
  const { data, error } = await (supabase.from("compliance_records" as any) as any)
    .select("*").eq("tenant_id", tenantId).eq("id", id).single();
  if (error) throw error;
  return data as ComplianceRecord;
}

export async function saveComplianceRecord(
  tenantId: string, input: ComplianceInput, existing?: Pick<ComplianceRecord, "id" | "updated_at">,
): Promise<ComplianceRecord> {
  assertValidInput(input);
  const payload = {
    kind: input.kind, title: input.title.trim(), reference_number: input.reference_number?.trim() || null,
    issuing_authority: input.issuing_authority?.trim() || null,
    employee_id: input.kind === "employee_permit" ? input.employee_id?.trim() || null : null,
    employee_name: input.kind === "employee_permit" ? input.employee_name?.trim() || null : null,
    issued_on: input.issued_on || null, expires_on: input.expires_on,
    status: input.status, notes: input.notes?.trim() || null,
  };
  if (existing) {
    const { data, error } = await (supabase.from("compliance_records" as any) as any)
      .update(payload).eq("tenant_id", tenantId).eq("id", existing.id)
      .eq("updated_at", existing.updated_at).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("COMPLIANCE_CONCURRENT_EDIT");
    return data as ComplianceRecord;
  }
  const { data, error } = await (supabase.from("compliance_records" as any) as any)
    .insert({ ...payload, tenant_id: tenantId }).select("*").single();
  if (error) throw error;
  return data as ComplianceRecord;
}

export function validateComplianceFile(file: File): void {
  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
    throw new Error("COMPLIANCE_FILE_INVALID");
  }
}

export async function uploadComplianceFile(tenantId: string, record: ComplianceRecord, file: File): Promise<ComplianceRecord> {
  validateComplianceFile(file);
  const path = `${tenantId}/${record.id}/${crypto.randomUUID()}`;
  const { error: uploadError } = await supabase.storage.from("compliance-documents")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await (supabase.from("compliance_records" as any) as any)
    .update({ file_path: path }).eq("tenant_id", tenantId).eq("id", record.id)
    .eq("updated_at", record.updated_at).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("COMPLIANCE_FILE_LINK_CONFLICT");
  return data as ComplianceRecord;
}

export async function getComplianceFileUrl(tenantId: string, path: string): Promise<string> {
  if (!path.startsWith(`${tenantId}/`)) throw new Error("COMPLIANCE_FILE_TENANT_MISMATCH");
  const { data, error } = await supabase.storage.from("compliance-documents").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw error || new Error("COMPLIANCE_FILE_UNAVAILABLE");
  return data.signedUrl;
}

export async function listComplianceAudit(tenantId: string, recordId: string) {
  const { data, error } = await (supabase.from("compliance_record_audit" as any) as any)
    .select("id,action,actor_id,created_at,old_value,new_value")
    .eq("tenant_id", tenantId).eq("record_id", recordId)
    .order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return (data || []) as { id: string; action: string; actor_id: string | null; created_at: string; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> }[];
}

export async function fetchCompanyComplianceAlerts(tenantId: string, today = todayLocal()) {
  const { data, count, error } = await (supabase.from("compliance_records" as any) as any)
    .select("id,title,expires_on", { count: "exact" })
    .eq("tenant_id", tenantId).eq("status", "active")
    .lte("expires_on", complianceCutoff(today))
    .order("expires_on", { ascending: true }).limit(20);
  if (error) throw error;
  return {
    total: count || 0,
    rows: ((data || []) as { id: string; title: string; expires_on: string }[]).map((row): ComplianceAlert => ({
      id: `register:${row.id}`, title: row.title, expiresOn: row.expires_on,
      href: `/compliance/${row.id}`, source: "register",
    })),
  };
}

export interface HrSnapshot {
  employees?: { id: string; name?: string; employeeNumber?: string; isDeleted?: boolean; employmentStatus?: string; contractEndDate?: string }[];
  documents?: { id: string; employeeId: string; name?: string; type?: string; expiryDate?: string }[];
}

function isDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
}

async function fetchHrSnapshot(tenantId: string): Promise<HrSnapshot> {
  const { data, error } = await supabase.from("tenant_settings")
    .select("value").eq("tenant_id", tenantId).eq("key", "alwafa_hr_v1").maybeSingle();
  if (error) throw error;
  return (data?.value || {}) as HrSnapshot;
}

export async function fetchHrEmployeesForCompliance(tenantId: string) {
  const hr = await fetchHrSnapshot(tenantId);
  return (Array.isArray(hr.employees) ? hr.employees : [])
    .filter((employee) => employee && !!employee.id && !employee.isDeleted && employee.employmentStatus !== "terminated")
    .map((employee) => ({ id: employee.id, name: employee.name || employee.employeeNumber || employee.id }));
}

/** Pure projection of existing HR data; no duplicate contract is stored. */
export function deriveHrComplianceEntries(hr: HrSnapshot): ComplianceAlert[] {
  const employees = (Array.isArray(hr.employees) ? hr.employees : [])
    .filter((employee) => employee && !!employee.id && !employee.isDeleted && employee.employmentStatus !== "terminated");
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const contracts = employees.filter((employee) => isDate(employee.contractEndDate)).map((employee): ComplianceAlert => ({
    id: `hr-contract:${employee.id}`,
    title: `${employee.name || employee.employeeNumber || employee.id} — عقد عمل`,
    titleEn: `${employee.name || employee.employeeNumber || employee.id} — Employment contract`,
    expiresOn: employee.contractEndDate!, href: `/staff/${employee.id}`, source: "hr",
  }));
  const documents = (Array.isArray(hr.documents) ? hr.documents : []).filter((doc) => {
    if (!doc || !doc.id || !doc.employeeId) return false;
    const employee = byId.get(doc.employeeId);
    return Boolean(employee && isDate(doc.expiryDate) && !(doc.type === "contract" && employee.contractEndDate === doc.expiryDate));
  }).map((doc): ComplianceAlert => ({
    id: `hr-document:${doc.id}`,
    title: `${byId.get(doc.employeeId)?.name || doc.employeeId} — ${doc.name || doc.type || "document"}`,
    expiresOn: doc.expiryDate!, href: `/staff/${doc.employeeId}`, source: "hr",
  }));
  return [...contracts, ...documents].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

/** Read existing HR contracts/documents; never copy them into compliance_records. */
export async function fetchHrComplianceEntries(tenantId: string): Promise<ComplianceAlert[]> {
  return deriveHrComplianceEntries(await fetchHrSnapshot(tenantId));
}
