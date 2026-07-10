import pytest
from unittest.mock import MagicMock
from langchain_core.messages import AIMessage

from arete_agents.models.pr import PRContext, FileChange
from arete_agents.models.review import FileReview


def make_mock_llm(json_response: str):
    mock = MagicMock()
    mock.invoke.return_value = AIMessage(content=json_response)
    return mock


def make_file(path: str = "src/auth.py", patch: str = "+def login():\n+    return True") -> FileChange:
    return FileChange(path=path, patch=patch, additions=2, deletions=0)


def make_pr(files: list[FileChange] | None = None) -> PRContext:
    return PRContext(repo="acme/api", pr_number=1, title="Add login", description="Adds auth", files=files or [make_file()])


def test_base_agent_is_abstract():
    from arete_agents.agents.base import BaseReviewAgent
    with pytest.raises(TypeError):
        BaseReviewAgent(llm=MagicMock())


def test_security_agent_returns_file_review():
    from arete_agents.agents.security import SecurityAgent
    mock_llm = make_mock_llm('{"comments": [{"path": "src/auth.py", "line": 1, "body": "SQL injection risk.", "severity": "error", "category": "security"}], "summary": "SQL injection found."}')
    agent = SecurityAgent(llm=mock_llm)
    result = agent.review_file(make_file(), make_pr())
    assert isinstance(result, FileReview)
    assert len(result.comments) == 1
    assert result.comments[0].severity == "error"
    assert result.comments[0].category == "security"


def test_agent_handles_empty_comments():
    from arete_agents.agents.security import SecurityAgent
    mock_llm = make_mock_llm('{"comments": [], "summary": "No security issues."}')
    agent = SecurityAgent(llm=mock_llm)
    result = agent.review_file(make_file(), make_pr())
    assert result.comments == []


def test_agent_handles_invalid_json_gracefully():
    from arete_agents.agents.security import SecurityAgent
    mock_llm = make_mock_llm("Sorry, I cannot help with this.")
    agent = SecurityAgent(llm=mock_llm)
    result = agent.review_file(make_file(), make_pr())
    assert isinstance(result, FileReview)
    assert result.comments == []
    assert "error" in result.summary.lower() or "parse" in result.summary.lower()


def test_performance_agent_returns_file_review():
    from arete_agents.agents.performance import PerformanceAgent
    mock_llm = make_mock_llm(
        '{"comments": [{"path": "src/orders.py", "line": 12, "body": "N+1 query in loop.", "severity": "warning", "category": "performance"}], "summary": "N+1 found."}'
    )
    agent = PerformanceAgent(llm=mock_llm)
    file = FileChange(path="src/orders.py", patch="+for o in orders:\n+    print(o.user.name)", additions=2, deletions=0)
    result = agent.review_file(file, make_pr([file]))
    assert result.comments[0].category == "performance"
    assert result.comments[0].severity == "warning"


def test_quality_agent_returns_file_review():
    from arete_agents.agents.quality import QualityAgent
    mock_llm = make_mock_llm(
        '{"comments": [{"path": "src/utils.py", "line": 3, "body": "Name x is unclear.", "severity": "info", "category": "quality"}], "summary": "Naming issue."}'
    )
    agent = QualityAgent(llm=mock_llm)
    file = FileChange(path="src/utils.py", patch="+x = get_user()", additions=1, deletions=0)
    result = agent.review_file(file, make_pr([file]))
    assert result.comments[0].category == "quality"
