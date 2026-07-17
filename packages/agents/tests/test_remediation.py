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
