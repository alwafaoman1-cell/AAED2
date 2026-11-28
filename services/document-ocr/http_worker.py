"""Authenticated, synchronous one-job HTTP adapter for the private OCR queue.

Queue leases remain the source of truth. This server never accepts document
bytes, tenant IDs, storage paths or destination URLs from its caller.
"""
from __future__ import annotations

import hmac
import json
import multiprocessing as mp
import os
import re
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread
from uuid import UUID

import psycopg

from worker import Config, process_one

RUN_PATH = "/api/internal/document-ocr/run"
SWEEP_PATH = "/api/internal/document-ocr/sweep"
MAX_BODY_BYTES = 512
REQUEST_BUDGET_SECONDS = 330
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def _unique_object(pairs):
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError("duplicate JSON keys")
    return value


def _connect(config: Config):
    return psycopg.connect(config.db_dsn, autocommit=True, connect_timeout=10,
                           options="-c statement_timeout=15000 -c lock_timeout=5000",
                           application_name="temo-document-ocr-http")


def create_handler(*, environment=None, config_factory=None, connection_factory=None,
                   processor=None, gate=None, process_context=None):
    """Dependency seams allow auth/concurrency tests without DB or OCR models."""
    environment = os.environ if environment is None else environment
    config_factory = config_factory or Config.from_env
    connection_factory = connection_factory or _connect
    processor = processor or process_one
    gate = gate if gate is not None else Lock()
    process_context = process_context or mp.get_context("spawn")

    class Handler(BaseHTTPRequestHandler):
        server_version = "TEMO-OCR"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_args):
            # BaseHTTPRequestHandler logs caller-supplied paths. No request
            # content, credentials, extraction IDs or document data go to logs.
            pass

        def _json(self, status, value):
            body = json.dumps(value, separators=(",", ":")).encode("utf-8")
            self.close_connection = True
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # A closed client does not roll back the cloud queue.

        def _authorized(self, secret_name):
            dispatch = environment.get("TEMO_OCR_DISPATCH_SECRET", "")
            download = environment.get("TEMO_DOCUMENT_DOWNLOAD_SECRET", "")
            secret = environment.get(secret_name, "")
            if len(dispatch) < 48 or not secret or (download and hmac.compare_digest(dispatch.encode(), download.encode())):
                self._json(503, {"processed": 0, "status": "unavailable"})
                return False
            headers = self.headers.get_all("Authorization", [])
            expected = ("Bearer " + secret).encode("utf-8")
            if len(headers) != 1 or not hmac.compare_digest(headers[0].encode("utf-8"), expected):
                self._json(401, {"processed": 0, "status": "unauthorized"})
                return False
            return True

        def _run(self, extraction_id):
            if not gate.acquire(blocking=False):
                self._json(202, {"processed": 0, "status": "busy"})
                return
            deadline = time.monotonic() + REQUEST_BUDGET_SECONDS
            try:
                config = config_factory()
                if config.provider != "paddleocr" or config.warm_reuse or hmac.compare_digest(
                        environment["TEMO_OCR_DISPATCH_SECRET"].encode(), config.download_secret.encode()):
                    raise RuntimeError("DOCUMENT_HTTP_CONFIGURATION_INVALID")
                with connection_factory(config) as connection:
                    processed = processor(config, connection, extraction_id=extraction_id, serialized=True,
                                          process_context=process_context, deadline=deadline)
                # True means a queue attempt was handled, including a recorded
                # failure. Only the persisted extraction status proves success.
                self._json(200, {"processed": int(bool(processed)),
                                 "status": "attempted" if processed else "idle_or_busy"})
            except Exception as error:
                print(f"DOCUMENT_OCR_HTTP_FAILURE:{type(error).__name__}", file=sys.stderr)
                self._json(503, {"processed": 0, "status": "unavailable"})
            finally:
                gate.release()

        def do_GET(self):
            if self.path == "/healthz":
                self._json(200, {"ok": True})
            elif self.path == SWEEP_PATH:
                if not self._authorized("CRON_SECRET"):
                    return
                if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
                    self._json(400, {"processed": 0, "status": "invalid_request"})
                    return
                self._run(None)
            else:
                self._json(404, {"processed": 0, "status": "not_found"})

        def do_POST(self):
            if self.path != RUN_PATH:
                self._json(404, {"processed": 0, "status": "not_found"})
                return
            if not self._authorized("TEMO_OCR_DISPATCH_SECRET"):
                return
            try:
                lengths = self.headers.get_all("Content-Length", [])
                if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]):
                    raise ValueError("invalid body framing")
                length = int(lengths[0])
                if not 1 <= length <= MAX_BODY_BYTES:
                    raise ValueError("invalid body size")
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    raise ValueError("invalid content type")
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("truncated body")
                payload = json.loads(body, object_pairs_hook=_unique_object)
                if not isinstance(payload, dict) or set(payload) != {"extraction_id"} or \
                        not isinstance(payload["extraction_id"], str) or not UUID_PATTERN.fullmatch(payload["extraction_id"]):
                    raise ValueError("invalid extraction ID")
                extraction_id = str(UUID(payload["extraction_id"]))
            except (ValueError, UnicodeError, OSError):
                self._json(400, {"processed": 0, "status": "invalid_request"})
                return
            self._run(extraction_id)

        def _method_not_allowed(self):
            self._json(405, {"processed": 0, "status": "method_not_allowed"})

        do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = _method_not_allowed

    return Handler


def run():
    port = int(os.environ.get("PORT", "8080"))
    if not 1 <= port <= 65535:
        raise RuntimeError("DOCUMENT_HTTP_PORT_INVALID")
    server = ThreadingHTTPServer(("0.0.0.0", port), create_handler())
    # Join in-flight handlers before interpreter shutdown, instead of silently
    # abandoning their daemon OCR child as soon as serve_forever returns.
    server.daemon_threads = False
    server.block_on_close = True
    previous = signal.getsignal(signal.SIGTERM)

    def terminate(_signal, _frame):
        # shutdown() must run on another thread than serve_forever().
        Thread(target=server.shutdown, name="ocr-http-shutdown", daemon=True).start()

    signal.signal(signal.SIGTERM, terminate)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    mp.freeze_support()
    run()
