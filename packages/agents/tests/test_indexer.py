from unittest.mock import patch

import pytest


@patch("arete_agents.context_map.indexer.run_cli")
def test_index_repository_returns_project_name_on_success(mock_run, tmp_path):
    from arete_agents.context_map.indexer import index_repository

    # cli index_repository returns the binary-derived project name + status.
    mock_run.return_value = {"project": "C-tmp-owner__repo", "status": "indexed", "nodes": 27}

    project = index_repository(installation_id=42, repo_dir=tmp_path)

    assert project == "C-tmp-owner__repo"
    mock_run.assert_called_once_with("index_repository", {"repo_path": str(tmp_path)})


@patch("arete_agents.context_map.indexer.run_cli")
def test_index_repository_raises_on_degraded_status(mock_run, tmp_path):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    mock_run.return_value = {"project": "p", "status": "degraded"}

    with pytest.raises(IndexerError):
        index_repository(installation_id=42, repo_dir=tmp_path)


@patch("arete_agents.context_map.indexer.run_cli")
def test_index_repository_raises_when_cli_fails(mock_run, tmp_path):
    """A missing binary / non-zero exit / timeout surfaces as CliError from
    run_cli, which the indexer must translate into IndexerError (fail open)."""
    from arete_agents.context_map.cli import CliError
    from arete_agents.context_map.indexer import IndexerError, index_repository

    mock_run.side_effect = CliError("codebase-memory-mcp binary not found on PATH")

    with pytest.raises(IndexerError):
        index_repository(installation_id=42, repo_dir=tmp_path)


@patch("arete_agents.context_map.indexer.run_cli")
def test_index_repository_raises_when_no_project_returned(mock_run, tmp_path):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    mock_run.return_value = {"status": "indexed"}  # no project name

    with pytest.raises(IndexerError):
        index_repository(installation_id=42, repo_dir=tmp_path)
