// Read-only resolver. May verify legacy archive metadata through caller Storage
// RLS; never uploads, edits a source, creates a signed link or calls Gmail.
import { expandClaimEmailDocuments, claimEmailMediaKind, claimEmailPriority, type ClaimEmailAttachmentKind, type ClaimEmailGeneratedDocument } from "./claimEngineerDocuments.ts";
import { claimEmailTemplateId, claimEmailTemplates, CLAIM_EMAIL_OWNER_TEST_ADDRESS, type ClaimEmailTemplateId, type ClaimEmailSummaryField } from "./claimEngineerEmailTemplates.ts";
type Row = Record<string, any>;
type Client = { from: (table: string) => any; rpc: (name: string, args: Row) => PromiseLike<{ data: any; error?: unknown }> };
export interface ClaimEngineerAttachment {
  id: string;
  kind: ClaimEmailAttachmentKind;
  sourceKind: "document_file" | "vehicle_media";
  sourceId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256?: string;
  bucket: string;
  storagePath: string;
  defaultSelected?: boolean;
}
export interface ClaimEngineerPacket {
  claimId: string;
  entryId: string;
  entryNumber: string;
  subject: string;
  recipient: { id: string; name: string; email: string };
  contextHash: string;
  attachments: ClaimEngineerAttachment[];
  technicalDeclaration: { id: string; revision: number; sourceHash: string; formData: Row; fileName: string } | null;
  warnings: string[];
  limitBytes: number;
  generatedDocuments: ClaimEmailGeneratedDocument[];
  templateId: ClaimEmailTemplateId;
  templates: ReturnType<typeof claimEmailTemplates>;
  recipientMode: "engineer" | "owner_test";
  ownerTestAllowed: boolean;
  statusSummary: ClaimEmailSummaryField[];
}
export interface ClaimEngineerPacketInput {
  admin: Client;
  caller: Client;
  tenantId: string;
  claimId: string;
  entryId?: string | null;
  language: "ar" | "en";
  role: string;
  templateId?: ClaimEmailTemplateId;
  testMode?: boolean;
}
const MAX_ROWS = 500;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const LIMIT_BYTES = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const GENERATED_CATEGORIES = new Set(["claim_estimate", "claim_summary", "delivery_proof", "cancelled_delivery_proof"]);
const FINANCIAL_MEDIA_CATEGORIES = new Set(["invoice", "expense", "expense_receipt", "supplier_invoice", "purchase_invoice", "cash_invoice", "tax_invoice", "insurance_invoice"]);
const PLATE_LETTERS: Record<string, string> = { ا: "A", ب: "B", ت: "T", ث: "T", ج: "J", ح: "H", خ: "K", د: "D", ذ: "D", ر: "R", ز: "Z", س: "S", ش: "S", ص: "S", ض: "D", ط: "T", ظ: "Z", ع: "A", غ: "G", ف: "F", ق: "Q", ك: "K", ل: "L", م: "M", ن: "N", ه: "H", و: "W", ي: "Y" };

