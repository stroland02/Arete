import pytest

from arete_agents.remediation import (
    RemediationGraph,
    RemediationResult,
    build_approval_request,
)
from arete_agents.tools.executor import (
    CommandExecutionError,
    CommandOutcome,
    MockCommandExecutor,
)


def _ok(stdout="done"):
    return CommandOutcome(ran=True, exit_code=0, stdout=stdout, stderr="")


def _fail(stderr="boom"):
    return CommandOutcome(ran=True, exit_code=1, stdout="", stderr=stderr)


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
    g.graph.invoke(
        {"approval_id": "appr-x", "review_id": "r", "command": "c"}, config
    )
    snap = g.graph.get_state(config)
    assert snap.next  # suspended at the approval interrupt
    assert ex.calls == []  # NOT applied yet


def test_idempotent_replay_does_not_double_apply():
    ex = MockCommandExecutor(outcome=_ok("cleaned"))
    g = RemediationGraph(ex)
    first = g.apply_and_resume("appr-2", "rev", "cmd")
    second = g.apply_and_resume("appr-2", "rev", "cmd")  # redelivered job
    assert ex.calls == ["cmd"]  # command ran exactly ONCE
    assert second.applied == first.applied and second.detail == first.detail


def test_nonzero_exit_is_failed_and_latched():
    ex = MockCommandExecutor(outcome=_fail("perm denied"))
    g = RemediationGraph(ex)
    res = g.apply_and_resume("appr-3", "rev", "cmd")
    assert res.applied is False and "perm denied" in res.detail
    g.apply_and_resume("appr-3", "rev", "cmd")  # replay
    assert ex.calls == ["cmd"]  # not re-run (latched)


def test_executor_raise_is_retryable_not_latched():
    ex = MockCommandExecutor(raises=CommandExecutionError("unreachable"))
    g = RemediationGraph(ex)
    with pytest.raises(CommandExecutionError):
        g.apply_and_resume("appr-4", "rev", "cmd")
    with pytest.raises(CommandExecutionError):
        g.apply_and_resume("appr-4", "rev", "cmd")  # retry re-runs
    assert ex.calls == ["cmd", "cmd"]  # attempted twice, never latched


# ── Phase 2 Task 9: dispatch-before-ack regression pins ──────────────────────
# The survey found this property already holds here: apply_and_resume is
# interrupt-gated (nothing runs before a human resume) and idempotent per
# approval_id (a redelivered/replayed job never re-applies, and a failed apply
# is never silently reported or retried as a success). These two tests exist
# to pin exactly that so a future change to the graph cannot invert it without
# a test going red. See .superpowers/sdd/task-9-brief.md.


def test_task9_failed_apply_is_never_reported_as_success():
    """A non-zero exit must surface as applied=False, never as a fabricated
    success — the equivalent, for this route, of "must not advance state to
    approved/posted" in the dashboard routes."""
    ex = MockCommandExecutor(outcome=_fail("permission denied"))
    g = RemediationGraph(ex)
    res = g.apply_and_resume("appr-task9-fail", "rev", "cmd")
    assert res.applied is False
    assert res.applied is not True  # explicit: never truthy on a failed apply


def test_task9_raised_effect_never_latches_a_false_success():
    """If the underlying effect (the command execution) throws rather than
    returning non-zero, the graph must not catch-and-report success either —
    the exception propagates, and no RemediationResult (success or otherwise)
    is latched for this approval_id until a real outcome exists."""
    ex = MockCommandExecutor(raises=CommandExecutionError("infra unreachable"))
    g = RemediationGraph(ex)
    with pytest.raises(CommandExecutionError):
        g.apply_and_resume("appr-task9-raise", "rev", "cmd")

    # No success (or any) result was latched by the failed attempt.
    config = {"configurable": {"thread_id": "appr-task9-raise"}}
    snap = g.graph.get_state(config)
    assert snap.values.get("result") is None
