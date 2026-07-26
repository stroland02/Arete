import json
import logging

from langchain_core.tools import StructuredTool

from arete_agents.context_map.cli import (
    CliError,
    project_for_installation,
    run_cli,
)

logger = logging.getLogger(__name__)

# Curated read-only allowlist: the codebase-memory-mcp tools (v0.8.1) that
# actually exist AND are safe for a review agent to call. Deliberately excluded:
#   * mutating / index-management tools (index_repository, delete_project)
#   * query_graph — its ``query`` arg is a Cypher-like graph DSL an LLM can't
#     reliably form (plain text errors with "expected token type ...")
#   * semantic_query — NOT a real codebase-memory-mcp tool; a prior allowlist bug
# ``project`` is resolved from the installation's checkout and INJECTED by the
# wrapper below — it is never part of a tool's agent-facing schema.
CONTEXT_MAP_READONLY_TOOLS: frozenset[str] = frozenset(
    {
        "get_architecture",
        "search_graph",
        "search_code",
        "trace_path",
        "get_code_snippet",
    }
)

_CALL_TIMEOUT_S = 60


def _call(project: str, tool: str, **args: object) -> str:
    """Run one read-only context-map tool over the cli and return its JSON
    result as a string. Fail-open: a CliError becomes an error string the agent
    can read and route around, never an exception into the review loop."""
    try:
        result = run_cli(tool, {"project": project, **args}, timeout=_CALL_TIMEOUT_S)
    except CliError as exc:
        return f"context-map {tool} unavailable: {exc}"
    return json.dumps(result)


def _build_tools(project: str) -> list:
    """Build the read-only LangChain tools bound to ``project``. Each tool's
    agent-facing signature exposes only the semantic args; ``project`` is closed
    over and injected in ``_call``. Docstrings are the tool descriptions the LLM
    sees, so they say when to reach for each one."""

    def get_architecture() -> str:
        """Return a high-level architecture summary of the codebase: packages,
        module boundaries, entry points, routes, hotspots, and layers. Call this
        first to orient yourself before drilling into specific code."""
        return _call(project, "get_architecture")

    def search_graph(query: str = "", limit: int = 10) -> str:
        """Full-text (BM25) search over the codebase graph for functions,
        classes, files, and other symbols matching ``query``. Returns ranked
        nodes with their qualified_name and file location. Use to discover where
        a concept lives. Leave ``query`` empty to list top nodes."""
        return _call(project, "search_graph", query=query, limit=limit)

    def search_code(pattern: str) -> str:
        """Search the indexed codebase for ``pattern`` and return matching code
        nodes with file paths and line numbers. Use to find concrete usages of a
        symbol or string across the repo."""
        return _call(project, "search_code", pattern=pattern)

    def trace_path(function_name: str) -> str:
        """Trace the call graph around ``function_name`` — its callers and
        callees. Use to judge the blast radius / reachability of a change to
        that function before commenting on it."""
        return _call(project, "trace_path", function_name=function_name)

    def get_code_snippet(qualified_name: str) -> str:
        """Return the source snippet for a symbol given its fully-qualified name
        (as reported by search_graph / search_code). Use to read the exact code
        before making a claim about it."""
        return _call(project, "get_code_snippet", qualified_name=qualified_name)

    builders = {
        "get_architecture": get_architecture,
        "search_graph": search_graph,
        "search_code": search_code,
        "trace_path": trace_path,
        "get_code_snippet": get_code_snippet,
    }
    return [
        StructuredTool.from_function(fn)
        for name, fn in builders.items()
        if name in CONTEXT_MAP_READONLY_TOOLS
    ]


def get_context_map_tools(installation_id: int | None) -> list:
    """Return the curated, read-only codebase-memory-mcp tools for this
    installation's already-indexed repo, as LangChain tools bound to that repo's
    project.

    Runs the binary via its one-shot ``cli`` mode (see context_map/cli.py) — the
    stdio MCP session is unusable (it corrupts its own JSON-RPC stream with log
    output). Returns [] when ``installation_id`` is None, no repo has been
    indexed for this installation yet, or the codebase-memory-mcp binary is
    unavailable. Fail-open — never raises into the review pipeline."""
    if installation_id is None:
        return []
    try:
        project = project_for_installation(installation_id)
    except CliError:
        return []
    if not project:
        return []
    return _build_tools(project)
