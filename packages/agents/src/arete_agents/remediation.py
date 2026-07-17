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
    """Shared, testable construction of the approval payload. Used both by the
    remediation graph's interrupt and by the request_infrastructure_approval
    tool, so the two never drift."""
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
    """Real LangGraph interrupt/checkpoint/resume for applying an operator-
    approved infra command.

    Thread-keyed by approval_id; the checkpointer IS the idempotency ledger.
    ``apply_command`` is a graph node, so the checkpointer records the apply
    atomically — that is what gives exactly-once apply on redelivery. Here the
    checkpointer is an in-process InMemorySaver; a deployed environment must
    swap in a durable saver (Postgres/Redis) for cross-restart idempotency and
    resume (see spec deferrals)."""

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
        # Suspends here on first invoke; interrupt() returns the resume payload
        # only once a human has approved and POST /approvals/apply drives
        # Command(resume=...). This is the HITL gate: nothing downstream (the
        # apply) runs until this returns.
        req = build_approval_request(state["command"], "infrastructure remediation")
        interrupt({"command": req.command, "reason": req.reason})
        return {}

    def _apply_command(self, state: _State) -> dict:
        # Runs exactly once on the resume path. May raise CommandExecutionError
        # (transient — infra unreachable); that propagates so the job can be
        # retried without latching a result.
        outcome = self._executor.run(state["command"])
        return {"outcome": outcome}

    def _incorporate(self, state: _State) -> dict:
        outcome = state["outcome"]
        applied = outcome.exit_code == 0
        detail = (outcome.stdout if applied else outcome.stderr).strip()
        if not detail:
            detail = (
                "command applied successfully"
                if applied
                else "command failed with no output"
            )
        return {"result": RemediationResult(applied=applied, detail=detail)}

    def apply_and_resume(
        self, approval_id: str, review_id: str, command: str
    ) -> RemediationResult:
        """Apply the approved command and resume the run. Idempotent per
        approval_id: a redelivered job never double-applies."""
        config = {"configurable": {"thread_id": approval_id}}
        snap = self.graph.get_state(config)

        # 1. Idempotent replay: thread already completed — return the cached
        #    result, do NOT re-run the command.
        if snap.values.get("result") is not None:
            return snap.values["result"]

        # 2. Fresh thread: drive up to the approval interrupt (suspends before
        #    any apply).
        if not snap.next and not snap.values:
            self.graph.invoke(
                {
                    "approval_id": approval_id,
                    "review_id": review_id,
                    "command": command,
                },
                config,
            )
            snap = self.graph.get_state(config)

        # 3. Drive forward to completion. A pending interrupt is resumed with the
        #    approval payload; a previously-errored node (executor raised on a
        #    prior delivery) is retried with None. Either way the apply happens
        #    only on this resume path — never auto-applied.
        if snap.next:
            has_interrupt = any(t.interrupts for t in snap.tasks)
            resume_arg = Command(resume={"approved": True}) if has_interrupt else None
            self.graph.invoke(resume_arg, config)  # CommandExecutionError propagates
            snap = self.graph.get_state(config)

        result = snap.values.get("result")
        if result is None:
            raise RuntimeError("Remediation graph produced no result")
        return result
