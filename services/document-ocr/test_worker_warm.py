"""Real spawned-process lifecycle checks using tiny fake OCR models.

No network, database, operational documents or heavyweight inference is used.
"""
from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import os
import signal
import sys
import time
import unittest
from threading import Event, Timer
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from worker import (Config, InvalidDocument, WarmOCRProcess, _warm_resource_limits,
                    finalize, process_one, run, provider_for_version, ENGLISH_ENGINE_VERSION)
from ocr_core import PaddleEnglishProvider, TesseractEnglishProvider

TENANT_A = "00000000-0000-4000-8000-000000000101"
TENANT_B = "00000000-0000-4000-8000-000000000102"
DEVELOPMENT_REF = "rrhyglrnlveygyiandhs"


class FakeProvider:
    name = "fake-ocr"
    version = "lifecycle-fixture"

    def __init__(self):
        self.calls = 0


class SlowProvider(FakeProvider):
    def __init__(self):
        time.sleep(6)
        super().__init__()


class ForbiddenProvider(FakeProvider):
    def __init__(self):
        raise AssertionError("A native document must not construct an OCR model")


def fake_process_document(raw, filename, mime, provider=None, expected_sha256=None, *, provider_factory=None):
    if raw == b"slow":
        time.sleep(6)
    if raw == b"crash":
        os._exit(31)
    if raw == b"invalid":
        raise InvalidDocument("DOCUMENT_HASH_MISMATCH")
    if raw == b"error":
        raise RuntimeError("Do not leak document-related error details")
    model = provider_factory()
    model.calls += 1
    return {"engine": model.name, "model_version": model.version, "pages": [], "duration_ms": 1,
            "provider_init_ms": 0, "total_duration_ms": 1, "pid": os.getpid(), "calls": model.calls,
            "sha256": "0" * 64 if raw == b"stale" else hashlib.sha256(raw).hexdigest()}


def wrong_request_child(connection, *_):
    connection.recv()
    connection.send(("not-the-current-request", "success", {"pages": []}))
    time.sleep(6)


def job(tenant=TENANT_A, raw=b"ok", *, filename="fixture.png", mime="image/png"):
    return {"tenant_id": tenant, "filename": filename, "mime": mime,
            "sha256": hashlib.sha256(raw).hexdigest()}


