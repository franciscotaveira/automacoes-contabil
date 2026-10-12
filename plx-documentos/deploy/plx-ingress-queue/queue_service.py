#!/usr/bin/env python3
"""Durable, serial ingress queue for the PLX document workflow.

The service accepts normalized document jobs, persists them in SQLite with a
UNIQUE idempotency key, and dispatches one job at a time to n8n.  This closes
the check-then-insert race that exists when several identical webhook requests
reach an n8n Data Table concurrently.
"""

from __future__ import annotations

import hmac
import json
import os
import signal
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from contextlib import closing
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','retry','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at REAL NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  response_json TEXT NOT NULL DEFAULT '',
  manual_retries INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_dispatch_idx
  ON jobs(status, next_attempt_at, id);
"""


def idempotency_key(payload: dict[str, Any]) -> str:
    explicit = str(payload.get("idempotency_key") or "").strip()
    if explicit:
        return explicit
    group_id = str(payload.get("group_id") or "").strip()
    message_id = str(payload.get("message_id") or "").strip()
    if not group_id or not message_id:
        raise ValueError("IDEMPOTENCY_KEY_REQUIRED")
    return f"waha:{group_id}:{message_id}"


@dataclass(frozen=True)
class EnqueueResult:
    accepted: bool
    duplicate: bool
    job_id: int
    status: str
    key: str


class QueueStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        # Dispatchers sleep while there is nothing due. New ingress wakes them
        # immediately, so idle polling does not consume CPU or SQLite writes.
        self._work_available = threading.Event()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        return conn

    def _initialize(self) -> None:
        with closing(self.connect()) as conn:
            conn.executescript(SCHEMA)
            columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
            if "manual_retries" not in columns:
                conn.execute("ALTER TABLE jobs ADD COLUMN manual_retries INTEGER NOT NULL DEFAULT 0")
            # A process may die after claiming a job. Requeue it on startup.
            now = time.time()
            conn.execute(
                "UPDATE jobs SET status='retry', next_attempt_at=?, "
                "last_error='RECOVERED_AFTER_RESTART', updated_at=? "
                "WHERE status='processing'",
                (now, now),
            )

    def enqueue(self, payload: dict[str, Any]) -> EnqueueResult:
        key = idempotency_key(payload)
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        now = time.time()
        with closing(self.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                "INSERT OR IGNORE INTO jobs "
                "(idempotency_key,payload_json,status,next_attempt_at,created_at,updated_at) "
                "VALUES (?,?, 'queued', 0, ?, ?)",
                (key, encoded, now, now),
            )
            inserted = cursor.rowcount == 1
            row = conn.execute(
                "SELECT id,status FROM jobs WHERE idempotency_key=?", (key,)
            ).fetchone()
            conn.commit()
        assert row is not None
        if inserted:
            self._work_available.set()
        return EnqueueResult(inserted, not inserted, int(row["id"]), row["status"], key)

    def wait_for_due_work(self, timeout: float) -> None:
        """Wait for ingress, or until the next scheduled retry may be due."""
        self._work_available.wait(max(0.01, timeout))
        self._work_available.clear()

    def next_dispatch_wait_seconds(self, maximum: float = 5.0) -> float:
        """Bound idle waiting without delaying scheduled retries unnecessarily."""
        now = time.time()
        with closing(self.connect()) as conn:
            row = conn.execute(
                "SELECT MIN(next_attempt_at) AS next_attempt_at "
                "FROM jobs WHERE status IN ('queued','retry')"
            ).fetchone()
        next_attempt = row["next_attempt_at"] if row else None
        if next_attempt is None:
            return maximum
        return max(0.01, min(maximum, float(next_attempt) - now))

    def claim_next(self) -> sqlite3.Row | None:
        now = time.time()
        with closing(self.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM jobs WHERE status IN ('queued','retry') "
                "AND next_attempt_at<=? ORDER BY id LIMIT 1", (now,)
            ).fetchone()
            if row is None:
                conn.commit()
                return None
            conn.execute(
                "UPDATE jobs SET status='processing', attempts=attempts+1, updated_at=? "
                "WHERE id=?", (now, row["id"]),
            )
            claimed = conn.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone()
            conn.commit()
            return claimed

    def mark_done(self, job_id: int, response: dict[str, Any]) -> None:
        now = time.time()
        with closing(self.connect()) as conn:
            conn.execute(
                "UPDATE jobs SET status='done', response_json=?, last_error='', updated_at=? "
                "WHERE id=?",
                (json.dumps(response, ensure_ascii=False), now, job_id),
            )

    def mark_failure(self, job_id: int, error: str, max_attempts: int, retry_delay: float) -> str:
        now = time.time()
        with closing(self.connect()) as conn:
            row = conn.execute("SELECT attempts FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                raise KeyError(job_id)
            exhausted = int(row["attempts"]) >= max_attempts
            status = "failed" if exhausted else "retry"
            next_attempt = 0 if exhausted else now + retry_delay
            conn.execute(
                "UPDATE jobs SET status=?, next_attempt_at=?, last_error=?, updated_at=? WHERE id=?",
                (status, next_attempt, error[:2000], now, job_id),
            )
            return status

    def get(self, job_id: int) -> dict[str, Any] | None:
        with closing(self.connect()) as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        return dict(row) if row else None

    def retry_failed(self, job_id: int) -> dict[str, Any] | None:
        """Open a new governed retry cycle only for a terminally failed job."""
        now = time.time()
        with closing(self.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                conn.commit()
                return None
            if row["status"] != "failed":
                conn.commit()
                return dict(row)
            previous = str(row["last_error"] or "")[:1500]
            conn.execute(
                "UPDATE jobs SET status='retry', attempts=0, next_attempt_at=?, "
                "manual_retries=manual_retries+1, last_error=?, updated_at=? WHERE id=?",
                (now, f"MANUAL_RETRY_AFTER:{previous}", now, job_id),
            )
            updated = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            conn.commit()
        self._work_available.set()
        return dict(updated)

    def counts(self) -> dict[str, int]:
        with closing(self.connect()) as conn:
            rows = conn.execute("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status").fetchall()
        result = {name: 0 for name in ("queued", "processing", "retry", "done", "failed")}
        result.update({row["status"]: int(row["count"]) for row in rows})
        return result


class Dispatcher(threading.Thread):
    daemon = True

    def __init__(self, store: QueueStore, endpoint: str, header_name: str, header_value: str,
                 max_attempts: int = 5, retry_base_seconds: float = 2.0):
        super().__init__(name="plx-serial-dispatcher")
        self.store = store
        self.endpoint = endpoint
        self.header_name = header_name
        self.header_value = header_value
        self.max_attempts = max_attempts
        self.retry_base_seconds = retry_base_seconds
        self.stop_event = threading.Event()

    def dispatch(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json", self.header_name: self.header_value},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                raw = response.read(1024 * 1024)
                body = json.loads(raw or b"{}")
                if not (200 <= response.status < 300) or not (
                    body.get("ok") is True or body.get("status") == "DUPLICATE"
                ):
                    raise RuntimeError(f"N8N_REJECTED:{response.status}:{str(body)[:500]}")
                return body
        except urllib.error.HTTPError as error:
            detail = error.read(2000).decode("utf-8", "replace")
            raise RuntimeError(f"N8N_HTTP_{error.code}:{detail}") from error

    def run_once(self) -> bool:
        job = self.store.claim_next()
        if job is None:
            return False
        try:
            response = self.dispatch(json.loads(job["payload_json"]))
            self.store.mark_done(int(job["id"]), response)
        except Exception as error:  # boundary records every transport/provider failure
            delay = self.retry_base_seconds * (2 ** max(0, int(job["attempts"]) - 1))
            self.store.mark_failure(int(job["id"]), repr(error), self.max_attempts, delay)
        return True

    def run(self) -> None:
        while not self.stop_event.is_set():
            if not self.run_once():
                self.store.wait_for_due_work(self.store.next_dispatch_wait_seconds())

    def stop(self) -> None:
        self.stop_event.set()


class QueueHttpHandler(BaseHTTPRequestHandler):
    server_version = "PLXIngressQueue/1.0"

    def _json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authorized(self) -> bool:
        expected = self.server.internal_token  # type: ignore[attr-defined]
        received = self.headers.get("X-Internal-Token", "")
        return bool(expected) and hmac.compare_digest(expected, received)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            return self._json(200, {"ok": True, "queue": self.server.store.counts()})  # type: ignore[attr-defined]
        if not self._authorized():
            return self._json(403, {"ok": False, "error": "FORBIDDEN"})
        if self.path.startswith("/v1/jobs/"):
            try:
                job_id = int(self.path.rsplit("/", 1)[-1])
            except ValueError:
                return self._json(400, {"ok": False, "error": "INVALID_JOB_ID"})
            job = self.server.store.get(job_id)  # type: ignore[attr-defined]
            return self._json(200 if job else 404, {"ok": bool(job), "job": job})
        return self._json(404, {"ok": False, "error": "NOT_FOUND"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            return self._json(403, {"ok": False, "error": "FORBIDDEN"})
        if self.path.startswith("/v1/jobs/") and self.path.endswith("/retry"):
            try:
                job_id = int(self.path.split("/")[3])
            except (ValueError, IndexError):
                return self._json(400, {"ok": False, "error": "INVALID_JOB_ID"})
            before = self.server.store.get(job_id)  # type: ignore[attr-defined]
            if before is None:
                return self._json(404, {"ok": False, "error": "JOB_NOT_FOUND"})
            if before["status"] != "failed":
                return self._json(409, {"ok": False, "error": "JOB_NOT_FAILED", "status": before["status"]})
            job = self.server.store.retry_failed(job_id)  # type: ignore[attr-defined]
            return self._json(202, {
                "ok": True,
                "job_id": job_id,
                "status": job["status"],
                "manual_retries": job["manual_retries"],
            })
        if self.path != "/v1/documents":
            return self._json(404, {"ok": False, "error": "NOT_FOUND"})
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 1024 * 1024:
                raise ValueError("INVALID_BODY_SIZE")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("OBJECT_REQUIRED")
            result = self.server.store.enqueue(payload)  # type: ignore[attr-defined]
        except (ValueError, json.JSONDecodeError) as error:
            return self._json(400, {"ok": False, "error": str(error)})
        return self._json(202, {
            "ok": True,
            "accepted": result.accepted,
            "duplicate": result.duplicate,
            "job_id": result.job_id,
            "status": result.status,
            "idempotency_key": result.key,
        })

    def log_message(self, fmt: str, *args: Any) -> None:
        print(json.dumps({"at": time.time(), "message": fmt % args}), flush=True)


class QueueHttpServer(ThreadingHTTPServer):
    # The default TCP backlog is too small for a WhatsApp reconnect burst.
    request_queue_size = 128
    daemon_threads = True


def main() -> None:
    store = QueueStore(os.getenv("QUEUE_DB", "/data/plx-ingress.sqlite3"))
    dispatcher = Dispatcher(
        store,
        os.getenv("N8N_ENDPOINT", "http://n8n:5678/webhook/plx-benchmark-v3"),
        os.getenv("N8N_HEADER_NAME", "X-Internal-Token"),
        os.environ["INTERNAL_TOKEN"],
        int(os.getenv("MAX_ATTEMPTS", "5")),
        float(os.getenv("RETRY_BASE_SECONDS", "2")),
    )
    dispatcher.start()
    server = QueueHttpServer(("0.0.0.0", int(os.getenv("PORT", "8090"))), QueueHttpHandler)
    server.store = store  # type: ignore[attr-defined]
    server.internal_token = os.environ["INTERNAL_TOKEN"]  # type: ignore[attr-defined]

    def shutdown(*_: Any) -> None:
        dispatcher.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        server.serve_forever()
    finally:
        dispatcher.stop()
        dispatcher.join(timeout=5)
        server.server_close()


if __name__ == "__main__":
    main()
