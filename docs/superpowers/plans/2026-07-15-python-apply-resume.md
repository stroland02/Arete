# Python apply/resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply an operator-approved infrastructure command and resume the run via a real LangGraph `interrupt()`/checkpoint/`Command(resume=…)` cycle, exposed as an idempotent `POST /approvals/apply`.

**Architecture:** A singleton `RemediationGraph` (compiled with `InMemorySaver`, thread-keyed by `approvalId`) suspends at an approval `interrupt()`, then on resume runs the approved command through an injected `CommandExecutor` in a graph node (so the checkpointer records the apply atomically → exactly-once). The endpoint drives `apply_and_resume`; transient "couldn't run" failures surface as HTTP 503 for safe queue retry.

**Tech Stack:** Python 3.12, FastAPI, LangGraph 1.2.9 (`langgraph.types.interrupt`/`Command`, `langgraph.checkpoint.memory.InMemorySaver`), Pydantic, pytest.

## Global Constraints

- Stay inside `packages/agents/`. No `@arete/db`/`packages/webhook`/`packages/dashboard` edits.
- `server.py` is SHARED-ADDITIVE: add exactly ONE new route function; touch nothing else.
- Fixed contract: `POST /approvals/apply` body `{approvalId, reviewId, command}` → `{status:"applied"|"failed", detail, resumedRunId?}`; IDEMPOTENT per `approvalId` — a redelivered job MUST NOT double-apply.
- HITL moat: apply runs ONLY on the resume path of an approval-seeded thread. Never auto-apply.
- Test baseline must not regress: `uv run pytest tests/ --ignore=tests/test_e2e_smoke.py` (29 passed).
- Run all commands from `packages/agents/` with `uv run`.

---

### Task 1: `CommandExecutor` + `CommandOutcome` + factory

**Files:**
- Create: `packages/agents/src/arete_agents/tools/executor.py`
- Test: `packages/agents/tests/test_executor.py`

**Interfaces:**
- Produces: `CommandOutcome` (Pydantic: `ran: bool`, `exit_code: int`, `stdout: str`, `stderr: str`); `CommandExecutionError(Exception)`; `CommandExecutor` protocol with `run(command: str) -> CommandOutcome`; `MockCommandExecutor(outcome=None, raises=None)` recording `self.calls: list[str]`; `SubprocessCommandExecutor`; `get_command_executor() -> CommandExecutor` (env `ARETE_COMMAND_EXECUTOR`, default `"mock"`).

- [ ] **Step 1: Write failing tests**

```python
# tests/test_executor.py
import pytest
from arete_agents.tools.executor import (
    CommandOutcome, CommandExecutionError, MockCommandExecutor,
    SubprocessCommandExecutor, get_command_executor,
)

def test_mock_records_calls_and_returns_configured_outcome():
    ex = MockCommandExecutor(outcome=CommandOutcome(ran=True, exit_code=0, stdout="ok", stderr=""))
    out = ex.run("aws s3 ls")
    assert out.ran and out.exit_code == 0 and out.stdout == "ok"
    assert ex.calls == ["aws s3 ls"]

def test_mock_can_raise_execution_error():
    ex = MockCommandExecutor(raises=CommandExecutionError("infra unreachable"))
    with pytest.raises(CommandExecutionError):
        ex.run("kubectl get pods")
    assert ex.calls == ["kubectl get pods"]  # attempt is recorded

def test_subprocess_captures_exit_and_streams():
    ex = SubprocessCommandExecutor()
    out = ex.run("python -c \"import sys; print('hi'); sys.exit(3)\"")
    assert out.ran and out.exit_code == 3 and "hi" in out.stdout

def test_subprocess_launch_failure_raises_execution_error():
    ex = SubprocessCommandExecutor()
    with pytest.raises(CommandExecutionError):
        ex.run("this-binary-does-not-exist-xyz")

def test_factory_defaults_to_mock(monkeypatch):
    monkeypatch.delenv("ARETE_COMMAND_EXECUTOR", raising=False)
    assert isinstance(get_command_executor(), MockCommandExecutor)

def test_factory_selects_subprocess(monkeypatch):
    monkeypatch.setenv("ARETE_COMMAND_EXECUTOR", "subprocess")
    assert isinstance(get_command_executor(), SubprocessCommandExecutor)
```

- [ ] **Step 2: Run tests, verify they fail** — `uv run pytest tests/test_executor.py -q` → ImportError.

