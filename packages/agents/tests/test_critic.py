from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.critic import CriticAgent
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import ReviewComment


def _pr_with_file(path: str, patch: str) -> PRContext:
    return PRContext(
        repo="acme/api",
        pr_number=1,
        title="Test",
        description="",
        files=[FileChange(path=path, patch=patch, additions=1, deletions=0)],
    )


def _make_llm(response: str) -> MagicMock:
    mock = MagicMock()
    mock.with_retry.return_value = mock
    mock.invoke.return_value = AIMessage(content=response)
    return mock


def _comment(body: str, category: str = "security") -> ReviewComment:
    return ReviewComment(
        path="src/auth.py", line=1, body=body, severity="error", category=category
    )


def test_critique_returns_drop_indices_from_response():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection."), _comment("Hallucinated frobnicate() call.")]
    llm = _make_llm('{"drop_indices": [1]}')

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == {1}


def test_critique_returns_empty_set_when_response_has_no_dropped():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm('{"drop_indices": []}')

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == set()


def test_critique_fails_open_on_unparseable_response():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm("Sorry, I can't produce JSON right now.")

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == set()


def test_critique_fails_open_when_llm_raises():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = MagicMock()
    llm.with_retry.return_value = llm
    llm.invoke.side_effect = RuntimeError("provider outage")

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == set()


def test_critique_ignores_out_of_range_indices():
    """Defensive: an LLM response naming an index outside the comments list
    must not raise or corrupt the result — just be filtered out."""
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm('{"drop_indices": [0, 5, -1]}')

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == {0}


def test_critique_with_empty_comments_list_makes_no_llm_call():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    llm = MagicMock()
    llm.with_retry.return_value = llm

    dropped = CriticAgent(llm).critique(pr, [])

    assert dropped == set()
    llm.invoke.assert_not_called()


def test_critique_prompt_includes_diff_and_comment_bodies():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users WHERE id=")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm('{"drop_indices": []}')

    CriticAgent(llm).critique(pr, comments)

    human_content = llm.invoke.call_args[0][0][1].content
    assert "SELECT * FROM users WHERE id=" in human_content
    assert "Real SQL injection." in human_content
