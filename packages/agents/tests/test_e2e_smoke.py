import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("GEMINI_API_KEY") or os.getenv("CI") == "true",
    reason="Skipped: GEMINI_API_KEY not set or running in CI",
)


def test_full_pipeline_catches_sql_injection():
    """Verifies real Gemini API flags obvious SQL injection in a PR diff."""
    from arete_agents.config import get_settings
    from arete_agents.llm.base import get_llm
    from arete_agents.models.pr import FileChange, PRContext
    from arete_agents.orchestrator import ReviewOrchestrator

    get_settings.cache_clear()
    settings = get_settings()
    llm = get_llm(settings)
    orch = ReviewOrchestrator(llm=llm)

    pr = PRContext(
        repo="acme/demo",
        pr_number=1,
        title="Add user login endpoint",
        description="Implements login with database lookup",
        files=[
            FileChange(
                path="src/auth.py",
                patch=(
                    "+def login(username, password):\n"
                    "+    query = f\"SELECT * FROM users WHERE "
                    "username='{username}' AND password='{password}'\"\n"
                    "+    return db.execute(query).fetchone()\n"
                ),
                additions=3,
                deletions=0,
            )
        ],
    )

    result = orch.run(pr)

    # Guard: if agents returned error summaries, the LLM calls failed (bad/missing key)
    agent_errors = [
        fr.summary for fr in result.file_reviews
        if "error" in fr.summary.lower() or "failed to parse" in fr.summary.lower()
    ]
    assert not agent_errors, (
        f"Agent(s) failed — check GEMINI_API_KEY. Error summaries: {agent_errors}"
    )

    # SQL injection is obvious -- expect at least one error-level security comment
    error_comments = [
        c for fr in result.file_reviews for c in fr.comments if c.severity == "error"
    ]

    print("\n--- Smoke Test Output ---")
    print(f"Risk Level: {result.risk_level.upper()}")
    print(f"Summary: {result.overall_summary}")
    for fr in result.file_reviews:
        for c in fr.comments:
            print(f"  [{c.severity.upper()}] {c.path}:{c.line} ({c.category})")
            print(f"    {c.body}")

    assert result.total_comments > 0, (
        "Expected at least one comment on the SQL injection"
    )
    assert len(error_comments) > 0, (
        "Expected at least one error-severity comment for SQL injection"
    )
    assert result.risk_level in ("high", "critical"), (
        f"SQL injection should be high/critical, got {result.risk_level}"
    )