- [ ] **Step 3: Implement**

```python
# tools/executor.py
import os
import shlex
import subprocess
from typing import Protocol, runtime_checkable

from pydantic import BaseModel


class CommandOutcome(BaseModel):
    ran: bool          # True iff the command process actually launched and completed
    exit_code: int
    stdout: str = ""
    stderr: str = ""


class CommandExecutionError(Exception):
    """The command could NOT be launched/completed (infra unreachable, missing
    binary, timeout). Distinct from 'ran with a non-zero exit code': this is a
    transient/retryable failure — nothing was applied."""


@runtime_checkable
class CommandExecutor(Protocol):
    def run(self, command: str) -> CommandOutcome: ...


class MockCommandExecutor:
    """In-sandbox / test executor. Never touches real infrastructure. Default
    outcome is a benign success that echoes what WOULD have run."""
    def __init__(self, outcome: CommandOutcome | None = None, raises: Exception | None = None) -> None:
        self._outcome = outcome
        self._raises = raises
        self.calls: list[str] = []

    def run(self, command: str) -> CommandOutcome:
        self.calls.append(command)
        if self._raises is not None:
            raise self._raises
        if self._outcome is not None:
            return self._outcome
        return CommandOutcome(ran=True, exit_code=0, stdout=f"[mock] would run: {command}", stderr="")


class SubprocessCommandExecutor:
    """Real executor. DEPLOY-ONLY path — untested against live AWS/kubectl in
    sandbox (see spec deferrals). Runs with least privilege the host provides."""
    def __init__(self, timeout_seconds: int = 300) -> None:
        self._timeout = timeout_seconds

    def run(self, command: str) -> CommandOutcome:
        try:
            proc = subprocess.run(
                shlex.split(command),
                capture_output=True, text=True, timeout=self._timeout,
            )
        except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as exc:
            raise CommandExecutionError(f"could not execute command: {exc}") from exc
        return CommandOutcome(ran=True, exit_code=proc.returncode, stdout=proc.stdout, stderr=proc.stderr)


def get_command_executor() -> CommandExecutor:
    kind = os.environ.get("ARETE_COMMAND_EXECUTOR", "mock").strip().lower()
    if kind == "subprocess":
        return SubprocessCommandExecutor()
    return MockCommandExecutor()
```

- [ ] **Step 4: Run tests, verify pass** — `uv run pytest tests/test_executor.py -q` → all pass.
- [ ] **Step 5: Commit** — `git add … && git commit -m "feat(agents): CommandExecutor abstraction for approved-command apply"`

---

### Task 2: `RemediationGraph` + `apply_and_resume` + `build_approval_request`

**Files:**
- Create: `packages/agents/src/arete_agents/remediation.py`
- Test: `packages/agents/tests/test_remediation.py`

**Interfaces:**
- Consumes: `CommandExecutor`, `CommandOutcome`, `CommandExecutionError` from Task 1.
- Produces: `RemediationResult` (Pydantic: `applied: bool`, `detail: str`); `ApprovalRequest` (Pydantic: `command: str`, `reason: str`); `build_approval_request(command, reason) -> ApprovalRequest`; `RemediationGraph(executor)` with `apply_and_resume(approval_id: str, review_id: str, command: str) -> RemediationResult`.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_remediation.py
import pytest
from arete_agents.remediation import (
    RemediationGraph, RemediationResult, build_approval_request,
)
from arete_agents.tools.executor import CommandOutcome, CommandExecutionError, MockCommandExecutor

def _ok(stdout="done"): return CommandOutcome(ran=True, exit_code=0, stdout=stdout, stderr="")
def _fail(stderr="boom"): return CommandOutcome(ran=True, exit_code=1, stdout="", stderr=stderr)

def test_build_approval_request():
    req = build_approval_request("aws s3 rm x", "leaked bucket")
    assert req.command == "aws s3 rm x" and req.reason == "leaked bucket"

def test_apply_runs_command_once_and_reports_applied():
    ex = MockCommandExecutor(outcome=_ok("cleaned"))
    g = RemediationGraph(ex)
    res = g.apply_and_resume("appr-1", "rev-1", "aws s3 rm x")
    assert isinstance(res, RemediationResult) and res.applied is True
    assert "cleaned" in res.detail
    assert ex.calls == ["aws s3 rm x"]

