"""Private, project-bound Supabase OCR queue consumer.

Deploy separately from Vercel/Edge. Run one instance or more: PostgreSQL
SKIP LOCKED prevents two workers from claiming the same extraction. Secrets are
read only from the server environment, never returned to TEMO or logged.
"""
from __future__ import annotations

import json
import math
import multiprocessing as mp
import os
import re
import signal
import sys
import time
from dataclasses import dataclass
from threading import Event, Thread
from urllib.parse import urlparse
from uuid import UUID, uuid4

import psycopg
import requests

from ocr_core import (MAX_BYTES, InvalidDocument, PaddleEnglishProvider,
                      TesseractEnglishProvider, process_document)

MAX_ATTEMPTS = 3
MAX_SECONDS = 270
# Drain supported live requests from older clients as well as the new version.
# Their requested version stays immutable; only unfinalized jobs are claimed,
# and the actual English-only processing policy is recorded separately.
ENGLISH_ENGINE_VERSION = "1.0.8-en-worker"
LEGACY_ENGINE_VERSIONS = {"1.0.0-worker", "1.0.1-worker", "1.0.2-worker", "1.0.3-worker", "1.0.4-worker", "1.0.5-worker", "1.0.6-worker", "1.0.7-en-worker"}
ENGINE_VERSIONS = [*sorted(LEGACY_ENGINE_VERSIONS), ENGLISH_ENGINE_VERSION]
SERIALIZED_CLAIM_LOCK = 763332108


def provider_for_version(provider_name: str, engine_version: str | None = None):
    """All live queue versions use English; the request version is evidence only."""
    return PaddleEnglishProvider if provider_name == "paddleocr" else TesseractEnglishProvider


@dataclass(frozen=True)
class Config:
    db_dsn: str
    supabase_url: str
    download_secret: str
    project_ref: str
    provider: str
    warm_reuse: bool = False

    @classmethod
    def from_env(cls) -> "Config":
        ref = os.environ["TEMO_ALLOWED_SUPABASE_REF"]
        url = os.environ["TEMO_SUPABASE_URL"].rstrip("/")
        if urlparse(url).scheme != "https" or urlparse(url).hostname != f"{ref}.supabase.co":
            raise RuntimeError("DOCUMENT_WORKER_PROJECT_MISMATCH")
        environment = os.environ["TEMO_WORKER_ENVIRONMENT"]
        projects = {"development": "rrhyglrnlveygyiandhs", "production": "ifnfwssdtjuzdtshnrht"}
        if projects.get(environment) != ref:
            raise RuntimeError("DOCUMENT_WORKER_ENVIRONMENT_MISMATCH")
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
        if not (direct or pooled) or connection.get("sslmode") not in {"require", "verify-ca", "verify-full"}:
            raise RuntimeError("DOCUMENT_WORKER_DB_PROJECT_UNVERIFIED")
        provider = os.environ.get("TEMO_OCR_PROVIDER", "paddleocr")
        if provider not in {"paddleocr", "tesseract"}:
            raise RuntimeError("DOCUMENT_WORKER_PROVIDER_INVALID")
        secret = os.environ["TEMO_DOCUMENT_DOWNLOAD_SECRET"]
        if len(secret) < 48:
            raise RuntimeError("DOCUMENT_WORKER_DOWNLOAD_SECRET_INVALID")
        warm_reuse = os.environ.get("TEMO_OCR_WARM_REUSE") == "1"
        if warm_reuse and environment != "development":
            raise RuntimeError("DOCUMENT_WORKER_WARM_REUSE_DEVELOPMENT_ONLY")
        return cls(dsn, url, secret, ref, provider, warm_reuse)


