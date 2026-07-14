from arete_agents.models.review import ReviewResult


def decide_verdict(result: ReviewResult) -> tuple[str, str]:
    """Deterministic, non-LLM risk-tiered verdict. Pure function of fields
    already on ReviewResult. Precedence: a failed analysis always blocks
    (nothing was actually reviewed), regardless of the risk_level the
    fallback path may have defaulted to."""
    if result.analysis_status == "failed":
        return (
            "blocked",
            "Automated review could not be completed (all agents failed); "
            "human review required before merge.",
        )
    if result.risk_level == "critical":
        return (
            "blocked",
            "Critical-severity findings require human sign-off before merge.",
        )
    if result.risk_level == "high":
        return (
            "review-required",
            "High-risk findings require human review before merge.",
        )
    if result.risk_level == "medium":
        return (
            "comment",
            "Medium-risk findings noted; advisory, not blocking.",
        )
    return ("pass", "No blocking issues found.")
