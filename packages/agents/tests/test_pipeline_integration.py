"""
End-to-end integration tests for the review pipeline entry point,
``ReviewOrchestrator.run(pr)``: LangGraph fan-out across 6 specialist agents
(or CIAgent when ``ci_logs`` is present) -> SynthesizerAgent -> ReviewResult.

No real LLM is ever called. Every model in this file is a
``unittest.mock.MagicMock`` whose ``.invoke()`` is routed by inspecting the
system/human prompt content that the real agent code builds — this exercises
the *actual* prompt-building, JSON-parsing, and orchestration code paths
without any network access.
"""

import json
import re

from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import ReviewResult
from arete_agents.orchestrator import ReviewOrchestrator

# Distinguishing substrings from each agent's system_prompt (see
# arete_agents/agents/*.py) mapped to the category/severity/body the router
# LLM should answer with when it sees that prompt.
_AGENT_MARKERS = [
    ("senior security engineer", "security", "error", "Possible SQL injection."),
    ("senior performance engineer", "performance", "warning", "N+1 query pattern."),
    ("code quality review", "quality", "info", "Unclear naming."),
    ("test-coverage review", "test_coverage", "warning", "Missing negative test."),
    ("deployment safety review", "deployment_safety", "error", "Breaking API change."),
    ("business logic review", "business_logic", "warning", "Missing audit log."),
    ("CI/CD and compiler diagnostics engineer", "ci_diagnostics", "error", "Compile error at import."),
]

_FILE_PATH_RE = re.compile(r"File: (\S+) \(")
_SEVERITY_WEIGHT = {"error": 3, "warning": 2, "info": 1}


def _echo_synth_response(human_content: str) -> str:
    """Build a schema-valid synthesizer reply by echoing back whatever raw
    reviews the orchestrator handed to the synthesizer prompt. Mirrors what a
    real synthesizer LLM would plausibly do (merge = identity here) without
    hardcoding file counts, so the same router works for 1-file and 20-file
    PRs alike."""
    raw_reviews = json.loads(human_content.split("Raw Reviews:", 1)[1].strip())
    all_comments = [c for fr in raw_reviews for c in fr["comments"]]
    if not all_comments:
        risk = "low"
    else:
        max_weight = max(_SEVERITY_WEIGHT.get(c["severity"], 0) for c in all_comments)
        risk = {3: "high", 2: "medium"}.get(max_weight, "low")
    return json.dumps(
        {
            "file_reviews": raw_reviews,
            "overall_summary": f"Synthesized {len(raw_reviews)} file review(s).",
            "risk_level": risk,
        }
    )


def make_router_llm(*, synth_ok: bool = True, agents_raise: bool = False) -> MagicMock:
    """A MagicMock LLM that answers differently depending on which agent's
    system prompt it's fed, so a single mock can drive the whole graph.

    - CI log-chunk extraction calls -> "NO_ERROR" (keeps chunking a no-op).
    - Synthesizer calls -> valid echo JSON, or garbage if synth_ok=False.
    - The 6 specialist agents (or CIAgent's main review call) -> a single
      valid comment tagged with that agent's category, unless agents_raise
      is set, in which case they raise to simulate an LLM/provider outage.
    """
    mock = MagicMock()

    def _invoke(messages, *_args, **_kwargs):
        system_content = messages[0].content
        human_content = messages[1].content if len(messages) > 1 else ""

        if "expert CI log analyzer" in system_content:
            return AIMessage(content="NO_ERROR")

        if "Areté Synthesizer" in system_content:
            if not synth_ok:
                return AIMessage(content="this is not valid json {{{")
            return AIMessage(content=_echo_synth_response(human_content))

        if agents_raise:
            raise RuntimeError("simulated LLM provider outage")

        for marker, category, severity, body in _AGENT_MARKERS:
            if marker in system_content:
                match = _FILE_PATH_RE.search(human_content)
                path = match.group(1) if match else "unknown"
                return AIMessage(
                    content=json.dumps(
                        {
                            "comments": [
                                {
                                    "path": path,
                                    "line": 1,
                                    "body": body,
                                    "severity": severity,
                                    "category": category,
                                }
                            ],
                            "summary": f"{category} check complete.",
                        }
                    )
                )

        raise AssertionError(f"Unrouted system prompt: {system_content[:120]!r}")

    mock.invoke.side_effect = _invoke
    mock.bind_tools.return_value = mock
    mock.with_retry.return_value = mock
    return mock


ALL_CATEGORIES = {
    "security",
    "performance",
    "quality",
    "test_coverage",
    "deployment_safety",
    "business_logic",
}


# --- a. Happy path -----------------------------------------------------


def test_happy_path_returns_valid_review_result_with_all_agent_categories():
    llm = make_router_llm()
    pr = PRContext(
        repo="acme/api",
        pr_number=10,
        title="Add feature",
        description="",
        files=[FileChange(path="src/app.py", patch="+x=1", additions=1, deletions=0)],
    )

    result = ReviewOrchestrator(llm=llm).run(pr)

    assert isinstance(result, ReviewResult)
    assert result.pr_context.pr_number == 10
    assert result.risk_level in ("low", "medium", "high", "critical")
    assert result.total_comments >= 6  # one comment per specialist agent

    categories = {c.category for fr in result.file_reviews for c in fr.comments}
    assert categories == ALL_CATEGORIES
    assert all(fr.path == "src/app.py" for fr in result.file_reviews)


