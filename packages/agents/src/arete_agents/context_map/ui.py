import os
import shutil
import socket
import subprocess
from pathlib import Path

from arete_agents.context_map.repo_cache import DEFAULT_REPOS_ROOT

_UI_BINARY_ENV_VAR = "CBM_UI_BINARY_PATH"
_DEFAULT_UI_BINARY_NAME = "codebase-memory-mcp-ui"

# installation_id -> (Popen handle, port). Process-wide, mirrors the
# session-caching pattern in mcp/client.py's _sessions dict — one running
# UI subprocess per installation, started lazily on first request.
_running_ui_processes: dict[int, tuple[subprocess.Popen, int]] = {}


class ContextMapUIError(Exception):
    """Raised when no index exists yet for this installation, or the
    UI-variant binary can't be found/started."""


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _has_indexed_repo(installation_id: int, root: Path) -> bool:
    return any((root / str(installation_id)).glob("*/.git"))


def get_or_start_ui(installation_id: int, root: Path = DEFAULT_REPOS_ROOT) -> str:
    """Return the base URL of a running codebase-memory-mcp graph-UI
    process for this installation, starting one if none is running yet.
    Raises ContextMapUIError if no repo has been indexed for this
    installation, or the UI binary is unavailable — callers (the
    /context-map/ui-url endpoint) turn that into an honest "not available
    yet" response rather than a fabricated URL."""
    if installation_id in _running_ui_processes:
        proc, port = _running_ui_processes[installation_id]
        if proc.poll() is None:
            return f"http://127.0.0.1:{port}"
        del _running_ui_processes[installation_id]

    if not _has_indexed_repo(installation_id, root):
        raise ContextMapUIError(
            f"No indexed repository yet for installation {installation_id}."
        )

    binary = os.environ.get(_UI_BINARY_ENV_VAR) or shutil.which(_DEFAULT_UI_BINARY_NAME)
    if not binary:
        raise ContextMapUIError(
            f"{_DEFAULT_UI_BINARY_NAME} binary not found on PATH and "
            f"{_UI_BINARY_ENV_VAR} is not set."
        )

    port = _find_free_port()
    proc = subprocess.Popen(
        [binary, "--ui=true", f"--port={port}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _running_ui_processes[installation_id] = (proc, port)
    return f"http://127.0.0.1:{port}"
