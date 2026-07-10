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
