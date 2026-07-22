from unittest.mock import MagicMock, patch

import pytest

from arete_agents.mcp import client as mcp_client


@pytest.fixture(autouse=True)
def reset_mcp_client_state():
    """The module under test keeps process-wide session state in globals.
    Reset it before and after every test so tests don't leak into each
    other (mirrors the fixture-per-test isolation used throughout this
    suite)."""
    mcp_client._sessions.clear()
    mcp_client._tool_definitions.clear()
    yield
    mcp_client._sessions.clear()
    mcp_client._tool_definitions.clear()


def test_get_or_create_session_reuses_existing_session():
    fake_session = MagicMock()
    mcp_client._sessions["already-connected"] = fake_session

    with patch.object(mcp_client, "_ensure_bg_loop") as ensure_loop, \
         patch("asyncio.run_coroutine_threadsafe") as run_coro:
        result = mcp_client.get_or_create_session("already-connected", "/usr/local/bin/codebase-memory-mcp")

    assert result is fake_session
    ensure_loop.assert_called_once()
    run_coro.assert_not_called()


def test_get_or_create_session_connects_when_not_present():
    fake_loop = MagicMock()
    fake_future = MagicMock()

    def fake_connect_stdio_effect(*_args, **_kwargs):
        mcp_client._sessions["new-server"] = MagicMock()

    with patch.object(mcp_client, "_ensure_bg_loop", return_value=fake_loop), \
         patch("asyncio.run_coroutine_threadsafe", return_value=fake_future) as run_coro:
        fake_future.result.side_effect = fake_connect_stdio_effect
        result = mcp_client.get_or_create_session("new-server", "/usr/local/bin/codebase-memory-mcp")

    run_coro.assert_called_once()
    assert result is mcp_client._sessions["new-server"]


def test_call_tool_sync_raises_when_no_session():
    with pytest.raises(RuntimeError, match="No MCP session"):
        mcp_client.call_tool_sync("missing-server", "index_repository", {})


def test_call_tool_sync_invokes_session_call_tool():
    fake_session = MagicMock()
    mcp_client._sessions["srv"] = fake_session
    fake_loop = MagicMock()
    mcp_client._bg_loop = fake_loop
    fake_future = MagicMock()
    fake_future.result.return_value = "tool-result"

    with patch("asyncio.run_coroutine_threadsafe", return_value=fake_future) as run_coro:
        result = mcp_client.call_tool_sync("srv", "index_repository", {"repo_path": "/tmp/x"})

    assert result == "tool-result"
    run_coro.assert_called_once()


def test_wrap_server_tools_filters_by_allowlist():
    mcp_client._sessions["srv"] = MagicMock()
    good = MagicMock()
    good.name = "search_graph"
    good.description = "search the graph"
    bad = MagicMock()
    bad.name = "index_repository"
    bad.description = "index the repo"
    mcp_client._tool_definitions["srv"] = [good, bad]

    tools = mcp_client.wrap_server_tools("srv", frozenset({"search_graph"}))

    assert [t.name for t in tools] == ["search_graph"]


def test_wrap_server_tools_returns_empty_without_session():
    mcp_client._tool_definitions["ghost"] = [MagicMock(name="x")]
    assert mcp_client.wrap_server_tools("ghost", None) == []


def test_connect_http_uses_get_valid_token(monkeypatch, tmp_path):
    """get_mcp_tools_for_agent must materialize the Bearer via
    MCPManager.get_valid_token (refresh-on-expiry / fail-closed), not read the
    raw stored 'token' field directly."""
    import arete_agents.mcp.client as client_mod
    from arete_agents.mcp.manager import MCPManager

    monkeypatch.setattr(client_mod, "HAS_MCP", True)
    monkeypatch.setattr(client_mod, "_ensure_bg_loop", lambda: object())

    m = MCPManager(str(tmp_path))
    m._save_config({"srv": {
        "transport": "http", "target": "https://mcp.example/sse", "status": "Authenticated",
        "token": "should-not-be-read-directly", "expires_at": None,
        "refresh_token": None, "token_url": None, "allowed_agents": ["all"],
    }})
    monkeypatch.setattr(client_mod, "MCPManager", lambda *_a, **_k: m)

    calls = {"valid": 0}
    real_get_valid = m.get_valid_token

    def spy_get_valid(name, **kw):
        calls["valid"] += 1
        return real_get_valid(name, **kw)
    monkeypatch.setattr(m, "get_valid_token", spy_get_valid)

    # Stop before any real event-loop / MCP connect: make the scheduling call
    # raise so the connect branch is exercised only up to token materialization.
    def _stop(*_a, **_k):
        raise RuntimeError("stop before real MCP connect")
    monkeypatch.setattr(client_mod.asyncio, "run_coroutine_threadsafe", _stop)

    client_mod.get_mcp_tools_for_agent("reviewer", str(tmp_path))
    assert calls["valid"] == 1  # token materialized via get_valid_token, not details['token']