# --- b. Synthesizer failure -> fallback merge ---------------------------


def test_synthesizer_invalid_json_falls_back_to_blind_merge():
    llm = make_router_llm(synth_ok=False)
    pr = PRContext(
        repo="acme/api",
        pr_number=11,
        title="Fix auth bug",
        description="",
        files=[FileChange(path="src/auth.py", patch="+password='hunter2'", additions=1, deletions=0)],
    )

    result = ReviewOrchestrator(llm=llm).run(pr)

    assert isinstance(result, ReviewResult)
    # The fallback path (_fallback_synthesize) merges FileReviews by path,
    # so a single-file PR collapses to exactly one FileReview.
    assert len(result.file_reviews) == 1
    fr = result.file_reviews[0]
    assert fr.path == "src/auth.py"

    categories = {c.category for c in fr.comments}
    assert categories == ALL_CATEGORIES

    # security + deployment_safety both report "error" severity -> risk
    # circuit breaker in _risk_level marks >=2 errors as "critical".
    assert result.risk_level == "critical"
    assert "CRITICAL" in result.overall_summary
    assert "6 issue(s)" in result.overall_summary or "issue(s)" in result.overall_summary


# --- c. All agents fail --------------------------------------------------


def test_all_agents_fail_produces_graceful_low_risk_result_no_crash():
    """Every specialist LLM call raises (simulated provider outage). The
    per-task exception handler in _execute_agent_review still produces an
    (empty-comment, error-summary) FileReview for every file, so raw_reviews
    is never actually empty for a non-empty PR — the synthesizer still runs
    and echoes those empty-comment reviews back. Verifies the pipeline
    degrades gracefully (no crash, valid ReviewResult, risk "low") rather
    than raising to the caller."""
    llm = make_router_llm(agents_raise=True)
    files = [
        FileChange(path="src/a.py", patch="+a=1", additions=1, deletions=0),
        FileChange(path="src/b.py", patch="+b=2", additions=1, deletions=0),
    ]
    pr = PRContext(repo="acme/api", pr_number=12, title="Broken LLM", description="", files=files)

    result = ReviewOrchestrator(llm=llm).run(pr)

    assert isinstance(result, ReviewResult)
    assert result.risk_level == "low"
    assert result.total_comments == 0
    all_summaries = " ".join(fr.summary for fr in result.file_reviews).lower()
    assert "outage" in all_summaries or "error" in all_summaries


def test_empty_pr_short_circuits_without_calling_the_llm():
    """The literal 'No files changed.' / risk 'low' short-circuit only
    triggers when the PR itself has zero files (see ReviewOrchestrator.run
    and _synthesize_reviews) — this is the scenario that produces that exact
    text; it's distinct from "all agents fail" on a non-empty PR above."""
    llm = make_router_llm()
    pr = PRContext(repo="acme/api", pr_number=13, title="Nothing changed", description="", files=[])

    result = ReviewOrchestrator(llm=llm).run(pr)

    assert result.overall_summary == "No files changed."
    assert result.risk_level == "low"
    assert result.file_reviews == []
    llm.invoke.assert_not_called()


# --- d. Large PR: 20 files run through the graph -------------------------


def test_large_pr_reviews_all_20_files():
    llm = make_router_llm()
    files = [
        FileChange(path=f"src/module_{i}.py", patch="+" + ("x" * 2000), additions=1, deletions=0)
        for i in range(20)
    ]
    pr = PRContext(repo="acme/monorepo", pr_number=14, title="Large refactor", description="", files=files)

    result = ReviewOrchestrator(llm=llm).run(pr)

    assert isinstance(result, ReviewResult)
    reviewed_paths = {fr.path for fr in result.file_reviews}
    expected_paths = {f.path for f in files}
    assert reviewed_paths == expected_paths
    assert len(expected_paths) == 20
    # 20 files x 6 agents = 120 raw FileReviews, echoed straight through by
    # the (non-merging) mock synthesizer used in this test.
    assert len(result.file_reviews) == 120


# --- e. CI logs path: only CIAgent runs -----------------------------------


def test_ci_logs_present_routes_to_ci_agent_only():
    llm = make_router_llm()
    files = [FileChange(path="src/build.py", patch="+broken_syntax(", additions=1, deletions=0)]
    pr = PRContext(
        repo="acme/api",
        pr_number=15,
        title="Fix failing build",
        description="",
        files=files,
        ciLogs="ERROR: SyntaxError at line 3 of src/build.py",
    )

    result = ReviewOrchestrator(llm=llm).run(pr)

    assert isinstance(result, ReviewResult)
    categories = {c.category for fr in result.file_reviews for c in fr.comments}
    assert categories == {"ci_diagnostics"}
    assert "security" not in categories and "performance" not in categories