def test_executor_not_called_before_resume():
    # White-box: invoking the graph to the interrupt must not run the command.
    ex = MockCommandExecutor(outcome=_ok())
    g = RemediationGraph(ex)
    config = {"configurable": {"thread_id": "appr-x"}}
    g.graph.invoke({"approval_id": "appr-x", "review_id": "r", "command": "c"}, config)
    snap = g.graph.get_state(config)
    assert snap.next  # suspended at the approval interrupt
    assert ex.calls == []  # NOT applied yet

def test_idempotent_replay_does_not_double_apply():
    ex = MockCommandExecutor(outcome=_ok("cleaned"))
    g = RemediationGraph(ex)
    first = g.apply_and_resume("appr-2", "rev", "cmd")
    second = g.apply_and_resume("appr-2", "rev", "cmd")  # redelivered job
    assert ex.calls == ["cmd"]                 # command ran exactly ONCE
    assert second.applied == first.applied and second.detail == first.detail

def test_nonzero_exit_is_failed_and_latched():
    ex = MockCommandExecutor(outcome=_fail("perm denied"))
    g = RemediationGraph(ex)
    res = g.apply_and_resume("appr-3", "rev", "cmd")
    assert res.applied is False and "perm denied" in res.detail
    g.apply_and_resume("appr-3", "rev", "cmd")   # replay
    assert ex.calls == ["cmd"]                    # not re-run (latched)

def test_executor_raise_is_retryable_not_latched():
    ex = MockCommandExecutor(raises=CommandExecutionError("unreachable"))
    g = RemediationGraph(ex)
    with pytest.raises(CommandExecutionError):
        g.apply_and_resume("appr-4", "rev", "cmd")
    with pytest.raises(CommandExecutionError):
        g.apply_and_resume("appr-4", "rev", "cmd")   # retry re-runs
    assert ex.calls == ["cmd", "cmd"]                # attempted twice, never latched
```

- [ ] **Step 2: Run tests, verify they fail** — `uv run pytest tests/test_remediation.py -q` → ImportError.

- [ ] **Step 3: Implement**

```python
# remediation.py
import logging
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel

from arete_agents.tools.executor import CommandExecutor, CommandOutcome

logger = logging.getLogger(__name__)


class ApprovalRequest(BaseModel):
    command: str
    reason: str


def build_approval_request(command: str, reason: str) -> ApprovalRequest:
    return ApprovalRequest(command=command, reason=reason)


class RemediationResult(BaseModel):
    applied: bool
    detail: str


class _State(TypedDict, total=False):
    approval_id: str
    review_id: str
    command: str
    outcome: CommandOutcome
    result: RemediationResult


class RemediationGraph:
    """Real LangGraph interrupt/checkpoint/resume for applying an approved infra
    command. Thread-keyed by approval_id; the checkpointer IS the idempotency
    ledger. `apply_command` is a node so the checkpointer records the apply
    atomically → exactly-once under a durable saver (InMemorySaver here — see
    spec deferrals: deploy needs Postgres/Redis saver)."""

    def __init__(self, executor: CommandExecutor) -> None:
        self._executor = executor
        self.graph = self._build_graph()

    def _build_graph(self):
        wf = StateGraph(_State)
        wf.add_node("request_approval", self._request_approval)
        wf.add_node("apply_command", self._apply_command)
        wf.add_node("incorporate", self._incorporate)
        wf.add_edge(START, "request_approval")
        wf.add_edge("request_approval", "apply_command")
        wf.add_edge("apply_command", "incorporate")
        wf.add_edge("incorporate", END)
        return wf.compile(checkpointer=InMemorySaver())

    def _request_approval(self, state: _State) -> dict:
        # Suspends here on first invoke; returns the resume payload once a human
        # has approved and POST /approvals/apply drives Command(resume=...).
        interrupt({"command": state["command"], "reason": "infrastructure remediation"})
        return {}

    def _apply_command(self, state: _State) -> dict:
        # Runs exactly once; may raise CommandExecutionError (transient) which
        # propagates so the job can be retried without latching.
        outcome = self._executor.run(state["command"])
        return {"outcome": outcome}

    def _incorporate(self, state: _State) -> dict:
        outcome = state["outcome"]
        applied = outcome.exit_code == 0
        detail = (outcome.stdout if applied else outcome.stderr).strip()
        if not detail:
            detail = "command applied successfully" if applied else "command failed with no output"
        return {"result": RemediationResult(applied=applied, detail=detail)}

    def apply_and_resume(self, approval_id: str, review_id: str, command: str) -> RemediationResult:
        config = {"configurable": {"thread_id": approval_id}}
        snap = self.graph.get_state(config)

        # 1. Idempotent replay: thread already completed — return cached result,
        #    do NOT re-run the command.
        if snap.values.get("result") is not None:
            return snap.values["result"]

        # 2. Fresh thread: drive up to the approval interrupt (suspends).
        if not snap.next and not snap.values:
            self.graph.invoke(
                {"approval_id": approval_id, "review_id": review_id, "command": command},
                config,
            )
            snap = self.graph.get_state(config)

        # 3. Drive forward to completion. A pending interrupt is resumed with the
        #    approval payload; a previously-errored node (executor raised) is
        #    retried with None. Either way, apply happens on THIS path only.
        if snap.next:
            has_interrupt = any(t.interrupts for t in snap.tasks)
            resume_arg = Command(resume={"approved": True}) if has_interrupt else None
            self.graph.invoke(resume_arg, config)   # CommandExecutionError propagates
            snap = self.graph.get_state(config)

        result = snap.values.get("result")
        if result is None:
            raise RuntimeError("Remediation graph produced no result")
        return result
