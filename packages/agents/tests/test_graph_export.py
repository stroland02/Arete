import json
from pathlib import Path
from unittest.mock import patch

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "cbm_get_architecture.json"


@patch("arete_agents.context_map.graph_export.project_for_installation", return_value="proj-42")
@patch("arete_agents.context_map.graph_export.run_cli")
def test_build_graph_export_shape(mock_run, _mock_project):
    from arete_agents.context_map.graph_export import build_graph_export

    mock_run.return_value = json.loads(FIXTURE.read_text())
    export = build_graph_export(installation_id=42)

    assert export["project"] == "proj-42"
    assert isinstance(export["nodes"], list) and len(export["nodes"]) > 0
    assert isinstance(export["edges"], list)
    node = export["nodes"][0]
    assert {"id", "kind", "name"} <= node.keys()
    assert "untested" in node and "dead" in node
    ids = {n["id"] for n in export["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in export["edges"])


@patch("arete_agents.context_map.graph_export.project_for_installation", return_value="proj-7")
@patch("arete_agents.context_map.graph_export.run_cli")
def test_build_graph_export_has_file_nodes_with_paths(mock_run, _mock_project):
    """The dashboard pain/activity sensors join findings onto nodes by path, so
    the export MUST surface File nodes carrying real repo-relative paths."""
    from arete_agents.context_map.graph_export import build_graph_export

    mock_run.return_value = json.loads(FIXTURE.read_text())
    export = build_graph_export(installation_id=7)

    files = [n for n in export["nodes"] if n["kind"] == "File"]
    assert files, "expected File nodes from the real get_architecture file_tree"
    assert any(n["path"] for n in files), "File nodes must carry a path for the sensor join"
    # real package->package call edges from the architecture boundaries
    assert any(e["kind"] == "CALLS" for e in export["edges"])


@patch("arete_agents.context_map.graph_export.project_for_installation", return_value=None)
def test_build_graph_export_raises_when_not_indexed(_mock_project):
    from arete_agents.context_map.graph_export import GraphExportError, build_graph_export

    with pytest.raises(GraphExportError):
        build_graph_export(installation_id=42)


@patch("arete_agents.context_map.graph_export.project_for_installation", return_value="proj-42")
@patch("arete_agents.context_map.graph_export.run_cli")
def test_build_graph_export_raises_when_query_fails(mock_run, _mock_project):
    from arete_agents.context_map.cli import CliError
    from arete_agents.context_map.graph_export import GraphExportError, build_graph_export

    mock_run.side_effect = CliError("cli get_architecture exited 1")
    with pytest.raises(GraphExportError):
        build_graph_export(installation_id=42)
