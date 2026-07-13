from arete_agents.mcp import client as mcp_client

# Curated read-only allowlist: query tools every agent benefits from. Mutating
# / index-management tools (e.g. index_repository) are deliberately excluded.
CONTEXT_MAP_READONLY_TOOLS: frozenset[str] = frozenset(
    {
        "search_graph",
        "trace_path",
        "get_code_snippet",
        "search_code",
        "get_architecture",
        "semantic_query",
    }
)


def get_context_map_tools(installation_id: int | None) -> list:
    """Return the curated, read-only codebase-memory-mcp tools for this
    installation's already-indexed repo, as LangChain tools. Returns [] when
    installation_id is None, CMP did not run / indexing failed for this review
    (no live ``context-map-{id}`` session), or the mcp package is unavailable.
    Fail-open — never raises."""
    if installation_id is None:
        return []
    server_name = f"context-map-{installation_id}"
    return mcp_client.wrap_server_tools(server_name, CONTEXT_MAP_READONLY_TOOLS)
