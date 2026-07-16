"""Normalize the codebase-memory-mcp code graph into a stable GraphExport JSON.

This builds ON the shipped context-mapping foundation: it queries an
already-connected per-installation MCP session (see
``arete_agents.mcp.client.get_or_create_session`` /
``call_tool_sync`` and the ``context-map-{id}`` / ``install-{id}``
conventions from ``context_map.indexer``). It NEVER opens a session or runs
the binary itself — a graph is only queryable after a review has indexed the
installation.

Reality note (codebase-memory-mcp 0.8.1): the single allowlisted whole-project
tool, ``get_architecture``, returns an *architecture summary* — packages,
package→package call boundaries, a file tree, entry points, clusters, layers —
NOT a raw per-node/edge dump (there is no TESTS edge type nor a dead-code flag
in its payload). We therefore build a real, honest map at file + package
granularity:

  * nodes  = files & folders (from ``file_tree``, carrying real repo-relative
             paths so the dashboard pain/activity sensors can join by path),
             packages (from ``packages`` + ``boundaries``), and entry-point
             functions (from ``entry_points``, linked to their file).
  * edges  = folder→child CONTAINS (file tree), package→package CALLS
             (boundaries), and file→function DEFINES (entry points).

``untested`` (vitality) and ``dead`` (necrosis) are left False: this binary's
``get_architecture`` does not expose per-node test-coverage or reachability,
and fabricating them would violate the anti-fabrication rule. They are honestly
absent in v1 (like the deferred heat/churn sensor), NOT zeroed to look real.
"""

from datetime import datetime, timezone
from typing import Any

from arete_agents.context_map.cli import CliError, project_for_installation, run_cli


class GraphExportError(Exception):
    """Raised when no indexed repo exists for this installation, or the tool
    payload can't be read. The endpoint (server.py) turns this into an honest
    ``{available: false}`` response, never a fabricated graph."""


def _dirname(path: str) -> str:
    return path.rsplit("/", 1)[0] if "/" in path else ""


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def build_graph_export(installation_id: int) -> dict:
    """Return the stable GraphExport dict for an installation's indexed repo.

    Consumes only the allowlisted read-only ``get_architecture`` tool over the
    already-connected ``context-map-{id}`` session. Raises GraphExportError if
    no session/index exists or the payload can't be parsed.
    """
    project = project_for_installation(installation_id)
    if not project:
        raise GraphExportError(
            f"No indexed repository for installation {installation_id}"
        )
    try:
        arch = run_cli("get_architecture", {"project": project})
    except CliError as exc:  # binary missing / query failed / unparseable
        raise GraphExportError(
            f"No queryable graph for installation {installation_id}: {exc}"
        ) from exc

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def add_node(nid: str, **fields: Any) -> None:
        if nid not in nodes:
            nodes[nid] = {
                "id": nid,
                "kind": fields.get("kind", "Unknown"),
                "name": fields.get("name", nid),
                "path": fields.get("path"),
                "qualifiedName": fields.get("qualifiedName"),
                "degree": int(fields.get("degree", 0) or 0),
                "untested": False,  # not derivable from get_architecture (0.8.1)
                "dead": False,  # not derivable from get_architecture (0.8.1)
            }

    # --- File tree: File / Folder nodes + CONTAINS edges -------------------
    for entry in arch.get("file_tree", []):
        path = entry.get("path")
        if not path:
            continue
        is_file = entry.get("type") == "file"
        add_node(
            path,
            kind="File" if is_file else "Folder",
            name=_basename(path),
            path=path,
            degree=int(entry.get("children", 0) or 0),
        )
    # containment edges once all tree nodes exist
    for entry in arch.get("file_tree", []):
        path = entry.get("path")
        parent = _dirname(path) if path else ""
        if path and parent and parent in nodes and path in nodes:
            edges.append({"source": parent, "target": path, "kind": "CONTAINS"})

    # --- Packages + package→package CALLS (boundaries) --------------------
    def pkg_id(name: str) -> str:
        return f"pkg:{name}"

    for pkg in arch.get("packages", []):
        name = pkg.get("name")
        if not name:
            continue
        add_node(
            pkg_id(name),
            kind="Package",
            name=name,
            degree=int(pkg.get("node_count", 0) or 0),
        )
    for b in arch.get("boundaries", []):
        src, dst = b.get("from"), b.get("to")
        if not src or not dst:
            continue
        # a boundary endpoint may be a package not in the (truncated) packages
        # list — materialize it so the real call edge stays valid.
        add_node(pkg_id(src), kind="Package", name=src)
        add_node(pkg_id(dst), kind="Package", name=dst)
        edges.append(
            {
                "source": pkg_id(src),
                "target": pkg_id(dst),
                "kind": "CALLS",
                "count": int(b.get("call_count", 0) or 0),
            }
        )

    # --- Entry-point functions, linked to their file ----------------------
    for ep in arch.get("entry_points", []):
        qn = ep.get("qualified_name") or ep.get("name")
        if not qn:
            continue
        file_path = ep.get("file")
        add_node(
            qn,
            kind="Function",
            name=ep.get("name", qn),
            path=file_path,
            qualifiedName=qn,
        )
        if file_path and file_path in nodes:
            edges.append({"source": file_path, "target": qn, "kind": "DEFINES"})

    # Drop any edge whose endpoints aren't both real nodes (referential safety).
    node_ids = set(nodes)
    edges = [e for e in edges if e["source"] in node_ids and e["target"] in node_ids]

    return {
        "project": project,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nodes": list(nodes.values()),
        "edges": edges,
    }
