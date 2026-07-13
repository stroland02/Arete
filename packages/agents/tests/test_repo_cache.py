from unittest.mock import MagicMock, patch

import pytest

from arete_agents.context_map.repo_cache import (
    RepoCacheError,
    _with_token,
    ensure_repo_checked_out,
)


def test_with_token_injects_https_basic_auth():
    url = _with_token("https://github.com/acme/api.git", "ghs_abc123")
    assert url == "https://x-access-token:ghs_abc123@github.com/acme/api.git"


def test_with_token_rejects_non_https_url():
    with pytest.raises(RepoCacheError):
        _with_token("git@github.com:acme/api.git", "ghs_abc123")


def test_ensure_repo_checked_out_clones_when_not_present(tmp_path):
    root = tmp_path / "repos"
    fake_result = MagicMock(returncode=0, stderr="")
    with patch(
        "arete_agents.context_map.repo_cache.subprocess.run", return_value=fake_result
    ) as run:
        repo_dir = ensure_repo_checked_out(
            clone_url="https://github.com/acme/api.git",
            installation_token="ghs_abc123",
            installation_id=42,
            repo_slug="acme/api",
            root=root,
        )
    assert repo_dir == root / "42" / "acme__api"
    args = run.call_args[0][0]
    assert args[:2] == ["git", "clone"]
    assert "x-access-token:ghs_abc123@github.com" in args[-2]


def test_ensure_repo_checked_out_pulls_when_already_cloned(tmp_path):
    root = tmp_path / "repos"
    repo_dir = root / "42" / "acme__api"
    (repo_dir / ".git").mkdir(parents=True)
    fake_result = MagicMock(returncode=0, stderr="")
    with patch(
        "arete_agents.context_map.repo_cache.subprocess.run", return_value=fake_result
    ) as run:
        ensure_repo_checked_out(
            clone_url="https://github.com/acme/api.git",
            installation_token="ghs_abc123",
            installation_id=42,
            repo_slug="acme/api",
            root=root,
        )
    args = run.call_args[0][0]
    assert args[:4] == ["git", "-C", str(repo_dir), "pull"]


def test_ensure_repo_checked_out_raises_and_redacts_token_on_git_failure(tmp_path):
    root = tmp_path / "repos"
    fake_result = MagicMock(
        returncode=128,
        stderr="fatal: could not read from 'https://x-access-token:ghs_abc123@github.com/acme/api.git'",
    )
    with patch(
        "arete_agents.context_map.repo_cache.subprocess.run", return_value=fake_result
    ):
        with pytest.raises(RepoCacheError) as exc_info:
            ensure_repo_checked_out(
                clone_url="https://github.com/acme/api.git",
                installation_token="ghs_abc123",
                installation_id=42,
                repo_slug="acme/api",
                root=root,
            )
    assert "ghs_abc123" not in str(exc_info.value)
    assert "x-access-token:***@" in str(exc_info.value)


def test_ensure_repo_checked_out_wraps_subprocess_timeout(tmp_path):
    import subprocess as subprocess_module

    root = tmp_path / "repos"
    with patch(
        "arete_agents.context_map.repo_cache.subprocess.run",
        side_effect=subprocess_module.TimeoutExpired(cmd="git clone", timeout=120),
    ):
        with pytest.raises(RepoCacheError):
            ensure_repo_checked_out(
                clone_url="https://github.com/acme/api.git",
                installation_token="ghs_abc123",
                installation_id=42,
                repo_slug="acme/api",
                root=root,
            )


def test_ensure_repo_checked_out_wraps_mkdir_oserror(tmp_path):
    root = tmp_path / "repos"
    with patch(
        "arete_agents.context_map.repo_cache.Path.mkdir",
        side_effect=OSError("disk full"),
    ):
        with pytest.raises(RepoCacheError):
            ensure_repo_checked_out(
                clone_url="https://github.com/acme/api.git",
                installation_token="ghs_abc123",
                installation_id=42,
                repo_slug="acme/api",
                root=root,
            )