export class ClaimEngineerPacketError extends Error {
  code: string;
  entries?: Array<{ id: string; entryNumber: string; arrivalDate: string; status: string }>;
  constructor(code: string) { super(code); this.name = "ClaimEngineerPacketError"; this.code = code; }
}
function fail(code: string): never { throw new ClaimEngineerPacketError(code); }
function object(value: unknown): value is Row { return !!value && typeof value === "object" && !Array.isArray(value); }
function hasControl(value: string) { return Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127); }
function ordered(value: any): any {
  if (Array.isArray(value)) return value.map(ordered);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export async function claimEngineerSourceHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(ordered(value))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function rows(query: any, code: string): Promise<Row[]> {
  const result = await query.limit(MAX_ROWS + 1);
  if (result.error || !Array.isArray(result.data)) fail(code);
  if (result.data.length > MAX_ROWS || (typeof result.count === "number" && result.count > result.data.length)) fail("claim_email_source_limit_exceeded");
  return result.data;
}
async function one(query: any, code: string): Promise<Row> {
  const result = await query.maybeSingle();
  if (result.error || !object(result.data)) fail(code);
  return result.data;
}
function identity(row: Row, tenantId: string, code: string) {
  if (row.tenant_id !== tenantId || row.deleted_at) fail(code);
}
function digits(value: unknown) {
  return String(value || "").replace(/[٠-٩۰-۹]/g, char => String("٠١٢٣٤٥٦٧٨٩".includes(char) ? "٠١٢٣٤٥٦٧٨٩".indexOf(char) : "۰۱۲۳۴۵۶۷۸۹".indexOf(char))).replace(/[^0-9]/g, "");
}
function letters(value: unknown) {
  return Array.from(String(value || "").normalize("NFKC").toUpperCase()).map(char => PLATE_LETTERS[char] || char).join("").replace(/[^A-Z]/g, "");
}
function subjectPart(value: unknown) {
  const text = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!text || /[^\x20-\x7e]/.test(text)) fail("claim_email_subject_details_required");
  return text;
}
function attachment(row: Row, sourceKind: ClaimEngineerAttachment["sourceKind"], tenantId: string, owner?: { claimId: string; entryId: string; orderIds: string[] }): ClaimEngineerAttachment {
  const document = sourceKind === "document_file";
  const bucket = row.storage_bucket;
  const storagePath = row.storage_path;
  const fileName = document ? row.original_file_name : row.file_name;
  const mimeType = row.mime_type;
  const byteSize = Number(document ? row.byte_size : row.file_size);
  if (!UUID.test(row.id || "") || !["temo-documents", "insurance-docs", "damage-photos", "work-order-photos", "expense-documents"].includes(bucket)
    || typeof storagePath !== "string" || !storagePath.startsWith(`${tenantId}/`) || storagePath.length > 2048
    || /[\\?#]/.test(storagePath) || hasControl(storagePath) || storagePath.split("/").some(segment => !segment || segment === "." || segment === "..")
    || /%(?:2f|5c|2e|00)/i.test(storagePath)) fail("claim_email_attachment_unavailable");
  if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 255 || /[\\/]/.test(fileName) || hasControl(fileName)
    || !MIME.has(mimeType) || !Number.isSafeInteger(byteSize) || byteSize < 1) fail("claim_email_attachment_metadata_required");
  if (byteSize > MAX_FILE_BYTES) fail("claim_email_attachment_too_large");
  if (owner && !document) {
    const parts = storagePath.split("/");
    if (parts[1] === "vehicle-entry" && parts[2] !== owner.entryId) fail("claim_email_visit_mismatch");
    if (parts[1] === "claims" && parts[2] !== owner.claimId) fail("claim_email_visit_mismatch");
    if (UUID.test(parts[1] || "") && ![owner.claimId, owner.entryId, ...owner.orderIds].includes(parts[1])) fail("claim_email_visit_mismatch");
  }
  if (!document && row.media_type === "image" && !mimeType.startsWith("image/")) fail("claim_email_attachment_metadata_required");
  if (document && !/^[a-f0-9]{64}$/.test(row.sha256 || "")) fail("claim_email_attachment_metadata_required");
  return {
    id: `${document ? "document" : "media"}:${row.id}`, sourceKind, sourceId: row.id,
    kind: !document && row.media_type === "image" ? "vehicle_photo" : "source_document",
    fileName, mimeType, byteSize, bucket, storagePath, ...(document ? { sha256: row.sha256 } : {}),
  };
}