def claim_next(connection: psycopg.Connection, extraction_id: str | None = None, *, serialized: bool = False) -> dict | None:
    if extraction_id is not None:
        extraction_id = str(UUID(extraction_id))
    with connection.transaction():
        if serialized:
            locked = connection.execute("select pg_try_advisory_xact_lock(%s)", (SERIALIZED_CLAIM_LOCK,)).fetchone()
            if not locked or locked[0] is not True:
                return None
            # The transaction lock serializes this check and the subsequent
            # claim. The processing row remains the global reservation after
            # commit, including when the connection uses a transaction pooler.
            active = connection.execute("""
              select exists (select 1 from public.document_extractions
                where engine_version = any(%s) and status = 'processing'
                  and processing_started_at >= now() - interval '6 minutes')
            """, (ENGINE_VERSIONS,)).fetchone()
            if not active or active[0] is not False:
                return None
        # A container may die after claiming a lease. Do not strand its job
        # forever, and do not revive a job that exhausted its attempt budget.
        connection.execute("""
          update public.document_extractions
          set status = 'failed', error_code = 'DOCUMENT_OCR_WORKER_LOST',
              lease_token = null, next_attempt_at = null
          where engine_version = any(%s) and status = 'processing' and attempt_count >= %s
            and processing_started_at < now() - interval '6 minutes'
             and (%s::uuid is null or id = %s::uuid)
        """, (ENGINE_VERSIONS, MAX_ATTEMPTS, extraction_id, extraction_id))
        row = connection.execute("""
          select e.id, e.tenant_id, e.file_id, e.attempt_count,
                 f.storage_bucket, f.storage_path, f.mime_type, f.sha256, f.original_file_name, e.engine_version
          from public.document_extractions e
          join public.document_files f on f.tenant_id = e.tenant_id and f.id = e.file_id
          where e.engine_version = any(%s) and e.attempt_count < %s and
             (%s::uuid is null or e.id = %s::uuid) and
             ((e.status in ('queued', 'retryable_failed') and
              (e.next_attempt_at is null or e.next_attempt_at <= now()))
             or (e.status = 'processing' and
                 e.processing_started_at < now() - interval '6 minutes'))
          order by e.created_at
          for update of e skip locked limit 1
        """, (ENGINE_VERSIONS, MAX_ATTEMPTS, extraction_id, extraction_id)).fetchone()
        if not row:
            return None
        lease = str(uuid4())
        connection.execute("""
          update public.document_extractions
          set status = 'processing', lease_token = %s, attempt_count = attempt_count + 1,
              processing_started_at = now(), next_attempt_at = null, error_code = null
          where id = %s and tenant_id = %s
        """, (lease, row[0], row[1]))
        return dict(zip(("id", "tenant_id", "file_id", "attempt_count", "bucket", "path", "mime", "sha256", "filename", "engine_version"), row)) | {"lease": lease}


def download(config: Config, job: dict, *, max_seconds: float | None = None) -> bytes:
    if job["bucket"] != "temo-documents" or not job["path"].startswith(str(job["tenant_id"]) + "/"):
        raise InvalidDocument("DOCUMENT_STORAGE_SCOPE_INVALID")
    url = f"{config.supabase_url}/functions/v1/document-worker-download"
    started = time.monotonic() if max_seconds is not None else None
    with requests.post(url, headers={"X-Worker-Secret": config.download_secret},
                       json={"extraction_id": str(job["id"]), "tenant_id": str(job["tenant_id"]), "lease_token": job["lease"]},
                       timeout=(5, 5 if max_seconds is not None else 25), stream=True, allow_redirects=False) as response:
        if response.status_code != 200:
            raise RuntimeError("DOCUMENT_STORAGE_DOWNLOAD_FAILED")
        response.raise_for_status()
        chunks = []; total = 0
        for chunk in response.iter_content(64 * 1024):
            if max_seconds is not None and time.monotonic() - started > max_seconds:
                raise RuntimeError("DOCUMENT_STORAGE_DOWNLOAD_TIMEOUT")
            total += len(chunk)
            if total > MAX_BYTES:
                raise InvalidDocument("DOCUMENT_SIZE_INVALID")
            chunks.append(chunk)
    return b"".join(chunks)


def _run_ocr(raw: bytes, job: dict, provider_name: str, connection):
    try:
        if sys.platform != "win32":
            import resource
            # Paddle uses multiple CPU threads; RLIMIT_CPU counts their sum,
            # so a 120-second CPU cap could kill a successful 80-second page.
            # The parent still enforces the shorter wall-clock deadline.
            resource.setrlimit(resource.RLIMIT_CPU, (600, 610))
            resource.setrlimit(resource.RLIMIT_AS, (6 * 1024**3, 6 * 1024**3))
        provider_factory = provider_for_version(provider_name, job.get("engine_version"))
        result = process_document(raw, job["filename"], job["mime"], None, job["sha256"],
                                  provider_factory=provider_factory)
        connection.send(("success", result))
    except InvalidDocument as error:
        connection.send(("permanent", error.code))
    except Exception:
        connection.send(("retry", "DOCUMENT_OCR_FAILED"))
    finally:
        connection.close()


