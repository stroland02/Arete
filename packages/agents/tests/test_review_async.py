"""POST /review mode=async — the ack-and-poll shape (M1, review half).

Reviews hit the identical ~300s connection ceiling the scan did (confirmed live:
a review of the real PR #1 reached the agents /review and died with `fetch
failed` at ~307s, same as the scan). This is the review-side twin of the scan
fix: the submit acks, the orchestrator runs on its own thread, and the caller
polls — so no connection has to outlive the review.

The synchronous contract is pinned unchanged, because the webhook falls back to
it and the migration must be reversible one service at a time.
"""

import threading
import time
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import arete_agents.server as server
from arete_agents import async_runs
from tests.conftest import INTERNAL_HEADERS

LLM_BLOCK = {"provider": "anthropic", "model": "claude-opus-4", "api_key": "sk-test"}


def _client():
    return TestClient(server.app, headers=INTERNAL_HEADERS)


def _body(mode="async"):
    return {
        "repo": "acme/api",
        "pr_number": 7,
        "title": "t",
        "description": "d",
        "files": [],
        "llm": LLM_BLOCK,
        "mode": mode,
    }


def _poll(client, run_id, timeout_s=5.0):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        resp = client.get(f"/review/runs/{run_id}")
        body = resp.json()
        if resp.status_code != 200 or body.get("status") != "running":
            return resp
        time.sleep(0.02)
    raise AssertionError("run never left 'running'")


def _orchestrator(run_impl):
    """Patch ReviewOrchestrator so .run() is run_impl, and the model-config
    builder so the BYO path reaches _run_review."""
    inst = MagicMock()
    inst.run.side_effect = run_impl
    return (
        patch.object(server, "ReviewOrchestrator", return_value=inst),
        patch.object(server, "get_llms_by_role_from_config", return_value={"security": MagicMock()}),
        patch.object(server, "ollama_unavailable_reason", return_value=None),
    )


def test_async_review_acks_before_it_finishes_then_polls_to_the_result():
    async_runs._reset_for_tests()
    release = threading.Event()

    def slow(pr):
        assert release.wait(timeout=5), "test forgot to release the review"
        result = MagicMock()
        result.model_dump.return_value = {
            "file_reviews": [
                {
                    "path": "a.ts",
                    "comments": [
                        {"path": "a.ts", "line": 1, "body": "x", "severity": "error", "category": "security"}
                    ],
                }
            ],
            "overall_summary": "one issue",
            "risk_level": "high",
        }
        return result

    p1, p2, p3 = _orchestrator(slow)
    with p1, p2, p3:
        client = _client()
        resp = client.post("/review", json=_body())
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "accepted"
        run_id = body["runId"]

        assert client.get(f"/review/runs/{run_id}").json() == {"status": "running"}
        release.set()
        final = _poll(client, run_id).json()

    assert final["status"] == "complete"
    assert final["result"]["risk_level"] == "high"
    assert final["result"]["file_reviews"][0]["comments"][0]["category"] == "security"


def test_async_review_failure_is_recorded_not_lost():
    async_runs._reset_for_tests()

    def broken(pr):
        raise RuntimeError("orchestrator exploded")

    p1, p2, p3 = _orchestrator(broken)
    with p1, p2, p3:
        client = _client()
        run_id = client.post("/review", json=_body()).json()["runId"]
        final = _poll(client, run_id).json()

    assert final["status"] == "failed"
    assert "orchestrator exploded" in final["error"]


def test_unknown_review_run_is_404():
    async_runs._reset_for_tests()
    resp = _client().get("/review/runs/never-existed")
    assert resp.status_code == 404
    assert "restarted" in resp.json()["detail"]


def test_default_mode_is_sync_and_does_not_touch_the_registry():
    async_runs._reset_for_tests()
    result = MagicMock()
    result.model_dump.return_value = {"file_reviews": [], "overall_summary": "clean", "risk_level": "low"}

    p1, p2, p3 = _orchestrator(lambda pr: result)
    with p1, p2, p3:
        client = _client()
        # No mode field: the sync path runs the orchestrator inline and returns
        # its result — the async registry is never touched.
        resp = client.post(
            "/review",
            json={"repo": "acme/api", "pr_number": 7, "title": "t", "description": "d", "files": [], "llm": LLM_BLOCK},
        )

    assert resp.status_code == 200
    assert "runId" not in resp.json()
    assert async_runs.get_run("anything") is None


def test_async_submit_still_503s_on_unreachable_ollama_before_acking():
    # Submit-time validation must not move off-connection: an unreachable model
    # fails the submit, not a run that acks then fails on a thread.
    async_runs._reset_for_tests()
    with patch.object(server, "ollama_unavailable_reason", return_value="ollama down: pull the model"):
        client = _client()
        resp = client.post(
            "/review",
            json={
                "repo": "acme/api",
                "pr_number": 7,
                "title": "t",
                "description": "d",
                "files": [],
                "llm": {"provider": "ollama", "model": "llama3"},
                "mode": "async",
            },
        )
    assert resp.status_code == 503
    assert "pull the model" in resp.json()["detail"]
