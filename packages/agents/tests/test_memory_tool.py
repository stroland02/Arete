"""Phase 2 Task 8 -- add_project_memory used to be a pure stub: it logged and
returned a hardcoded success string, persisting nothing. These tests pin the
real behavior: the tool calls the webhook's token-guarded POST
/internal/memory, and every failure mode -- a real transport error, a server
rejection, an oversized note, or missing tenant context -- returns an honest
failure string. It must NEVER return the "Successfully saved" string unless
the webhook actually reported success.
"""

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest

from arete_agents.config import get_settings
from arete_agents.internal_token import verify_internal_token
from arete_agents.tools.memory import build_memory_tool


@pytest.fixture(autouse=True)
def _settings_env(monkeypatch):
    # Settings() eagerly validates ANTHROPIC_API_KEY when LLM_PROVIDER=anthropic
    # (the default) -- unrelated to this tool, but get_settings() is a single
    # process-wide lru_cache shared with every other Settings consumer, same as
    # test_llm.py / test_cli.py's existing pattern. The internal-token keyset
    # (conftest.py's autouse fixture) / webhook_service_url are left at their
    # defaults; every test here injects its own `post` fn, so the real
    # webhook_service_url is never dialed.
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


# ---------------------------------------------------------------------------
# Real-HTTP tests (review finding B3 + the "_default_post is never exercised"
# and "no test asserts the Authorization header is actually sent" gaps).
#
# B3: the tool inferred success from a bare status code -- `status_code in
# (200, 201)`, with the response body never inspected. The real endpoint
# returns 201 {"ok": true, "id": ...}. A server answering `200 text/html`
# (a proxy error page, a login redirect, a misrouted request) therefore
# produced "Successfully saved project memory" with nothing persisted: the
# ORIGINAL DEFECT this whole task existed to remove, reintroduced one layer
# out. Success now requires 201 AND a JSON body with ok === true.
#
# These drive the REAL `_default_post` against a REAL local HTTP server, so
# the actual httpx call, the actual URL construction, and the actual headers
# are exercised -- not a fake `post` fn.
# ---------------------------------------------------------------------------


class _CannedHandler(BaseHTTPRequestHandler):
    """Answers every POST with the class-level canned response and records the
    request for assertions."""

    status = 201
    content_type = "application/json"
    payload = b'{"ok": true, "id": "mem-1"}'
    seen: list[dict] = []

    def do_POST(self):  # noqa: N802 (BaseHTTPRequestHandler's API)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        type(self).seen.append(
            {
                "path": self.path,
                "headers": dict(self.headers),
                "body": json.loads(raw) if raw else None,
            }
        )
        self.send_response(self.status)
        self.send_header("Content-Type", self.content_type)
        self.send_header("Content-Length", str(len(self.payload)))
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *args):  # silence the default stderr access log
        pass


@pytest.fixture
def canned_server(monkeypatch):
    """Start a real HTTP server and point Settings.webhook_service_url at it,
    so `_default_post` (the production code path) is what actually runs."""

    def _start(
        *,
        status: int,
        content_type: str,
        payload: bytes,
        kid: str = "canned-server-kid",
        secret: str = "canned-server-signing-key-0123456789abcdef",
    ):
        handler = type(
            "Handler",
            (_CannedHandler,),
            {"status": status, "content_type": content_type, "payload": payload, "seen": []},
        )
        server = HTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        started.append((server, thread))
        monkeypatch.setenv("WEBHOOK_SERVICE_URL", f"http://127.0.0.1:{server.server_port}")
        monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEYS", json.dumps({kid: secret}))
        monkeypatch.setenv("INTERNAL_TOKEN_ACTIVE_KID", kid)
        get_settings.cache_clear()
        return handler

    started: list = []
    yield _start
    for server, thread in started:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_bare_http_200_html_is_not_reported_as_success(canned_server):
    """THE B3 probe, verbatim: a server that answers 200 text/html persisted
    nothing, yet the tool said 'Successfully saved project memory'."""
    canned_server(status=200, content_type="text/html", payload=b"<html>hello</html>")
    tool = build_memory_tool(1, "owner/repo")  # real _default_post

    result = tool.invoke({"note": "Always use Redis for caching.", "kind": "infra"})

    assert "Successfully saved" not in result
    assert "Failed to save" in result


def test_http_200_with_ok_true_json_is_still_not_success(canned_server):
    """The endpoint's success contract is 201. A 200 -- even a well-formed
    one -- is not the endpoint answering; treating it as success is how a
    proxy or a redirect gets mistaken for a persisted row."""
    canned_server(status=200, content_type="application/json", payload=b'{"ok": true, "id": "x"}')
    tool = build_memory_tool(1, "owner/repo")

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Successfully saved" not in result


def test_201_without_ok_true_is_not_reported_as_success(canned_server):
    canned_server(status=201, content_type="application/json", payload=b'{"ok": false, "reason": "cap_exceeded"}')
    tool = build_memory_tool(1, "owner/repo")

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Successfully saved" not in result
    assert "Failed to save" in result


def test_201_with_a_non_json_body_is_not_reported_as_success(canned_server):
    canned_server(status=201, content_type="text/html", payload=b"created")
    tool = build_memory_tool(1, "owner/repo")

    result = tool.invoke({"note": "n", "kind": "project"})

    assert "Successfully saved" not in result


def test_real_201_ok_true_over_real_http_reports_success_and_sends_the_bearer(canned_server):
    """The one genuine success shape -- and the only test that proves the
    Authorization header is actually PUT ON THE WIRE by `_default_post`
    (previously only Content-Type was asserted, against a fake poster). The
    header must be a genuine signed internal token identifying THIS process
    ("arete-agents") -- not a literal string match, since obs Phase 3 Task 4
    replaced the static shared secret with a minted, verifiable JWT."""
    handler = canned_server(status=201, content_type="application/json", payload=b'{"ok": true, "id": "mem-7"}')
    tool = build_memory_tool(42, "owner/repo")

    result = tool.invoke({"note": "Use tabs, not spaces.", "kind": "terminology"})

    assert "Successfully saved" in result
    assert len(handler.seen) == 1
    request = handler.seen[0]
    assert request["path"] == "/internal/memory"
    auth_header = request["headers"]["Authorization"]
    assert auth_header.startswith("Bearer ")
    verified = verify_internal_token(auth_header)
    assert verified.ok is True
    assert verified.iss == "arete-agents"
    assert request["headers"]["Content-Type"] == "application/json"
    assert request["body"]["installationId"] == 42
    assert request["body"]["repoFullName"] == "owner/repo"


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
