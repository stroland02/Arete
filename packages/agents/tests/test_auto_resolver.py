"""auto_resolver's real, testable core: LLM-verified auto-resolution of open
review comments.

Per docs/superpowers/specs/2026-07-15-python-apply-resume-design.md's
"Out of scope" note, obtaining open comments (a DB read) and actually
resolving a thread (a GitHub/GitLab API mutation, needing a minted
installation token) are cross-lane (webhook/db) and are NOT built here --
those are injected as callables so this module owns only the real,
in-lane part: deciding, via the actual LLM, whether a diff resolves an issue.
"""

from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.auto_resolver import OpenComment, scan_and_resolve_prs, verify_resolved
from arete_agents.config import Settings

_SETTINGS = Settings(llm_provider="anthropic", anthropic_api_key="sk-ant-test")


def _llm(reply: str) -> MagicMock:
    mock = MagicMock()
    mock.invoke.return_value = AIMessage(content=reply)
    return mock


def test_verify_resolved_true_when_llm_confirms_fix(monkeypatch):
    monkeypatch.setattr(
        "arete_agents.auto_resolver.get_llms_by_role",
        lambda settings: {"security": _llm("RESOLVED")},
    )
    comment = OpenComment(id="c1", pr_number=42, body="SQL injection.", line=15)
    assert verify_resolved(_SETTINGS, comment, "real diff fixing it") is True


def test_verify_resolved_false_when_llm_says_unresolved(monkeypatch):
    monkeypatch.setattr(
        "arete_agents.auto_resolver.get_llms_by_role",
        lambda settings: {"security": _llm("UNRESOLVED")},
    )
    comment = OpenComment(id="c1", pr_number=42, body="SQL injection.", line=15)
    assert verify_resolved(_SETTINGS, comment, "unrelated diff") is False


def test_verify_resolved_never_fabricates_resolution_on_llm_error(monkeypatch):
    # An LLM call failure must never be treated as "resolved" -- a real
    # security finding must not be auto-closed just because verification
    # itself broke.
    boom = MagicMock()
    boom.invoke.side_effect = RuntimeError("provider outage")
    monkeypatch.setattr(
        "arete_agents.auto_resolver.get_llms_by_role",
        lambda settings: {"security": boom},
    )
    comment = OpenComment(id="c1", pr_number=42, body="SQL injection.", line=15)
    assert verify_resolved(_SETTINGS, comment, "some diff") is False


def test_verify_resolved_false_when_no_security_llm_configured(monkeypatch):
    monkeypatch.setattr(
        "arete_agents.auto_resolver.get_llms_by_role", lambda settings: {}
    )
    comment = OpenComment(id="c1", pr_number=42, body="SQL injection.", line=15)
    assert verify_resolved(_SETTINGS, comment, "some diff") is False


def test_scan_resolves_only_verified_comments(monkeypatch):
    replies = {101: "RESOLVED", 102: "UNRESOLVED"}
    _current_pr = [None]

    def fake_get_llms(settings):
        # The reply depends on which PR's diff was fetched -- verify_resolved
        # is called once per comment with that PR's own diff.
        return {"security": _llm(replies[_current_pr[0]])}

    def fetch_latest_diff(pr_number: int) -> str:
        _current_pr[0] = pr_number
        return f"diff for {pr_number}"

    monkeypatch.setattr("arete_agents.auto_resolver.get_llms_by_role", fake_get_llms)

    resolve_thread = MagicMock()
    comments = [
        OpenComment(id="c101", pr_number=101, body="SQL injection.", line=5),
        OpenComment(id="c102", pr_number=102, body="XSS.", line=9),
    ]

    resolved_count = scan_and_resolve_prs(
        _SETTINGS, comments, fetch_latest_diff, resolve_thread
    )

    resolve_thread.assert_called_once_with("c101")
    assert resolved_count == 1


def test_scan_resolves_nothing_when_no_comments_open():
    resolve_thread = MagicMock()
    resolved_count = scan_and_resolve_prs(
        _SETTINGS, [], lambda pr: "", resolve_thread
    )
    assert resolved_count == 0
    resolve_thread.assert_not_called()
