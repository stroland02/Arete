from arete_agents.models.pr import PRContext
from arete_agents.models.review import ReviewResult


def _result(risk_level: str, analysis_status: str = "complete") -> ReviewResult:
    return ReviewResult(
        pr_context=PRContext(
            repo="r/r", pr_number=1, title="t", description="d", files=[]
        ),
        file_reviews=[],
        overall_summary="s",
        risk_level=risk_level,
        analysis_status=analysis_status,
    )


def test_failed_analysis_blocks_even_when_risk_level_is_low():
    """Precedence: a failed analysis always blocks (nothing was actually
    reviewed), even when the fallback path defaulted risk_level to 'low'."""
    from arete_agents.verdict import decide_verdict

    verdict, reason = decide_verdict(_result("low", analysis_status="failed"))
    assert verdict == "blocked"
    assert "could not be completed" in reason


def test_critical_risk_is_blocked():
    from arete_agents.verdict import decide_verdict

    verdict, reason = decide_verdict(_result("critical"))
    assert verdict == "blocked"
    assert "Critical-severity" in reason


def test_high_risk_is_review_required():
    from arete_agents.verdict import decide_verdict

    verdict, reason = decide_verdict(_result("high"))
    assert verdict == "review-required"
    assert "human review" in reason


def test_medium_risk_is_comment():
    from arete_agents.verdict import decide_verdict

    verdict, reason = decide_verdict(_result("medium"))
    assert verdict == "comment"
    assert "advisory" in reason


def test_low_risk_is_pass():
    from arete_agents.verdict import decide_verdict

    verdict, reason = decide_verdict(_result("low"))
    assert verdict == "pass"
    assert reason == "No blocking issues found."