def process_isolated(raw: bytes, job: dict, provider_name: str, *, context=None,
                     timeout_seconds: float = MAX_SECONDS) -> tuple[str, dict | str]:
    context = context or mp
    parent, child = context.Pipe(duplex=False)
    process = None
    try:
        process = context.Process(target=_run_ocr, args=(raw, job, provider_name, child), daemon=True)
        process.start()
    except BaseException:
        parent.close()
        child.close()
        if process is not None:
            process.close()
        raise
    child.close()
    try:
        if parent.poll(max(0, min(MAX_SECONDS, timeout_seconds))):
            return parent.recv()
        return "retry", "DOCUMENT_OCR_TIMEOUT"
    except EOFError:
        return "retry", "DOCUMENT_OCR_WORKER_EXITED"
    finally:
        if process.is_alive(): process.terminate()
        process.join(5)
        if process.is_alive(): process.kill(); process.join()
        parent.close()


class _CachedProviderFactory:
    """Cache models only. Document bytes/results are never cached here."""
    def __init__(self, factory):
        self.factory = factory
        self.name = factory.name
        self.version = factory.version
        self.english_only = bool(getattr(factory, "english_only", False))
        self._provider = None

    def __call__(self):
        if self._provider is None:
            self._provider = self.factory()
        return self._provider


def _warm_resource_limits(max_jobs: int, *, first_job: bool):
    if sys.platform == "win32":
        return
    import resource
    # RLIMIT_CPU counts cumulative CPU seconds, including all Paddle threads.
    # Keep a 600-second budget per job, with a bounded process lifetime; reusing
    # the original fixed soft limit would kill a later, otherwise valid job.
    hard = 600 * max_jobs + 10
    if first_job:
        resource.setrlimit(resource.RLIMIT_AS, (6 * 1024**3, 6 * 1024**3))
    usage = resource.getrusage(resource.RUSAGE_SELF)
    soft = min(hard - 1, math.ceil(usage.ru_utime + usage.ru_stime) + 600)
    resource.setrlimit(resource.RLIMIT_CPU, (soft, hard))


def _warm_child(connection, tenant_scope: str, provider_name: str, provider_factory,
                document_processor, max_jobs: int, idle_seconds: float):
    """One spawned child, one tenant and a bounded number of documents."""
    factory = provider_factory or provider_for_version(provider_name)
    cached_factory = _CachedProviderFactory(factory)
    processor = document_processor or process_document
    try:
        for index in range(max_jobs):
            if not connection.poll(idle_seconds):
                return
            envelope = connection.recv()
            if envelope is None:
                return
            request_id, raw, job = envelope
            result = None
            try:
                if str(job.get("tenant_id", "")) != tenant_scope:
                    connection.send((request_id, "retry", "DOCUMENT_OCR_SCOPE_CHANGED"))
                    return
                _warm_resource_limits(max_jobs, first_job=index == 0)
                result = processor(raw, job["filename"], job["mime"], None, job["sha256"],
                                   provider_factory=cached_factory)
                connection.send((request_id, "success", result))
            except InvalidDocument as error:
                connection.send((request_id, "permanent", error.code))
                return
            except Exception:
                connection.send((request_id, "retry", "DOCUMENT_OCR_FAILED"))
                return
            finally:
                # Model state alone survives. Do not intentionally retain the
                # current input, job metadata, OCR pages or transport envelope.
                raw = job = result = envelope = None
    except (EOFError, BrokenPipeError, OSError):
        return
    finally:
        connection.close()


def _child_rss_bytes(process_id: int) -> int:
    import psutil
    try:
        return psutil.Process(process_id).memory_info().rss
    except psutil.NoSuchProcess:
        return 0  # The receive thread will observe EOF and retire it.