```

- [ ] **Step 4: Run tests, verify pass** — `uv run pytest tests/test_remediation.py -q` → all pass. If the errored-node retry path (`test_executor_raise_is_retryable_not_latched`) behaves unexpectedly, inspect `snap.next`/`snap.tasks` after the first raise and adjust the step-3 branch accordingly.
- [ ] **Step 5: Commit** — `git commit -m "feat(agents): RemediationGraph — real interrupt/resume apply of approved command"`

---

### Task 3: Truthful `request_infrastructure_approval`

**Files:**
- Modify: `packages/agents/src/arete_agents/tools/actions.py:65-72`
- Test: `packages/agents/tests/test_actions_approval.py`

**Interfaces:**
- Consumes: `build_approval_request` from Task 2.

- [ ] **Step 1: Write failing test**

```python
# tests/test_actions_approval.py
from arete_agents.tools.actions import request_infrastructure_approval

def test_request_infra_approval_is_truthful_not_fake_resume():
    out = request_infrastructure_approval.invoke({"command": "aws s3 rm x", "reason": "leak"})
    assert "aws s3 rm x" in out and "leak" in out
    assert "Resuming" not in out           # no longer lies about resuming inline
    assert "await" in out.lower() or "suspend" in out.lower()
```

- [ ] **Step 2: Run test, verify it fails** — `uv run pytest tests/test_actions_approval.py -q` → AssertionError on "Resuming".

- [ ] **Step 3: Implement** — replace the body of `request_infrastructure_approval` (keep the `@tool`/schema decorator and signature). Function-local import to avoid import-time cost in the review loop:

```python
@tool("request_infrastructure_approval", args_schema=RequestInfrastructureApprovalInput)
def request_infrastructure_approval(command: str, reason: str) -> str:
    """
    Request human approval to execute a potentially dangerous infrastructure command.
    The run pauses until a human clicks 'Approve' or 'Reject'. If approved, the platform
    applies the command asynchronously (via the approval-exec pipeline) and resumes the run.
    """
    from arete_agents.remediation import build_approval_request
    req = build_approval_request(command, reason)
    return (
        f"Suspended: awaiting human approval to run `{req.command}`. "
        f"Reason: {req.reason}. Execution occurs only after approval."
    )
