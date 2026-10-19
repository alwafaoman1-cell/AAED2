// Development-only worker queue smoke test. Uses a generated synthetic user,
// the disposable staging tenant, and a generated OCR fixture; cleans only its
// own file, extraction and user. No business form is saved.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ref = 'rrhyglrnlveygyiandhs';
const tenantId = '00000000-0000-4000-8000-000000005741';
const url = `https://${ref}.supabase.co`;
if (process.env.TEMO_SUPABASE_URL !== url || !process.env.TEMO_SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.TEMO_SUPABASE_ANON_KEY) {
  throw new Error('DOCUMENT_SMOKE_DEVELOPMENT_CONFIG_REQUIRED');
}

const admin = createClient(url, process.env.TEMO_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, process.env.TEMO_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
// PNG decoders ignore trailing bytes; a random nonce gives every smoke run a
// fresh hash without mutating an immutable reviewed extraction from a prior run.
const image = Buffer.concat([
  await readFile(join(tmpdir(), 'temo-ocr-golden-synthetic-1', 'arabic_claim.png')),
  Buffer.from(randomUUID()),
]);
const sha256 = createHash('sha256').update(image).digest('hex');
const storagePath = `${tenantId}/operational/${sha256}.png`;
let userId;
let fileId;
let extractionId;
let uploaded = false;
let createdFile = false;
let createdExtraction = false;
let completed = false;

try {
  const email = `temo-preview-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { tenant_id: tenantId, role: 'manager', full_name: 'Synthetic Preview OCR Tester' },
  });
  if (created.error || !created.data.user) throw new Error('DOCUMENT_SMOKE_USER_CREATE_FAILED');
  userId = created.data.user.id;

  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error('DOCUMENT_SMOKE_AUTH_FAILED');
  // The golden fixture may already have a reviewed extraction. Reuse its
  // immutable file record; never delete another run's file or review.
  const existingFile = await client.from('document_files').select('id')
    .eq('tenant_id', tenantId).eq('sha256', sha256).eq('access_scope', 'operational').maybeSingle();
  if (existingFile.error) throw new Error(`DOCUMENT_SMOKE_FILE_LOOKUP_FAILED:${existingFile.error.code}`);
  if (existingFile.data) fileId = existingFile.data.id;
  else {
    const upload = await client.storage.from('temo-documents').upload(storagePath, image,
      { contentType: 'image/png', upsert: false });
    if (upload.error) throw new Error(`DOCUMENT_SMOKE_STORAGE_UPLOAD_FAILED:${upload.error.statusCode || 'unknown'}`);
    uploaded = true;
    const inserted = await client.from('document_files').insert({
      tenant_id: tenantId, sha256, original_file_name: 'synthetic_arabic_claim.png',
      mime_type: 'image/png', byte_size: image.length, access_scope: 'operational',
      storage_bucket: 'temo-documents', storage_path: storagePath,
    }).select('id').single();
    if (inserted.error || !inserted.data) throw new Error(`DOCUMENT_SMOKE_FILE_REGISTER_FAILED:${inserted.error?.code || 'unknown'}`);
    fileId = inserted.data.id;
    createdFile = true;
  }

  const existingExtraction = await client.from('document_extractions').select('id')
    .eq('tenant_id', tenantId).eq('file_id', fileId).eq('engine_version', '1.0.2-worker').maybeSingle();
  if (existingExtraction.error) throw new Error(`DOCUMENT_SMOKE_EXTRACTION_LOOKUP_FAILED:${existingExtraction.error.code}`);
  if (existingExtraction.data) throw new Error('DOCUMENT_SMOKE_VERSION_ALREADY_USED');

  const queued = await client.rpc('document_enqueue_processing', {
    p_file_id: fileId, p_engine_version: '1.0.2-worker',
  });
  if (queued.error || !queued.data?.[0]) throw new Error(`DOCUMENT_SMOKE_ENQUEUE_FAILED:${queued.error?.code || 'unknown'}`);
  extractionId = queued.data[0].extraction_id;
  createdExtraction = true;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = await client.from('document_extractions')
      .select('status,error_code,page_count,raw_text,processing_metrics')
      .eq('tenant_id', tenantId).eq('id', extractionId).single();
    if (result.error) throw new Error(`DOCUMENT_SMOKE_RESULT_READ_FAILED:${result.error.code}`);
    if (result.data.status === 'extracted') {
      if (result.data.page_count < 1 || !result.data.raw_text?.trim()) {
        throw new Error('DOCUMENT_SMOKE_EMPTY_OCR_RESULT');
      }
      const pages = await client.from('document_extraction_pages').select('id')
        .eq('tenant_id', tenantId).eq('extraction_id', extractionId);
      if (pages.error || pages.data?.length !== result.data.page_count) {
        throw new Error('DOCUMENT_SMOKE_PAGE_COUNT_MISMATCH');
      }
      completed = true;
      console.log(JSON.stringify({ development_worker_smoke: 'PASS', queue: 'PASS',
        storage: 'PASS', authenticated_rls: 'PASS', pages: result.data.page_count,
        worker_engine: result.data.processing_metrics?.ocrEngine || 'unknown' }));
      break;
    }
    if (result.data.status === 'failed') {
      throw new Error(`DOCUMENT_SMOKE_WORKER_FAILED:${result.data.error_code || 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!completed) throw new Error('DOCUMENT_SMOKE_WORKER_TIMEOUT');
} finally {
  // Deleting test rows is restricted to the IDs created above. Never touch
  // the existing staging tenant or the invited human test account.
  if (createdExtraction && extractionId) {
    for (const table of ['document_extraction_events', 'document_extraction_fields', 'document_extraction_pages']) {
      const result = await admin.from(table).delete().eq('tenant_id', tenantId).eq('extraction_id', extractionId);
      if (result.error) throw new Error(`DOCUMENT_SMOKE_CLEANUP_FAILED:${table}`);
    }
    const removed = await admin.from('document_extractions').delete().eq('tenant_id', tenantId).eq('id', extractionId);
    if (removed.error) throw new Error('DOCUMENT_SMOKE_CLEANUP_FAILED:extraction');
  }
  if (createdFile && fileId) {
    const removed = await admin.from('document_files').delete().eq('tenant_id', tenantId).eq('id', fileId);
    if (removed.error) throw new Error('DOCUMENT_SMOKE_CLEANUP_FAILED:file');
  }
  if (uploaded) {
    const removed = await admin.storage.from('temo-documents').remove([storagePath]);
    if (removed.error) throw new Error('DOCUMENT_SMOKE_CLEANUP_FAILED:storage');
  }
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw new Error('DOCUMENT_SMOKE_CLEANUP_FAILED:user');
  }
  console.log('Development synthetic smoke cleanup: PASS');
}
