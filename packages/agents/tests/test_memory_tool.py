"""Phase 2 Task 8 -- add_project_memory used to be a pure stub: it logged and
returned a hardcoded success string, persisting nothing. These tests pin the
real behavior: the tool calls the webhook's token-guarded POST
/internal/memory, and every failure mode -- a real transport error, a server
rejection, an oversized note, or missing tenant context -- returns an honest
failure string. It must NEVER return the "Successfully saved" string unless
the webhook actually reported success.
"""

import socket

import httpx
import pytest

from arete_agents.config import get_settings
from arete_agents.tools.memory import build_memory_tool


@pytest.fixture(autouse=True)
def _settings_env(monkeypatch):
    # Settings() eagerly validates ANTHROPIC_API_KEY when LLM_PROVIDER=anthropic
    # (the default) -- unrelated to this tool, but get_settings() is a single
    # process-wide lru_cache shared with every other Settings consumer, same as
    # test_llm.py / test_cli.py's existing pattern. internal_api_token /
    # webhook_service_url are left at their defaults; every test here injects
    # its own `post` fn, so the real webhook_service_url is never dialed.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _unused_port() -> int:
    """A real TCP port with nothing listening on it -- used to induce a
    genuine httpx transport error (connection refused), not a mocked one."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _ok_response(memory_id: str = "mem-1") -> httpx.Response:
    return httpx.Response(201, json={"ok": True, "id": memory_id})


def _rejected_response(status: int, reason: str) -> httpx.Response:
    return httpx.Response(status, json={"ok": False, "reason": reason})


class RecordingPoster:
    """Fake post() that records every call and returns a canned response --
    used for the tests that assert what was SENT, not the transport itself."""

    def __init__(self, response: httpx.Response):
        self.response = response
        self.calls: list[tuple[dict, dict]] = []

    def __call__(self, payload: dict, headers: dict) -> httpx.Response:
        self.calls.append((payload, headers))
        return self.response


def test_persists_a_row_and_reports_the_real_success():
    poster = RecordingPoster(_ok_response("mem-42"))
    tool = build_memory_tool(123, "owner/repo", post=poster)

    result = tool.invoke({"note": "Use tabs, not spaces.", "kind": "terminology"})

    assert "Successfully saved" in result
    assert "Use tabs, not spaces." in result
    assert len(poster.calls) == 1
    payload, headers = poster.calls[0]
    assert payload == {
        "installationId": 123,
        "repoFullName": "owner/repo",
        "kind": "terminology",
        "title": "Use tabs, not spaces.",
        "body": "Use tabs, not spaces.",
    }
    assert "Content-Type" in headers


# SECURITY (mutation test for the tenant guard, Global Constraint 10): the
# LLM-facing tool schema has NO installation/repo argument at all -- there is
# no code path by which a tool call can name a different tenant's repo. This
# asserts that closure binding: the payload sent to the server always carries
# the values build_memory_tool was constructed with, never anything the model
# could have supplied via `note`/`kind`.
def test_tool_schema_never_exposes_installation_or_repo_to_the_model():
    poster = RecordingPoster(_ok_response())
    tool = build_memory_tool(999, "victim-org/victim-repo", post=poster)

    schema_fields = tool.args_schema.model_fields.keys()
    assert "installation_id" not in schema_fields
    assert "repo_full_name" not in schema_fields
    assert set(schema_fields) == {"note", "kind"}

    tool.invoke({"note": "n", "kind": "project"})
    payload, _headers = poster.calls[0]
    assert payload["installationId"] == 999
    assert payload["repoFullName"] == "victim-org/victim-repo"


def test_rejected_by_server_as_repo_not_found_returns_failure_not_success():
    poster = RecordingPoster(_rejected_response(404, "repo_not_found"))
    tool = build_memory_tool(1, "owner/repo", post=poster)

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Failed to save" in result
    assert "Successfully saved" not in result
    assert "repo_not_found" in result


def test_rejected_by_server_as_cap_exceeded_returns_failure_not_success():
    poster = RecordingPoster(_rejected_response(400, "cap_exceeded"))
    tool = build_memory_tool(1, "owner/repo", post=poster)

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Failed to save" in result
    assert "Successfully saved" not in result
    assert "cap_exceeded" in result


def test_rejected_unauthenticated_returns_failure_not_success():
    poster = RecordingPoster(httpx.Response(401, json={"error": "unauthorized"}))
    tool = build_memory_tool(1, "owner/repo", post=poster)

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Failed to save" in result
    assert "Successfully saved" not in result


def test_oversized_note_is_rejected_not_truncated_and_never_calls_the_server():
    poster = RecordingPoster(_ok_response())
    tool = build_memory_tool(1, "owner/repo", post=poster)

    oversized = "x" * 4001  # mirrors memory-write.ts's MAX_MEMORY_BODY_CHARS = 4000
    result = tool.invoke({"note": oversized, "kind": "project"})

    assert "Failed to save" in result
    assert "Successfully saved" not in result
    assert poster.calls == []  # rejected client-side; never truncated and sent


def test_note_exactly_at_the_cap_is_accepted():
    poster = RecordingPoster(_ok_response())
    tool = build_memory_tool(1, "owner/repo", post=poster)

    at_cap = "x" * 4000
    result = tool.invoke({"note": at_cap, "kind": "project"})

    assert "Successfully saved" in result
    assert len(poster.calls) == 1


def test_missing_installation_context_fails_honestly_without_any_network_call():
    poster = RecordingPoster(_ok_response())
    tool = build_memory_tool(None, "owner/repo", post=poster)

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Failed to save" in result
    assert "Successfully saved" not in result
    assert poster.calls == []


def test_missing_repo_context_fails_honestly_without_any_network_call():
    poster = RecordingPoster(_ok_response())
    tool = build_memory_tool(123, None, post=poster)

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Failed to save" in result
    assert poster.calls == []


def test_unrecognized_kind_falls_back_to_project_rather_than_being_rejected():
    poster = RecordingPoster(_ok_response())
    tool = build_memory_tool(1, "owner/repo", post=poster)

    result = tool.invoke({"note": "n", "kind": "not-a-real-kind"})

    assert "Successfully saved" in result
    payload, _ = poster.calls[0]
    assert payload["kind"] == "project"


# THE core defect being removed (task-8-brief.md: "a transport failure
# returns a failure string, not the success string"). This induces a REAL
# httpx transport error -- an actual TCP connection refused against a port
# nothing is listening on -- rather than mocking a return value, so the
# except branch that handles httpx.HTTPError is genuinely exercised.
def test_real_transport_failure_returns_honest_failure_never_the_success_string():
    dead_port = _unused_port()

    def post_over_real_network(payload: dict, headers: dict) -> httpx.Response:
        return httpx.post(
            f"http://127.0.0.1:{dead_port}/internal/memory",
            json=payload,
            headers=headers,
            timeout=2.0,
        )

    tool = build_memory_tool(1, "owner/repo", post=post_over_real_network)

    result = tool.invoke({"note": "Always use Redis for caching.", "kind": "infra"})

    assert "Failed to save" in result
    assert "Successfully saved" not in result


def test_real_transport_failure_is_a_genuine_httpx_error():
    """Sanity-checks the test above isn't accidentally vacuous: confirm the
    unused port really does raise a real httpx transport error when hit
    directly. On this platform an unbound loopback port produces a connect
    TIMEOUT rather than an immediate refusal (no RST) -- both ConnectError
    and ConnectTimeout are real, un-mocked httpx.HTTPError transport
    failures, which is the property this test (and the tool's `except
    httpx.HTTPError` handler) actually depends on."""
    dead_port = _unused_port()
    with pytest.raises((httpx.ConnectError, httpx.ConnectTimeout)):
        httpx.post(f"http://127.0.0.1:{dead_port}/internal/memory", json={}, timeout=2.0)
