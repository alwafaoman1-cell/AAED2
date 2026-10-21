import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { DocumentExtractionResult, DocumentPage, DocumentType, EntityMatch, ExtractedField, ExtractionIssue, ProcessingStatus } from "./types";
import { DOCUMENT_ENGINE_VERSION } from "./types";
import type { SupportedDocumentMime } from "./fileSafety";

export type DocumentAccessScope = "operational" | "finance" | "restricted";

export function scopeForDocument(type?: DocumentType): DocumentAccessScope {
  if (type === "customer_id") return "restricted";
  if (["expense_receipt", "supplier_invoice", "purchase_invoice", "invoice"].includes(type || "")) return "finance";
  return "operational";
}

async function assertCurrentTenant(tenantId: string): Promise<void> {
  const { data, error } = await supabase.rpc("get_user_tenant_id");
  if (error) throw error;
  if (!data || data !== tenantId) throw new Error("DOCUMENT_TENANT_MISMATCH");
}

export async function registerDocumentFile(input: {
  tenantId: string;
  file: File;
  sha256: string;
  mimeType: SupportedDocumentMime;
  scope: DocumentAccessScope;
}): Promise<{ id: string; storagePath: string }> {
  await assertCurrentTenant(input.tenantId);
  const existing = await supabase.from("document_files").select("id,storage_path")
    .eq("tenant_id", input.tenantId).eq("sha256", input.sha256).eq("access_scope", input.scope).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { id: existing.data.id, storagePath: existing.data.storage_path };

  const extension = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[input.mimeType];
  const storagePath = `${input.tenantId}/${input.scope}/${input.sha256}.${extension}`;
  const upload = await supabase.storage.from("temo-documents").upload(storagePath, input.file, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (upload.error && upload.error.statusCode !== "409") throw upload.error;
  const inserted = await supabase.from("document_files").insert({
    tenant_id: input.tenantId,
    sha256: input.sha256,
    original_file_name: input.file.name.slice(0, 255),
    mime_type: input.mimeType,
    byte_size: input.file.size,
    access_scope: input.scope,
    storage_bucket: "temo-documents",
    storage_path: storagePath,
  }).select("id,storage_path").single();
  if (!inserted.error && inserted.data) return { id: inserted.data.id, storagePath: inserted.data.storage_path };
  // Another browser may have inserted the same content between our lookup and insert.
  const raced = await supabase.from("document_files").select("id,storage_path")
    .eq("tenant_id", input.tenantId).eq("sha256", input.sha256).eq("access_scope", input.scope).maybeSingle();
  if (raced.error) throw raced.error;
  if (raced.data) return { id: raced.data.id, storagePath: raced.data.storage_path };
  throw inserted.error || new Error("DOCUMENT_FILE_REGISTER_FAILED");
}

export async function claimDocumentProcessing(fileId: string): Promise<{
  extractionId: string; acquired: boolean; status: ProcessingStatus; lease: string;
}> {
  const { data, error } = await supabase.rpc("document_claim_processing", {
    p_file_id: fileId, p_engine_version: DOCUMENT_ENGINE_VERSION,
  });
  if (error) throw error;
  const claim = data?.[0];
  if (!claim) throw new Error("DOCUMENT_PROCESSING_CLAIM_FAILED");
  return { extractionId: claim.extraction_id, acquired: claim.acquired, status: claim.processing_status as ProcessingStatus, lease: claim.lease };
}

export async function enqueueDocumentProcessing(fileId: string, engineVersion = DOCUMENT_ENGINE_VERSION): Promise<{ extractionId: string; status: ProcessingStatus }> {
  const { data, error } = await supabase.rpc("document_enqueue_processing", {
    p_file_id: fileId, p_engine_version: `${engineVersion}-worker`,
  });
  if (error) throw error;
  const queued = data?.[0];
  if (!queued) throw new Error("DOCUMENT_WORKER_ENQUEUE_FAILED");
  return { extractionId: queued.extraction_id, status: queued.processing_status as ProcessingStatus };
}

export async function loadDocumentExtraction(tenantId: string, extractionId: string): Promise<DocumentExtractionResult> {
  await assertCurrentTenant(tenantId);
  const extraction = await supabase.from("document_extractions").select("*").eq("tenant_id", tenantId).eq("id", extractionId).single();
  if (extraction.error) throw extraction.error;
  const row = extraction.data;
  const [pages, fields, file] = await Promise.all([
    supabase.from("document_extraction_pages").select("*").eq("tenant_id", tenantId).eq("extraction_id", extractionId).order("page_number"),
    supabase.from("document_extraction_fields").select("*").eq("tenant_id", tenantId).eq("extraction_id", extractionId),
    supabase.from("document_files").select("id,sha256,original_file_name,mime_type").eq("tenant_id", tenantId)
      .eq("id", row.file_id).single(),
  ]);
  for (const result of [pages, fields, file]) if (result.error) throw result.error;
  const fileRow = file.data!;
  const metrics = (row.processing_metrics || {}) as Record<string, unknown>;
  const mappedFields: Record<string, ExtractedField> = {};
  for (const field of fields.data || []) mappedFields[field.field_key] = {
    key: field.field_key, rawValue: field.raw_value, normalizedValue: field.normalized_value,
    confidence: field.confidence, sourcePage: field.source_page,
    sourceBox: field.source_box as unknown as ExtractedField["sourceBox"],
    method: field.extraction_method as ExtractedField["method"],
    validation: field.validation_status as ExtractedField["validation"], evidence: [],
    reviewStatus: field.review_status as ExtractedField["reviewStatus"], reviewedValue: field.reviewed_value,
  };
  const mappedPages: DocumentPage[] = (pages.data || []).map((page) => ({
    number: page.page_number, text: page.text_content, method: page.extraction_method as DocumentPage["method"],
    confidence: page.confidence, width: page.width ?? undefined, height: page.height ?? undefined,
    segments: page.segments as unknown as DocumentPage["segments"],
  }));
  return {
    extractionId: row.id, fileId: row.file_id, tenantId, sha256: fileRow.sha256,
    fileName: fileRow.original_file_name, mimeType: fileRow.mime_type,
    documentType: row.document_type as DocumentType,
    documentTypeConfidence: Number(metrics.documentTypeConfidence || 0),
    language: row.detected_language as DocumentExtractionResult["language"],
    method: row.extraction_method as DocumentExtractionResult["method"], rawText: row.raw_text || "",
    pages: mappedPages, fields: mappedFields,
    issues: row.issues as unknown as ExtractionIssue[], matches: row.matches as unknown as EntityMatch[],
    matchingStatus: (metrics.matchingStatus || "skipped") as DocumentExtractionResult["matchingStatus"],
    overallConfidence: row.overall_confidence || 0, needsReview: row.status !== "verified",
    status: row.status as ProcessingStatus, aiUsed: row.ai_used,
    timings: {
      nativeMs: Number(metrics.nativeMs || 0), ocrMs: Number(metrics.ocrMs || 0),
      parseMs: Number(metrics.parseMs || 0), matchMs: Number(metrics.matchMs || 0),
      totalMs: Number(metrics.totalMs || 0),
    },
    ocrEngine: typeof metrics.ocrEngine === "string" ? metrics.ocrEngine : undefined,
    ocrModelVersion: typeof metrics.ocrModelVersion === "string" ? metrics.ocrModelVersion : undefined,
    parserVersion: typeof metrics.parserVersion === "string" ? metrics.parserVersion : undefined,
    profileVersion: typeof metrics.profileVersion === "string" ? metrics.profileVersion : undefined,
  };
}

export async function persistDocumentExtraction(result: DocumentExtractionResult, lease?: string): Promise<void> {
  if (!result.extractionId) throw new Error("DOCUMENT_EXTRACTION_ID_REQUIRED");
  await assertCurrentTenant(result.tenantId);
  const extractionId = result.extractionId;
  const existingPages = await supabase.from("document_extraction_pages").select("page_number,text_content")
    .eq("tenant_id", result.tenantId).eq("extraction_id", extractionId);
  if (existingPages.error) throw existingPages.error;
  for (const previous of existingPages.data || []) {
    const current = result.pages.find((page) => page.number === previous.page_number);
    if (!current || current.text.slice(0, 200000) !== previous.text_content) {
      throw new Error("DOCUMENT_RETRY_PAGE_CONFLICT");
    }
  }
  const existingFields = await supabase.from("document_extraction_fields").select("field_key,raw_value,normalized_value")
    .eq("tenant_id", result.tenantId).eq("extraction_id", extractionId);
  if (existingFields.error) throw existingFields.error;
  for (const previous of existingFields.data || []) {
    const current = result.fields[previous.field_key];
    if (!current || current.rawValue !== previous.raw_value || current.normalizedValue !== previous.normalized_value) {
      throw new Error("DOCUMENT_RETRY_RESULT_CONFLICT");
    }
  }
  const pageRows = result.pages.map((page) => ({
    tenant_id: result.tenantId, extraction_id: extractionId, page_number: page.number,
    extraction_method: page.method, text_content: page.text.slice(0, 200000),
    confidence: page.confidence, width: page.width ?? null, height: page.height ?? null,
    segments: (page.segments || []) as unknown as Json,
  }));
  // A browser may not publish pages for a server-worker extraction. The
  // server already stored them; this path only publishes reviewed candidates.
  if (lease && pageRows.length) {
    const savedPages = await supabase.from("document_extraction_pages").upsert(pageRows, {
      onConflict: "tenant_id,extraction_id,page_number", ignoreDuplicates: true,
    });
    if (savedPages.error) throw savedPages.error;
  }
  const fieldRows = Object.values(result.fields).map((field) => ({
    tenant_id: result.tenantId, extraction_id: extractionId, field_key: field.key,
    raw_value: field.rawValue, normalized_value: field.normalizedValue,
    confidence: field.confidence, source_page: field.sourcePage,
    source_box: (field.sourceBox || null) as unknown as Json,
    extraction_method: field.method, validation_status: field.validation,
  }));
  if (fieldRows.length) {
    const savedFields = await supabase.from("document_extraction_fields").upsert(fieldRows, {
      onConflict: "tenant_id,extraction_id,field_key", ignoreDuplicates: true,
    });
    if (savedFields.error) throw savedFields.error;
  }
  const metrics = { ...result.timings, documentTypeConfidence: result.documentTypeConfidence, matchingStatus: result.matchingStatus,
    ocrEngine: result.ocrEngine, ocrModelVersion: result.ocrModelVersion, parserVersion: result.parserVersion, profileVersion: result.profileVersion };
  const changes = {
    status: result.status,
    document_type: result.documentType, detected_language: result.language,
    overall_confidence: result.overallConfidence,
    ai_used: result.aiUsed, issues: result.issues as unknown as Json,
    matches: result.matches as unknown as Json, processing_metrics: metrics,
    error_code: null,
    ...(lease ? { extraction_method: result.method, raw_text: result.rawText.slice(0, 1000000), page_count: result.pages.length } : {}),
  };
  let finishing = supabase.from("document_extractions").update(changes)
    .eq("tenant_id", result.tenantId).eq("id", extractionId);
  finishing = lease ? finishing.eq("lease_token", lease) : finishing.eq("status", "extracted");
  const finished = await finishing.select("id").single();
  if (finished.error || !finished.data) throw finished.error || new Error("DOCUMENT_PROCESSING_LEASE_LOST");
}

export async function markDocumentExtractionFailed(tenantId: string, extractionId: string, lease: string, code: string): Promise<void> {
  const safeCode = /^[A-Z0-9_]{1,80}$/.test(code) ? code : "DOCUMENT_PROCESSING_FAILED";
  const { data, error } = await supabase.from("document_extractions").update({ status: "failed", error_code: safeCode })
    .eq("tenant_id", tenantId).eq("id", extractionId).eq("lease_token", lease).select("id").maybeSingle();
  if (error || !data) throw error || new Error("DOCUMENT_PROCESSING_LEASE_LOST");
}

export async function getPrivateDocumentUrl(fileId: string, tenantId: string): Promise<string> {
  await assertCurrentTenant(tenantId);
  const { data, error } = await supabase.from("document_files").select("storage_bucket,storage_path")
    .eq("tenant_id", tenantId).eq("id", fileId).single();
  if (error) throw error;
  const signed = await supabase.storage.from(data.storage_bucket).createSignedUrl(data.storage_path, 5 * 60);
  if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("DOCUMENT_SIGNED_URL_FAILED");
  return signed.data.signedUrl;
}

export async function getDocumentAttachment(fileId: string, tenantId: string) {
  await assertCurrentTenant(tenantId);
  const { data, error } = await supabase.from("document_files")
    .select("storage_bucket,storage_path,original_file_name,mime_type,byte_size")
    .eq("tenant_id", tenantId).eq("id", fileId).single();
  if (error) throw error;
  return { bucket: data.storage_bucket, path: data.storage_path, file_name: data.original_file_name, mime_type: data.mime_type, size: data.byte_size };
}

export async function linkDocumentFile(input: { tenantId: string; fileId: string; entityType: string; entityId: string }): Promise<void> {
  await assertCurrentTenant(input.tenantId);
  const { error } = await supabase.from("document_links").upsert({
    tenant_id: input.tenantId, file_id: input.fileId, entity_type: input.entityType, entity_id: input.entityId,
  }, { onConflict: "tenant_id,file_id,entity_type,entity_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function verifyDocumentFields(input: {
  tenantId: string; extractionId: string;
  reviews: Array<{ key: string; status: "accepted" | "corrected" | "rejected"; value: string | null }>;
}): Promise<void> {
  await assertCurrentTenant(input.tenantId);
  const { error } = await supabase.rpc("document_verify_review", {
    p_extraction_id: input.extractionId, p_reviews: input.reviews as unknown as Json,
  });
  if (error) throw error;
}