class WarmOCRProcess:
    """Development opt-in: reuse a lazy model in a tenant-bound subprocess.

    The parent stays in control of the wall-clock deadline, including cold
    initialization/IPC. Timeouts, failure, idle expiry, tenant changes and the
    job limit all destroy the child; no document result cache is maintained.
    """
    def __init__(self, provider_name: str, *, max_jobs: int = 8, idle_seconds: float = 60,
                 timeout_seconds: float = MAX_SECONDS, shutdown: Event | None = None,
                 context=None, provider_factory=None, document_processor=None, _child_target=None,
                 _rss_reader=None):
        if provider_name not in {"paddleocr", "tesseract"} or not 1 <= max_jobs <= 8 \
                or not 0 < idle_seconds <= 300 or not 0 < timeout_seconds <= MAX_SECONDS:
            raise ValueError("DOCUMENT_WARM_CONFIGURATION_INVALID")
        self.provider_name = provider_name
        self.max_jobs = max_jobs
        self.idle_seconds = idle_seconds
        self.timeout_seconds = timeout_seconds
        self.shutdown = shutdown
        # Spawn never inherits the parent's live database connection or lease.
        self.context = context or mp.get_context("spawn")
        self.provider_factory = provider_factory
        self.document_processor = document_processor
        self._child_target = _child_target or _warm_child
        self._rss_reader = _rss_reader or _child_rss_bytes
        self._process = self._connection = None
        self._tenant = None
        self._engine_policy = None
        self._completed = 0
        self._last_used = 0.0
        self._sending = None
        self._receiving = None

    @property
    def process_id(self):
        return self._process.pid if self._process is not None else None

    def close(self):
        connection, process = self._connection, self._process
        self._connection = self._process = self._tenant = None
        self._engine_policy = None
        self._completed = 0
        self._last_used = 0.0
        if connection is not None:
            connection.close()
        if process is not None:
            if process.is_alive():
                process.terminate()
            process.join(0.3)
            if process.is_alive():
                process.kill()
                process.join(0.7)
        # A killed reader releases any blocked sender. Never leave a document
        # envelope held by an idle background thread after processing returns.
        if self._sending is not None:
            self._sending.join(0.3)
            self._sending = None
        if self._receiving is not None:
            self._receiving.join(0.3)
            self._receiving = None

    def reap_idle(self):
        if self._process is not None and (not self._process.is_alive()
                or time.monotonic() - self._last_used >= self.idle_seconds):
            self.close()

    def _start(self, tenant_scope: str, engine_version: str | None = None):
        parent, child = self.context.Pipe(duplex=True)
        process = self.context.Process(target=self._child_target, args=(
            child, tenant_scope, self.provider_name,
            self.provider_factory or provider_for_version(self.provider_name, engine_version),
            self.document_processor, self.max_jobs, self.idle_seconds), daemon=True)
        try:
            process.start()
        except BaseException:
            parent.close(); child.close()
            raise
        child.close()
        self._connection, self._process, self._tenant = parent, process, tenant_scope
        self._engine_policy = ENGLISH_ENGINE_VERSION
        self._completed = 0

    def process(self, raw: bytes, job: dict) -> tuple[str, dict | str]:
        started = time.monotonic()
        deadline = started + self.timeout_seconds
        tenant_scope = str(job.get("tenant_id", ""))
        if not tenant_scope:
            self.close()
            return "retry", "DOCUMENT_OCR_SCOPE_CHANGED"
        if self.shutdown is not None and self.shutdown.is_set():
            self.close()
            return "retry", "DOCUMENT_OCR_SHUTDOWN"
        self.reap_idle()
        engine_version = job.get("engine_version")
        engine_policy = ENGLISH_ENGINE_VERSION
        if self._tenant != tenant_scope or self._engine_policy != engine_policy or self._completed >= self.max_jobs:
            self.close()
        request_id = str(uuid4())
        # The child receives no DB lease, storage path, credentials or record IDs.
        child_job = {"tenant_id": tenant_scope, "filename": job["filename"],
                     "mime": job["mime"], "sha256": job["sha256"], "engine_version": engine_version}
        send_done = Event()
        send_error = []
        receive_done = Event()
        received = []
        receive_error = []
        try:
            if self._process is None:
                self._start(tenant_scope, engine_version)
            connection = self._connection

            def send_request():
                try:
                    connection.send((request_id, raw, child_job))
                except Exception as error:
                    send_error.append(type(error).__name__)
                finally:
                    send_done.set()

            def receive_response():
                try:
                    received.append(connection.recv())
                except Exception as error:
                    receive_error.append(type(error).__name__)
                finally:
                    receive_done.set()

            self._sending = Thread(target=send_request, daemon=True)
            self._receiving = Thread(target=receive_response, daemon=True)
            self._sending.start()
            self._receiving.start()
            while time.monotonic() < deadline:
                if self.shutdown is not None and self.shutdown.is_set():
                    self.close()
                    return "retry", "DOCUMENT_OCR_SHUTDOWN"
                if send_done.is_set() and send_error:
                    self.close()
                    return "retry", "DOCUMENT_OCR_WORKER_EXITED"
                try:
                    rss = self._rss_reader(self._process.pid)
                except Exception:
                    self.close()
                    return "retry", "DOCUMENT_OCR_MEMORY_UNAVAILABLE"
                if rss > 6 * 1024**3:
                    self.close()
                    return "retry", "DOCUMENT_OCR_MEMORY_LIMIT"
                remaining = deadline - time.monotonic()
                if receive_done.wait(min(0.1, max(0, remaining))):
                    if receive_error:
                        self.close()
                        return "retry", "DOCUMENT_OCR_WORKER_EXITED"
                    response = received[0]
                    if not isinstance(response, tuple) or len(response) != 3 or response[0] != request_id:
                        self.close()
                        return "retry", "DOCUMENT_OCR_PROTOCOL_INVALID"
                    _, outcome, result = response
                    if outcome not in {"success", "permanent", "retry"} or \
                            (outcome == "success" and not isinstance(result, dict)) or \
                            (outcome != "success" and not isinstance(result, str)):
                        self.close()
                        return "retry", "DOCUMENT_OCR_PROTOCOL_INVALID"
                    if outcome == "success" and result.get("sha256") != child_job["sha256"]:
                        self.close()
                        return "retry", "DOCUMENT_OCR_RESULT_MISMATCH"
                    self._sending.join(0.3)
                    self._sending = None
                    self._receiving.join(0.3)
                    self._receiving = None
                    self._completed += 1
                    self._last_used = time.monotonic()
                    if outcome == "success":
                        result["worker_process_ms"] = round((self._last_used - started) * 1000)
                    if outcome != "success" or self._completed >= self.max_jobs:
                        self.close()
                    return outcome, result
            self.close()
            return "retry", "DOCUMENT_OCR_TIMEOUT"
        except (EOFError, BrokenPipeError, OSError):
            self.close()
            return "retry", "DOCUMENT_OCR_WORKER_EXITED"
        except Exception:
            self.close()
            return "retry", "DOCUMENT_OCR_FAILED"


