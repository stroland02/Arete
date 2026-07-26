"""Run codebase-memory-mcp tools via its one-shot ``cli`` subcommand.

The binary's stdio MCP session is unusable in this environment: it writes
``level=info msg=…`` logs to **stdout**, which corrupts the JSON-RPC stream, so
``initialize`` hangs/fails (see the codebase-memory-mcp reference notes). Its
``cli <tool> '<json>'`` mode has no handshake — logs go to stderr and the tool's
JSON result is the only thing on stdout — so indexing and architecture queries
go through here instead of the stdio client.

Two environment facts this module encodes:
  * Project names are derived by the binary from the checkout's ABSOLUTE path
    (e.g. ``C:/app/.data/repos/990001/owner__repo`` → project
    ``C-app-.data-repos-990001-owner__repo``); a supplied ``project`` arg is
    ignored on index. So the graph query resolves the project by matching the
    checkout path, never by a synthetic ``install-<id>`` name.
  * ``repo_path`` must be a NATIVE path (a POSIX ``/c/...`` path indexes 0
    files); ``str(Path)`` already yields the native form on each platform.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

from arete_agents.context_map.repo_cache import DEFAULT_REPOS_ROOT

_BINARY_ENV_VAR = "CBM_BINARY_PATH"
_DEFAULT_BINARY_NAME = "codebase-memory-mcp"
_CLI_TIMEOUT_S = 300


class CliError(Exception):
    """A codebase-memory-mcp CLI call failed: binary missing, non-zero exit, or
    output that isn't parseable JSON. Callers translate this into their own
    IndexerError / GraphExportError and fail open (never a fabricated graph)."""


def resolve_binary() -> str:
    override = os.environ.get(_BINARY_ENV_VAR)
    if override:
        return override
    found = shutil.which(_DEFAULT_BINARY_NAME)
    if not found:
        raise CliError(
            f"{_DEFAULT_BINARY_NAME} binary not found on PATH and "
            f"{_BINARY_ENV_VAR} is not set."
        )
    return found


def run_cli(tool: str, args: dict, timeout: int = _CLI_TIMEOUT_S) -> dict:
    """Run one codebase-memory-mcp tool and return its parsed JSON result.
    Raises CliError on missing binary, non-zero exit, timeout, or non-JSON
    output."""
    binary = resolve_binary()
    try:
        proc = subprocess.run(
            [binary, "cli", tool, json.dumps(args)],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        raise CliError(f"cli {tool} failed to run: {exc}") from exc

    if proc.returncode != 0:
        raise CliError(f"cli {tool} exited {proc.returncode}: {proc.stderr.strip()[:500]}")

    out = proc.stdout.strip()
    # stdout is pure JSON in cli mode; be defensive about a stray leading line
    # by parsing from the first brace.
    brace = out.find("{")
    if brace == -1:
        raise CliError(f"cli {tool} produced no JSON output")
    try:
        return json.loads(out[brace:])
    except json.JSONDecodeError as exc:
        raise CliError(f"cli {tool} returned non-JSON: {out[:300]}") from exc


def project_for_installation(
    installation_id: int, root: Path = DEFAULT_REPOS_ROOT
) -> str | None:
    """The codebase-memory-mcp project name for an installation's indexed repo,
    or None if nothing is checked out / indexed. cli project names are derived
    from the checkout's absolute path, so we find the repo under
    ``<root>/<installation_id>/`` and match it to a project by its root_path
    suffix (drive-prefix and separator agnostic)."""
    inst_dir = root / str(installation_id)
    if not inst_dir.exists():
        return None
    repo_dirs = [p for p in inst_dir.iterdir() if (p / ".git").exists()]
    if not repo_dirs:
        return None
    suffix = f"/{installation_id}/{repo_dirs[0].name}".lower()
    projects = run_cli("list_projects", {}).get("projects", [])
    for proj in projects:
        root_path = str(proj.get("root_path", "")).replace("\\", "/").rstrip("/").lower()
        if root_path.endswith(suffix):
            return proj.get("name")
    return None
