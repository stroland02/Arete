import json
import os
import shutil
from pathlib import Path
from typing import Any

from arete_agents.mcp import client as mcp_client

_BINARY_ENV_VAR = "CBM_BINARY_PATH"
_DEFAULT_BINARY_NAME = "codebase-memory-mcp"


class IndexerError(Exception):
    """Raised when the codebase-memory-mcp binary is missing, the MCP
    session can't be established, or indexing itself fails or reports a
    degraded result. Callers must catch this and fail open."""


def _resolve_binary() -> str:
    override = os.environ.get(_BINARY_ENV_VAR)
    if override:
        return override
    found = shutil.which(_DEFAULT_BINARY_NAME)
    if not found:
        raise IndexerError(
            f"{_DEFAULT_BINARY_NAME} binary not found on PATH and "
            f"{_BINARY_ENV_VAR} is not set."
        )
    return found


def _extract_status(result: Any) -> str | None:
    """codebase-memory-mcp's index_repository returns a CallToolResult
    whose content is a list of content blocks; the tool's JSON payload is
    the first block's text. Any parsing failure is treated as an unknown
    (non-degraded) status rather than raising — a status-parsing hiccup
    shouldn't fail an otherwise-successful index."""
    try:
        return json.loads(result.content[0].text).get("status")
    except Exception:
        return None


def index_repository(installation_id: int, repo_dir: Path) -> str:
    """Index (or incrementally re-index) repo_dir into codebase-memory-mcp's
    graph, keyed by a per-installation project name. Returns the project
    name callers should use for subsequent queries. Raises IndexerError on
    any failure — callers must catch this and fail open."""
    server_name = f"context-map-{installation_id}"
    project = f"install-{installation_id}"

    binary = _resolve_binary()
    try:
        mcp_client.get_or_create_session(server_name, binary)
        result = mcp_client.call_tool_sync(
            server_name,
            "index_repository",
            {"repo_path": str(repo_dir), "project": project},
        )
    except Exception as exc:
        raise IndexerError(f"Failed to index {repo_dir}: {exc}") from exc

    if _extract_status(result) == "degraded":
        raise IndexerError(f"Indexing degraded for {repo_dir} (project={project})")

    return project
