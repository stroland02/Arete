from pathlib import Path
from unittest.mock import patch

from arete_agents.context_map import ensure_indexed
from arete_agents.context_map.indexer import IndexerError
from arete_agents.context_map.repo_cache import RepoCacheError
from arete_agents.models.pr import FileChange, PRContext


def _pr(**overrides):
    defaults = dict(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )
    defaults.update(overrides)
    return PRContext(**defaults)


def test_ensure_indexed_returns_none_without_clone_fields():
    assert ensure_indexed(_pr()) is None


def test_ensure_indexed_returns_none_when_installation_id_missing():
    pr = _pr(clone_url="https://github.com/acme/api.git", installation_token="ghs_x")
    assert ensure_indexed(pr) is None


@patch("arete_agents.context_map.index_repository", return_value="install-42")
@patch("arete_agents.context_map.ensure_repo_checked_out", return_value=Path("/tmp/repo"))
def test_ensure_indexed_returns_project_on_success(mock_checkout, mock_index):
    pr = _pr(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
    )

    project = ensure_indexed(pr)

    assert project == "install-42"
    mock_checkout.assert_called_once_with(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
        repo_slug="acme/api",
    )
    mock_index.assert_called_once_with(installation_id=42, repo_dir=Path("/tmp/repo"))


@patch(
    "arete_agents.context_map.ensure_repo_checked_out",
    side_effect=RepoCacheError("clone failed"),
)
def test_ensure_indexed_fails_open_on_clone_error(_mock_checkout):
    pr = _pr(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
    )
    assert ensure_indexed(pr) is None


@patch("arete_agents.context_map.index_repository", side_effect=IndexerError("indexing failed"))
@patch("arete_agents.context_map.ensure_repo_checked_out", return_value=Path("/tmp/repo"))
def test_ensure_indexed_fails_open_on_index_error(_mock_checkout, _mock_index):
    pr = _pr(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
    )
    assert ensure_indexed(pr) is None