def finalize(connection: psycopg.Connection, job: dict, result: dict):
    metrics = {"ocrEngine": result["engine"], "ocrModelVersion": result["model_version"],
               "ocrMs": result["duration_ms"], "languagePolicy": "english_only",
               "processingEngineVersion": ENGLISH_ENGINE_VERSION,
               "requestedEngineVersion": job.get("engine_version") or ENGLISH_ENGINE_VERSION}
    for source, target in (("provider_init_ms", "providerInitMs"), ("total_duration_ms", "totalDurationMs"),
                           ("worker_process_ms", "workerProcessMs"), ("download_ms", "downloadMs")):
        value = result.get(source)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0:
            metrics[target] = value
    if result.get("worker_mode") in {"isolated", "warm"}:
        metrics["workerMode"] = result["worker_mode"]
    profile = result.get("preprocessing_profile")
    if isinstance(profile, str) and re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,95}", profile):
        metrics["preprocessingProfile"] = profile
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
              page_count = %s, processing_metrics = %s::jsonb,
              issues = %s::jsonb, lease_token = null
          where id = %s and tenant_id = %s and lease_token = %s
        """, ("ocr" if any(p["method"] == "ocr" for p in result["pages"]) else "native_pdf",
              "\n\f\n".join(p["text"] for p in result["pages"])[:1_000_000], len(result["pages"]),
              json.dumps(metrics),
              json.dumps(result.get("issues", [])),
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


def process_one(config: Config, connection: psycopg.Connection, ocr_runner: WarmOCRProcess | None = None, *,
                extraction_id: str | None = None, serialized: bool = False, process_context=None,
                deadline: float | None = None) -> bool:
    if ocr_runner is not None and (process_context is not None or deadline is not None):
        raise ValueError("DOCUMENT_HTTP_WARM_REUSE_UNSUPPORTED")
    if ocr_runner is not None and (not config.warm_reuse or config.project_ref != "rrhyglrnlveygyiandhs"):
        raise RuntimeError("DOCUMENT_WORKER_WARM_REUSE_DEVELOPMENT_ONLY")
    if deadline is not None and time.monotonic() >= deadline - 20:
        return False  # Leave the durable job untouched for another invocation.
    job = claim_next(connection, extraction_id, serialized=serialized) if extraction_id is not None or serialized else claim_next(connection)
    if not job:
        return False
    stage = "download"
    try:
        started = time.monotonic()
        raw = download(config, job, max_seconds=30) if deadline is not None else download(config, job)
        download_ms = round((time.monotonic() - started) * 1000)
        stage = "ocr"
        started = time.monotonic()
        if deadline is not None or process_context is not None:
            remaining = MAX_SECONDS if deadline is None else max(0, deadline - time.monotonic() - 20)
            outcome, result = process_isolated(raw, job, config.provider, context=process_context,
                                              timeout_seconds=min(MAX_SECONDS, remaining)) if remaining > 0 else \
                ("retry", "DOCUMENT_OCR_TIMEOUT")
        else:
            outcome, result = ocr_runner.process(raw, job) if ocr_runner is not None else process_isolated(raw, job, config.provider)
        if outcome == "success":
            result.setdefault("worker_process_ms", round((time.monotonic() - started) * 1000))
            result["download_ms"] = download_ms
            result["worker_mode"] = "warm" if ocr_runner is not None else "isolated"
            stage = "finalize"
            finalize(connection, job, result)
        else:
            if ocr_runner is not None:
                ocr_runner.close()
            stage = "record_failure"
            fail_job(connection, job, result, outcome == "retry")
    except InvalidDocument as error:
        if ocr_runner is not None:
            ocr_runner.close()
        fail_job(connection, job, error.code, False)
    except Exception as error:
        if ocr_runner is not None:
            ocr_runner.close()
        sqlstate = error.sqlstate if isinstance(error, psycopg.Error) else 'none'
        primary = error.diag.message_primary if isinstance(error, psycopg.Error) else ''
        safe_primary = primary if primary and re.fullmatch(
            r'(?:permission denied for|new row violates row-level security policy for) [A-Za-z0-9_ "\x27]{1,100}',
            primary,
        ) else 'unknown'
        print(f"DOCUMENT_WORKER_JOB_RETRY:{stage}:{type(error).__name__}:{sqlstate or 'none'}:{safe_primary}", file=sys.stderr)
        fail_job(connection, job, "DOCUMENT_WORKER_IO_FAILED", True)
    return True


def run():
    config = Config.from_env()
    if config.warm_reuse and config.project_ref != "rrhyglrnlveygyiandhs":
        raise RuntimeError("DOCUMENT_WORKER_WARM_REUSE_DEVELOPMENT_ONLY")
    one_shot = os.environ.get("TEMO_WORKER_ONCE") == "1"
    test_max_jobs = int(os.environ.get("TEMO_WORKER_TEST_MAX_JOBS", "1")) if one_shot else None
    if test_max_jobs is not None and not 1 <= test_max_jobs <= 4:
        raise RuntimeError("DOCUMENT_WORKER_TEST_JOB_LIMIT_INVALID")
    completed = 0
    deadline = time.monotonic() + 120 * test_max_jobs if one_shot else None
    shutdown = Event()
    ocr_runner = WarmOCRProcess(config.provider, shutdown=shutdown) if config.warm_reuse else None
    previous_sigterm = signal.signal(signal.SIGTERM, lambda *_: shutdown.set())
    try:
        while not shutdown.is_set():
            try:
                # A dropped connection cannot be reused. Reopen it so queued
                # jobs continue after a transient database interruption.
                with psycopg.connect(config.db_dsn, autocommit=True) as connection:
                    while not shutdown.is_set():
                        processed = process_one(config, connection, ocr_runner) if ocr_runner is not None else process_one(config, connection)
                        if processed and one_shot:
                            completed += 1
                            if completed >= test_max_jobs:
                                return
                        if deadline and time.monotonic() >= deadline:
                            raise RuntimeError("DOCUMENT_WORKER_TEST_QUEUE_TIMEOUT")
                        if ocr_runner is not None:
                            ocr_runner.reap_idle()
                        shutdown.wait(2)
            except psycopg.Error as error:
                if ocr_runner is not None:
                    ocr_runner.close()
                if deadline and time.monotonic() >= deadline:
                    raise RuntimeError("DOCUMENT_WORKER_TEST_QUEUE_TIMEOUT") from None
                # No row content, token, filename or document text goes to logs.
                # SQLSTATE and exception class identify a broken contract.
                primary = error.diag.message_primary or ''
                safe_primary = primary if re.fullmatch(
                    r'(?:permission denied for|new row violates row-level security policy for) [A-Za-z0-9_ "\x27]{1,100}',
                    primary,
                ) else 'unknown'
                print(f"DOCUMENT_WORKER_DATABASE_RETRY:{type(error).__name__}:{error.sqlstate or 'none'}:{safe_primary}", file=sys.stderr)
                shutdown.wait(5)
    finally:
        if ocr_runner is not None:
            ocr_runner.close()
        signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    mp.freeze_support()
    run()
