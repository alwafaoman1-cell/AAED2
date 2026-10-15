"""Private Supabase Development OCR queue consumer.

Deploy separately from Vercel/Edge. Run one instance or more: PostgreSQL
SKIP LOCKED prevents two workers from claiming the same extraction. Secrets are
read only from the server environment, never returned to TEMO or logged.
"""
from __future__ import annotations

import json
import multiprocessing as mp
import os
import sys
import time
from dataclasses import dataclass
from urllib.parse import quote, urlparse
from uuid import uuid4

import psycopg
import requests

from ocr_core import MAX_BYTES, InvalidDocument, PaddleProvider, TesseractProvider, process_document

MAX_ATTEMPTS = 3
MAX_SECONDS = 150
ENGINE_VERSION = "1.0.0-worker"


@dataclass(frozen=True)
class Config:
    db_dsn: str
    supabase_url: str
    service_key: str
    project_ref: str
    provider: str

    @classmethod
    def from_env(cls) -> "Config":
        ref = os.environ["TEMO_ALLOWED_SUPABASE_REF"]
        url = os.environ["TEMO_SUPABASE_URL"].rstrip("/")
        if urlparse(url).scheme != "https" or urlparse(url).hostname != f"{ref}.supabase.co":
            raise RuntimeError("DOCUMENT_WORKER_PROJECT_MISMATCH")
        if ref != "rrhyglrnlveygyiandhs":
            raise RuntimeError("DOCUMENT_WORKER_DEVELOPMENT_ONLY")
        dsn = os.environ["TEMO_DOCUMENT_DB_DSN"]
        try:
            from psycopg.conninfo import conninfo_to_dict
            connection = conninfo_to_dict(dsn)
        except Exception as error:
            raise RuntimeError("DOCUMENT_WORKER_DB_PROJECT_UNVERIFIED") from error
        host = connection.get("host", "").lower()
        user = connection.get("user", "")
        # A long-running OCR process must not connect as the database owner.
        # Development E2E uses a disposable role; Production will need a
        # separately provisioned, audited least-privilege worker identity.
        permitted_users = {"temo_document_worker"}
        direct = host == f"db.{ref}.supabase.co" and user in permitted_users
        pooled = host.endswith(".pooler.supabase.com") and user in {f"{role}.{ref}" for role in permitted_users}
        if not (direct or pooled):
            raise RuntimeError("DOCUMENT_WORKER_DB_PROJECT_UNVERIFIED")
        provider = os.environ.get("TEMO_OCR_PROVIDER", "paddleocr")
        if provider not in {"paddleocr", "tesseract"}:
            raise RuntimeError("DOCUMENT_WORKER_PROVIDER_INVALID")
        return cls(dsn, url, os.environ["TEMO_SUPABASE_SERVICE_ROLE_KEY"], ref, provider)


def claim_next(connection: psycopg.Connection) -> dict | None:
    with connection.transaction():
        # A container may die after claiming a lease. Do not strand its job
        # forever, and do not revive a job that exhausted its attempt budget.
        connection.execute("""
          update public.document_extractions
          set status = 'failed', error_code = 'DOCUMENT_OCR_WORKER_LOST',
              lease_token = null, next_attempt_at = null
          where engine_version = %s and status = 'processing' and attempt_count >= %s
            and processing_started_at < now() - interval '5 minutes'
        """, (ENGINE_VERSION, MAX_ATTEMPTS))
        row = connection.execute("""
          select e.id, e.tenant_id, e.file_id, e.attempt_count,
                 f.storage_bucket, f.storage_path, f.mime_type, f.sha256, f.original_file_name
          from public.document_extractions e
          join public.document_files f on f.tenant_id = e.tenant_id and f.id = e.file_id
          where e.engine_version = %s and e.attempt_count < %s and
            ((e.status in ('queued', 'retryable_failed') and
              (e.next_attempt_at is null or e.next_attempt_at <= now()))
             or (e.status = 'processing' and
                 e.processing_started_at < now() - interval '5 minutes'))
          order by e.created_at
          for update of e skip locked limit 1
        """, (ENGINE_VERSION, MAX_ATTEMPTS)).fetchone()
        if not row:
            return None
        lease = str(uuid4())
        connection.execute("""
          update public.document_extractions
          set status = 'processing', lease_token = %s, attempt_count = attempt_count + 1,
              processing_started_at = now(), next_attempt_at = null, error_code = null
          where id = %s and tenant_id = %s
        """, (lease, row[0], row[1]))
        return dict(zip(("id", "tenant_id", "file_id", "attempt_count", "bucket", "path", "mime", "sha256", "filename"), row)) | {"lease": lease}


def download(config: Config, job: dict) -> bytes:
    if job["bucket"] != "temo-documents" or not job["path"].startswith(str(job["tenant_id"]) + "/"):
        raise InvalidDocument("DOCUMENT_STORAGE_SCOPE_INVALID")
    url = f"{config.supabase_url}/storage/v1/object/authenticated/temo-documents/{quote(job['path'], safe='/')}"
    with requests.get(url, headers={"Authorization": f"Bearer {config.service_key}", "apikey": config.service_key},
                      timeout=(5, 25), stream=True, allow_redirects=False) as response:
        if response.status_code != 200:
            raise RuntimeError("DOCUMENT_STORAGE_DOWNLOAD_FAILED")
        response.raise_for_status()
        chunks = []; total = 0
        for chunk in response.iter_content(64 * 1024):
            total += len(chunk)
            if total > MAX_BYTES:
                raise InvalidDocument("DOCUMENT_SIZE_INVALID")
            chunks.append(chunk)
    return b"".join(chunks)


