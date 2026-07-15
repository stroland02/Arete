from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "cbm_get_architecture.json"


def _tool_result(text: str):
    block = MagicMock()
    block.text = text
    result = MagicMock()
    result.content = [block]
    return result


@patch("arete_agents.context_map.graph_export.mcp_client")
def test_build_graph_export_shape(mock_client):
    from arete_agents.context_map.graph_export import build_graph_export

    mock_client.call_tool_sync.return_value = _tool_result(FIXTURE.read_text())
    export = build_graph_export(installation_id=42)

    assert export["project"] == "install-42"
    assert isinstance(export["nodes"], list) and len(export["nodes"]) > 0
    assert isinstance(export["edges"], list)
    node = export["nodes"][0]
    assert {"id", "kind", "name"} <= node.keys()
    assert "untested" in node and "dead" in node
    ids = {n["id"] for n in export["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in export["edges"])


@patch("arete_agents.context_map.graph_export.mcp_client")
def test_build_graph_export_has_file_nodes_with_paths(mock_client):
    """The dashboard pain/activity sensors join findings onto nodes by path, so
    the export MUST surface File nodes carrying real repo-relative paths."""
    from arete_agents.context_map.graph_export import build_graph_export

    mock_client.call_tool_sync.return_value = _tool_result(FIXTURE.read_text())
    export = build_graph_export(installation_id=7)

    files = [n for n in export["nodes"] if n["kind"] == "File"]
    assert files, "expected File nodes from the real get_architecture file_tree"
    assert any(n["path"] for n in files), "File nodes must carry a path for the sensor join"
    # real package->package call edges from the architecture boundaries
    assert any(e["kind"] == "CALLS" for e in export["edges"])


@patch("arete_agents.context_map.graph_export.mcp_client")
def test_build_graph_export_raises_when_not_indexed(mock_client):
    from arete_agents.context_map.graph_export import GraphExportError, build_graph_export

    mock_client.call_tool_sync.side_effect = RuntimeError(
        "No MCP session for server 'context-map-42'."
    )
    with pytest.raises(GraphExportError):
        build_graph_export(installation_id=42)
