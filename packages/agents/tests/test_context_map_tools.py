from unittest.mock import MagicMock

import pytest

from arete_agents.context_map.tools import (
    CONTEXT_MAP_READONLY_TOOLS,
    get_context_map_tools,
)
from arete_agents.mcp import client as mcp_client


@pytest.fixture(autouse=True)
def reset_sessions():
    mcp_client._sessions.clear()
    mcp_client._tool_definitions.clear()
    yield
    mcp_client._sessions.clear()
    mcp_client._tool_definitions.clear()


def _fake_tool(name: str):
    t = MagicMock()
    t.name = name
    t.description = f"{name} description"
    return t


def test_returns_only_allowlisted_tools():
    mcp_client._sessions["context-map-42"] = MagicMock()
    mcp_client._tool_definitions["context-map-42"] = [
        _fake_tool("search_graph"),
        _fake_tool("index_repository"),  # mutating -> excluded
        _fake_tool("trace_path"),
    ]

    tools = get_context_map_tools(42)

    assert sorted(t.name for t in tools) == ["search_graph", "trace_path"]
    assert set(t.name for t in tools) <= CONTEXT_MAP_READONLY_TOOLS


def test_returns_empty_when_not_indexed():
    assert get_context_map_tools(99) == []


def test_returns_empty_when_installation_id_none():
    assert get_context_map_tools(None) == []
