from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessage

from arete_agents.models.pr import FileChange, PRContext

SEC = (
    '{"comments": [{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
    '"severity": "error", "category": "security"}], "summary": "SQL injection."}'
)
PERF = '{"comments": [], "summary": "No performance issues."}'
QUAL = (
    '{"comments": [{"path": "src/auth.py", "line": 2, "body": "Use snake_case.", '
    '"severity": "info", "category": "quality"}], "summary": "Naming issue."}'
)
TEST_COV = (
    '{"comments": [{"path": "src/auth.py", "line": 8, "body": "Missing error test.", '
    '"severity": "warning", "category": "test_coverage"}], "summary": "Untested path."}'
)
DEPLOY = '{"comments": [], "summary": "No deployment risks."}'
BIZ = (
    '{"comments": [{"path": "src/auth.py", "line": 3, "body": "Missing audit log.", '
    '"severity": "warning", "category": "business_logic"}], "summary": "Audit gap."}'
)


@pytest.fixture
def sample_pr():
    return PRContext(
        repo="acme/api",
        pr_number=7,
        title="Fix login",
        description="Addresses auth bug",
        files=[
            FileChange(
                path="src/auth.py",
                patch="+SELECT * FROM users WHERE id='" + "+user_id",
                additions=1,
                deletions=0,
            )
        ],
    )


@pytest.fixture
def cyclic_llm():
    mock = MagicMock()
    mock.invoke.side_effect = [
        AIMessage(content=r)
        for r in [SEC, PERF, QUAL, TEST_COV, DEPLOY, BIZ] * 20
    ]
    mock.with_retry.return_value = mock
    return mock
