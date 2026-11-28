"""Fail-closed and lease-recovery checks; no live database or documents."""
from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock, patch

from worker import (ENGINE_VERSIONS, ENGLISH_ENGINE_VERSION, LEGACY_ENGINE_VERSIONS,
                    Config, InvalidDocument, SERIALIZED_CLAIM_LOCK, _run_ocr, claim_next, download,
                    finalize, process_isolated, process_one, run)


class FakeConnection:
    def __init__(self, row=None):
        self.statements: list[str] = []
        self.parameters: list[tuple] = []
        self.row = row

    def transaction(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, _parameters):
        self.statements.append(sql)
        self.parameters.append(_parameters)
        return self

    def fetchone(self):
        return self.row


class WorkerTests(unittest.TestCase):
    def test_new_policy_retains_previous_english_revision_as_drainable(self):
        self.assertEqual(ENGLISH_ENGINE_VERSION, "1.0.8-en-worker")
        self.assertIn("1.0.7-en-worker", LEGACY_ENGINE_VERSIONS)

    def test_serialized_claim_returns_before_cleanup_if_lock_or_active_job_is_busy(self):
        for responses, statements in (([(False,)], 1), ([(True,), (True,)], 2)):
            connection = FakeConnection()
            iterator = iter(responses)
            connection.fetchone = lambda: next(iterator)
            self.assertIsNone(claim_next(connection, serialized=True))
            self.assertEqual(len(connection.statements), statements)
            self.assertEqual(connection.parameters[0], (SERIALIZED_CLAIM_LOCK,))
            self.assertFalse(any("update public" in sql.lower() for sql in connection.statements))

    def test_serialized_targeted_claim_scopes_cleanup_and_eligible_row(self):
        target = "00000000-0000-4000-8000-000000000123"
        row = (target, "tenant", "file", 0, "temo-documents", "tenant/file.png", "image/png", "a" * 64,
               "file.png", "1.0.7-en-worker")
        connection = FakeConnection()
        responses = iter([(True,), (False,), row])
        connection.fetchone = lambda: next(responses)
        result = claim_next(connection, target, serialized=True)
        self.assertEqual(result["id"], target)
        self.assertEqual(result["engine_version"], "1.0.7-en-worker")
        self.assertIn("processing_started_at >= now() - interval '6 minutes'", connection.statements[1])
        self.assertEqual(connection.parameters[2][-2:], (target, target))
        self.assertEqual(connection.parameters[3][-2:], (target, target))
        self.assertIn("id = %s::uuid", connection.statements[2])
        self.assertIn("e.id = %s::uuid", connection.statements[3])
        self.assertIn("skip locked", connection.statements[3])

    def test_bad_target_is_rejected_before_database_access(self):
        connection = FakeConnection()
        with self.assertRaises(ValueError):
            claim_next(connection, "not-a-uuid", serialized=True)
        self.assertEqual(connection.statements, [])

    def test_isolated_uses_supplied_spawn_context_without_database_state(self):
        context = MagicMock()
        parent, child = MagicMock(), MagicMock()
        context.Pipe.return_value = (parent, child)
        parent.poll.return_value = True
        parent.recv.return_value = ("success", {"pages": []})
        context.Process.return_value.is_alive.return_value = False
        self.assertEqual(process_isolated(b"raw", {"filename": "test.png"}, "paddleocr", context=context,
                                          timeout_seconds=42), ("success", {"pages": []}))
        parent.poll.assert_called_once_with(42)
        self.assertEqual(context.Process.call_args.kwargs["target"], _run_ocr)
        self.assertEqual(context.Process.call_args.kwargs["args"],
                         (b"raw", {"filename": "test.png"}, "paddleocr", child))

    def test_failed_spawn_closes_both_pipe_ends_without_joining_unstarted_child(self):
        context = MagicMock()
        parent, child = MagicMock(), MagicMock()
        context.Pipe.return_value = (parent, child)
        context.Process.return_value.start.side_effect = RuntimeError("spawn failed")
        with self.assertRaisesRegex(RuntimeError, "spawn failed"):
            process_isolated(b"raw", {}, "paddleocr", context=context)
        parent.close.assert_called_once()
        child.close.assert_called_once()
        context.Process.return_value.close.assert_called_once()
        context.Process.return_value.join.assert_not_called()

    def test_finalizer_persists_preprocessing_profile_and_rejects_lost_lease(self):
        connection = MagicMock()
        job = {"id": "extraction", "tenant_id": "tenant", "lease": "lease"}
        result = {"engine": "paddleocr", "model_version": "PP-OCRv5-en-only-1.0.8", "duration_ms": 1,
                  "pages": [], "preprocessing_profile": "bounded-pages-1800-2mp-v2"}
        connection.execute.return_value.fetchone.return_value = ("processing",)
        finalize(connection, job, result)
        update = next(call for call in connection.execute.call_args_list if "status = 'extracted'" in call.args[0])
        self.assertEqual(json.loads(update.args[1][3])["preprocessingProfile"], result["preprocessing_profile"])
        connection.reset_mock()
        connection.execute.return_value.fetchone.return_value = None
        with self.assertRaisesRegex(RuntimeError, "DOCUMENT_LEASE_LOST"):
            finalize(connection, job, result)
        self.assertEqual(connection.execute.call_count, 1)

    def test_http_process_passes_target_spawn_and_deadline_and_records_finalize_failure(self):
        config = Config("dsn", "https://example.invalid", "d" * 64, "ref", "paddleocr")
        target = "00000000-0000-4000-8000-000000000123"
        fixture = {"id": target, "tenant_id": "tenant", "lease": "lease", "filename": "test.png",
                   "mime": "image/png", "sha256": "a" * 64, "attempt_count": 0}
        context = object()
        with patch("worker.claim_next", return_value=fixture) as claim, patch("worker.download", return_value=b"raw") as downloaded, \
                patch("worker.process_isolated", return_value=("success", {"pages": []})) as isolated, \
                patch("worker.finalize", side_effect=RuntimeError("private data")), patch("worker.fail_job") as failed, \
                patch("worker.time.monotonic", return_value=100):
            self.assertTrue(process_one(config, MagicMock(), extraction_id=target, serialized=True,
                                        process_context=context, deadline=200))
        self.assertEqual(claim.call_args.args[1], target)
        self.assertEqual(claim.call_args.kwargs, {"serialized": True})
        downloaded.assert_called_once_with(config, fixture, max_seconds=30)
        self.assertEqual(isolated.call_args.kwargs, {"context": context, "timeout_seconds": 80})
        self.assertEqual(failed.call_args.args[2:], ("DOCUMENT_WORKER_IO_FAILED", True))

    def test_expired_http_budget_leaves_job_unclaimed_without_starting_ocr(self):
        config = Config("dsn", "https://example.invalid", "d" * 64, "ref", "paddleocr")
        with patch("worker.time.monotonic", return_value=100), patch("worker.claim_next") as claim, \
                patch("worker.process_isolated") as isolated:
            self.assertFalse(process_one(config, MagicMock(), serialized=True, deadline=110))
        claim.assert_not_called()
        isolated.assert_not_called()

    def test_http_download_time_budget_is_checked_during_stream(self):
        config = Config("dsn", "https://example.invalid", "d" * 64, "ref", "paddleocr")
        fixture = {"id": "id", "tenant_id": "tenant", "lease": "lease", "bucket": "temo-documents", "path": "tenant/file.png"}
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = 200
        response.iter_content.return_value = [b"raw"]
        with patch("worker.requests.post", return_value=response) as post, \
                patch("worker.time.monotonic", side_effect=[0, 31]):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_STORAGE_DOWNLOAD_TIMEOUT"):
                download(config, fixture, max_seconds=30)
        self.assertEqual(post.call_args.kwargs["timeout"], (5, 5))

    def test_accepts_production_only_when_environment_and_role_match(self):
        with patch.dict(os.environ, {
            "TEMO_ALLOWED_SUPABASE_REF": "ifnfwssdtjuzdtshnrht",
            "TEMO_WORKER_ENVIRONMENT": "production",
            "TEMO_SUPABASE_URL": "https://ifnfwssdtjuzdtshnrht.supabase.co",
            "TEMO_DOCUMENT_DB_DSN": "postgresql://temo_document_worker:password@db.ifnfwssdtjuzdtshnrht.supabase.co/postgres?sslmode=require",
            "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64,
        }):
            self.assertEqual(Config.from_env().project_ref, "ifnfwssdtjuzdtshnrht")

    def test_refuses_cross_environment_production_or_short_secret(self):
        env = {
            "TEMO_ALLOWED_SUPABASE_REF": "ifnfwssdtjuzdtshnrht",
            "TEMO_WORKER_ENVIRONMENT": "development",
            "TEMO_SUPABASE_URL": "https://ifnfwssdtjuzdtshnrht.supabase.co",
            "TEMO_DOCUMENT_DB_DSN": "postgresql://temo_document_worker:password@db.ifnfwssdtjuzdtshnrht.supabase.co/postgres?sslmode=require",
            "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64,
        }
        with patch.dict(os.environ, env):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_ENVIRONMENT_MISMATCH"):
                Config.from_env()
        env["TEMO_WORKER_ENVIRONMENT"] = "production"
        env["TEMO_DOCUMENT_DOWNLOAD_SECRET"] = "short"
        with patch.dict(os.environ, env):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_DOWNLOAD_SECRET_INVALID"):
                Config.from_env()

    def test_refuses_mismatched_database_and_host(self):
        env = {
            "TEMO_ALLOWED_SUPABASE_REF": "rrhyglrnlveygyiandhs",
            "TEMO_WORKER_ENVIRONMENT": "development",
            "TEMO_SUPABASE_URL": "https://rrhyglrnlveygyiandhs.supabase.co",
            "TEMO_DOCUMENT_DB_DSN": "postgresql://postgres.other@example.invalid/db",
            "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64,
        }
        with patch.dict(os.environ, env):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_DB_PROJECT_UNVERIFIED"):
                Config.from_env()
        env["TEMO_SUPABASE_URL"] = "https://other.supabase.co"
        with patch.dict(os.environ, env):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_PROJECT_MISMATCH"):
                Config.from_env()

    def test_dsn_cannot_smuggle_development_ref_in_query_string(self):
        ref = "rrhyglrnlveygyiandhs"
        env = {
            "TEMO_ALLOWED_SUPABASE_REF": ref,
            "TEMO_WORKER_ENVIRONMENT": "development",
            "TEMO_SUPABASE_URL": f"https://{ref}.supabase.co",
            "TEMO_DOCUMENT_DB_DSN": f"postgresql://postgres:password@db.other.supabase.co/postgres?application_name={ref}",
            "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64,
        }
        with patch.dict(os.environ, env):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_DB_PROJECT_UNVERIFIED"):
                Config.from_env()

    def test_development_pooler_worker_identity_is_accepted(self):
        ref = "rrhyglrnlveygyiandhs"
        with patch.dict(os.environ, {
            "TEMO_ALLOWED_SUPABASE_REF": ref,
            "TEMO_WORKER_ENVIRONMENT": "development",
            "TEMO_SUPABASE_URL": f"https://{ref}.supabase.co",
            "TEMO_DOCUMENT_DB_DSN": f"postgresql://temo_document_worker.{ref}:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require",
            "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64,
        }):
            self.assertEqual(Config.from_env().project_ref, ref)

    def test_database_owner_identity_is_rejected(self):
        ref = "rrhyglrnlveygyiandhs"
        with patch.dict(os.environ, {
            "TEMO_ALLOWED_SUPABASE_REF": ref,
            "TEMO_WORKER_ENVIRONMENT": "development",
            "TEMO_SUPABASE_URL": f"https://{ref}.supabase.co",
            "TEMO_DOCUMENT_DB_DSN": f"postgresql://postgres:password@db.{ref}.supabase.co/postgres?sslmode=require",
            "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64,
        }):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_DB_PROJECT_UNVERIFIED"):
                Config.from_env()

    def test_dedicated_development_worker_role_is_accepted_without_other_roles(self):
        ref = "rrhyglrnlveygyiandhs"
        base = {
            "TEMO_ALLOWED_SUPABASE_REF": ref,
            "TEMO_WORKER_ENVIRONMENT": "development",
            "TEMO_SUPABASE_URL": f"https://{ref}.supabase.co",
            "TEMO_DOCUMENT_DOWNLOAD_SECRET": "x" * 64,
        }
        with patch.dict(os.environ, base | {"TEMO_DOCUMENT_DB_DSN":
                f"postgresql://temo_document_worker.{ref}:password@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require"}):
            self.assertEqual(Config.from_env().project_ref, ref)
        with patch.dict(os.environ, base | {"TEMO_DOCUMENT_DB_DSN":
                f"postgresql://other_role.{ref}:password@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require"}):
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_WORKER_DB_PROJECT_UNVERIFIED"):
                Config.from_env()

    def test_claim_reaps_expired_lease_and_can_retry_stale_job(self):
        connection = FakeConnection()
        self.assertIsNone(claim_next(connection))
        self.assertEqual(set(ENGINE_VERSIONS), LEGACY_ENGINE_VERSIONS | {ENGLISH_ENGINE_VERSION})
        self.assertEqual(len(connection.statements), 2)
        self.assertIn("DOCUMENT_OCR_WORKER_LOST", connection.statements[0])
        self.assertIn("skip locked", connection.statements[1].lower())
        self.assertIn("processing_started_at < now() - interval '6 minutes'", connection.statements[1])

    def test_claim_preserves_requested_version_while_draining_all_supported_live_versions(self):
        for version in ENGINE_VERSIONS:
            with self.subTest(version=version):
                row = ("extraction", "tenant", "file", 0, "temo-documents", "tenant/file.png",
                       "image/png", "a" * 64, "file.png", version)
                connection = FakeConnection(row)
                claimed = claim_next(connection)
                self.assertEqual(claimed["engine_version"], version)
                self.assertEqual(claimed["id"], row[0])
                self.assertTrue(claimed["lease"])
                self.assertIn(version, connection.parameters[0][0])
                self.assertIn(version, connection.parameters[1][0])
                self.assertIn("e.status in ('queued', 'retryable_failed')", connection.statements[1])
                self.assertIn("e.status = 'processing'", connection.statements[1])
                # Claiming changes the lease/status, never an archived revision's identity.
                self.assertNotIn("engine_version =", connection.statements[2])

    def test_isolated_legacy_jobs_use_actual_english_filter_and_model_metadata(self):
        import hashlib
        import io
        from PIL import Image
        from ocr_core import PaddleEnglishProvider

        output = io.BytesIO()
        Image.new("RGB", (32, 32), "white").save(output, format="PNG")
        raw = output.getvalue()
        # Exercise the real document pipeline, including its native-text filter,
        # without loading an inference model or using operational documents.
        page = (1, None, "Claim No: SYNTHETIC-ENGLISH\nاسم العميل: بيانات سابقة", 600, 800)
        for version in ENGINE_VERSIONS:
            with self.subTest(version=version):
                connection = MagicMock()
                job = {"filename": "fixture.png", "mime": "image/png",
                       "sha256": hashlib.sha256(raw).hexdigest(), "engine_version": version}
                with patch("worker.sys.platform", "win32"), patch("ocr_core._image_pages", return_value=[page]):
                    _run_ocr(raw, job, "paddleocr", connection)
                outcome, result = connection.send.call_args.args[0]
                self.assertEqual(outcome, "success")
                self.assertEqual(result["pages"][0]["text"], "Claim No: SYNTHETIC-ENGLISH")
                self.assertEqual(result["model_version"], PaddleEnglishProvider.version)
                self.assertEqual(job["engine_version"], version)

    def test_private_storage_path_is_tenant_scoped(self):
        config = Config("", "https://example.invalid", "x" * 64, "development", "paddleocr")
        with self.assertRaisesRegex(InvalidDocument, "DOCUMENT_STORAGE_SCOPE_INVALID"):
            download(config, {"bucket": "public", "path": "other/file.pdf", "tenant_id": "expected"})

    def test_storage_redirect_does_not_forward_server_credentials(self):
        from unittest.mock import MagicMock
        config = Config("", "https://example.invalid", "x" * 64, "development", "paddleocr")
        response = MagicMock()
        response.__enter__.return_value.status_code = 302
        job = {"bucket": "temo-documents", "path": "tenant-id/file.png", "tenant_id": "tenant-id",
               "id": "extraction-id", "lease": "lease-id"}
        with patch("worker.requests.post", return_value=response) as request:
            with self.assertRaisesRegex(RuntimeError, "DOCUMENT_STORAGE_DOWNLOAD_FAILED"):
                download(config, job)
        self.assertFalse(request.call_args.kwargs["allow_redirects"])
        self.assertNotIn("apikey", request.call_args.kwargs["headers"])

    def test_reconnects_after_database_connection_failure(self):
        from unittest.mock import MagicMock

        first = MagicMock()
        first.__enter__.side_effect = __import__("psycopg").OperationalError("lost")
        second = MagicMock()
        second.__enter__.return_value = second
        config = Config("development-dsn", "https://example.invalid", "x" * 64, "development", "paddleocr")
        with patch("worker.Config.from_env", return_value=config), \
             patch("worker.psycopg.connect", side_effect=[first, second]) as connect, \
             patch("worker.process_one", return_value=True), \
             patch("worker.time.sleep"), \
             patch.dict(os.environ, {"TEMO_WORKER_ONCE": "1", "TEMO_WORKER_TEST_MAX_JOBS": "1"}):
            run()
        self.assertEqual(connect.call_count, 2)


if __name__ == "__main__":
    unittest.main()
