import { extractFromFile, type ExtractSchema } from "@/lib/aiExtract";
import { isDocumentWorkerEnabled } from "./config";
import { DocumentFileError, sha256File, validateDocumentFile, type SupportedDocumentMime } from "./fileSafety";
import { overallDocumentConfidence } from "./confidence";
import { matchExtractedEntities } from "./matching";
import { openDocumentPdf, extractNativePdfPage, hasPageSizedPdfImage, mergeNativeAndOcrPage, renderPdfPageForOcr } from "./nativePdf";
import { createBrowserOcrProvider, imageDimensions, type OcrProvider } from "./ocr";
import { normalizeCandidate, parseDocumentPages } from "./parsers";
import { extractPurchaseLineItems } from "./lineItems";
import { withDocumentDeadline } from "./timing";
import { claimDocumentProcessing, enqueueDocumentProcessing, loadDocumentExtraction, markDocumentExtractionFailed, registerDocumentFile, scopeForDocument, persistDocumentExtraction } from "./persistence";
import { DEFAULT_EXTRACTION_POLICY, type DocumentExtractionResult, type DocumentPage, type DocumentType, type ExtractionIssue, type ExtractionPolicy, type ExtractionProgress } from "./types";

export interface DocumentEngineOptions {
  tenantId: string;
  expectedType?: DocumentType;
  policy?: Partial<ExtractionPolicy>;
  onProgress?: (progress: ExtractionProgress) => void;
  signal?: AbortSignal;
  /** Dependency injection for deterministic golden tests; production uses the browser WASM worker. */
  ocrFactory?: () => Promise<OcrProvider>;
  match?: typeof matchExtractedEntities;
  aiFallback?: (file: File, schema: ExtractSchema) => Promise<Record<string, string>>;
}

const inFlight = new Map<string, Promise<DocumentExtractionResult>>();

function addClaimCompletenessWarning(result: DocumentExtractionResult, expected?: DocumentType): void {
  if (expected !== "insurance_claim") return;
  const missing = ["claim_number", "insurance_company", "plate_number", "accident_date"]
    .filter((key) => !result.fields[key] || result.fields[key].validation !== "valid");
  if (missing.length) result.issues.push({ code: "CLAIM_CRITICAL_FIELDS_MISSING", severity: "warning",
    message: `Critical claim fields need manual review: ${missing.join(", ")}.` });
}

function elapsed(start: number): number { return Math.round(performance.now() - start); }
function assertActive(signal?: AbortSignal) { if (signal?.aborted) throw new DocumentFileError("DOCUMENT_PROCESSING_CANCELLED", "Document processing was cancelled."); }

function aiSchema(type?: DocumentType): ExtractSchema | null {
  if (type === "vehicle_registration") return "vehicle_customer";
  if (["insurance_claim", "insurance_approval", "lpo", "damage_report"].includes(type || "")) return "insurance_claim";
  if (["expense_receipt", "supplier_invoice", "purchase_invoice"].includes(type || "")) return "expense_receipt";
  return null;
}

function aiKeyToEngineKey(key: string): string {
  return ({ customer_name: "owner_name", customer_phone: "owner_phone", plate: "plate_number", incident_date: "accident_date", estimated_cost: "approved_amount" } as Record<string, string>)[key] || key;
}

const AI_ALLOWED_FIELDS = new Set([
  "owner_name", "owner_phone", "plate_number", "plate_letters", "plate_country", "vin", "make", "model", "year", "color",
  "claim_number", "insurance_company", "accident_date", "approved_amount", "supplier_name", "supplier_vatin",
  "invoice_number", "invoice_date", "subtotal", "vat", "total",
]);

