"""In-process registry for asynchronous runs (scans and reviews).

Why this exists: the webhook's call to ``POST /scan`` (and now ``POST /review``) used to stay open for the
entire scan — an unbounded LLM workload — and something in the path (still
unidentified; the 300 s undici theory was disproved by driving it) severs long
connections. The observed failure: the socket closed at 307 s while this
service kept working for seven more minutes and completed six model calls into
a connection nobody was listening to. The enqueue/ack shape removes the
dependency on the unknown: no connection has to outlive the scan, so whatever
kills long connections stops mattering.

Deliberately in-memory. This service is one process, and the webhook side
already treats a vanished run honestly: an unknown run id is reported as
failed, and its stale-``ScanRun`` recovery closes out rows abandoned by a
restart. Persisting run state here would duplicate, worse, the source of truth
the webhook's database already is.

Thread-safe: FastAPI serves from a threadpool and each async scan runs on its
own daemon thread, so every mutation happens under the lock.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

# Terminal runs older than this are pruned on the next insert. Long enough that
# a webhook polling every few seconds cannot miss a result; short enough that a
# day of scans cannot grow the registry without bound.
_TERMINAL_TTL_SECONDS = 60 * 60


@dataclass
class ScanRun:
    status: str  # "running" | "complete" | "no_findings" | "failed"
    created_at: float = field(default_factory=time.time)
    response: Optional[dict[str, Any]] = None
    error: Optional[str] = None


_lock = threading.Lock()
_runs: dict[str, ScanRun] = {}


def create_run() -> str:
    """Register a new running scan and return its id."""
    run_id = uuid.uuid4().hex
    now = time.time()
    with _lock:
        # Prune old terminal runs here rather than on a timer: an insert is the
        # only moment the registry grows, so it is the only moment it needs to
        # shrink.
        expired = [
            k
            for k, run in _runs.items()
            if run.status != "running" and now - run.created_at > _TERMINAL_TTL_SECONDS
        ]
        for k in expired:
            del _runs[k]
        _runs[run_id] = ScanRun(status="running")
    return run_id


def complete_run(run_id: str, response: dict[str, Any]) -> None:
    """Record a finished scan. ``response`` is the ScanResponse dict — its own
    ``status`` ("complete" | "no_findings") becomes the run's status, so the
    poller sees exactly what the synchronous path would have returned."""
    with _lock:
        run = _runs.get(run_id)
        if run is None:
            return
        run.status = str(response.get("status", "complete"))
        run.response = response


def fail_run(run_id: str, error: str) -> None:
    with _lock:
        run = _runs.get(run_id)
        if run is None:
            return
        run.status = "failed"
        run.error = error


def get_run(run_id: str) -> Optional[ScanRun]:
    with _lock:
        return _runs.get(run_id)


def _reset_for_tests() -> None:
    with _lock:
        _runs.clear()