```

- [ ] **Step 4: Run test + full suite** — `uv run pytest tests/test_actions_approval.py -q` pass; then `uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` → still ≥29 passed (confirm nothing asserted the old string).
- [ ] **Step 5: Commit** — `git commit -m "feat(agents): truthful request_infrastructure_approval (no fake inline resume)"`

---

### Task 4: `POST /approvals/apply` route (SHARED-ADDITIVE, +1 function)

**Files:**
- Modify: `packages/agents/src/arete_agents/server.py` (add imports + one route function + one singleton; touch nothing else)
- Test: `packages/agents/tests/test_approvals_endpoint.py`

**Interfaces:**
- Consumes: `RemediationGraph`, `RemediationResult`, `get_command_executor`, `CommandExecutionError`.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_approvals_endpoint.py
import pytest
from fastapi.testclient import TestClient

import arete_agents.server as server
from arete_agents.remediation import RemediationGraph
from arete_agents.tools.executor import CommandOutcome, CommandExecutionError, MockCommandExecutor

@pytest.fixture
def client():
    return TestClient(server.app)

def _use(monkeypatch, executor):
    monkeypatch.setattr(server, "_remediation", RemediationGraph(executor))

def test_apply_success(monkeypatch, client):
    _use(monkeypatch, MockCommandExecutor(outcome=CommandOutcome(ran=True, exit_code=0, stdout="ok", stderr="")))
    r = client.post("/approvals/apply", json={"approvalId": "a1", "reviewId": "r1", "command": "aws s3 rm x"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "applied" and "ok" in body["detail"] and body["resumedRunId"] == "a1"

def test_apply_command_failed_returns_failed_200(monkeypatch, client):
    _use(monkeypatch, MockCommandExecutor(outcome=CommandOutcome(ran=True, exit_code=2, stdout="", stderr="denied")))
    r = client.post("/approvals/apply", json={"approvalId": "a2", "reviewId": "r", "command": "cmd"})
    assert r.status_code == 200 and r.json()["status"] == "failed" and "denied" in r.json()["detail"]

def test_apply_transient_failure_returns_503(monkeypatch, client):
    _use(monkeypatch, MockCommandExecutor(raises=CommandExecutionError("unreachable")))
    r = client.post("/approvals/apply", json={"approvalId": "a3", "reviewId": "r", "command": "cmd"})
    assert r.status_code == 503

def test_apply_is_idempotent_over_http(monkeypatch, client):
    ex = MockCommandExecutor(outcome=CommandOutcome(ran=True, exit_code=0, stdout="ok", stderr=""))
    _use(monkeypatch, ex)
    p = {"approvalId": "a4", "reviewId": "r", "command": "cmd"}
    client.post("/approvals/apply", json=p)
    client.post("/approvals/apply", json=p)   # redelivered
    assert ex.calls == ["cmd"]                 # applied exactly once
```

- [ ] **Step 2: Run tests, verify they fail** — `uv run pytest tests/test_approvals_endpoint.py -q` → 404 (route missing).

- [ ] **Step 3: Implement** — add to `server.py` ONLY: imports, one singleton, one route. Place the singleton next to the existing `_orchestrator`/`_chat_agent` block and the route next to the other `@app.post`s.

```python
# add to imports
from fastapi import HTTPException
from pydantic import BaseModel
from arete_agents.remediation import RemediationGraph
from arete_agents.tools.executor import CommandExecutionError, get_command_executor

# add next to _orchestrator / _chat_agent singletons
_remediation = RemediationGraph(get_command_executor())


class ApplyApprovalRequest(BaseModel):
    approvalId: str
    reviewId: str
    command: str


# add next to the other @app.post routes
@app.post("/approvals/apply")
def apply_approval(req: ApplyApprovalRequest):
    try:
        result = _remediation.apply_and_resume(req.approvalId, req.reviewId, req.command)
    except CommandExecutionError as exc:
        # Command could not be launched — nothing applied. 503 so the approval-exec
        # queue redelivers; the retry is safe (idempotent, never double-applies).
        raise HTTPException(status_code=503, detail=f"transient execution failure: {exc}")
    return {
        "status": "applied" if result.applied else "failed",
        "detail": result.detail,
        "resumedRunId": req.approvalId,
    }
```

- [ ] **Step 4: Run tests, verify pass** — `uv run pytest tests/test_approvals_endpoint.py -q` all pass. (If `TestClient` needs httpx, it is already a FastAPI dep; confirm import works.)
- [ ] **Step 5: Full suite + commit** — `uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` (all green, no baseline regression), then `git commit -m "feat(agents): POST /approvals/apply — idempotent apply/resume endpoint"`.

---

## Self-Review

- **Spec coverage:** executor (T1) ✓; interrupt/checkpoint/resume + idempotency + latch/retry semantics (T2) ✓; truthful tool sentinel (T3) ✓; endpoint + contract mapping + 503 nuance (T4) ✓; HITL moat (apply only on resume path) ✓; deferrals documented in spec ✓. `auto_resolver.py` intentionally untouched ✓.
- **Placeholder scan:** none — every step has full code/commands.
- **Type consistency:** `CommandOutcome{ran,exit_code,stdout,stderr}`, `RemediationResult{applied,detail}`, `apply_and_resume(approval_id, review_id, command)`, `build_approval_request(command, reason)`, response keys `status/detail/resumedRunId` — consistent across T1–T4.