async function addOptionalAiFallback(
  file: File, result: DocumentExtractionResult, options: DocumentEngineOptions, policy: ExtractionPolicy,
): Promise<void> {
  if (!policy.allowAiFallback || result.overallConfidence >= policy.aiFallbackBelow) return;
  const schema = aiSchema(options.expectedType || result.documentType);
  if (!schema) return;
  result.aiUsed = true;
  result.issues.push({ code: "EXTERNAL_AI_USED", severity: "info", message: "An external AI provider was used after native/OCR extraction." });
  try {
    const data = await (options.aiFallback || extractFromFile)(file, schema);
    for (const [rawKey, rawValue] of Object.entries(data)) {
      const key = aiKeyToEngineKey(rawKey);
      if (!AI_ALLOWED_FIELDS.has(key)) continue;
      if (!rawValue?.trim() || result.fields[key]?.confidence >= policy.mediumConfidence) continue;
      const normalized = normalizeCandidate(key, rawValue);
      result.fields[key] = {
        key, rawValue, normalizedValue: normalized.value, confidence: normalized.valid ? 0.62 : 0.3,
        sourcePage: 1, method: "ai", validation: normalized.valid ? "valid" : "warning",
        evidence: ["external_ai_unverified"],
      };
    }
    result.method = "ai";
  } catch {
    result.issues.push({ code: "AI_FALLBACK_FAILED", severity: "warning", message: "External AI could not extract this document. Review manually; no data was saved to a business record." });
  }
}

export async function processDocumentLocally(
  file: File, mimeType: SupportedDocumentMime, sha256: string, options: DocumentEngineOptions,
): Promise<DocumentExtractionResult> {
  const policy = { ...DEFAULT_EXTRACTION_POLICY, ...options.policy };
  const started = performance.now();
  const pages: DocumentPage[] = [];
  const issues: ExtractionIssue[] = [];
  let ocrPromise: Promise<OcrProvider> | undefined;
  let ocrClosed = false;
  let nativeMs = 0;
  let ocrMs = 0;
  // Cache a rejected initialization too: a missing model must not trigger a
  // second download/worker start for every page in a multi-page scan.
  const closeOcr = async () => {
    if (!ocrPromise || ocrClosed) return;
    ocrClosed = true;
    try { await (await ocrPromise).close(); }
    catch { /* Preserve the extraction error; worker startup may itself have failed. */ }
  };
  const onAbort = () => { void closeOcr(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const getOcr = async () => {
    assertActive(options.signal);
    ocrPromise ||= (options.ocrFactory || createBrowserOcrProvider)();
    const worker = await ocrPromise;
    if (options.signal?.aborted) {
      await closeOcr();
      assertActive(options.signal);
    }
    return worker;
  };
  try {
    if (mimeType === "application/pdf") {
      const pdf = await openDocumentPdf(file, policy.maxPdfPages);
      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          assertActive(options.signal);
          options.onProgress?.({ stage: "native", page: pageNumber, totalPages: pdf.numPages });
          const pageStart = performance.now();
          const page = await pdf.getPage(pageNumber);
          const native = await extractNativePdfPage(page, pageNumber);
          nativeMs += elapsed(pageStart);
          const enoughNativeText = native.text.replace(/\s/g, "").length >= policy.nativeMinCharacters;
          let pageSizedImage = false;
          if (enoughNativeText) {
            try { pageSizedImage = await hasPageSizedPdfImage(page); }
            catch { pageSizedImage = true; } // OCR is safer than assuming a partially parsed PDF is complete.
          }
          if (enoughNativeText && !pageSizedImage) {
            pages.push(native);
          } else {
            const ocrStart = performance.now();
            options.onProgress?.({ stage: "ocr", page: pageNumber, totalPages: pdf.numPages, percent: 0 });
            try {
              const rendered = await renderPdfPageForOcr(page);
              const worker = await getOcr();
              const recognized = await worker.recognize({ blob: rendered.blob, page: pageNumber, width: rendered.width, height: rendered.height },
                (percent) => options.onProgress?.({ stage: "ocr", page: pageNumber, totalPages: pdf.numPages, percent }));
              pages.push(recognized.text.trim() ? mergeNativeAndOcrPage(native, recognized) : native);
              if (!recognized.text.trim()) issues.push({ code: "OCR_NO_TEXT", severity: "warning", message: `Page ${pageNumber} has no readable text.` });
            } catch {
              pages.push(native);
              issues.push({ code: "OCR_FAILED", severity: "warning", message: `OCR failed on page ${pageNumber}; review this page manually.` });
            }
            ocrMs += elapsed(ocrStart);
          }
          page.cleanup();
        }
      } finally { await pdf.destroy(); }
    } else {
      const ocrStart = performance.now();
      options.onProgress?.({ stage: "ocr", page: 1, totalPages: 1, percent: 0 });
      const dimensions = await imageDimensions(file);
      try {
        const worker = await getOcr();
        pages.push(await worker.recognize({ blob: file, page: 1, ...dimensions },
          (percent) => options.onProgress?.({ stage: "ocr", page: 1, totalPages: 1, percent })));
      } catch {
        pages.push({ number: 1, text: "", method: "ocr", confidence: 0, ...dimensions });
        issues.push({ code: "OCR_FAILED", severity: "warning", message: "OCR failed; review the image manually." });
      }
      ocrMs = elapsed(ocrStart);
    }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    await closeOcr();
  }

  assertActive(options.signal);
  options.onProgress?.({ stage: "parsing" });
  const parseStart = performance.now();
  const parsed = parseDocumentPages(pages, options.expectedType);
  const purchaseLines = options.expectedType === "purchase_invoice" ? extractPurchaseLineItems(pages) : null;
  const parseMs = elapsed(parseStart);
  const rawText = pages.map((page) => page.text).join("\n\f\n");
  const method = pages.some((page) => page.method === "ocr") ? "ocr" : "native_pdf";
  const result: DocumentExtractionResult = {
    tenantId: options.tenantId, sha256, fileName: file.name, mimeType,
    documentType: parsed.type, documentTypeConfidence: parsed.typeConfidence,
    language: parsed.language, method, rawText, pages, fields: { ...parsed.fields, ...purchaseLines?.fields },
    issues: [...issues, ...parsed.issues, ...(purchaseLines?.issues || [])], matches: [], matchingStatus: "skipped",
    overallConfidence: 0, needsReview: true, status: "needs_review", aiUsed: false,
    timings: { nativeMs, ocrMs, parseMs, matchMs: 0, totalMs: 0 },
    ocrEngine: method === "ocr" ? "tesseract.js" : "pdfjs-native",
    ocrModelVersion: method === "ocr" ? "ara+eng" : "pdf-text-layer",
    parserVersion: "rules-1.3", profileVersion: "default-1.0",
  };
  addClaimCompletenessWarning(result, options.expectedType);
  options.onProgress?.({ stage: "matching" });
  const matchStart = performance.now();
  try {
    const matched = await (options.match || matchExtractedEntities)(options.tenantId, result.fields);
    result.matches = matched.matches;
    result.issues.push(...matched.issues);
    result.matchingStatus = "complete";
  } catch {
    result.issues.push({ code: "DATABASE_MATCH_FAILED", severity: "warning", message: "Database matching could not be completed. Verify duplicates manually before saving." });
    result.matchingStatus = "failed";
  }
  result.timings.matchMs = elapsed(matchStart);
  result.overallConfidence = overallDocumentConfidence(result);
  await addOptionalAiFallback(file, result, options, policy);
  result.overallConfidence = overallDocumentConfidence(result);
  result.timings.totalMs = elapsed(started);
  return result;
}