def _run_ocr(raw: bytes, job: dict, provider_name: str, connection):
    try:
        if sys.platform != "win32":
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (120, 125))
            resource.setrlimit(resource.RLIMIT_AS, (6 * 1024**3, 6 * 1024**3))
        provider = PaddleProvider() if provider_name == "paddleocr" else TesseractProvider()
        result = process_document(raw, job["filename"], job["mime"], provider, job["sha256"])
        connection.send(("success", result))
    except InvalidDocument as error:
        connection.send(("permanent", error.code))
    except Exception:
        connection.send(("retry", "DOCUMENT_OCR_FAILED"))
    finally:
        connection.close()


def process_isolated(raw: bytes, job: dict, provider_name: str) -> tuple[str, dict | str]:
    parent, child = mp.Pipe(duplex=False)
    process = mp.Process(target=_run_ocr, args=(raw, job, provider_name, child), daemon=True)
    process.start(); child.close()
    try:
        if parent.poll(MAX_SECONDS):
            return parent.recv()
        return "retry", "DOCUMENT_OCR_TIMEOUT"
    except EOFError:
        return "retry", "DOCUMENT_OCR_WORKER_EXITED"
    finally:
        if process.is_alive(): process.terminate()
        process.join(5)
        if process.is_alive(): process.kill(); process.join()
        parent.close()


def finalize(connection: psycopg.Connection, job: dict, result: dict):
    with connection.transaction():
        row = connection.execute("""
          select status from public.document_extractions
          where id = %s and tenant_id = %s and lease_token = %s for update
        """, (job["id"], job["tenant_id"], job["lease"])).fetchone()
        if not row or row[0] != "processing":
            raise RuntimeError("DOCUMENT_LEASE_LOST")
        for page in result["pages"]:
            connection.execute("""
              insert into public.document_extraction_pages
              (tenant_id, extraction_id, page_number, extraction_method, text_content, confidence, width, height, segments)
              values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
              on conflict (tenant_id, extraction_id, page_number) do nothing
            """, (job["tenant_id"], job["id"], page["number"], page["method"], page["text"], page["confidence"], page["width"], page["height"], json.dumps(page["segments"])))
        connection.execute("""
          update public.document_extractions
          set status = 'extracted', extraction_method = %s, raw_text = %s,
              page_count = %s, processing_metrics = %s::jsonb, lease_token = null
          where id = %s and tenant_id = %s and lease_token = %s
        """, ("ocr" if any(p["method"] == "ocr" for p in result["pages"]) else "native_pdf",
              "\n\f\n".join(p["text"] for p in result["pages"])[:1_000_000], len(result["pages"]),
              json.dumps({"ocrEngine": result["engine"], "ocrModelVersion": result["model_version"], "ocrMs": result["duration_ms"]}),
              job["id"], job["tenant_id"], job["lease"]))


def fail_job(connection: psycopg.Connection, job: dict, code: str, retry: bool):
    safe_code = code if code.isupper() and code.replace("_", "").isalnum() and len(code) <= 80 else "DOCUMENT_OCR_FAILED"
    next_status = "retryable_failed" if retry and job["attempt_count"] + 1 < MAX_ATTEMPTS else "failed"
    with connection.transaction():
        connection.execute("""
          update public.document_extractions
          set status = %s, error_code = %s, lease_token = null,
              next_attempt_at = case when %s = 'retryable_failed' then now() + (%s * interval '1 minute') else null end
          where id = %s and tenant_id = %s and lease_token = %s and status = 'processing'
        """, (next_status, safe_code, next_status, 2 ** int(job["attempt_count"]), job["id"], job["tenant_id"], job["lease"]))


def process_one(config: Config, connection: psycopg.Connection) -> bool:
    job = claim_next(connection)
    if not job:
        return False
    try:
        raw = download(config, job)
        outcome, result = process_isolated(raw, job, config.provider)
        if outcome == "success":
            finalize(connection, job, result)
        else:
            fail_job(connection, job, result, outcome == "retry")
    except InvalidDocument as error:
        fail_job(connection, job, error.code, False)
    except Exception:
        fail_job(connection, job, "DOCUMENT_WORKER_IO_FAILED", True)
    return True


def run():
    config = Config.from_env()
    one_shot = os.environ.get("TEMO_WORKER_ONCE") == "1"
    test_max_jobs = int(os.environ.get("TEMO_WORKER_TEST_MAX_JOBS", "1")) if one_shot else None
    if test_max_jobs is not None and not 1 <= test_max_jobs <= 4:
        raise RuntimeError("DOCUMENT_WORKER_TEST_JOB_LIMIT_INVALID")
    completed = 0
    deadline = time.monotonic() + 120 * test_max_jobs if one_shot else None
    while True:
        try:
            # A dropped connection cannot be reused. Reopen it so queued jobs
            # continue after a transient Development database interruption.
            with psycopg.connect(config.db_dsn, autocommit=True) as connection:
                while True:
                    if process_one(config, connection) and one_shot:
                        completed += 1
                        if completed >= test_max_jobs:
                            return
                    if deadline and time.monotonic() >= deadline:
                        raise RuntimeError("DOCUMENT_WORKER_TEST_QUEUE_TIMEOUT")
                    time.sleep(2)
        except psycopg.Error:
            if deadline and time.monotonic() >= deadline:
                raise RuntimeError("DOCUMENT_WORKER_TEST_QUEUE_TIMEOUT") from None
            # No row content, token, filename or document text goes to logs.
            print("DOCUMENT_WORKER_DATABASE_RETRY", file=sys.stderr)
            time.sleep(5)


if __name__ == "__main__":
    mp.freeze_support()
    run()
