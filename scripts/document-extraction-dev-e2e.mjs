import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const ref = "rrhyglrnlveygyiandhs";
const url = process.env.TEMO_SUPABASE_URL;
if (url !== `https://${ref}.supabase.co`) throw new Error("DOCUMENT_E2E_DEVELOPMENT_ONLY");
const key = process.env.TEMO_SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("DOCUMENT_E2E_DEV_SERVICE_KEY_REQUIRED");
const dataset = process.env.TEMO_OCR_DATASET || join(tmpdir(), "temo-ocr-golden-synthetic-1");
const manifest = JSON.parse(await readFile(join(dataset, "manifest.json"), "utf8"));
if (!manifest.sanitized || !manifest.version?.startsWith("synthetic-")) throw new Error("DOCUMENT_E2E_SYNTHETIC_ONLY");
const bytes = await readFile(join(dataset, "arabic_claim.png"));
const pdfBytes = await readFile(join(dataset, "approval_multipage.pdf"));
const purchaseBytes = await readFile(join(dataset, "parts_table.png"));
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const tenantId = randomUUID();
const email = `temo-ocr-${randomUUID()}@example.invalid`;
const password = randomBytes(24).toString("base64url");
let userId = null;
let browser = null;
let cleanupFailure = null;
try {
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { tenant_id: tenantId, company_name: "TEMO OCR synthetic tenant", full_name: "Synthetic OCR Tester", role: "admin" },
  });
  if (created.error || !created.data.user) throw new Error("DOCUMENT_E2E_DEV_AUTH_CREATE_FAILED");
  userId = created.data.user.id;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${process.env.DOCUMENT_SMOKE_URL || "http://127.0.0.1:4174"}/src/test/fixtures/document-engine-harness.html`);
  const outcome = await page.evaluate(async (input) => {
    const { supabase } = await import("/src/integrations/supabase/client.ts");
    const { extractAndPersistDocument } = await import("/src/lib/documentExtraction/engine.ts");
    const { defaultReviewSelection, buildAutofillPayload } = await import("/src/lib/documentExtraction/autofill.ts");
    const { reviewedPurchaseLineItems } = await import("/src/lib/documentExtraction/lineItems.ts");
    const { verifyDocumentFields, loadDocumentExtraction } = await import("/src/lib/documentExtraction/persistence.ts");
    const login = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
    if (login.error) throw new Error("DOCUMENT_E2E_DEV_LOGIN_FAILED");
    const file = new File([new Uint8Array(input.bytes)], "arabic_claim.png", { type: "image/png" });
    const progress = [];
    const result = await extractAndPersistDocument(file, {
      tenantId: input.tenantId, expectedType: "insurance_claim", policy: { allowAiFallback: false },
      onProgress: (value) => progress.push(value.stage),
    });
    const selectedByDefault = defaultReviewSelection(result);
    const required = ["claim_number", "insurance_company", "plate_number", "accident_date"];
    if (required.some((key) => !result.fields[key] || result.fields[key].validation !== "valid")) {
      throw new Error("DOCUMENT_E2E_WORKER_FIELDS_MISSING");
    }
    if (selectedByDefault.claim_number || selectedByDefault.plate_number) {
      throw new Error("DOCUMENT_E2E_CRITICAL_FIELD_AUTO_SELECTED");
    }
    const reviews = Object.values(result.fields).map((field) => ({
      key: field.key,
      status: required.includes(field.key) ? "accepted" : "rejected",
      value: required.includes(field.key) ? field.normalizedValue : null,
    }));
    await verifyDocumentFields({ tenantId: input.tenantId, extractionId: result.extractionId, reviews });
    const verified = await loadDocumentExtraction(input.tenantId, result.extractionId);
    if (verified.status !== "verified") throw new Error("DOCUMENT_E2E_REVIEW_NOT_SAVED");
    const repeated = await extractAndPersistDocument(file, {
      tenantId: input.tenantId, expectedType: "insurance_claim", policy: { allowAiFallback: false },
    });
    if (repeated.extractionId !== result.extractionId || repeated.status !== "verified") {
      throw new Error("DOCUMENT_E2E_DUPLICATE_EXTRACTION");
    }
    let wrongTenantDenied = false;
    try {
      await extractAndPersistDocument(file, {
        tenantId: crypto.randomUUID(), expectedType: "insurance_claim", policy: { allowAiFallback: false },
      });
    } catch { wrongTenantDenied = true; }
    if (!wrongTenantDenied) throw new Error("DOCUMENT_E2E_TENANT_ISOLATION_FAILED");
    const selected = Object.fromEntries(reviews.map((review) => [review.key, review.value]));
    const form = buildAutofillPayload(verified, "insurance_claim", selected);
    const purchaseFile = new File([new Uint8Array(input.purchaseBytes)], "parts_table.png", { type: "image/png" });
    const purchase = await extractAndPersistDocument(purchaseFile, {
      tenantId: input.tenantId, expectedType: "purchase_invoice", policy: { allowAiFallback: false },
    });
    const lineKeys = Object.keys(purchase.fields).filter((key) => /^line_item_\d+_/.test(key));
    if (purchase.ocrEngine !== "paddleocr" || lineKeys.length !== 8 ||
        Object.values(defaultReviewSelection(purchase)).some((selected, index) =>
          selected && /^line_item_/.test(Object.keys(purchase.fields)[index]))) {
      throw new Error("DOCUMENT_E2E_PURCHASE_LINES_MISSING_OR_PRESELECTED");
    }
    const purchaseReviews = Object.values(purchase.fields).map((field) => ({
      key: field.key, status: lineKeys.includes(field.key) || ["invoice_number", "total"].includes(field.key) ? "accepted" : "rejected",
      value: lineKeys.includes(field.key) || ["invoice_number", "total"].includes(field.key) ? field.normalizedValue : null,
    }));
    await verifyDocumentFields({ tenantId: input.tenantId, extractionId: purchase.extractionId, reviews: purchaseReviews });
    const purchaseVerified = await loadDocumentExtraction(input.tenantId, purchase.extractionId);
    const purchasePayload = buildAutofillPayload(purchaseVerified, "purchase_invoice",
      Object.fromEntries(purchaseReviews.map((review) => [review.key, review.value])));
    const purchaseItems = reviewedPurchaseLineItems(purchasePayload);
    return { status: verified.status, engine: result.ocrEngine, aiUsed: result.aiUsed,
      extractionId: result.extractionId, fields: result.fields,
      form, progress, pageCount: result.pages.length, duplicateBlocked: true, wrongTenantDenied,
      purchase: { status: purchaseVerified.status, engine: purchase.ocrEngine, invoiceNumber: purchasePayload.invoice_number,
        total: purchasePayload.total, items: purchaseItems } };
  }, { email, password, tenantId, bytes: [...bytes], purchaseBytes: [...purchaseBytes] });
  const expected = { claim_number: "C/004/01/26/9999/00001", insurance_company: "شركة تجريبية", plate: "47782" };
  if (outcome.status !== "verified" || outcome.engine !== "paddleocr" || outcome.aiUsed ||
      outcome.pageCount !== 1 || !outcome.progress.includes("uploading") || !outcome.progress.includes("saving") ||
      outcome.form.claim_number !== expected.claim_number || outcome.form.insurance_company !== expected.insurance_company ||
      outcome.form.incident_date !== "2026-04-27" ||
      !outcome.form.plate?.includes(expected.plate) || !outcome.duplicateBlocked || !outcome.wrongTenantDenied || pageErrors.length) {
    throw new Error("DOCUMENT_E2E_FORM_HANDOFF_FAILED");
  }
  if (outcome.purchase.status !== "verified" || outcome.purchase.engine !== "paddleocr" ||
      outcome.purchase.invoiceNumber !== "DEMO-88" || outcome.purchase.total !== "47.250" ||
      !outcome.purchase.items.valid || outcome.purchase.items.items.length !== 2 ||
      outcome.purchase.items.items[0].name !== "Oil Filter" || outcome.purchase.items.items[1].name !== "Brake Pads") {
    throw new Error("DOCUMENT_E2E_PURCHASE_REVIEW_HANDOFF_FAILED");
  }
  // Exercise the actual routed forms and review dialog, without pressing a
  // business Save button. Both documents are already verified, so upload is
  // deduplicated and the worker receives no additional job.
  const base = process.env.DOCUMENT_SMOKE_URL || "http://127.0.0.1:4174";
  await page.goto(`${base}/insurance/new`);
  await page.getByRole("button", { name: "رفع PDF أو صورة" }).waitFor({ timeout: 30_000 });
  await page.locator('input[type="file"][accept="image/*,application/pdf"]').first()
    .setInputFiles({ name: "arabic_claim.png", mimeType: "image/png", buffer: bytes });
  await page.getByRole("dialog").getByText("مراجعة البيانات المستخرجة").waitFor({ timeout: 30_000 });
  await page.getByRole("dialog").getByRole("button", { name: "تحقق وعبئ النموذج فقط" }).click();
  await page.waitForFunction(() => document.querySelector('input[placeholder="من شركة التأمين أو ولّد رقماً مؤقتاً"]')?.value === "C/004/01/26/9999/00001");
  const claimUi = await page.locator('input[placeholder="من شركة التأمين أو ولّد رقماً مؤقتاً"]').inputValue();
  if (claimUi !== expected.claim_number || pageErrors.length) throw new Error("DOCUMENT_E2E_CLAIM_FORM_UI_FAILED");

  // The same upload control must accept a real, multi-page PDF and expose
  // fields from its second page for review without saving a business record.
  await page.locator('input[type="file"][accept="image/*,application/pdf"]').first()
    .setInputFiles({ name: "approval_multipage.pdf", mimeType: "application/pdf", buffer: pdfBytes });
  const pdfReview = page.getByRole("dialog").filter({ hasText: "مراجعة البيانات المستخرجة" });
  await pdfReview.waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] input')]
    .some((input) => input.value === "DEMO-LPO-12"), null, { timeout: 120_000 });
  const pdfFields = await pdfReview.locator("input").evaluateAll((inputs) => inputs.map((input) => input.value));
  if (!pdfFields.includes(expected.claim_number) || !pdfFields.includes("150.000") || pageErrors.length) {
    throw new Error("DOCUMENT_E2E_MULTIPAGE_PDF_REVIEW_FAILED");
  }
  await pdfReview.getByRole("button", { name: "إلغاء دون تطبيق" }).click();

  await page.getByRole("button", { name: "مسح بالكاميرا" }).click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]')
    .setInputFiles({ name: "arabic_claim.png", mimeType: "image/png", buffer: bytes });
  await page.getByRole("button", { name: "اعتماد الصفحة" }).waitFor();
  await page.getByRole("button", { name: "الأصلي", exact: true }).click();
  await page.getByRole("button", { name: "اعتماد الصفحة" }).click();
  await page.getByRole("button", { name: "استخراج إلى النموذج" }).click();
  const scanReview = page.getByRole("dialog").filter({ hasText: "مراجعة البيانات المستخرجة" });
  await scanReview.waitFor({ timeout: 120_000 });
  await scanReview.getByText("رقم المطالبة", { exact: true }).waitFor();
  await scanReview.locator("label").filter({ hasText: "رقم المطالبة" }).getByRole("checkbox").click();
  await scanReview.getByRole("button", { name: "تحقق وعبئ النموذج فقط" }).click();
  await page.waitForFunction(() => document.querySelector('input[placeholder="من شركة التأمين أو ولّد رقماً مؤقتاً"]')?.value === "C/004/01/26/9999/00001");
  if (pageErrors.length) throw new Error("DOCUMENT_E2E_SCANNER_FORM_UI_FAILED");

  const purchasePage = await context.newPage();
  purchasePage.on("pageerror", (error) => pageErrors.push(error.message));
  await purchasePage.goto(`${base}/inventory/purchase-invoices`);
  await purchasePage.getByRole("button", { name: "فاتورة شراء جديدة" }).click();
  await purchasePage.locator('input[type="file"][accept="image/*,application/pdf"]').first()
    .setInputFiles({ name: "parts_table.png", mimeType: "image/png", buffer: purchaseBytes });
  await purchasePage.getByRole("dialog").getByText("مراجعة البيانات المستخرجة").waitFor({ timeout: 30_000 });
  await purchasePage.getByRole("dialog").getByRole("button", { name: "تحقق وعبئ النموذج فقط" }).click();
  await purchasePage.waitForFunction(() => {
    const values = [...document.querySelectorAll("input")].map((element) => element.value);
    return values.includes("Oil Filter") && values.includes("Brake Pads");
  });
  if (pageErrors.length) throw new Error("DOCUMENT_E2E_PURCHASE_FORM_UI_FAILED");
  process.stdout.write(JSON.stringify({ development_browser_e2e: "PASS", upload: "PASS", worker: outcome.engine,
    review_rpc: "PASS", apply_to_form: "PASS", critical_fields_auto_selected: false,
    claim_form_ui: "PASS", multipage_pdf_review: "PASS", scanner_to_worker_form: "PASS", purchase_form_ui: "PASS", purchase_lines: "2/2 reviewed",
    no_external_ai: true, duplicate_blocked: true,
    wrong_tenant_denied: true, page_errors: pageErrors.length }) + "\n");
} finally {
  if (browser) await browser.close();
  try {
    // Only rows belonging to the uniquely generated synthetic tenant are removed.
    const files = await admin.from("document_files").select("id,storage_path").eq("tenant_id", tenantId);
    if (files.error) throw files.error;
    for (const file of files.data || []) {
      const extractions = await admin.from("document_extractions").select("id").eq("tenant_id", tenantId).eq("file_id", file.id);
      if (extractions.error) throw extractions.error;
      for (const extraction of extractions.data || []) {
        for (const table of ["document_extraction_events", "document_extraction_fields", "document_extraction_pages"]) {
          const removed = await admin.from(table).delete().eq("tenant_id", tenantId).eq("extraction_id", extraction.id);
          if (removed.error) throw removed.error;
        }
        const removed = await admin.from("document_extractions").delete().eq("tenant_id", tenantId).eq("id", extraction.id);
        if (removed.error) throw removed.error;
      }
      const object = await admin.storage.from("temo-documents").remove([file.storage_path]);
      if (object.error) throw object.error;
      const removed = await admin.from("document_files").delete().eq("tenant_id", tenantId).eq("id", file.id);
      if (removed.error) throw removed.error;
    }
    if (userId) {
      const settings = await admin.from("tenant_settings").delete().eq("tenant_id", tenantId);
      if (settings.error) throw settings.error;
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) throw removed.error;
    }
    const tenant = await admin.from("tenants").delete().eq("id", tenantId);
    if (tenant.error) throw tenant.error;
    process.stdout.write("Development synthetic fixture cleanup: PASS\n");
  } catch {
    cleanupFailure = new Error("DOCUMENT_E2E_CLEANUP_FAILED");
  }
  if (cleanupFailure) throw cleanupFailure;
}
