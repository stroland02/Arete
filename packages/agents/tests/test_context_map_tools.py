import json
from unittest.mock import patch

from arete_agents.context_map.cli import CliError
from arete_agents.context_map.tools import (
    CONTEXT_MAP_READONLY_TOOLS,
    get_context_map_tools,
)

# The review-time context-map tools run codebase-memory-mcp via its one-shot
# ``cli`` mode (see context_map/cli.py) — NOT the stdio MCP session, which
# corrupts its own JSON-RPC stream. So these tests mock the cli boundary
# (project_for_installation + run_cli), never a live session.

_PATH = "arete_agents.context_map.tools"


def test_returns_empty_when_installation_id_none():
    assert get_context_map_tools(None) == []


def test_returns_empty_when_not_indexed():
    # No repo indexed for this installation yet -> honest empty, no tools.
    with patch(f"{_PATH}.project_for_installation", return_value=None):
        assert get_context_map_tools(42) == []


def test_returns_empty_when_binary_unavailable():
    # Missing binary surfaces as CliError from project_for_installation ->
    # fail open, never raise into the review pipeline.
    with patch(f"{_PATH}.project_for_installation", side_effect=CliError("no binary")):
        assert get_context_map_tools(42) == []


def test_returns_only_real_readonly_tools():
    with patch(f"{_PATH}.project_for_installation", return_value="proj-x"):
        tools = get_context_map_tools(7)
    names = {t.name for t in tools}
    assert names == set(CONTEXT_MAP_READONLY_TOOLS)
    # Mutating / non-existent / DSL tools must never be exposed.
    assert "index_repository" not in names   # mutating
    assert "delete_project" not in names     # mutating
    assert "semantic_query" not in names     # not a real codebase-memory-mcp tool
    assert "query_graph" not in names        # Cypher-like DSL, not agent-formable


def test_tool_injects_project_and_forwards_args():
    captured = {}

    def fake_run_cli(tool, args, timeout=60):
        captured["tool"] = tool
        captured["args"] = args
        return {"ok": True}

    with patch(f"{_PATH}.project_for_installation", return_value="proj-x"), patch(
        f"{_PATH}.run_cli", side_effect=fake_run_cli
    ):
        tools = get_context_map_tools(7)
        search_code = next(t for t in tools if t.name == "search_code")
        out = search_code.invoke({"pattern": "TODO"})

    assert captured["tool"] == "search_code"
    # project is resolved from the installation and injected — the LLM never
    # supplies it.
    assert captured["args"]["project"] == "proj-x"
    assert captured["args"]["pattern"] == "TODO"
    assert json.loads(out) == {"ok": True}


def test_get_architecture_takes_no_llm_args_but_injects_project():
    captured = {}

    def fake_run_cli(tool, args, timeout=60):
        captured["tool"] = tool
        captured["args"] = args
        return {"packages": []}

    with patch(f"{_PATH}.project_for_installation", return_value="proj-x"), patch(
        f"{_PATH}.run_cli", side_effect=fake_run_cli
    ):
        tools = get_context_map_tools(7)
        arch = next(t for t in tools if t.name == "get_architecture")
        arch.invoke({})

    assert captured["tool"] == "get_architecture"
    assert captured["args"] == {"project": "proj-x"}


def test_tool_fails_open_on_cli_error():
    with patch(f"{_PATH}.project_for_installation", return_value="proj-x"), patch(
        f"{_PATH}.run_cli", side_effect=CliError("boom")
    ):
        tools = get_context_map_tools(7)
        arch = next(t for t in tools if t.name == "get_architecture")
        out = arch.invoke({})

    # An error becomes a string the agent can read, not an exception.
    assert isinstance(out, str)
    assert "unavailable" in out.lower()
