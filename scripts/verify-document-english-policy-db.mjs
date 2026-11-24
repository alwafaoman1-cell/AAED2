// Local PostgreSQL/WASM verification only. No hosted project or credentials.
// Uses the actual document tables, RLS policies, triggers and RPC bodies.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { PGlite } = await import(pathToFileURL(path.join(root, "output/workflow-requirements-db-runtime/node_modules/@electric-sql/pglite/dist/index.js")).href);
const db = await PGlite.create();
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const version = "1.0.7-en-worker";
const legacy = Array.from({ length: 7 }, (_, index) => `1.0.${index}-worker`);
const checks = [];
const sources = {};
const output = path.join(root, "output/ocr-english-development-2026-11-24/database.json");
const read = name => fs.readFile(path.join(root, "supabase/migrations", name), "utf8");
async function check(name, action) { await action(); checks.push({ name, passed: true }); console.log("PASS", name); }
async function fails(sql, values, expression) { await assert.rejects(db.query(sql, values), expression); }
async function actor(number = 1) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id(number)}',false); select set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`);
}
async function worker() {
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','',false); set role temo_document_worker;");
}
async function enqueue(file, engine) {
  return (await db.query("select * from public.document_enqueue_processing($1,$2)", [file, engine])).rows[0];
}
async function snapshot() {
  await db.exec("reset role");
  return (await db.query(`select jsonb_build_object(
    'extraction',(select to_jsonb(e) from public.document_extractions e where id=$1),
    'fields',(select jsonb_agg(to_jsonb(f) order by f.id) from public.document_extraction_fields f where extraction_id=$1),
    'pages',(select jsonb_agg(to_jsonb(p) order by p.id) from public.document_extraction_pages p where extraction_id=$1)) as value`, [id(401)])).rows[0].value;
}

