import asyncio
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
