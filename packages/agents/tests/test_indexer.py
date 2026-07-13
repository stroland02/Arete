from unittest.mock import MagicMock, patch

import pytest


def _tool_result(status: str | None):
    block = MagicMock()
    block.text = "not json" if status is None else f'{{"status": "{status}"}}'
    result = MagicMock()
    result.content = [block]
    return result


@patch(
    "arete_agents.context_map.indexer._resolve_binary",
    return_value="/usr/local/bin/codebase-memory-mcp",
)
@patch("arete_agents.context_map.indexer.mcp_client")
def test_index_repository_returns_project_name_on_success(mock_client, _mock_binary, tmp_path):
    from arete_agents.context_map.indexer import index_repository

    mock_client.call_tool_sync.return_value = _tool_result("indexed")

    project = index_repository(installation_id=42, repo_dir=tmp_path)

    assert project == "install-42"
    mock_client.get_or_create_session.assert_called_once_with(
        "context-map-42", "/usr/local/bin/codebase-memory-mcp"
    )


@patch(
    "arete_agents.context_map.indexer._resolve_binary",
    return_value="/usr/local/bin/codebase-memory-mcp",
)
@patch("arete_agents.context_map.indexer.mcp_client")
def test_index_repository_raises_on_degraded_status(mock_client, _mock_binary, tmp_path):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    mock_client.call_tool_sync.return_value = _tool_result("degraded")

    with pytest.raises(IndexerError):
        index_repository(installation_id=42, repo_dir=tmp_path)


@patch(
    "arete_agents.context_map.indexer._resolve_binary",
    return_value="/usr/local/bin/codebase-memory-mcp",
)
@patch("arete_agents.context_map.indexer.mcp_client")
def test_index_repository_raises_when_session_call_fails(mock_client, _mock_binary, tmp_path):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    mock_client.get_or_create_session.side_effect = RuntimeError("subprocess failed to start")

    with pytest.raises(IndexerError):
        index_repository(installation_id=42, repo_dir=tmp_path)


def test_index_repository_raises_when_binary_missing(tmp_path, monkeypatch):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    monkeypatch.delenv("CBM_BINARY_PATH", raising=False)
    with patch("arete_agents.context_map.indexer.shutil.which", return_value=None):
        with pytest.raises(IndexerError):
            index_repository(installation_id=42, repo_dir=tmp_path)