class WarmProcessTests(unittest.TestCase):
    def runner(self, **options):
        defaults = {"provider_factory": FakeProvider, "document_processor": fake_process_document,
                    "timeout_seconds": 4, "context": mp.get_context("spawn")}
        runner = WarmOCRProcess("paddleocr", **(defaults | options))
        self.addCleanup(runner.close)
        return runner

    def test_same_tenant_reuses_one_model_without_caching_a_document_result(self):
        runner = self.runner()
        first_status, first = runner.process(b"first", job(raw=b"first"))
        second_status, second = runner.process(b"second", job(raw=b"second"))
        self.assertEqual((first_status, second_status), ("success", "success"))
        self.assertEqual(first["pid"], second["pid"])
        self.assertEqual((first["calls"], second["calls"]), (1, 2))
        self.assertIsNot(first, second)
        self.assertGreaterEqual(second["worker_process_ms"], 0)

    def test_switching_tenants_destroys_the_previous_model_process(self):
        runner = self.runner()
        _, first = runner.process(b"ok", job())
        status, second = runner.process(b"ok", job(TENANT_B))
        self.assertEqual(status, "success")
        self.assertNotEqual(first["pid"], second["pid"])
        self.assertEqual(second["calls"], 1)

    def test_legacy_and_new_requests_share_only_the_same_effective_english_policy(self):
        runner = self.runner()
        legacy = job() | {"engine_version": "1.0.6-worker"}
        english = job() | {"engine_version": ENGLISH_ENGINE_VERSION}
        status, first = runner.process(b"ok", legacy)
        self.assertEqual(status, "success")
        status, second = runner.process(b"ok", english)
        self.assertEqual(status, "success")
        self.assertEqual(first["pid"], second["pid"])
        self.assertEqual(second["calls"], 2)
        self.assertEqual(legacy["engine_version"], "1.0.6-worker")
        self.assertEqual(english["engine_version"], ENGLISH_ENGINE_VERSION)

    def test_new_legacy_and_unspecified_requests_choose_english_only_models(self):
        self.assertIs(provider_for_version("paddleocr", ENGLISH_ENGINE_VERSION), PaddleEnglishProvider)
        self.assertIs(provider_for_version("paddleocr"), PaddleEnglishProvider)
        self.assertIs(provider_for_version("tesseract", ENGLISH_ENGINE_VERSION), TesseractEnglishProvider)
        for version in (f"1.0.{index}-worker" for index in range(7)):
            self.assertIs(provider_for_version("paddleocr", version), PaddleEnglishProvider)
            self.assertIs(provider_for_version("tesseract", version), TesseractEnglishProvider)

    def test_job_limit_retires_the_child_and_the_next_request_starts_fresh(self):
        runner = self.runner(max_jobs=2)
        _, first = runner.process(b"ok", job())
        self.assertIsNotNone(runner.process_id)
        status, second = runner.process(b"ok", job())
        self.assertEqual(status, "success")
        self.assertEqual(second["calls"], 2)
        self.assertIsNone(runner.process_id)
        status, third = runner.process(b"ok", job())
        self.assertEqual(status, "success")
        self.assertNotEqual(first["pid"], third["pid"])
        self.assertEqual(third["calls"], 1)

    def test_idle_child_is_retired_before_reusing_model_state(self):
        runner = self.runner(idle_seconds=1)
        _, first = runner.process(b"ok", job())
        time.sleep(1.1)
        runner.reap_idle()
        self.assertIsNone(runner.process_id)
        status, second = runner.process(b"ok", job())
        self.assertEqual(status, "success")
        self.assertNotEqual(first["pid"], second["pid"])
        self.assertEqual(second["calls"], 1)

    def test_timeout_kills_the_job_and_cannot_deliver_a_late_result_to_next_job(self):
        runner = self.runner(timeout_seconds=2)
        started = time.monotonic()
        self.assertEqual(runner.process(b"slow", job(raw=b"slow")), ("retry", "DOCUMENT_OCR_TIMEOUT"))
        self.assertLess(time.monotonic() - started, 4)
        self.assertIsNone(runner.process_id)
        status, next_result = runner.process(b"ok", job())
        self.assertEqual(status, "success")
        self.assertEqual(next_result["calls"], 1)

    def test_wall_timeout_includes_cold_model_initialization(self):
        runner = self.runner(provider_factory=SlowProvider, timeout_seconds=2)
        started = time.monotonic()
        self.assertEqual(runner.process(b"ok", job()), ("retry", "DOCUMENT_OCR_TIMEOUT"))
        self.assertLess(time.monotonic() - started, 4)
        self.assertIsNone(runner.process_id)

    def test_crashed_process_is_discarded_and_next_job_can_succeed(self):
        runner = self.runner()
        self.assertEqual(runner.process(b"crash", job(raw=b"crash")), ("retry", "DOCUMENT_OCR_WORKER_EXITED"))
        self.assertIsNone(runner.process_id)
        status, next_result = runner.process(b"ok", job())
        self.assertEqual(status, "success")
        self.assertEqual(next_result["calls"], 1)

    def test_document_failure_retires_model_and_returns_only_a_safe_code(self):
        for raw, expected in ((b"invalid", ("permanent", "DOCUMENT_HASH_MISMATCH")),
                              (b"error", ("retry", "DOCUMENT_OCR_FAILED"))):
            with self.subTest(raw=raw):
                runner = self.runner()
                self.assertEqual(runner.process(raw, job(raw=raw)), expected)
                self.assertIsNone(runner.process_id)
                status, next_result = runner.process(b"ok", job())
                self.assertEqual(status, "success")
                self.assertEqual(next_result["calls"], 1)

    def test_wrong_request_correlation_is_never_accepted_as_current_output(self):
        runner = self.runner(_child_target=wrong_request_child)
        self.assertEqual(runner.process(b"ok", job()), ("retry", "DOCUMENT_OCR_PROTOCOL_INVALID"))
        self.assertIsNone(runner.process_id)

    def test_current_envelope_with_another_documents_hash_is_rejected(self):
        runner = self.runner()
        self.assertEqual(runner.process(b"stale", job(raw=b"stale")), ("retry", "DOCUMENT_OCR_RESULT_MISMATCH"))
        self.assertIsNone(runner.process_id)

    def test_parent_enforces_rss_ceiling_even_on_platforms_without_posix_rlimits(self):
        runner = self.runner(_rss_reader=lambda _: 6 * 1024**3 + 1)
        self.assertEqual(runner.process(b"ok", job()), ("retry", "DOCUMENT_OCR_MEMORY_LIMIT"))
        self.assertIsNone(runner.process_id)

    def test_shutdown_interrupts_inflight_work_and_kills_the_child(self):
        shutdown = Event()
        runner = self.runner(shutdown=shutdown)
        timer = Timer(0.7, shutdown.set)
        timer.start()
        self.addCleanup(timer.cancel)
        self.assertEqual(runner.process(b"slow", job(raw=b"slow")), ("retry", "DOCUMENT_OCR_SHUTDOWN"))
        self.assertIsNone(runner.process_id)

    def test_shutdown_before_job_does_not_start_a_process(self):
        shutdown = Event(); shutdown.set()
        runner = self.runner(shutdown=shutdown)
        self.assertEqual(runner.process(b"ok", job()), ("retry", "DOCUMENT_OCR_SHUTDOWN"))
        self.assertIsNone(runner.process_id)

    def test_real_native_pdf_bypasses_the_model_inside_the_spawned_child(self):
        import pymupdf
        document = pymupdf.open()
        page = document.new_page()
        page.insert_text((50, 50), "Synthetic native PDF with enough selectable text to bypass image OCR safely.")
        raw = document.tobytes(); document.close()
        runner = self.runner(provider_factory=ForbiddenProvider, document_processor=None)
        status, result = runner.process(raw, job(raw=raw, filename="fixture.pdf", mime="application/pdf"))
        self.assertEqual(status, "success")
        self.assertEqual(result["pages"][0]["method"], "native_pdf")
        self.assertEqual(result["provider_init_ms"], 0)
        self.assertEqual(result["engine"], ForbiddenProvider.name)

    def test_hash_validation_precedes_model_initialization_in_the_real_child(self):
        import io
        from PIL import Image
        runner = self.runner(provider_factory=ForbiddenProvider, document_processor=None)
        buffer = io.BytesIO(); Image.new("RGB", (32, 32), "white").save(buffer, format="PNG")
        raw = buffer.getvalue()
        self.assertEqual(runner.process(raw, job(raw=b"different")), ("permanent", "DOCUMENT_HASH_MISMATCH"))
        self.assertIsNone(runner.process_id)