async function waitForExisting(tenantId: string, extractionId: string, signal?: AbortSignal): Promise<DocumentExtractionResult> {
  for (let attempt = 0; attempt < 90; attempt++) {
    assertActive(signal);
    const result = await loadDocumentExtraction(tenantId, extractionId);
    if (["needs_review", "extracted", "verified"].includes(result.status)) return result;
    if (result.status === "failed") throw new Error("DOCUMENT_PREVIOUS_PROCESSING_FAILED_RETRY");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("DOCUMENT_PROCESSING_IN_PROGRESS_RETRY_LATER");
}

async function parseServerPages(result: DocumentExtractionResult, options: DocumentEngineOptions): Promise<DocumentExtractionResult> {
  if (result.status !== "extracted" || !result.pages.length) throw new Error("DOCUMENT_WORKER_RESULT_MISSING");
  options.onProgress?.({ stage: "parsing" });
  const parsed = parseDocumentPages(result.pages, options.expectedType);
  const purchaseLines = options.expectedType === "purchase_invoice" ? extractPurchaseLineItems(result.pages) : null;
  result.documentType = parsed.type;
  result.documentTypeConfidence = parsed.typeConfidence;
  result.language = parsed.language;
  result.fields = { ...parsed.fields, ...purchaseLines?.fields };
  result.issues.push(...parsed.issues, ...(purchaseLines?.issues || []));
  addClaimCompletenessWarning(result, options.expectedType);
  result.parserVersion = "rules-1.3";
  result.profileVersion = "default-1.0";
  options.onProgress?.({ stage: "matching" });
  try {
    const matched = await (options.match || matchExtractedEntities)(options.tenantId, result.fields);
    result.matches = matched.matches;
    result.issues.push(...matched.issues);
    result.matchingStatus = "complete";
  } catch {
    result.matchingStatus = "failed";
    result.issues.push({ code: "DATABASE_MATCH_FAILED", severity: "warning", message: "Review duplicates manually; matching is unavailable." });
  }
  result.overallConfidence = overallDocumentConfidence(result);
  result.needsReview = true;
  result.status = "needs_review";
  options.onProgress?.({ stage: "saving" });
  await persistDocumentExtraction(result); // server OCR text/pages remain immutable
  return result;
}

export async function extractAndPersistDocument(file: File, options: DocumentEngineOptions): Promise<DocumentExtractionResult> {
  options.onProgress?.({ stage: "validating" });
  const mimeType = await validateDocumentFile(file, options.policy?.maxFileBytes);
  // The local WASM provider is a useful compatibility baseline, not an
  // acceptable Arabic-claim or purchase-table engine. Never silently degrade
  // these reviewed workflows to its known lower-accuracy path.
  if (["insurance_claim", "insurance_approval", "lpo", "purchase_invoice"].includes(options.expectedType || "") &&
      !isDocumentWorkerEnabled() && !options.ocrFactory) {
    throw new DocumentFileError("DOCUMENT_WORKER_REQUIRED", "Document worker is required for this extraction.");
  }
  const sha256 = await sha256File(file);
  const scope = scopeForDocument(options.expectedType);
  const key = `${options.tenantId}:${scope}:${sha256}`;
  const previous = inFlight.get(key);
  if (previous) return previous;
  const task = (async () => {
    options.onProgress?.({ stage: "uploading" });
    const registered = await registerDocumentFile({ tenantId: options.tenantId, file, sha256, mimeType, scope });
    if (isDocumentWorkerEnabled() && !options.ocrFactory) {
      const queued = await enqueueDocumentProcessing(registered.id);
      options.onProgress?.({ stage: "ocr" });
      const remote = await waitForExisting(options.tenantId, queued.extractionId, options.signal);
      const result = remote.status === "extracted" ? await parseServerPages(remote, options) : remote;
      options.onProgress?.({ stage: "done" });
      return result;
    }
    const claimed = await claimDocumentProcessing(registered.id);
    if (!claimed.acquired) {
      const existing = await waitForExisting(options.tenantId, claimed.extractionId, options.signal);
      options.onProgress?.({ stage: "done" });
      return existing;
    }
    try {
      const result = await withDocumentDeadline(
        (signal) => processDocumentLocally(file, mimeType, sha256, { ...options, signal }),
        options.policy?.maxProcessingMs ?? DEFAULT_EXTRACTION_POLICY.maxProcessingMs,
        options.signal,
      );
      result.fileId = registered.id;
      result.extractionId = claimed.extractionId;
      options.onProgress?.({ stage: "saving" });
      await persistDocumentExtraction(result, claimed.lease);
      options.onProgress?.({ stage: "done" });
      return result;
    } catch (error) {
      const code = error instanceof DocumentFileError ? error.code : (error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "DOCUMENT_PROCESSING_FAILED");
      try { await markDocumentExtractionFailed(options.tenantId, claimed.extractionId, claimed.lease, code); }
      catch { /* Original error remains actionable; file and job stay available for inspection. */ }
      throw error;
    }
  })();
  inFlight.set(key, task);
  try { return await task; }
  finally { if (inFlight.get(key) === task) inFlight.delete(key); }
}