export async function resolveClaimEngineerPacket(input: ClaimEngineerPacketInput): Promise<ClaimEngineerPacket> {
  const { admin, caller, tenantId, claimId, language, role } = input;
  if (!["admin", "manager", "insurance", "supervisor"].includes(role)) fail("claim_email_forbidden");
  if (input.testMode && role !== "admin") fail("claim_email_owner_test_forbidden");
  const templateId = claimEmailTemplateId(input.templateId);
  if (!UUID.test(tenantId) || !UUID.test(claimId) || (input.entryId && !UUID.test(input.entryId)) || !["en", "ar"].includes(language)) fail("claim_email_invalid_request");
  const claim = await one(caller.from("insurance_claims").select("id,tenant_id,customer_id,vehicle_id,vehicle_entry_id,claim_number,insurance_company_id,insurance_company,insurance_employee_id,vehicle_make,vehicle_model,vehicle_plate,status,repair_stage,notes,inspection_id,job_order_id,auto_job_order_id,estimated_amount,estimated_cost,estimation_type,upl_items,approved_amount,deductible_amount,claim_estimate_number,claim_estimate_revision,claim_estimate_document_status,claim_estimate_modified_at,claim_estimate_generated_at,claim_estimate_content_hash,claim_estimate_storage_path,policy_number,estimate_date,created_at,updated_at,deleted_at")
    .eq("tenant_id", tenantId).eq("id", claimId).is("deleted_at", null), "claim_email_claim_unavailable");
  identity(claim, tenantId, "claim_email_claim_unavailable");
  if (claim.id !== claimId) fail("claim_email_claim_unavailable");
  if (!UUID.test(claim.vehicle_id || "")) fail("claim_email_visit_mismatch");

  let chosenEntryId = input.entryId || claim.vehicle_entry_id;
  let candidates: Row[] = [];
  if (!chosenEntryId) {
    candidates = await rows(caller.from("vehicle_entries").select("id,tenant_id,entry_number,arrival_date,status,vehicle_id,customer_id,insurance_claim_id,converted_claim_id,deleted_at", { count: "exact" })
      .eq("tenant_id", tenantId).is("deleted_at", null).or(`insurance_claim_id.eq.${claimId},converted_claim_id.eq.${claimId}`).order("id"), "claim_email_visit_unavailable");
    if (candidates.length > 1) {
      const error = new ClaimEngineerPacketError("claim_email_visit_required");
      error.entries = candidates.map(row => ({ id: row.id, entryNumber: row.entry_number || "", arrivalDate: row.arrival_date || "", status: row.status || "" }));
      throw error;
    }
    chosenEntryId = candidates[0]?.id;
  }
  if (!UUID.test(chosenEntryId || "")) fail("claim_email_visit_unavailable");
  const entry = await one(caller.from("vehicle_entries").select("id,tenant_id,entry_number,arrival_date,status,vehicle_id,customer_id,insurance_company_id,insurance_snapshot,insurance_claim_id,converted_claim_id,intake_revision,vehicle_snapshot,customer_snapshot,vehicle_condition,vehicle_location,work_order_id,converted_work_order_id,updated_at,deleted_at")
    .eq("tenant_id", tenantId).eq("id", chosenEntryId).is("deleted_at", null), "claim_email_visit_unavailable");
  identity(entry, tenantId, "claim_email_visit_unavailable");
  if (entry.id !== chosenEntryId || entry.vehicle_id !== claim.vehicle_id || !entry.customer_id
    || (entry.insurance_claim_id && entry.insurance_claim_id !== claimId) || (entry.converted_claim_id && entry.converted_claim_id !== claimId)
    || (entry.insurance_claim_id !== claimId && entry.converted_claim_id !== claimId && claim.vehicle_entry_id !== entry.id)) fail("claim_email_visit_mismatch");
  // Review visitors and the claim's insurance financial party remain independent.
  // The explicit claim/entry identity above is required; matching a vehicle alone is insufficient.
  if (!UUID.test(claim.insurance_company_id || "") || (entry.insurance_company_id && entry.insurance_company_id !== claim.insurance_company_id)) fail("claim_email_engineer_mismatch");
  let engineer: Row;
  if (input.testMode) engineer = { id: "owner_test", name: "Owner", email: CLAIM_EMAIL_OWNER_TEST_ADDRESS };
  else {
    if (!UUID.test(claim.insurance_employee_id || "")) fail("claim_email_engineer_required");
    engineer = await one(caller.from("insurance_company_employees").select("id,tenant_id,insurance_company_id,name,email,is_active,updated_at")
      .eq("tenant_id", tenantId).eq("id", claim.insurance_employee_id).eq("insurance_company_id", claim.insurance_company_id).eq("is_active", true), "claim_email_engineer_unavailable");
    if (engineer.id !== claim.insurance_employee_id || engineer.tenant_id !== tenantId || engineer.insurance_company_id !== claim.insurance_company_id || engineer.is_active !== true) fail("claim_email_engineer_mismatch");
  }
  const email = String(engineer.email || "").trim();
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email) || email.length > 254) fail("claim_email_engineer_email_required");
  const vehicle = await one(caller.from("vehicles").select("*")
    .eq("tenant_id", tenantId).eq("id", claim.vehicle_id).is("deleted_at", null), "claim_email_vehicle_unavailable");
  identity(vehicle, tenantId, "claim_email_vehicle_unavailable");
  if (vehicle.id !== claim.vehicle_id) fail("claim_email_vehicle_unavailable");
  const plateDigits = digits(vehicle.plate_number);
  const plateLetters = letters(vehicle.plate_letters);
  if (!plateDigits || plateDigits.length > 7 || !plateLetters || plateLetters.length > 4) fail("claim_email_subject_details_required");
  const subject = `${subjectPart(claim.claim_number)} ${subjectPart(claim.vehicle_make || vehicle.brand)} ${subjectPart(claim.vehicle_model || vehicle.model)} ${plateDigits}/${plateLetters}`;
  if (subject.length > 300) fail("claim_email_subject_details_required");

  // Admin inventories only already-authorized claim/visit references. Every file
  // is subsequently read through caller RLS, including finance/restricted scopes.
  const [claimLinks, entryLinks, entryMedia, claimMedia, signatures] = await Promise.all([
    rows(admin.from("document_links").select("id,tenant_id,file_id,entity_type,entity_id,linked_at,removed_at", { count: "exact" }).eq("tenant_id", tenantId).eq("entity_type", "claim").eq("entity_id", claimId).is("removed_at", null), "claim_email_document_unavailable"),
    rows(admin.from("document_links").select("id,tenant_id,file_id,entity_type,entity_id,linked_at,removed_at", { count: "exact" }).eq("tenant_id", tenantId).eq("entity_type", "vehicle_entry").eq("entity_id", entry.id).is("removed_at", null), "claim_email_document_unavailable"),
    rows(caller.from("vehicle_media").select("*", { count: "exact" }).eq("tenant_id", tenantId).eq("vehicle_entry_id", entry.id).is("deleted_at", null), "claim_email_attachment_unavailable"),
    rows(caller.from("vehicle_media").select("*", { count: "exact" }).eq("tenant_id", tenantId).eq("claim_id", claimId).is("deleted_at", null), "claim_email_attachment_unavailable"),
    rows(admin.from("vehicle_entry_signatures").select("id,tenant_id,vehicle_entry_id,intake_revision,signature_role,created_at", { count: "exact" }).eq("tenant_id", tenantId).eq("vehicle_entry_id", entry.id).eq("intake_revision", entry.intake_revision).eq("signature_role", "delivered_by"), "claim_email_frozen_source_unavailable"),
  ]);
  for (const link of [...claimLinks, ...entryLinks]) {
    if (link.tenant_id !== tenantId || link.removed_at || !UUID.test(link.file_id || "")
      || !((link.entity_type === "claim" && link.entity_id === claimId) || (link.entity_type === "vehicle_entry" && link.entity_id === entry.id))) fail("claim_email_document_unavailable");
  }
  for (const signature of signatures) {
    if (signature.tenant_id !== tenantId || signature.vehicle_entry_id !== entry.id || signature.intake_revision !== entry.intake_revision || signature.signature_role !== "delivered_by") fail("claim_email_frozen_source_unavailable");
  }
  signatures.sort((a, b) => a.id.localeCompare(b.id));
  const fileIds = [...new Set([...claimLinks, ...entryLinks].map(row => row.file_id))].sort();
  if (fileIds.length > MAX_ROWS) fail("claim_email_source_limit_exceeded");
  const fileRows: Row[] = [], visitFileLinks: Row[] = [];
  for (let index = 0; index < fileIds.length; index += 100) {
    const batch = fileIds.slice(index, index + 100);
    const [files, visitLinks] = await Promise.all([
      rows(caller.from("document_files").select("id,tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path,created_at", { count: "exact" }).eq("tenant_id", tenantId).in("id", batch), "claim_email_document_unavailable"),
      rows(admin.from("document_links").select("id,tenant_id,file_id,entity_type,entity_id,linked_at,removed_at", { count: "exact" }).eq("tenant_id", tenantId).eq("entity_type", "vehicle_entry").in("file_id", batch).is("removed_at", null), "claim_email_document_unavailable"),
    ]);
    fileRows.push(...files); visitFileLinks.push(...visitLinks);
  }
  const explicitlyLinked = new Set(entryLinks.map(row => row.file_id));
  const canonicalVisit = claim.vehicle_entry_id === entry.id || (!claim.vehicle_entry_id && candidates.length === 1);
  const includedFileIds = new Set(fileIds.filter(fileId => explicitlyLinked.has(fileId)
    || (canonicalVisit && !visitFileLinks.some(link => link.file_id === fileId && link.entity_id !== entry.id))));
  const fileMap = new Map(fileRows.map(row => [row.id, row]));
  const candidatesToSend: ClaimEngineerAttachment[] = [];
  const mediaOwner = { claimId, entryId: entry.id, orderIds: [entry.work_order_id, entry.converted_work_order_id, claim.job_order_id, claim.auto_job_order_id].filter((value): value is string => typeof value === "string") };
  for (const fileId of includedFileIds) {
    const row = fileMap.get(fileId);
    if (!row || row.tenant_id !== tenantId) fail("claim_email_document_unavailable");
    candidatesToSend.push({ ...attachment(row, "document_file", tenantId), defaultSelected: true });
  }
  const mediaRows = [...new Map([...entryMedia, ...claimMedia].map(row => [row.id, row])).values()];
  const includedMedia: Row[] = [];
  for (const row of mediaRows) {
    identity(row, tenantId, "claim_email_attachment_unavailable");
    if (row.vehicle_entry_id && row.vehicle_entry_id !== entry.id) continue;
    if (!row.vehicle_entry_id && (!canonicalVisit || row.claim_id !== claimId)) continue;
    if ((row.claim_id && row.claim_id !== claimId) || (row.vehicle_id && row.vehicle_id !== claim.vehicle_id)) fail("claim_email_visit_mismatch");
    if (!["image", "document"].includes(row.media_type)) continue;
    if (row.source === "generated_claim_document" || row.source === "legacy_generated_documents"
      || GENERATED_CATEGORIES.has(row.category) || FINANCIAL_MEDIA_CATEGORIES.has(row.category)
      || row.storage_bucket === "expense-documents") continue;
    const item = attachment(row, "vehicle_media", tenantId, mediaOwner);
    if (row.media_type === "document") item.kind = claimEmailMediaKind(row.category) || "source_document";
    includedMedia.push(row); candidatesToSend.push({ ...item, defaultSelected: claimEmailPriority(item.kind) });
  }
  // A single object can be indexed through OCR, the intake and the claim.
  const paths = new Map<string, ClaimEngineerAttachment>(), hashes = new Map<string, ClaimEngineerAttachment>();
  const attachments = candidatesToSend.sort((a, b) => a.id.localeCompare(b.id)).filter(item => {
    const path = `${item.bucket}:${item.storagePath}`;
    const previous = paths.get(path) || (item.sha256 ? hashes.get(item.sha256) : undefined);
    if (previous && (previous.mimeType !== item.mimeType || previous.byteSize !== item.byteSize)) fail("claim_email_attachment_metadata_required");
    paths.set(path, item); if (item.sha256) hashes.set(item.sha256, item);
    return !previous;
  });
  const selectionRequired = attachments.reduce((sum, item) => sum + item.byteSize, 0) > LIMIT_BYTES;

  let declaration: Row | null = null;
  let frozenReceiptId: string | null = null;
  let signedEntry: Row | null = null;
  if (signatures.length) {
    const context = await caller.rpc("vehicle_intake_receipt_context", { p_entry_id: entry.id });
    if (context.error || context.data?.entry_id !== entry.id || context.data?.revision !== entry.intake_revision || !Array.isArray(context.data?.receipts)) fail("claim_email_frozen_source_unavailable");
    const receipt = context.data.receipts.find((row: Row) => row.revision === entry.intake_revision);
    if (!receipt || !UUID.test(receipt.id || "")) fail("claim_email_frozen_source_unavailable");
    const frozen = await caller.rpc("vehicle_intake_receipt_document", { p_receipt_id: receipt.id });
    if (frozen.error || frozen.data?.entry?.id !== entry.id || frozen.data?.revision !== entry.intake_revision) fail("claim_email_frozen_source_unavailable");
    const ink = Array.isArray(frozen.data.entry.vehicle_entry_signatures) ? frozen.data.entry.vehicle_entry_signatures : [];
    if ((frozen.data.entry.tenant_id && frozen.data.entry.tenant_id !== tenantId) || (frozen.data.entry.vehicle_id && frozen.data.entry.vehicle_id !== claim.vehicle_id)
      || !ink.some((signature: Row) => signatures.some(source => source.id === signature.id) && signature.signature_role === "delivered_by"
        && signature.intake_revision === entry.intake_revision && typeof signature.signature_data_url === "string" && signature.signature_data_url.startsWith("data:image/png;base64,"))) fail("claim_email_frozen_source_unavailable");
    declaration = frozen.data.entry.vehicle_technical_declaration || null;
    frozenReceiptId = receipt.id;
    signedEntry = frozen.data.entry;
  } else {
    const result = await caller.from("vehicle_technical_declarations").select("id,tenant_id,vehicle_entry_id,form_data,revision,updated_at").eq("tenant_id", tenantId).eq("vehicle_entry_id", entry.id).maybeSingle();
    if (result.error) fail("claim_email_technical_declaration_unavailable");
    declaration = result.data;
  }
  let technicalDeclaration: ClaimEngineerPacket["technicalDeclaration"] = null;
  if (declaration) {
    if (!UUID.test(declaration.id || "") || !Number.isSafeInteger(declaration.revision) || declaration.revision < 1 || !object(declaration.form_data)
      || (declaration.tenant_id && declaration.tenant_id !== tenantId) || (declaration.vehicle_entry_id && declaration.vehicle_entry_id !== entry.id)
      || new TextEncoder().encode(JSON.stringify(declaration.form_data)).length > 1024 * 1024) fail("claim_email_technical_declaration_unavailable");
    const sourceHash = await claimEngineerSourceHash({ entryId: entry.id, intakeRevision: entry.intake_revision, frozenReceiptId, declaration });
    technicalDeclaration = { id: declaration.id, revision: declaration.revision, sourceHash, formData: declaration.form_data, fileName: `Vehicle-Technical-Declaration-${String(entry.entry_number || entry.id).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf` };
  }
  const warnings: string[] = [];
  if (selectionRequired) warnings.push("claim_email_packet_selection_required");
  if (!attachments.some(item => item.kind === "source_document")) warnings.push("claim_email_source_documents_missing");
  if (!attachments.some(item => item.kind === "vehicle_photo")) warnings.push("claim_email_vehicle_photos_missing");
  if (!technicalDeclaration) warnings.push("claim_email_technical_declaration_missing");
  else if (!technicalDeclaration.formData.signature_data_url) warnings.push("claim_email_technical_declaration_unsigned");
  const expansion = await expandClaimEmailDocuments({ caller, admin, tenantId, claim, entry, vehicle, mediaRows, canonicalVisit, signedEntry, frozenReceiptId, technical: technicalDeclaration, templateId, defaultTechnical: claimEmailTemplates(language).find(template => template.id === templateId)!.defaultTechnical, language, hash: claimEngineerSourceHash, storedAttachment: row => attachment(row, "vehicle_media", tenantId, mediaOwner) });
  for (const item of expansion.stored) {
    if (!attachments.some(previous => previous.bucket === item.bucket && previous.storagePath === item.storagePath)) attachments.push(item);
  }
  attachments.sort((a, b) => a.id.localeCompare(b.id));
  if (!attachments.length && !expansion.generatedDocuments.length) fail("claim_email_packet_empty");
  const recipient = { id: engineer.id, name: engineer.name || "", email };
  const contextHash = await claimEngineerSourceHash({ version: 2, tenantId, language, templateId, testMode: !!input.testMode, claim, entry, vehicle, engineer,
    links: [...claimLinks, ...entryLinks, ...visitFileLinks].sort((a, b) => a.id.localeCompare(b.id)),
    files: fileRows.filter(row => includedFileIds.has(row.id)).sort((a, b) => a.id.localeCompare(b.id)),
    media: includedMedia.sort((a, b) => a.id.localeCompare(b.id)), signatures, technicalSourceHash: technicalDeclaration?.sourceHash || null, attachments, expansionSources: expansion.sourceRows, generatedDocuments: expansion.generatedDocuments, statusSummary: expansion.statusSummary });
  // The action enables this only after checking this tenant's Gmail sender.
  return { claimId, entryId: entry.id, entryNumber: entry.entry_number || "", subject, recipient, contextHash, attachments, technicalDeclaration, warnings: [...warnings, ...expansion.warnings], limitBytes: LIMIT_BYTES, generatedDocuments: expansion.generatedDocuments, templates: claimEmailTemplates(language), templateId, recipientMode: input.testMode ? "owner_test" : "engineer", ownerTestAllowed: false, statusSummary: expansion.statusSummary };
}
