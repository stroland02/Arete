import os
import shlex
import subprocess
from typing import Protocol, runtime_checkable

from pydantic import BaseModel


class CommandOutcome(BaseModel):
    ran: bool  # True iff the command process actually launched and completed
    exit_code: int
    stdout: str = ""
    stderr: str = ""


class CommandExecutionError(Exception):
    """The command could NOT be launched/completed (infra unreachable, missing
    binary, timeout). Distinct from 'ran with a non-zero exit code': this is a
    transient/retryable failure — nothing was applied, so the job may be
    redelivered safely."""


@runtime_checkable
class CommandExecutor(Protocol):
    def run(self, command: str) -> CommandOutcome: ...


class MockCommandExecutor:
    """In-sandbox / test executor. Never touches real infrastructure. Default
    outcome is a benign success that echoes what WOULD have run — safe to leave
    wired by default so an unconfigured deploy can't accidentally run live
    commands (see get_command_executor)."""

    def __init__(
        self,
        outcome: CommandOutcome | None = None,
        raises: Exception | None = None,
    ) -> None:
        self._outcome = outcome
        self._raises = raises
        self.calls: list[str] = []

    def run(self, command: str) -> CommandOutcome:
        self.calls.append(command)
        if self._raises is not None:
            raise self._raises
        if self._outcome is not None:
            return self._outcome
        return CommandOutcome(
            ran=True, exit_code=0, stdout=f"[mock] would run: {command}", stderr=""
        )


class SubprocessCommandExecutor:
    """Real executor. DEPLOY-ONLY path — untested against live AWS/kubectl in
    the sandbox (see spec deferrals). Runs with whatever least-privilege
    credentials the host provides. A command that launches and exits non-zero
    is a real (latched) outcome; a command that cannot launch at all raises
    CommandExecutionError (transient/retryable)."""

    def __init__(self, timeout_seconds: int = 300) -> None:
        self._timeout = timeout_seconds

    def run(self, command: str) -> CommandOutcome:
        try:
            proc = subprocess.run(
                shlex.split(command),
                capture_output=True,
                text=True,
                timeout=self._timeout,
            )
        except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as exc:
            raise CommandExecutionError(f"could not execute command: {exc}") from exc
        return CommandOutcome(
            ran=True,
            exit_code=proc.returncode,
            stdout=proc.stdout,
            stderr=proc.stderr,
        )


def get_command_executor() -> CommandExecutor:
    """Select the executor from ARETE_COMMAND_EXECUTOR. Defaults to the mock:
    a deployed environment must opt in to real execution explicitly
    (ARETE_COMMAND_EXECUTOR=subprocess), so nothing can run live infra commands
    by accident."""
    kind = os.environ.get("ARETE_COMMAND_EXECUTOR", "mock").strip().lower()
    if kind == "subprocess":
        return SubprocessCommandExecutor()
    return MockCommandExecutor()
