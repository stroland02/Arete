import pytest

from arete_agents.tools.executor import (
    CommandExecutionError,
    CommandOutcome,
    MockCommandExecutor,
    SubprocessCommandExecutor,
    get_command_executor,
)


def test_mock_records_calls_and_returns_configured_outcome():
    ex = MockCommandExecutor(
        outcome=CommandOutcome(ran=True, exit_code=0, stdout="ok", stderr="")
    )
    out = ex.run("aws s3 ls")
    assert out.ran and out.exit_code == 0 and out.stdout == "ok"
    assert ex.calls == ["aws s3 ls"]


def test_mock_default_outcome_is_benign_success():
    ex = MockCommandExecutor()
    out = ex.run("kubectl delete pod x")
    assert out.ran and out.exit_code == 0
    assert "kubectl delete pod x" in out.stdout  # echoes what WOULD run


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
