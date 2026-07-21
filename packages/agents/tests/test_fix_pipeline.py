"""POST /fix — author a real file patch for one work item, verified by
auto_resolver's core, honest fix_failed when it can't
(docs/superpowers/specs/2026-07-19-healing-loop-design.md §3, Eng3 lane).

No real git clone or LLM call ever happens here: ensure_repo_checked_out is
patched to a pre-built tmp_path checkout (mirrors test_scan.py's _checkout
convention), and both the author LLM and auto_resolver.verify_resolved are
mocked per scenario.
"""

import time
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from arete_agents.config import Settings
from arete_agents.fix_pipeline import author_patch, run_fix
from arete_agents.models.fix import FixItem, FixRepo, FixRequest, FixResponse
from tests.conftest import INTERNAL_HEADERS


def _checkout(tmp_path, installation_id=42, repo_slug="acme/shop"):
    """A fake checkout with one real, existing source file."""
    repo_dir = tmp_path / str(installation_id) / repo_slug
    target = repo_dir / "app" / "api" / "reports.ts"
    target.parent.mkdir(parents=True)
    target.write_text(
        "import { db } from '../data/db'\n"
        "export function reports(q) {\n"
        "  return db.raw(q)\n"
        "}\n",
        encoding="utf-8",
    )
    return repo_dir


def _request(**overrides):
    base = dict(
        containerId="cont_1",
        installationId=42,
        repo=FixRepo(fullName="acme/shop", defaultBranch="main", token="tok"),
        item=FixItem(
            kind="issue",
            title="SQL built from raw request input",
            detail="reports() passes q straight into db.raw.",
            dimension="security",
            confidence=0.8,
            evidence=[{"path": "app/api/reports.ts", "line": 3, "excerpt": "db.raw(q)"}],
        ),
    )
    base.update(overrides)
    return FixRequest(**base)


_FIXED_FILE_CONTENT = (
    "import { db } from '../data/db'\n"
    "export function reports(q) {\n"
    "  return db.raw('SELECT * FROM reports WHERE q = ?', [q])\n"
    "}\n"
)


def _author_reply(files, summary="fixed it"):
    """A MagicMock LLM whose .invoke() returns the given files/summary as the
    author-stage JSON contract expects."""
    import json

    from langchain_core.messages import AIMessage

    llm = MagicMock()
    llm.with_retry.return_value = llm
    llm.invoke.return_value = AIMessage(content=json.dumps({"files": files, "summary": summary}))
    return llm


def _run(tmp_path, llm, verify_result=True, **req_overrides):
    checkout = _checkout(tmp_path)
    req = _request(**req_overrides)
    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
        "arete_agents.fix_pipeline.verify_resolved", return_value=verify_result
    ) as verify_mock:
        result = run_fix(
            req,
            {"security": llm},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )
    return result, verify_mock


# --- 1. fixed path ----------------------------------------------------------


def test_fixed_path_returns_verified_patch(tmp_path):
    llm = _author_reply([{"path": "app/api/reports.ts", "content": _FIXED_FILE_CONTENT, "isNew": False}])
    result, verify_mock = _run(tmp_path, llm, verify_result=True)

    assert result.status == "fixed"
    assert result.reason is None
    assert len(result.patch) == 1
    assert result.patch[0].path == "app/api/reports.ts"
    assert result.patch[0].content == _FIXED_FILE_CONTENT
    assert result.verification.verdict == "verified"
    verify_mock.assert_called_once()
    actions = [s.action for s in result.transcript]
    assert actions == ["author", "verify", "compose"]
    assert all(s.report.status == "done" for s in result.transcript)


# --- 2. failed verification --------------------------------------------------


def test_failed_verification_returns_fix_failed_with_empty_patch(tmp_path):
    llm = _author_reply([{"path": "app/api/reports.ts", "content": _FIXED_FILE_CONTENT, "isNew": False}])
    result, verify_mock = _run(tmp_path, llm, verify_result=False)

    assert result.status == "fix_failed"
    assert result.patch == []  # non-empty iff status == "fixed" — never leaked on a failed verify
    assert "verify" in result.reason.lower() or "resolve" in result.reason.lower()
    assert result.verification.verdict == "unverified"
    verify_mock.assert_called_once()


# --- 3. grounding violation ---------------------------------------------------


def test_grounding_violation_rejects_whole_patch_before_verifying(tmp_path):
    # Path doesn't exist in the checkout and isn't marked new.
    llm = _author_reply([{"path": "app/api/does-not-exist.ts", "content": "whatever", "isNew": False}])
    result, verify_mock = _run(tmp_path, llm)

    assert result.status == "fix_failed"
    assert result.patch == []
    assert "grounding" in result.reason.lower()
    assert "does-not-exist.ts" in result.reason
    verify_mock.assert_not_called()  # a grounding violation never reaches verification


def test_grounding_violation_when_existing_file_marked_new(tmp_path):
    # app/api/reports.ts DOES exist — claiming isNew is itself a violation.
    llm = _author_reply([{"path": "app/api/reports.ts", "content": "x", "isNew": True}])
    result, verify_mock = _run(tmp_path, llm)

    assert result.status == "fix_failed"
    assert "already exists" in result.reason
    verify_mock.assert_not_called()


