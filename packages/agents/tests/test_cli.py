import json
from io import StringIO
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from arete_agents.models.pr import FileChange, PRContext

MOCK_LLM_RESPONSE = json.dumps({
    "comments": [
        {
            "path": "src/auth.py",
            "line": 1,
            "body": "SQL injection.",
            "severity": "error",
            "category": "security",
        }
    ],
    "summary": "SQL injection found.",
})

SAMPLE_PR = PRContext(
    repo="acme/api",
    pr_number=1,
    title="Add login",
    description="Auth endpoint",
    files=[
        FileChange(
            path="src/auth.py",
            patch="+query = f'SELECT * FROM users WHERE id={user_id}'",
            additions=1,
            deletions=0,
        )
    ],
)


def test_cli_reads_stdin_and_writes_stdout(monkeypatch, capsys):
    mock_llm = MagicMock()
    mock_llm.bind_tools.return_value = mock_llm
    mock_llm.with_retry.return_value = mock_llm
    mock_llm.invoke.return_value = AIMessage(content=MOCK_LLM_RESPONSE)

    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    from arete_agents.config import get_settings
    from arete_agents.llm.base import ROLE_KEYS
    get_settings.cache_clear()

    llms_by_role = {role: mock_llm for role in ROLE_KEYS}
    with patch("arete_agents.cli.get_llms_by_role", return_value=llms_by_role):
        monkeypatch.setattr("sys.stdin", StringIO(SAMPLE_PR.model_dump_json()))
        from arete_agents.cli import main
        main()

    try:
        captured = capsys.readouterr()
        result = json.loads(captured.out)
        assert result["risk_level"] in ("low", "medium", "high", "critical")
        assert "file_reviews" in result
    finally:
        get_settings.cache_clear()


def test_cli_exits_1_on_invalid_json(monkeypatch):
    monkeypatch.setattr("sys.stdin", StringIO("not valid json"))
    from arete_agents.cli import main
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 1
