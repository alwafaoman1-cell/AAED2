"""One-shot Development-only queue -> private Storage -> OCR -> DB smoke.

Requires temporary DB credentials and a Development service key in the process
environment. Uses only the generated synthetic fixture; removes its own data.
Never prints credentials, document text, identifiers, or tenant details.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import psycopg
import requests

from worker import Config, claim_next, download, finalize, process_isolated


def run() -> None:
    config = Config.from_env()  # fails closed outside the named Development project
    dataset = Path(os.environ["TEMO_OCR_DATASET"])
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    if not manifest.get("sanitized") or not manifest.get("version", "").startswith("synthetic-"):
        raise RuntimeError("DOCUMENT_E2E_SYNTHETIC_FIXTURE_REQUIRED")
    fixture = dataset / "arabic_claim.png"
    raw = fixture.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    headers = {"Authorization": f"Bearer {config.service_key}", "apikey": config.service_key}
    file_id, extraction_id, actor = (str(uuid4()) for _ in range(3))
    path = None
    object_created = False
    with psycopg.connect(config.db_dsn, autocommit=True) as connection:
        tenant = connection.execute("select id from public.tenants limit 1").fetchone()
        if not tenant:
            raise RuntimeError("DOCUMENT_E2E_DEV_TENANT_REQUIRED")
        tenant_id = str(tenant[0])
        path = f"{tenant_id}/operational/{digest}.png"
        object_url = f"{config.supabase_url}/storage/v1/object/temo-documents/{quote(path, safe='/')}"
        try:
            response = requests.post(object_url, headers={**headers, "Content-Type": "image/png"},
                                     data=raw, timeout=(5, 25), allow_redirects=False)
            if response.status_code not in (200, 201):
                raise RuntimeError("DOCUMENT_E2E_STORAGE_UPLOAD_FAILED")
            object_created = True
            with connection.transaction():
                connection.execute("select set_config('request.jwt.claim.sub', %s, true)", (actor,))
                connection.execute("""
                  insert into public.document_files
                    (id, tenant_id, sha256, original_file_name, mime_type, byte_size,
                     access_scope, storage_bucket, storage_path, uploaded_by)
                  values (%s, %s, %s, 'synthetic-arabic-claim.png', 'image/png', %s,
                          'operational', 'temo-documents', %s, %s)
                """, (file_id, tenant_id, digest, len(raw), path, actor))
                connection.execute("""
                  insert into public.document_extractions
                    (id, tenant_id, file_id, engine_version, status)
                  values (%s, %s, %s, '1.0.0-worker', 'queued')
                """, (extraction_id, tenant_id, file_id))
            job = claim_next(connection)
            if not job or str(job["id"]) != extraction_id:
                raise RuntimeError("DOCUMENT_E2E_QUEUE_CLAIM_FAILED")
            fetched = download(config, job)
            if fetched != raw:
                raise RuntimeError("DOCUMENT_E2E_STORAGE_INTEGRITY_FAILED")
            outcome, result = process_isolated(fetched, job, config.provider)
            if outcome != "success" or not isinstance(result, dict):
                raise RuntimeError("DOCUMENT_E2E_OCR_FAILED")
            finalize(connection, job, result)
            row = connection.execute("""
              select status, page_count, raw_text is not null,
                     processing_metrics->>'ocrEngine'
              from public.document_extractions where id = %s and tenant_id = %s
            """, (extraction_id, tenant_id)).fetchone()
            page_count = connection.execute("""
              select count(*) from public.document_extraction_pages
              where extraction_id = %s and tenant_id = %s
            """, (extraction_id, tenant_id)).fetchone()[0]
            if row != ("extracted", 1, True, result["engine"]) or page_count != 1:
                raise RuntimeError("DOCUMENT_E2E_RESULT_NOT_PERSISTED")
            if claim_next(connection) is not None:
                raise RuntimeError("DOCUMENT_E2E_DUPLICATE_QUEUE_CLAIM")
            print(json.dumps({"development_worker_e2e": "PASS", "private_storage": "PASS",
                              "queue_claim": "PASS", "ocr_engine": result["engine"],
                              "pages_persisted": page_count, "duplicate_claim": False}))
        finally:
            with connection.transaction():
                connection.execute("delete from public.document_extraction_events where extraction_id = %s and tenant_id = %s", (extraction_id, tenant_id))
                connection.execute("delete from public.document_extraction_fields where extraction_id = %s and tenant_id = %s", (extraction_id, tenant_id))
                connection.execute("delete from public.document_extraction_pages where extraction_id = %s and tenant_id = %s", (extraction_id, tenant_id))
                connection.execute("delete from public.document_extractions where id = %s and tenant_id = %s", (extraction_id, tenant_id))
                connection.execute("delete from public.document_files where id = %s and tenant_id = %s", (file_id, tenant_id))
            if object_created:
                removed = requests.delete(object_url, headers=headers, timeout=(5, 25), allow_redirects=False)
                if removed.status_code not in (200, 204):
                    raise RuntimeError("DOCUMENT_E2E_STORAGE_CLEANUP_FAILED")


if __name__ == "__main__":
    run()
