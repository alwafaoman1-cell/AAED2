"""Fail-closed and lease-recovery checks; no live database or documents."""
from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from worker import (ENGINE_VERSIONS, ENGLISH_ENGINE_VERSION, LEGACY_ENGINE_VERSIONS,
                    Config, InvalidDocument, _run_ocr, claim_next, download, run)


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
