from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def reset_ui_process_state():
    from arete_agents.context_map import ui

    ui._running_ui_processes.clear()
    yield
    ui._running_ui_processes.clear()


def test_get_or_start_ui_raises_when_no_index_exists(tmp_path):
    from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui

    with pytest.raises(ContextMapUIError):
        get_or_start_ui(installation_id=42, root=tmp_path)


def test_get_or_start_ui_raises_when_binary_missing(tmp_path):
    from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui

    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    with patch("arete_agents.context_map.ui.shutil.which", return_value=None):
        with pytest.raises(ContextMapUIError):
            get_or_start_ui(installation_id=42, root=tmp_path)


def test_get_or_start_ui_starts_process_and_returns_url(tmp_path):
    from arete_agents.context_map.ui import get_or_start_ui

    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    fake_proc = MagicMock()
    fake_proc.poll.return_value = None

    with patch("arete_agents.context_map.ui.shutil.which", return_value="/usr/local/bin/codebase-memory-mcp-ui"), \
         patch("arete_agents.context_map.ui.subprocess.Popen", return_value=fake_proc) as popen, \
         patch("arete_agents.context_map.ui._find_free_port", return_value=54321):
        url = get_or_start_ui(installation_id=42, root=tmp_path)

    assert url == "http://127.0.0.1:54321"
    popen.assert_called_once()


def test_get_or_start_ui_reuses_running_process(tmp_path):
    from arete_agents.context_map import ui
    from arete_agents.context_map.ui import get_or_start_ui

    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    fake_proc = MagicMock()
    fake_proc.poll.return_value = None
    ui._running_ui_processes[42] = (fake_proc, 54321)

    with patch("arete_agents.context_map.ui.subprocess.Popen") as popen:
        url = get_or_start_ui(installation_id=42, root=tmp_path)

    assert url == "http://127.0.0.1:54321"
    popen.assert_not_called()
