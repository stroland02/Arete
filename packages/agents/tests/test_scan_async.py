"""POST /scan mode=async — the ack-and-poll shape (M1).

Something unidentified severs long-lived connections to this service (observed:
socket closed at 307 s while the scan kept working for seven more minutes; the
300 s undici theory was disproved by driving it). These tests pin the shape that
removes the dependency on that unknown: the submit acks immediately, the scan
runs on its own thread, and the caller polls — so no connection ever has to
outlive the scan.

The synchronous contract is also pinned unchanged, because the webhook falls
back to it and the migration must stay reversible.
"""

import threading
import time
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import arete_agents.server as server
from arete_agents import scan_runs
from arete_agents.scan import ScanUnavailableError
from tests.conftest import INTERNAL_HEADERS

LLM_BLOCK = {"provider": "anthropic", "model": "claude-opus-4", "api_key": "sk-test"}


def _client():
    return TestClient(server.app, headers=INTERNAL_HEADERS)


def _submit(client, mode="async"):
    return client.post(
        "/scan",
        json={"installationId": 42, "repoSlug": "acme/shop", "llm": LLM_BLOCK, "mode": mode},
    )


def _poll_until_terminal(client, run_id, timeout_s=5.0):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        resp = client.get(f"/scan/runs/{run_id}")
        body = resp.json()
        if resp.status_code != 200 or body.get("status") != "running":
            return resp
        time.sleep(0.02)
    raise AssertionError("run never left 'running'")


def _patched(run_scan_impl):
    return (
        patch.object(server, "get_llms_by_role_from_config", return_value={"security": MagicMock()}),
        patch.object(server, "run_scan", side_effect=run_scan_impl),
        patch.object(server, "ollama_unavailable_reason", return_value=None),
    )


def test_async_submit_acks_before_the_scan_finishes():
    scan_runs._reset_for_tests()
    release = threading.Event()

    def slow_scan(req, llms):
        # Holds until the test releases it — standing in for the multi-minute
        # LLM workload the old synchronous connection had to survive.
        assert release.wait(timeout=5), "test forgot to release the scan"
        result = MagicMock()
        result.model_dump.return_value = {
            "status": "complete",
            "findings": [{"kind": "issue", "title": "raw sql"}],
        }
        return result

    p1, p2, p3 = _patched(slow_scan)
    with p1, p2, p3:
        client = _client()
        resp = _submit(client)

        # The ack arrives while the scan is still blocked — the whole point.
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "accepted"
        run_id = body["runId"]

        assert client.get(f"/scan/runs/{run_id}").json() == {"status": "running"}

        release.set()
        final = _poll_until_terminal(client, run_id).json()

    assert final["status"] == "complete"
    assert final["findings"][0]["title"] == "raw sql"


def test_async_failure_is_recorded_not_lost():
    scan_runs._reset_for_tests()

    def broken_scan(req, llms):
        raise RuntimeError("model returned garbage")

    p1, p2, p3 = _patched(broken_scan)
    with p1, p2, p3:
        client = _client()
        run_id = _submit(client).json()["runId"]
        final = _poll_until_terminal(client, run_id).json()

    # A thread cannot raise to anyone. Losing the error would leave the poller
    # seeing "running" forever, which is the hang this shape exists to end.
    assert final["status"] == "failed"
    assert "model returned garbage" in final["error"]


def test_async_cant_scan_yet_reports_the_same_honest_message_as_sync_503():
    scan_runs._reset_for_tests()

    def unavailable(req, llms):
        raise ScanUnavailableError("no cached checkout for acme/shop yet")

    p1, p2, p3 = _patched(unavailable)
    with p1, p2, p3:
        client = _client()
        run_id = _submit(client).json()["runId"]
        final = _poll_until_terminal(client, run_id).json()

    assert final["status"] == "failed"
    assert "no cached checkout" in final["error"]


def test_unknown_run_is_404_because_a_restart_forgets_runs():
    scan_runs._reset_for_tests()
    resp = _client().get("/scan/runs/never-existed")
    assert resp.status_code == 404
    # The caller must read this as "failed", never as "still running" — the
    # registry is in-memory and a restart forgets every in-flight run.
    assert "restarted" in resp.json()["detail"]


def test_default_mode_is_sync_and_unchanged():
    scan_runs._reset_for_tests()
    result = MagicMock()
    result.model_dump.return_value = {"status": "no_findings", "findings": []}

    p1, p2, p3 = _patched(lambda req, llms: result)
    with p1, p2, p3:
        client = _client()
        resp = client.post(
            "/scan",
            json={"installationId": 42, "repoSlug": "acme/shop", "llm": LLM_BLOCK},
        )

    # No mode sent: findings arrive in the response body, no runId anywhere.
    # The webhook's fallback path and the migration's reversibility both rest
    # on this staying true.
    assert resp.status_code == 200
    assert "runId" not in resp.json()


def test_registry_prunes_old_terminal_runs_but_never_running_ones():
    scan_runs._reset_for_tests()
    done = scan_runs.create_run()
    scan_runs.complete_run(done, {"status": "complete", "findings": []})
    stuck = scan_runs.create_run()  # stays running

    # Age both past the TTL, then trigger the prune with a fresh insert.
    scan_runs._runs[done].created_at -= scan_runs._TERMINAL_TTL_SECONDS + 1
    scan_runs._runs[stuck].created_at -= scan_runs._TERMINAL_TTL_SECONDS + 1
    scan_runs.create_run()

    assert scan_runs.get_run(done) is None, "terminal runs past the TTL are pruned"
    assert scan_runs.get_run(stuck) is not None, (
        "a running run is never pruned — pruning it would turn a slow scan into a 404 mid-poll"
    )
