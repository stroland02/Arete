import pytest

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewComment, ReviewResult


def test_file_change_detects_python_language():
    fc = FileChange(
        path="src/auth.py", patch="+def login():\n+    pass", additions=2, deletions=0
    )
    assert fc.language == "python"


def test_file_change_detects_typescript():
    fc = FileChange(
        path="src/api/routes.ts",
        patch="+export const handler",
        additions=1,
        deletions=0,
    )
    assert fc.language == "typescript"


def test_file_change_unknown_extension_is_other():
    fc = FileChange(path="Makefile", patch="+build:", additions=1, deletions=0)
    assert fc.language == "other"


def test_pr_context_holds_files():
    ctx = PRContext(
        repo="acme/api",
        pr_number=42,
        title="Add payment endpoint",
        description="Implements Stripe checkout",
        files=[
            FileChange(
                path="src/payments.py",
                patch="+def charge():\n+    pass",
                additions=2,
                deletions=0,
            )
        ],
    )
    assert len(ctx.files) == 1
    assert ctx.files[0].path == "src/payments.py"


def test_pr_context_accepts_camelcase_alias_fields():
    """The TS/JS webhook sends ciLogs/customRules (camelCase)."""
    ctx = PRContext.model_validate({
        "repo": "acme/api", "pr_number": 1, "title": "t", "description": "d",
        "files": [], "ciLogs": "boom", "customRules": ["no eval()"],
    })
    assert ctx.ci_logs == "boom"
    assert ctx.custom_rules == ["no eval()"]


def test_pr_context_accepts_snake_case_fields():
    """Direct API/CLI callers may send Python-convention snake_case field
    names (ci_logs, custom_rules) instead of the JS alias — these must not
    be silently dropped to their defaults."""
    ctx = PRContext.model_validate({
        "repo": "acme/api", "pr_number": 1, "title": "t", "description": "d",
        "files": [], "ci_logs": "boom", "custom_rules": ["no eval()"],
    })
    assert ctx.ci_logs == "boom"
    assert ctx.custom_rules == ["no eval()"]


def test_pr_context_defaults_telemetry_to_empty_list():
    from arete_agents.models.pr import FileChange, PRContext

    pr = PRContext(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )
    assert pr.telemetry == []


def test_pr_context_accepts_telemetry_snapshots():
    from datetime import datetime, timezone

    from arete_agents.models.pr import FileChange, PRContext
    from arete_agents.models.telemetry import TelemetrySnapshot

    pr = PRContext(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
        telemetry=[
            TelemetrySnapshot(
                provider="github_actions",
                source_ref="acme/api",
                summary_text="All CI green.",
                fetched_at=datetime(2026, 7, 10, tzinfo=timezone.utc),
            )
        ],
    )
    assert len(pr.telemetry) == 1
    assert pr.telemetry[0].provider == "github_actions"


def test_review_comment_rejects_invalid_severity():
    with pytest.raises(Exception):
        ReviewComment(
            path="src/auth.py",
            line=10,
            body="Bad",
            severity="critical_bad",
            category="security",
        )


def test_review_result_computes_total_comments():
    result = ReviewResult(
        pr_context=PRContext(
            repo="r/r", pr_number=1, title="t", description="d", files=[]
        ),
        file_reviews=[
            FileReview(
                path="a.py",
                comments=[
                    ReviewComment(
                        path="a.py",
                        line=1,
                        body="Issue",
                        severity="error",
                        category="security",
                    ),
                    ReviewComment(
                        path="a.py",
                        line=5,
                        body="Note",
                        severity="info",
                        category="quality",
                    ),
                ],
                summary="Two issues",
            ),
        ],
        overall_summary="Found 2 issues",
        risk_level="medium",
    )
    assert result.total_comments == 2


def test_pr_context_accepts_clone_context_fields():
    from arete_agents.models.pr import PRContext

    pr = PRContext.model_validate({
        "repo": "acme/api", "pr_number": 1, "title": "t", "description": "d",
        "files": [], "cloneUrl": "https://github.com/acme/api.git",
        "installationToken": "ghs_abc123", "installationId": 42,
    })
    assert pr.clone_url == "https://github.com/acme/api.git"
    assert pr.installation_token == "ghs_abc123"
    assert pr.installation_id == 42


def test_pr_context_clone_fields_default_to_none():
    from arete_agents.models.pr import PRContext

    pr = PRContext(repo="acme/api", pr_number=1, title="t", description="d", files=[])
    assert pr.clone_url is None
    assert pr.installation_token is None
    assert pr.installation_id is None


def test_review_result_grounding_counters_default_to_zero():
    from arete_agents.models.pr import PRContext
    from arete_agents.models.review import ReviewResult

    result = ReviewResult(
        pr_context=PRContext(repo="r/r", pr_number=1, title="t", description="d", files=[]),
        file_reviews=[],
        overall_summary="none",
        risk_level="low",
    )
    assert result.citation_dropped_count == 0
    assert result.security_evidence_dropped_count == 0


def test_pr_context_accepts_repo_conventions_field():
    from arete_agents.models.pr import FileChange, PRContext

    pr = PRContext.model_validate({
        "repo": "acme/api", "pr_number": 1, "title": "t", "description": "d",
        "files": [], "repoConventions": "# Conventions\nUse tabs.",
    })
    assert pr.repo_conventions == "# Conventions\nUse tabs."


def test_pr_context_repo_conventions_defaults_to_none():
    from arete_agents.models.pr import PRContext

    pr = PRContext(repo="acme/api", pr_number=1, title="t", description="d", files=[])
    assert pr.repo_conventions is None
