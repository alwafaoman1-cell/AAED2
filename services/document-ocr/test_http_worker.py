"""Real loopback HTTP contract tests; no database, Paddle or cloud access."""
import http.client
import json
import os
import signal
import unittest
from http.server import ThreadingHTTPServer
from threading import Event, Lock, Thread
from unittest.mock import MagicMock, patch

import http_worker
from worker import Config

TARGET = "00000000-0000-4000-8000-000000000123"
ENVIRONMENT = {"TEMO_OCR_DISPATCH_SECRET": "s" * 64, "TEMO_DOCUMENT_DOWNLOAD_SECRET": "d" * 64,
               "CRON_SECRET": "c" * 32}


class HTTPWorkerTests(unittest.TestCase):
    def setUp(self):
        self.environment = dict(ENVIRONMENT)
        self.config = Config("private-dsn", "https://example.invalid", "d" * 64, "production-ref", "paddleocr")
        self.config_factory = MagicMock(return_value=self.config)
        self.connection = MagicMock()
        self.connection.__enter__.return_value = self.connection
        self.connect = MagicMock(return_value=self.connection)
        self.processor = MagicMock(return_value=True)
        self.gate = Lock()
        handler = http_worker.create_handler(environment=self.environment, config_factory=self.config_factory,
                 connection_factory=self.connect, processor=self.processor, gate=self.gate)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, method="POST", url=http_worker.RUN_PATH, body=None, *, secret=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        if body is None and method == "POST":
            body = json.dumps({"extraction_id": TARGET})
        supplied = {"Content-Type": "application/json"}
        if secret is not False:
            supplied["Authorization"] = "Bearer " + (secret or self.environment["TEMO_OCR_DISPATCH_SECRET"])
        supplied.update(headers or {})
        connection.request(method, url, body=body, headers=supplied)
        response = connection.getresponse()
        status, value = response.status, json.loads(response.read())
        connection.close()
        return status, value

    def test_public_health_does_not_load_config_database_or_models(self):
        self.environment.clear()
        with patch("worker.PaddleEnglishProvider") as paddle:
            status, value = self.request("GET", "/healthz", secret=False)
        self.assertEqual((status, value), (200, {"ok": True}))
        self.config_factory.assert_not_called()
        self.connect.assert_not_called()
        self.processor.assert_not_called()
        paddle.assert_not_called()

    def test_wrong_missing_or_cross_purpose_auth_is_rejected_before_config_or_models(self):
        for secret in (False, "wrong", ENVIRONMENT["CRON_SECRET"]):
            with self.subTest(secret=bool(secret)), patch("worker.PaddleEnglishProvider") as paddle:
                self.assertEqual(self.request(secret=secret)[0], 401)
                paddle.assert_not_called()
        self.assertEqual(self.request("GET", http_worker.SWEEP_PATH)[0], 401)
        self.config_factory.assert_not_called()
        self.connect.assert_not_called()
        self.processor.assert_not_called()

    def test_short_or_reused_dispatch_secret_is_unavailable_before_config(self):
        for value in ("short", ENVIRONMENT["TEMO_DOCUMENT_DOWNLOAD_SECRET"]):
            self.environment["TEMO_OCR_DISPATCH_SECRET"] = value
            self.assertEqual(self.request()[0], 503)
        self.config_factory.assert_not_called()
        self.connect.assert_not_called()

    def test_malformed_oversized_extra_or_duplicate_fields_do_not_claim(self):
        bodies = ["", "{", "[]", "{}", json.dumps({"extraction_id": "bad"}),
                  json.dumps({"extraction_id": TARGET, "tenant_id": TARGET}), " " * 513,
                  '{"extraction_id":"' + TARGET + '","extraction_id":"' + TARGET + '"}']
        for body in bodies:
            with self.subTest(bodyLength=len(body)):
                self.assertEqual(self.request(body=body)[0], 400)
        self.assertEqual(self.request(headers={"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.request(headers={"Transfer-Encoding": "chunked"})[0], 400)
        self.config_factory.assert_not_called()
        self.processor.assert_not_called()

    def test_targeted_request_is_synchronous_uses_spawn_and_returns_no_document_state(self):
        self.assertEqual(self.request(), (200, {"processed": 1, "status": "attempted"}))
        call = self.processor.call_args
        self.assertEqual(call.args, (self.config, self.connection))
        self.assertEqual(call.kwargs["extraction_id"], TARGET)
        self.assertIs(call.kwargs["serialized"], True)
        self.assertEqual(call.kwargs["process_context"].get_start_method(), "spawn")
        self.assertIsInstance(call.kwargs["deadline"], float)
        self.assertFalse(self.gate.locked())

    def test_sweep_uses_cron_auth_and_claims_only_one_oldest_due_job(self):
        self.assertEqual(self.request("GET", http_worker.SWEEP_PATH, secret=ENVIRONMENT["CRON_SECRET"])[0], 200)
        self.assertIsNone(self.processor.call_args.kwargs["extraction_id"])
        self.processor.assert_called_once()

    def test_local_busy_does_not_load_config_or_claim_and_duplicate_uses_cloud_state(self):
        self.gate.acquire()
        try:
            self.assertEqual(self.request(), (202, {"processed": 0, "status": "busy"}))
        finally:
            self.gate.release()
        self.config_factory.assert_not_called()
        self.processor.side_effect = [True, False]
        self.assertEqual(self.request()[1]["processed"], 1)
        self.assertEqual(self.request(), (200, {"processed": 0, "status": "idle_or_busy"}))

    def test_concurrent_requests_never_enter_ocr_twice(self):
        entered, release = Event(), Event()
        result = []

        def process(*_args, **_kwargs):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("test timeout")
            return True

        self.processor.side_effect = process
        first = Thread(target=lambda: result.append(self.request()))
        first.start()
        try:
            self.assertTrue(entered.wait(2))
            self.assertEqual(self.request(), (202, {"processed": 0, "status": "busy"}))
            self.processor.assert_called_once()
        finally:
            release.set()
            first.join(3)
        self.assertEqual(result, [(200, {"processed": 1, "status": "attempted"})])

    def test_failure_is_sanitized_and_releases_gate_for_next_request(self):
        self.processor.side_effect = RuntimeError("private tenant document token secret")
        self.assertEqual(self.request(), (503, {"processed": 0, "status": "unavailable"}))
        self.assertFalse(self.gate.locked())
        self.processor.side_effect = None
        self.assertEqual(self.request()[0], 200)

    def test_http_refuses_tesseract_or_warm_configuration(self):
        for provider, warm in (("tesseract", False), ("paddleocr", True)):
            self.config_factory.return_value = Config("dsn", "https://example.invalid", "d" * 64, "ref", provider, warm)
            self.assertEqual(self.request()[0], 503)
        self.connect.assert_not_called()
        self.processor.assert_not_called()

    def test_connection_uses_server_side_timeouts(self):
        with patch("http_worker.psycopg.connect") as connect:
            http_worker._connect(self.config)
        self.assertEqual(connect.call_args.kwargs["connect_timeout"], 10)
        self.assertIn("statement_timeout=15000", connect.call_args.kwargs["options"])
        self.assertIn("lock_timeout=5000", connect.call_args.kwargs["options"])

    def test_sigterm_starts_shutdown_on_another_thread(self):
        server = MagicMock()

        def terminate(**_kwargs):
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)

        server.serve_forever.side_effect = terminate
        previous = signal.getsignal(signal.SIGTERM)
        with patch.dict(os.environ, {"PORT": "8080"}), patch("http_worker.ThreadingHTTPServer", return_value=server), \
                patch("http_worker.Thread") as thread:
            http_worker.run()
        self.assertEqual(thread.call_args.kwargs["target"], server.shutdown)
        thread.return_value.start.assert_called_once()
        server.server_close.assert_called_once()
        self.assertIs(server.daemon_threads, False)
        self.assertIs(server.block_on_close, True)
        self.assertIs(signal.getsignal(signal.SIGTERM), previous)


class HTTPDrainTests(unittest.TestCase):
    def test_sigterm_drains_active_handler_before_run_returns(self):
        entered, release, returned = Event(), Event(), Event()
        observed, failures, responses = [], [], []
        config = Config("dsn", "https://example.invalid", "d" * 64, "ref", "paddleocr")
        connection = MagicMock()
        connection.__enter__.return_value = connection

        def process(*_args, **_kwargs):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("drain test timeout")
            return True

        handler = http_worker.create_handler(environment=ENVIRONMENT, config_factory=lambda: config,
                      connection_factory=lambda _config: connection, processor=process)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)

        def client():
            try:
                request = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                request.request("POST", http_worker.RUN_PATH, body=json.dumps({"extraction_id": TARGET}),
                    headers={"Authorization": "Bearer " + ENVIRONMENT["TEMO_OCR_DISPATCH_SECRET"],
                             "Content-Type": "application/json"})
                response = request.getresponse()
                responses.append((response.status, json.loads(response.read())))
                request.close()
            except Exception as error:
                failures.append(type(error).__name__)

        def coordinate():
            active = Thread(target=client)
            active.start()
            try:
                if not entered.wait(2):
                    failures.append("handler did not start")
                signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
                observed.append(returned.wait(.1))
            finally:
                release.set()
                active.join(3)

        helper = Thread(target=coordinate)
        with patch.dict(os.environ, {"PORT": "8080"}), patch("http_worker.ThreadingHTTPServer", return_value=server):
            helper.start()
            try:
                http_worker.run()
                returned.set()
            finally:
                release.set()
                helper.join(4)
        self.assertEqual(failures, [])
        self.assertEqual(observed, [False])
        self.assertEqual(responses, [(200, {"processed": 1, "status": "attempted"})])


if __name__ == "__main__":
    unittest.main()