let failure;
try {
  sources.foundation = await read("20261013120000_document_extraction_engine.sql");
  sources.safety = await read("20261013121000_document_extraction_processing_safety.sql");
  sources.queue = await read("20261014100000_document_worker_queue.sql");
  sources.roles = await read("20261018100000_document_worker_production_scope.sql");
  sources.previous = await read("20261021075356_document_vehicle_entry_gate_pass_detection.sql");
  sources.english = await read("20261124102637_document_english_only_extraction_policy.sql");
  // Minimal Supabase Auth/profile support. These helpers derive identity from
  // the current test JWT subject; business guards below are not stubbed.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create type public.app_role as enum('admin','manager','insurance','supervisor','accountant','technician','customer');
    create table public.tenants(id uuid primary key);
    create table public.profiles(user_id uuid primary key,tenant_id uuid not null,role public.app_role not null);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create function public.get_user_tenant_id() returns uuid language sql stable security definer set search_path='' as $$select tenant_id from public.profiles where user_id=auth.uid()$$;
    create function public.get_user_role() returns public.app_role language sql stable security definer set search_path='' as $$select role from public.profiles where user_id=auth.uid()$$;
    grant usage on schema public,auth to authenticated,anon;
    insert into public.tenants values('${id(101)}'),('${id(102)}');
    insert into public.profiles values('${id(1)}','${id(101)}','admin'),('${id(2)}','${id(102)}','admin'),('${id(3)}','${id(101)}','technician');
  `);
  // Everything before Storage provisioning is the original complete document
  // foundation: real tables, prepare/audit functions, triggers, RLS and grants.
  await db.exec(sources.foundation.split("insert into storage.buckets")[0]);
  await db.exec(sources.safety);
  await db.exec(`select set_config('request.jwt.claim.sub','${id(1)}',false); select set_config('request.jwt.claim.role','authenticated',false);`);
  await db.query(`insert into public.document_files(id,tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path,uploaded_by)
    values($1,$2,$3,'synthetic-old.png','image/png',100,'operational','temo-documents',$4,$5)`,
  [id(301), id(101), "a".repeat(64), `${id(101)}/operational/${"a".repeat(64)}.png`, id(1)]);
  await db.query(`insert into public.document_files(id,tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path,uploaded_by)
    values($1,$2,$3,'synthetic-other.png','image/png',100,'operational','temo-documents',$4,$5)`,
  [id(302), id(102), "b".repeat(64), `${id(102)}/operational/${"b".repeat(64)}.png`, id(2)]);
  // Pre-existing verified evidence is seeded before the worker guards are
  // installed. All actual new-version operations run with every guard active.
  await db.query(`insert into public.document_extractions(id,tenant_id,file_id,engine_version,status,raw_text,page_count,extraction_method)
    values($1,$2,$3,'1.0.6-worker','processing','ORIGINAL ARCHIVED EVIDENCE',1,'ocr')`, [id(401), id(101), id(301)]);
  await db.query(`insert into public.document_extraction_pages(id,tenant_id,extraction_id,page_number,extraction_method,text_content,confidence)
    values($1,$2,$3,1,'ocr','ORIGINAL ARCHIVED PAGE',0.9)`, [id(501), id(101), id(401)]);
  await db.query(`insert into public.document_extraction_fields(id,tenant_id,extraction_id,field_key,raw_value,normalized_value,confidence,source_page,extraction_method,validation_status)
    values($1,$2,$3,'owner_name','بيانات سابقة محفوظة','بيانات سابقة محفوظة',0.9,1,'ocr','valid')`, [id(601), id(101), id(401)]);
  await db.query("update public.document_extractions set status='verified' where id=$1", [id(401)]);
  await db.exec(sources.queue);
  await db.exec(sources.roles);
  await db.exec("grant usage on schema auth to temo_document_worker");
  await db.exec(sources.previous);
  const historical = await snapshot();
  await actor();
  await check("the previous RPC rejects the new English-only revision", () => fails(
    "select * from public.document_enqueue_processing($1,$2)", [id(301), version], /DOCUMENT_ENGINE_VERSION_INVALID/));
  await check("the old verified revision is still returned without requeueing", async () => {
    const row = await enqueue(id(301), "1.0.6-worker");
    assert.equal(row.extraction_id, id(401)); assert.equal(row.processing_status, "verified");
  });
  await db.exec("reset role");
  await check("the additive English migration applies without rewriting historic evidence", async () => {
    await db.exec(sources.english); assert.deepEqual(await snapshot(), historical);
  });
  await actor();
  let english;
  await check("same-file English extraction creates its own queued immutable revision", async () => {
    english = await enqueue(id(301), version);
    assert.equal(english.processing_status, "queued"); assert.notEqual(english.extraction_id, id(401));
    const row = (await db.query("select * from public.document_extractions where id=$1", [english.extraction_id])).rows[0];
    assert.equal(row.engine_version, version); assert.equal(row.uploaded_by, id(1));
    assert.equal(row.raw_text, null); assert.equal(row.page_count, 0); assert.equal(row.lease_token, null);
  });
  await check("repeated enqueue returns the same English row and all legacy revisions remain supported", async () => {
    assert.equal((await enqueue(id(301), version)).extraction_id, english.extraction_id);
    for (const item of legacy) assert.ok((await enqueue(id(301), item)).extraction_id);
    const rows = (await db.query("select count(*)::integer as n from public.document_extractions where file_id=$1", [id(301)])).rows[0];
    assert.equal(rows.n, 8);
  });
  await check("unknown and null engine revisions remain rejected", async () => {
    for (const item of ["1.0.7-en-worker-forged", null]) await fails(
      "select * from public.document_enqueue_processing($1,$2)", [id(301), item], /DOCUMENT_ENGINE_VERSION_INVALID/);
  });
  await check("tenant and operational-role authorization are still canonical", async () => {
    await actor(2); await fails("select * from public.document_enqueue_processing($1,$2)", [id(301), version], /DOCUMENT_ACCESS_DENIED/);
    assert.equal((await db.query("select * from public.document_extractions where id=$1", [english.extraction_id])).rows.length, 0);
    await actor(3); await fails("select * from public.document_enqueue_processing($1,$2)", [id(301), version], /DOCUMENT_ACCESS_DENIED/);
    await actor();
  });
  await check("anonymous callers cannot execute the queue RPC", async () => {
    await db.exec("reset role; set role anon");
    await fails("select * from public.document_enqueue_processing($1,$2)", [id(301), version], /permission denied/i);
    await actor();
  });
  await check("authenticated callers cannot fabricate queue rows or worker raw results", async () => {
    await fails("insert into public.document_extractions(tenant_id,file_id,engine_version,status,raw_text) values($1,$2,$3,'extracted','forged')",
      [id(101), id(301), version], /DOCUMENT_WORKER_ENQUEUE_RPC_ONLY/);
    await fails("update public.document_extractions set raw_text='forged',status='extracted' where id=$1",
      [english.extraction_id], /DOCUMENT_WORKER_RESULT_SERVER_ONLY/);
  });
  await check("worker RLS admits English queue processing but not arbitrary unqueued files", async () => {
    await worker();
    assert.equal((await db.query("select * from public.document_files where id=$1", [id(302)])).rows.length, 0);
    const rows = (await db.query("update public.document_extractions set status='processing',lease_token=$1,attempt_count=1,processing_started_at=now() where id=$2 returning id", [id(701), english.extraction_id])).rows;
    assert.equal(rows.length, 1);
  });
  await check("the browser cannot publish worker pages even while the English job is processing", async () => {
    await actor();
    await fails("insert into public.document_extraction_pages(tenant_id,extraction_id,page_number,extraction_method,text_content,confidence) values($1,$2,1,'ocr','forged',0.9)",
      [id(101), english.extraction_id], /DOCUMENT_WORKER_PAGES_SERVER_ONLY/);
  });
  await check("worker page publication and finalization use the original RLS and transition guards", async () => {
    await worker();
    await fails("insert into public.document_extraction_pages(tenant_id,extraction_id,page_number,extraction_method,text_content,confidence) values($1,$2,1,'ocr','wrong tenant',0.9)",
      [id(102), english.extraction_id], /DOCUMENT_PAGE_INSERT_NOT_ALLOWED|row-level security/i);
    await db.query("insert into public.document_extraction_pages(tenant_id,extraction_id,page_number,extraction_method,text_content,confidence) values($1,$2,1,'ocr','Claim No: SYNTHETIC-ENGLISH',0.9)",
      [id(101), english.extraction_id]);
    assert.equal((await db.query("select * from public.document_extraction_pages where extraction_id=$1", [english.extraction_id])).rows.length, 1);
    await db.query("update public.document_extractions set status='extracted',raw_text='Claim No: SYNTHETIC-ENGLISH',page_count=1,extraction_method='ocr',lease_token=null where id=$1", [english.extraction_id]);
    assert.equal((await db.query("select status from public.document_extractions where id=$1", [english.extraction_id])).rows[0].status, "extracted");
    await fails("update public.document_extraction_pages set text_content='changed' where extraction_id=$1", [english.extraction_id], /permission denied/i);
    assert.equal((await db.query("update public.document_extractions set status='processing' where id=$1 returning id", [english.extraction_id])).rows.length, 0);
  });
  await check("old verified extraction and field edits remain blocked and original pages remain read-only", async () => {
    await actor();
    await fails("update public.document_extractions set raw_text='changed' where id=$1", [id(401)], /DOCUMENT_EXTRACTION_VERIFIED_READ_ONLY/);
    await fails("update public.document_extraction_fields set reviewed_value='changed' where id=$1", [id(601)], /DOCUMENT_VERIFIED_FIELDS_READ_ONLY/);
    await fails("update public.document_extraction_pages set text_content='changed' where id=$1", [id(501)], /permission denied/i);
    assert.deepEqual(await snapshot(), historical);
  });
  await check("new English evidence can enter review without rewriting authoritative pages", async () => {
    await actor();
    await db.query("insert into public.document_extraction_fields(tenant_id,extraction_id,field_key,raw_value,normalized_value,confidence,source_page,extraction_method,validation_status) values($1,$2,'claim_number','SYNTHETIC-ENGLISH','SYNTHETIC-ENGLISH',0.9,1,'ocr','warning')",
      [id(101), english.extraction_id]);
    await db.query("update public.document_extractions set status='needs_review',document_type='insurance_claim' where id=$1", [english.extraction_id]);
    await fails("update public.document_extractions set raw_text='changed' where id=$1", [english.extraction_id], /DOCUMENT_WORKER_RESULT_SERVER_ONLY/);
    assert.deepEqual(await snapshot(), historical);
  });
  await check("actual worker claim SQL drains supported legacy queued, retryable and expired leases without revising history", async () => {
    const workerSource = await fs.readFile(path.join(root, "services/document-ocr/worker.py"), "utf8");
    const claimBody = workerSource.split("def claim_next(")[1].split("def download(")[0];
    const queries = [...claimBody.matchAll(/connection\.execute\("""([\s\S]*?)""",/g)].map(match => match[1]);
    assert.equal(queries.length, 3);
    const finalizeBody = workerSource.split("def finalize(")[1].split("def fail_job(")[0];
    const finalizeQueries = [...finalizeBody.matchAll(/connection\.execute\("""([\s\S]*?)""",/g)].map(match => match[1]);
    assert.equal(finalizeQueries.length, 3);
    const bind = sql => { let index = 0; return sql.replace(/%s/g, () => `$${++index}`); };
    const versions = [...legacy, version];
    await actor(2);
    const live = [];
    for (const item of versions) live.push(await enqueue(id(302), item));
    await worker();
    for (const [index, item] of live.entries()) {
      if (index % 3 === 0) continue;
      await db.query(`update public.document_extractions set status='processing',lease_token=$1,attempt_count=1,
        processing_started_at=now()-interval '7 minutes' where id=$2`, [id(800 + index), item.extraction_id]);
      if (index % 3 === 1) await db.query(`update public.document_extractions set status='retryable_failed',
        lease_token=null,next_attempt_at=null where id=$1`, [item.extraction_id]);
    }
    const requested = new Set();
    for (let count = 0; count < 30; count++) {
      await db.exec("begin");
      await db.query(bind(queries[0]), [versions, 3]);
      const claimed = (await db.query(bind(queries[1]), [versions, 3])).rows[0];
      if (!claimed) { await db.exec("commit"); break; }
      assert.ok(versions.includes(claimed.engine_version));
      assert.notEqual(claimed.id, id(401));
      const lease = id(900 + count);
      await db.query(bind(queries[2]), [lease, claimed.id, claimed.tenant_id]);
      await db.exec("commit");
      const metrics = { ocrEngine: "paddleocr", ocrModelVersion: "PP-OCRv5-en-only-1.0.7", ocrMs: 10,
        processingEngineVersion: version, requestedEngineVersion: claimed.engine_version, languagePolicy: "english_only" };
      await db.query(bind(finalizeQueries[2]), ["native_pdf", "Claim No: SYNTHETIC-CUTOVER", 0,
        JSON.stringify(metrics), "[]", claimed.id, claimed.tenant_id, lease]);
      const saved = (await db.query("select engine_version,status,processing_metrics from public.document_extractions where id=$1", [claimed.id])).rows[0];
      assert.equal(saved.engine_version, claimed.engine_version); assert.equal(saved.status, "extracted");
      assert.equal(saved.processing_metrics.requestedEngineVersion, claimed.engine_version);
      requested.add(claimed.engine_version);
    }
    assert.deepEqual([...requested].sort(), [...versions].sort());
    assert.equal((await db.query(bind(queries[1]), [versions, 3])).rows.length, 0);
    assert.deepEqual(await snapshot(), historical);
  });
  await check("old clients cannot erase or forge worker policy metrics while saving legitimate parser metrics", async () => {
    await actor(2);
    const target = (await enqueue(id(302), "1.0.5-worker")).extraction_id;
    await db.query(`update public.document_extractions set status='needs_review',document_type='insurance_claim',
      processing_metrics=$1::jsonb where id=$2`, [JSON.stringify({ parserVersion: "old-client-parser", parseMs: 11,
        languagePolicy: "forged", processingEngineVersion: "forged", requestedEngineVersion: "forged", ocrMs: 999 }), target]);
    const metrics = (await db.query("select processing_metrics from public.document_extractions where id=$1", [target])).rows[0].processing_metrics;
    assert.equal(metrics.languagePolicy, "english_only"); assert.equal(metrics.processingEngineVersion, version);
    assert.equal(metrics.requestedEngineVersion, "1.0.5-worker"); assert.equal(metrics.ocrMs, 10);
    assert.equal(metrics.ocrEngine, "paddleocr"); assert.equal(metrics.ocrModelVersion, "PP-OCRv5-en-only-1.0.7");
    assert.equal(metrics.parserVersion, "old-client-parser"); assert.equal(metrics.parseMs, 11);
    assert.deepEqual(await snapshot(), historical);
  });
} catch (error) {
  failure = { message: error.message, query: error.query?.slice(0, 500) };
  console.error("FAIL", failure.message);
  if (failure.query) console.error("SQL", failure.query);
  process.exitCode = 1;
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({
    engine: "PGlite 0.6.0 (local PostgreSQL/WASM)",
    scope: "Isolated synthetic document-policy schema; no hosted connection or credentials",
    limitations: [
      "Minimal synthetic Auth/profile helpers; document business guards are actual migration bodies",
      "Foundation applied up to Storage provisioning; Storage HTTP/object behavior is outside this verifier",
      "Pre-existing verified history seeded before worker-guard installation; all new operations retain the actual guards",
      "Does not run the entire historical project migration chain, a real worker download or a deployed API",
    ],
    passed: checks.length, failed: failure ? 1 : 0, complete: !failure, checks, ...(failure ? { failure } : {}),
  }, null, 2));
  await db.close();
  if (!failure) console.log(`PASS ${checks.length} isolated English document-policy PostgreSQL checks`);
}