def test_empty_files_from_author_is_an_honest_fix_failed_not_a_grounding_violation(tmp_path):
    llm = _author_reply([], summary="could not find a safe way to parameterize this query")
    result, verify_mock = _run(tmp_path, llm)

    assert result.status == "fix_failed"
    assert result.reason == "could not find a safe way to parameterize this query"
    assert result.patch == []
    verify_mock.assert_not_called()


# --- 4. new-file allowance ----------------------------------------------------


def test_new_file_allowance_when_explicitly_marked(tmp_path):
    llm = _author_reply(
        [
            {"path": "app/api/reports.ts", "content": _FIXED_FILE_CONTENT, "isNew": False},
            {"path": "app/api/sql-utils.ts", "content": "export function safeQuery() {}\n", "isNew": True},
        ]
    )
    result, verify_mock = _run(tmp_path, llm, verify_result=True)

    assert result.status == "fixed"
    paths = {f.path for f in result.patch}
    assert paths == {"app/api/reports.ts", "app/api/sql-utils.ts"}
    verify_mock.assert_called_once()


# --- 5. timeout ----------------------------------------------------------------


def test_timeout_returns_honest_fix_failed(tmp_path):
    checkout = _checkout(tmp_path)
    req = _request()

    def slow_author(*args, **kwargs):
        time.sleep(0.2)
        return {"files": [{"path": "app/api/reports.ts", "content": "x", "isNew": False}], "summary": "slow"}

    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
        "arete_agents.fix_pipeline.author_patch", side_effect=slow_author
    ):
        result = run_fix(
            req,
            {"security": MagicMock()},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
            timeout_seconds=0.01,
        )

    assert result.status == "fix_failed"
    assert result.reason == "timeout"
    assert result.patch == []


# --- author_patch unit tests (parsing/fail-closed behavior) -------------------


def test_author_patch_fails_closed_on_unparseable_output():
    llm = MagicMock()
    llm.with_retry.return_value = llm
    from langchain_core.messages import AIMessage

    llm.invoke.return_value = AIMessage(content="not json at all")
    item = _request().item
    result = author_patch(llm, item, {"app/api/reports.ts": "content"})
    assert result["files"] == []


def test_author_patch_fails_closed_on_llm_exception():
    llm = MagicMock()
    llm.with_retry.return_value = llm
    llm.invoke.side_effect = RuntimeError("provider outage")
    item = _request().item
    result = author_patch(llm, item, {"app/api/reports.ts": "content"})
    assert result["files"] == []
    assert "provider outage" in result["summary"]


# --- endpoint-level tests -------------------------------------------------------


def test_fix_endpoint_builds_clients_from_llm_block_and_returns_200():
    import arete_agents.server as server

    captured = {}

    def fake_from_config(provider, model=None, api_key=None, base_url=None):
        captured.update(provider=provider, model=model, api_key=api_key, base_url=base_url)
        return {"security": MagicMock()}

    fake_response = FixResponse(status="fixed", patch=[], transcript=[], verification=None)

    with patch.object(server, "get_llms_by_role_from_config", side_effect=fake_from_config), patch.object(
        server, "run_fix", return_value=fake_response
    ) as run_mock, patch.object(server, "ollama_unavailable_reason", return_value=None):
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post(
            "/fix",
            json={
                "containerId": "cont_1",
                "installationId": 42,
                "repo": {"fullName": "acme/shop", "defaultBranch": "main", "token": "tok"},
                "item": {
                    "kind": "issue",
                    "title": "t",
                    "detail": "d",
                    "dimension": "security",
                    "confidence": 0.8,
                    "evidence": [{"path": "a.ts", "line": 1}],
                },
                "llm": {"provider": "anthropic", "model": "claude-opus-4", "apiKey": "sk-user"},
            },
        )

    assert resp.status_code == 200
    assert captured == {"provider": "anthropic", "model": "claude-opus-4", "api_key": "sk-user", "base_url": None}
    run_mock.assert_called_once()


def test_fix_endpoint_ollama_unavailable_is_honest_fix_failed_not_503():
    """Deliberate deviation from /review and /scan (which 503): FixResponse
    already carries success/failure in its own `status` field, so every
    "could not do it" case — including an unreachable Ollama — is HTTP 200
    with status:"fix_failed", never a 503. Regression guard for that design
    choice (see server.py's /fix docstring)."""
    import arete_agents.server as server

    hint = "Ollama is not reachable. Run `ollama pull qwen2.5-coder` and retry."
    with patch.object(server, "ollama_unavailable_reason", return_value=hint), patch.object(
        server, "run_fix"
    ) as run_mock:
        client = TestClient(server.app, headers=INTERNAL_HEADERS)
        resp = client.post(
            "/fix",
            json={
                "containerId": "cont_1",
                "installationId": 42,
                "repo": {"fullName": "acme/shop", "defaultBranch": "main", "token": "tok"},
                "item": {
                    "kind": "issue",
                    "title": "t",
                    "detail": "d",
                    "dimension": "security",
                    "confidence": 0.8,
                    "evidence": [{"path": "a.ts", "line": 1}],
                },
                "llm": {"provider": "ollama", "model": "qwen2.5-coder"},
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "fix_failed"
    assert "ollama pull" in body["reason"]
    run_mock.assert_not_called()