class WarmGuardTests(unittest.TestCase):
    def environment(self, *, production=False):
        ref = "ifnfwssdtjuzdtshnrht" if production else DEVELOPMENT_REF
        return {"TEMO_ALLOWED_SUPABASE_REF": ref, "TEMO_WORKER_ENVIRONMENT": "production" if production else "development",
                "TEMO_SUPABASE_URL": f"https://{ref}.supabase.co",
                "TEMO_DOCUMENT_DB_DSN": f"postgresql://temo_document_worker:password@db.{ref}.supabase.co/postgres?sslmode=require",
                "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64}

    def test_warm_reuse_is_off_by_default_and_requires_development_opt_in(self):
        with patch.dict(os.environ, self.environment(), clear=True):
            self.assertFalse(Config.from_env().warm_reuse)
        with patch.dict(os.environ, self.environment() | {"TEMO_OCR_WARM_REUSE": "1"}, clear=True):
            self.assertTrue(Config.from_env().warm_reuse)
        with patch.dict(os.environ, self.environment(production=True), clear=True):
            self.assertFalse(Config.from_env().warm_reuse)
        with patch.dict(os.environ, self.environment(production=True) | {"TEMO_OCR_WARM_REUSE": "1"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_WARM_REUSE_DEVELOPMENT_ONLY"):
                Config.from_env()

    def test_process_one_cannot_receive_a_warm_runner_for_production(self):
        config = Config("", "https://example.invalid", "x" * 64, "ifnfwssdtjuzdtshnrht", "paddleocr", True)
        with patch("worker.claim_next") as claim:
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_WARM_REUSE_DEVELOPMENT_ONLY"):
                process_one(config, MagicMock(), MagicMock())
            claim.assert_not_called()

    def test_default_production_dispatch_keeps_a_new_isolated_process_per_job(self):
        config = Config("", "https://example.invalid", "x" * 64, "ifnfwssdtjuzdtshnrht", "paddleocr")
        fixture = job() | {"id": "extraction", "lease": "lease"}
        result = {"engine": "fake", "model_version": "fixture", "duration_ms": 1, "pages": []}
        with patch("worker.claim_next", return_value=fixture), patch("worker.download", return_value=b"ok"), \
             patch("worker.process_isolated", return_value=("success", result)) as isolated, \
             patch("worker.finalize") as saved, patch("worker.WarmOCRProcess") as warm:
            self.assertTrue(process_one(config, MagicMock()))
            isolated.assert_called_once_with(b"ok", fixture, "paddleocr")
            warm.assert_not_called()
            self.assertEqual(saved.call_args.args[2]["worker_mode"], "isolated")

    def test_failed_finalization_discards_warm_state_and_records_only_safe_failure_code(self):
        config = Config("", "https://example.invalid", "x" * 64, DEVELOPMENT_REF, "paddleocr", True)
        fixture = job() | {"id": "extraction", "lease": "lease"}
        runner = MagicMock(); runner.process.return_value = ("success", {"pages": []})
        with patch("worker.claim_next", return_value=fixture), patch("worker.download", return_value=b"ok"), \
             patch("worker.finalize", side_effect=RuntimeError("private error details")), \
             patch("worker.fail_job") as failed:
            self.assertTrue(process_one(config, MagicMock(), runner))
            runner.close.assert_called_once()
            self.assertEqual(failed.call_args.args[2:], ("DOCUMENT_WORKER_IO_FAILED", True))

    def test_finalizer_keeps_historical_ocr_ms_and_adds_stage_timings_without_document_details(self):
        connection = MagicMock(); connection.execute.return_value.fetchone.return_value = ("processing",)
        fixture = job() | {"id": "extraction", "lease": "lease"}
        result = {"engine": "fake", "model_version": "fixture", "duration_ms": 10, "provider_init_ms": 25,
                  "total_duration_ms": 40, "worker_process_ms": 45, "download_ms": 5,
                  "worker_mode": "warm", "pages": []}
        finalize(connection, fixture, result)
        update = next(call for call in connection.execute.call_args_list if "status = 'extracted'" in call.args[0])
        metrics = json.loads(update.args[1][3])
        self.assertEqual(metrics, {"ocrEngine": "fake", "ocrModelVersion": "fixture", "ocrMs": 10,
                                   "providerInitMs": 25, "totalDurationMs": 40, "workerProcessMs": 45,
                                   "downloadMs": 5, "workerMode": "warm", "languagePolicy": "english_only",
                                   "processingEngineVersion": ENGLISH_ENGINE_VERSION,
                                   "requestedEngineVersion": ENGLISH_ENGINE_VERSION})

    def test_legacy_live_result_records_effective_policy_without_changing_requested_revision(self):
        connection = MagicMock(); connection.execute.return_value.fetchone.return_value = ("processing",)
        fixture = job() | {"id": "extraction", "lease": "lease", "engine_version": "1.0.5-worker"}
        result = {"engine": "paddleocr", "model_version": PaddleEnglishProvider.version,
                  "duration_ms": 10, "pages": []}
        finalize(connection, fixture, result)
        update = next(call for call in connection.execute.call_args_list if "status = 'extracted'" in call.args[0])
        metrics = json.loads(update.args[1][3])
        self.assertEqual(metrics["requestedEngineVersion"], "1.0.5-worker")
        self.assertEqual(metrics["processingEngineVersion"], ENGLISH_ENGINE_VERSION)
        self.assertEqual(metrics["languagePolicy"], "english_only")
        self.assertEqual(metrics["ocrModelVersion"], PaddleEnglishProvider.version)
        self.assertNotIn("engine_version =", update.args[0])

    def test_linux_cpu_budget_is_renewed_from_consumed_cpu_but_hard_lifetime_stays_bounded(self):
        resource = SimpleNamespace(RLIMIT_CPU=0, RLIMIT_AS=1, RUSAGE_SELF=2,
                                   setrlimit=MagicMock(), getrusage=MagicMock())
        resource.getrusage.side_effect = [SimpleNamespace(ru_utime=0.2, ru_stime=0.4),
                                         SimpleNamespace(ru_utime=300.3, ru_stime=120.2)]
        with patch("worker.sys.platform", "linux"), patch.dict(sys.modules, {"resource": resource}):
            _warm_resource_limits(8, first_job=True)
            _warm_resource_limits(8, first_job=False)
        self.assertEqual(resource.setrlimit.call_args_list[0].args, (1, (6 * 1024**3, 6 * 1024**3)))
        self.assertEqual(resource.setrlimit.call_args_list[1].args, (0, (601, 4810)))
        self.assertEqual(resource.setrlimit.call_args_list[2].args, (0, (1021, 4810)))

    def test_run_cleans_warm_child_and_restores_sigterm_handler_on_shutdown(self):
        config = Config("development-dsn", "https://example.invalid", "x" * 64, DEVELOPMENT_REF, "paddleocr", True)
        previous = signal.getsignal(signal.SIGTERM)
        connection = MagicMock(); connection.__enter__.return_value = connection

        def stop(*_):
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            return False

        with patch("worker.Config.from_env", return_value=config), patch("worker.WarmOCRProcess") as factory, \
             patch("worker.psycopg.connect", return_value=connection), patch("worker.process_one", side_effect=stop):
            run()
            factory.return_value.close.assert_called_once()
        self.assertIs(signal.getsignal(signal.SIGTERM), previous)

    def test_reconnect_recycles_warm_state_before_reopening_database(self):
        import psycopg
        config = Config("development-dsn", "https://example.invalid", "x" * 64, DEVELOPMENT_REF, "paddleocr", True)
        first = MagicMock(); first.__enter__.side_effect = psycopg.OperationalError("lost")
        second = MagicMock(); second.__enter__.return_value = second
        event = MagicMock(); event.is_set.return_value = False
        with patch("worker.Config.from_env", return_value=config), patch("worker.WarmOCRProcess") as factory, \
             patch("worker.psycopg.connect", side_effect=[first, second]), patch("worker.Event", return_value=event), \
             patch("worker.process_one", return_value=True), \
             patch.dict(os.environ, {"TEMO_WORKER_ONCE": "1", "TEMO_WORKER_TEST_MAX_JOBS": "1"}):
            run()
            self.assertEqual(factory.return_value.close.call_count, 2)

    def test_development_reuse_keeps_the_existing_queue_schedule(self):
        config = Config("development-dsn", "https://example.invalid", "x" * 64, DEVELOPMENT_REF, "paddleocr", True)
        connection = MagicMock(); connection.__enter__.return_value = connection
        event = MagicMock(); event.is_set.return_value = False
        with patch("worker.Config.from_env", return_value=config), patch("worker.WarmOCRProcess"), \
             patch("worker.psycopg.connect", return_value=connection), patch("worker.Event", return_value=event), \
             patch("worker.process_one", return_value=True) as process, \
             patch.dict(os.environ, {"TEMO_WORKER_ONCE": "1", "TEMO_WORKER_TEST_MAX_JOBS": "2"}):
            run()
            self.assertEqual(process.call_count, 2)
            event.wait.assert_called_once_with(2)


if __name__ == "__main__":
    unittest.main()
