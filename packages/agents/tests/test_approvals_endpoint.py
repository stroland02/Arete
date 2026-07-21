import pytest
from fastapi.testclient import TestClient

from tests.conftest import INTERNAL_HEADERS

import arete_agents.server as server
from arete_agents.remediation import RemediationGraph
from arete_agents.tools.executor import (
    CommandExecutionError,
    CommandOutcome,
    MockCommandExecutor,
)


@pytest.fixture
def client():
    return TestClient(server.app, headers=INTERNAL_HEADERS)


def _use(monkeypatch, executor):
    monkeypatch.setattr(server, "_remediation", RemediationGraph(executor))


def test_apply_success(monkeypatch, client):
    _use(
        monkeypatch,
        MockCommandExecutor(
            outcome=CommandOutcome(ran=True, exit_code=0, stdout="ok", stderr="")
        ),
    )
    r = client.post(
        "/approvals/apply",
        json={"approvalId": "a1", "reviewId": "r1", "command": "aws s3 rm x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "applied"
    assert "ok" in body["detail"]
    assert body["resumedRunId"] == "a1"


def test_apply_command_failed_returns_failed_200(monkeypatch, client):
    _use(
        monkeypatch,
        MockCommandExecutor(
            outcome=CommandOutcome(ran=True, exit_code=2, stdout="", stderr="denied")
        ),
    )
    r = client.post(
        "/approvals/apply",
        json={"approvalId": "a2", "reviewId": "r", "command": "cmd"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "failed"
    assert "denied" in r.json()["detail"]


def test_apply_transient_failure_returns_503(monkeypatch, client):
    _use(monkeypatch, MockCommandExecutor(raises=CommandExecutionError("unreachable")))
    r = client.post(
        "/approvals/apply",
        json={"approvalId": "a3", "reviewId": "r", "command": "cmd"},
    )
    assert r.status_code == 503


def test_apply_is_idempotent_over_http(monkeypatch, client):
    ex = MockCommandExecutor(
        outcome=CommandOutcome(ran=True, exit_code=0, stdout="ok", stderr="")
    )
    _use(monkeypatch, ex)
    p = {"approvalId": "a4", "reviewId": "r", "command": "cmd"}
    client.post("/approvals/apply", json=p)
    client.post("/approvals/apply", json=p)  # redelivered
    assert ex.calls == ["cmd"]  # applied exactly once
