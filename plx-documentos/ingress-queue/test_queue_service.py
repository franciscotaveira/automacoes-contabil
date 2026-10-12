import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from queue_service import Dispatcher, QueueHttpHandler, QueueHttpServer, QueueStore, idempotency_key


class FakeDispatcher(Dispatcher):
    def __init__(self, store, outcomes, **kwargs):
        super().__init__(store, "http://unused", "X-Test", "secret", **kwargs)
        self.outcomes = list(outcomes)
        self.calls = []
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def dispatch(self, payload):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            self.calls.append(payload)
            outcome = self.outcomes.pop(0) if self.outcomes else {"ok": True}
            if isinstance(outcome, Exception):
                raise outcome
            time.sleep(0.005)
            return outcome
        finally:
            with self.lock:
                self.active -= 1


class QueueServiceTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tempdir.name) / "queue.sqlite3")
        self.store = QueueStore(self.db_path)

    def tearDown(self):
        self.tempdir.cleanup()

    def payload(self, index=1):
        return {
            "tenant_id": "tenant-plx", "operation_id": "plx-documentos", "session_id": "plx-documentos",
            "group_id": "plx@g.us", "message_id": f"msg-{index}", "source_file_id": f"drive-{index}",
        }

    def test_idempotency_key_requires_group_and_message(self):
        self.assertEqual(idempotency_key(self.payload()), "waha:tenant-plx:plx-documentos:plx-documentos:plx@g.us:msg-1")
        with self.assertRaisesRegex(ValueError, "IDEMPOTENCY_KEY_REQUIRED"):
            idempotency_key({"tenant_id": "tenant-plx", "group_id": "plx@g.us"})

    def test_same_message_id_in_another_tenant_is_not_deduplicated(self):
        first = self.store.enqueue(self.payload())
        other_tenant = {**self.payload(), "tenant_id": "tenant-outro"}
        second = self.store.enqueue(other_tenant)
        self.assertTrue(first.accepted)
        self.assertTrue(second.accepted)
        self.assertNotEqual(first.key, second.key)

    def test_expired_claim_cannot_complete_after_new_claim(self):
        result = self.store.enqueue(self.payload())
        first = self.store.claim_next(lease_seconds=0.01)
        self.assertIsNotNone(first)
        time.sleep(0.02)
        second = self.store.claim_next(lease_seconds=1)
        self.assertIsNotNone(second)
        self.assertNotEqual(first["lease_token"], second["lease_token"])
        with self.assertRaisesRegex(RuntimeError, "LEASE_NOT_OWNED"):
            self.store.mark_done(result.job_id, first["lease_token"], {"ok": True})
        self.store.mark_done(result.job_id, second["lease_token"], {"ok": True})
        self.assertEqual(self.store.get(result.job_id)["status"], "done")

    def test_sequential_duplicate_returns_same_job(self):
        first = self.store.enqueue(self.payload())
        second = self.store.enqueue(self.payload())
        self.assertTrue(first.accepted)
        self.assertTrue(second.duplicate)
        self.assertEqual(first.job_id, second.job_id)
        self.assertEqual(sum(self.store.counts().values()), 1)

    def test_twenty_concurrent_duplicates_are_atomic(self):
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda _: self.store.enqueue(self.payload()), range(20)))
        self.assertEqual(sum(result.accepted for result in results), 1)
        self.assertEqual(len({result.job_id for result in results}), 1)
        self.assertEqual(self.store.counts()["queued"], 1)

    def test_twenty_distinct_documents_are_all_queued(self):
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda index: self.store.enqueue(self.payload(index)), range(20)))
        self.assertEqual(sum(result.accepted for result in results), 20)
        self.assertEqual(self.store.counts()["queued"], 20)

    def test_new_ingress_wakes_idle_dispatcher_without_polling_delay(self):
        self.store._work_available.clear()
        elapsed = []

        def wait_for_work():
            started = time.monotonic()
            self.store.wait_for_due_work(1)
            elapsed.append(time.monotonic() - started)

        waiter = threading.Thread(target=wait_for_work)
        waiter.start()
        time.sleep(0.02)
        self.store.enqueue(self.payload())
        waiter.join(timeout=0.5)
        self.assertFalse(waiter.is_alive())
        self.assertLess(elapsed[0], 0.5)

    def test_dispatcher_processes_queue_serially(self):
        for index in range(20):
            self.store.enqueue(self.payload(index))
        dispatcher = FakeDispatcher(self.store, [{"ok": True}] * 20)
        dispatcher.start()
        deadline = time.time() + 5
        while self.store.counts()["done"] < 20 and time.time() < deadline:
            time.sleep(0.01)
        dispatcher.stop()
        dispatcher.join(timeout=2)
        self.assertEqual(self.store.counts()["done"], 20)
        self.assertEqual(len({call["message_id"] for call in dispatcher.calls}), 20)
        self.assertEqual(dispatcher.max_active, 1)

    def test_transient_failure_retries_then_succeeds(self):
        result = self.store.enqueue(self.payload())
        dispatcher = FakeDispatcher(
            self.store, [RuntimeError("temporary"), {"ok": True}],
            max_attempts=3, retry_base_seconds=0,
        )
        self.assertTrue(dispatcher.run_once())
        self.assertEqual(self.store.get(result.job_id)["status"], "retry")
        self.assertTrue(dispatcher.run_once())
        job = self.store.get(result.job_id)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["attempts"], 2)

    def test_permanent_failure_moves_to_failed(self):
        result = self.store.enqueue(self.payload())
        dispatcher = FakeDispatcher(
            self.store, [RuntimeError("one"), RuntimeError("two")],
            max_attempts=2, retry_base_seconds=0,
        )
        dispatcher.run_once()
        dispatcher.run_once()
        job = self.store.get(result.job_id)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["attempts"], 2)
        self.assertIn("two", job["last_error"])

    def test_processing_job_is_recovered_after_restart(self):
        result = self.store.enqueue(self.payload())
        claimed = self.store.claim_next()
        self.assertEqual(claimed["status"], "processing")
        recovered = QueueStore(self.db_path).get(result.job_id)
        self.assertEqual(recovered["status"], "retry")
        self.assertEqual(recovered["last_error"], "RECOVERED_AFTER_RESTART")

    def test_failed_job_can_start_one_new_governed_retry_cycle(self):
        result = self.store.enqueue(self.payload())
        dispatcher = FakeDispatcher(
            self.store, [RuntimeError("provider unavailable")],
            max_attempts=1, retry_base_seconds=0,
        )
        dispatcher.run_once()
        self.assertEqual(self.store.get(result.job_id)["status"], "failed")
        retried = self.store.retry_failed(result.job_id)
        self.assertEqual(retried["status"], "retry")
        self.assertEqual(retried["attempts"], 0)
        self.assertEqual(retried["manual_retries"], 1)
        self.assertIn("provider unavailable", retried["last_error"])


class QueueHttpTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.store = QueueStore(str(Path(self.tempdir.name) / "http.sqlite3"))
        self.server = QueueHttpServer(("127.0.0.1", 0), QueueHttpHandler)
        self.server.store = self.store
        self.server.internal_token = "test-secret"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.tempdir.cleanup()

    def request(self, path, method="GET", body=None, token=None):
        headers = {}
        if token is not None:
            headers["X-Internal-Token"] = token
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.loads(error.read())
            finally:
                error.close()

    def test_health_exposes_only_counts(self):
        status, body = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["queue"]["queued"], 0)
        self.assertNotIn("jobs", body)

    def test_enqueue_requires_token(self):
        status, body = self.request("/v1/documents", "POST", {"group_id": "g", "message_id": "m"})
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "FORBIDDEN")

    def test_concurrent_http_duplicates_return_one_accepted_job(self):
        payload = {"tenant_id": "tenant-plx", "operation_id": "plx-documentos", "session_id": "plx-documentos", "group_id": "plx@g.us", "message_id": "same", "source_file_id": "drive"}
        with ThreadPoolExecutor(max_workers=20) as pool:
            responses = list(pool.map(
                lambda _: self.request("/v1/documents", "POST", payload, "test-secret"),
                range(20),
            ))
        self.assertTrue(all(status == 202 for status, _ in responses))
        bodies = [body for _, body in responses]
        self.assertEqual(sum(body["accepted"] for body in bodies), 1)
        self.assertEqual(len({body["job_id"] for body in bodies}), 1)

    def test_invalid_payload_fails_closed(self):
        status, body = self.request("/v1/documents", "POST", {"tenant_id": "tenant-plx", "group_id": "plx@g.us"}, "test-secret")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "IDEMPOTENCY_KEY_REQUIRED")

    def test_retry_endpoint_only_reopens_failed_jobs(self):
        queued = self.store.enqueue({"tenant_id": "tenant-plx", "operation_id": "plx-documentos", "session_id": "plx-documentos", "group_id": "plx@g.us", "message_id": "queued"})
        status, body = self.request(f"/v1/jobs/{queued.job_id}/retry", "POST", token="test-secret")
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "JOB_NOT_FAILED")

        failed = self.store.enqueue({"tenant_id": "tenant-plx", "operation_id": "plx-documentos", "session_id": "plx-documentos", "group_id": "plx@g.us", "message_id": "failed"})
        dispatcher = FakeDispatcher(self.store, [{"ok": True}, RuntimeError("temporary")], max_attempts=1)
        dispatcher.run_once()  # claims and completes the older queued job first
        dispatcher.run_once()
        self.assertEqual(self.store.get(failed.job_id)["status"], "failed")
        status, body = self.request(f"/v1/jobs/{failed.job_id}/retry", "POST", token="test-secret")
        self.assertEqual(status, 202)
        self.assertEqual(body["status"], "retry")
        self.assertEqual(body["manual_retries"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
