from pathlib import Path

from arete_agents.context_map.cli import CliError, run_cli


class IndexerError(Exception):
    """Raised when the codebase-memory-mcp CLI is missing, indexing fails, or
    reports a degraded result. Callers must catch this and fail open."""


def index_repository(installation_id: int, repo_dir: Path) -> str:
    """Index (or incrementally re-index) repo_dir into codebase-memory-mcp's
    graph and return the project name to use for subsequent queries.

    Uses the binary's one-shot ``cli index_repository`` (the stdio MCP session
    is unusable — it corrupts its own JSON-RPC stream with log output). The
    project name is derived by the binary from the checkout's absolute path and
    returned in the response, so we surface that rather than a synthetic
    ``install-<id>`` name. ``installation_id`` is retained for the call
    signature / logging. Raises IndexerError on any failure — callers must catch
    it and fail open."""
    try:
        result = run_cli("index_repository", {"repo_path": str(repo_dir)})
    except CliError as exc:
        raise IndexerError(f"Failed to index {repo_dir}: {exc}") from exc

    if result.get("status") == "degraded":
        raise IndexerError(f"Indexing degraded for {repo_dir} (installation {installation_id})")

    project = result.get("project")
    if not project:
        raise IndexerError(f"Indexing {repo_dir} returned no project name")
    return project
