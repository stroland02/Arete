from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessage

from arete_agents.agents.ci_agent import CIAgent
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import ReviewResult

CI_RESPONSE = (
    '{"comments": [{"path": "src/app.py", "line": 12, "body": "Import error causes CI failure.", '
    '"severity": "error", "category": "ci_diagnostics"}], "summary": "Missing import."}'
)


@pytest.fixture
def ci_pr():
    return PRContext(
        repo="acme/api",
        pr_number=99,
        title="Bump deps",
        description="Update requirements",
        files=[FileChange(path="src/app.py", patch="+import missing_module", additions=1, deletions=0)],
        ci_logs="Error: ModuleNotFoundError: No module named 'missing_module'",
    )


@pytest.fixture
def ci_llm():
    mock = MagicMock()
    mock.invoke.side_effect = [AIMessage(content=CI_RESPONSE)] * 20
    mock.with_retry.return_value = mock
    return mock


def test_ci_agent_name():
    mock = MagicMock()
    assert CIAgent(mock).agent_name == "ci_diagnostics"


def test_ci_agent_returns_file_review(ci_pr, ci_llm):
    agent = CIAgent(ci_llm)
    result = agent.review_file(ci_pr.files[0], ci_pr)
    assert result.path == "src/app.py"
    assert len(result.comments) == 1
    assert result.comments[0].category == "ci_diagnostics"
    assert result.comments[0].severity == "error"


def test_ci_agent_summary_populated(ci_pr, ci_llm):
    agent = CIAgent(ci_llm)
    result = agent.review_file(ci_pr.files[0], ci_pr)
    assert result.summary == "Missing import."


def test_orchestrator_routes_to_ci_agent_when_ci_logs_present(ci_pr, ci_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=ci_llm).run(ci_pr)
    assert isinstance(result, ReviewResult)
    categories = {c.category for fr in result.file_reviews for c in fr.comments}
    assert "ci_diagnostics" in categories


def test_orchestrator_skips_ci_agent_without_ci_logs():
    from unittest.mock import MagicMock
    from langchain_core.messages import AIMessage
    from arete_agents.orchestrator import ReviewOrchestrator

    normal_response = (
        '{"comments": [{"path": "src/app.py", "line": 1, "body": "issue", '
        '"severity": "info", "category": "security"}], "summary": "ok"}'
    )
    llm = MagicMock()
    llm.invoke.side_effect = [AIMessage(content=normal_response)] * 40
    llm.with_retry.return_value = llm

    pr = PRContext(
        repo="acme/api",
        pr_number=1,
        title="Normal PR",
        description="No CI logs",
        files=[FileChange(path="src/app.py", patch="+x = 1", additions=1, deletions=0)],
    )
    result = ReviewOrchestrator(llm=llm).run(pr)
    assert isinstance(result, ReviewResult)
    categories = {c.category for fr in result.file_reviews for c in fr.comments}
    assert "ci_diagnostics" not in categories
