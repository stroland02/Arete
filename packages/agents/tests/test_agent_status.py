"""Per-specialist AgentStatus on ReviewResult (tiered-comms spec §2, plan Task
6). All fields must come from REAL run state — status from whether the agent
actually completed, confidence from real survival through the verification
pipeline, blockers from actual raised errors. Never fabricated for display.
"""

from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.orchestrator import ReviewOrchestrator

_SYNTH_VALID = (
    '{"file_reviews": [{"path": "src/auth.py", "comments": '
    '[{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
    '"severity": "error", "category": "security"}], '
    '"summary": "SQL injection."}], '
    '"overall_summary": "One security issue.", "risk_level": "high", '
    '"dropped_count": 0}'
)


def test_completed_agent_reports_done_with_real_confidence(sample_pr, cyclic_llm):
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    statuses = {s.agent: s for s in result.agent_statuses}
    assert "security" in statuses
    s = statuses["security"]
    assert s.status == "done"
    assert 0.0 <= s.confidence <= 1.0
    assert s.blockers == []


def test_failed_agent_reports_blocked_with_the_error_as_blocker(sample_pr):
    def fake_invoke(messages, **kwargs):
        system = messages[0].content
        if "Synthesizer" in system:
            return AIMessage(content=_SYNTH_VALID)
        if "performance engineer" in system:
            raise RuntimeError("performance provider outage")
        return AIMessage(content='{"comments": [], "summary": "ok"}')

    mock = MagicMock()
    mock.bind_tools.return_value = mock
    mock.with_retry.return_value = mock
    mock.invoke.side_effect = fake_invoke

    result = ReviewOrchestrator(llm=mock).run(sample_pr)
    statuses = {s.agent: s for s in result.agent_statuses}
    s = statuses["performance"]
    assert s.status == "blocked"
    assert len(s.blockers) == 1
    assert "performance provider outage" in s.blockers[0]
    assert s.confidence == 0.0


def test_agent_that_never_ran_is_absent_not_fabricated(sample_pr):
    # CI-log path only dispatches CIAgent -- the 6 specialists never ran, so
    # they must not appear with an invented status (anti-fabrication rule).
    from arete_agents.models.pr import FileChange, PRContext

    ci_pr = PRContext(
        repo=sample_pr.repo,
        pr_number=sample_pr.pr_number,
        title=sample_pr.title,
        description=sample_pr.description,
        files=[FileChange(path="src/auth.py", patch="+fix", additions=1, deletions=0)],
        ci_logs="build failed",
    )

    def fake_invoke(messages, **kwargs):
        system = messages[0].content
        if "Synthesizer" in system:
            return AIMessage(content=_SYNTH_VALID)
        return AIMessage(content='{"comments": [], "summary": "no issue found"}')

    mock = MagicMock()
    mock.bind_tools.return_value = mock
    mock.with_retry.return_value = mock
    mock.invoke.side_effect = fake_invoke

    result = ReviewOrchestrator(llm=mock).run(ci_pr)
    agents_reported = {s.agent for s in result.agent_statuses}
    assert "security" not in agents_reported
    assert "ci_diagnostics" in agents_reported


def test_no_findings_yields_full_confidence(sample_pr):
    # A role that raised zero comments has nothing that could have been
    # dropped -- confidence is 1.0, not an arbitrary/undefined value.
    def fake_invoke(messages, **kwargs):
        system = messages[0].content
        if "Synthesizer" in system:
            return AIMessage(content=_SYNTH_VALID)
        if "security engineer" in system:
            return AIMessage(
                content='{"comments": [{"path": "src/auth.py", "line": 5, '
                '"body": "SQL injection.", "severity": "error", "category": '
                '"security"}], "summary": "SQL injection."}'
            )
        return AIMessage(content='{"comments": [], "summary": "No issues."}')

    mock = MagicMock()
    mock.bind_tools.return_value = mock
    mock.with_retry.return_value = mock
    mock.invoke.side_effect = fake_invoke

    result = ReviewOrchestrator(llm=mock).run(sample_pr)
    statuses = {s.agent: s for s in result.agent_statuses}
    assert statuses["performance"].status == "done"
    assert statuses["performance"].confidence == 1.0
