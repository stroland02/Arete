from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.models.review import FileReview, ReviewComment, ReviewResult


def test_orchestrator_returns_review_result(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    assert isinstance(result, ReviewResult)
    assert result.pr_context.pr_number == 7


def test_orchestrator_reviews_all_files(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    reviewed = {fr.path for fr in result.file_reviews}
    expected = {f.path for f in sample_pr.files}
    assert reviewed == expected


def test_orchestrator_merges_comments_from_all_agents(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    categories = {c.category for fr in result.file_reviews for c in fr.comments}
    assert "security" in categories
    assert "quality" in categories
    assert "test_coverage" in categories
    assert "business_logic" in categories


def test_orchestrator_sets_risk_level(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    assert result.risk_level in ("low", "medium", "high", "critical")


def test_orchestrator_handles_empty_pr(cyclic_llm):
    from arete_agents.models.pr import PRContext
    from arete_agents.orchestrator import ReviewOrchestrator
    empty = PRContext(repo="x/y", pr_number=1, title="Empty", description="", files=[])
    result = ReviewOrchestrator(llm=cyclic_llm).run(empty)
    assert result.file_reviews == []
    assert result.total_comments == 0


def test_orchestrator_reviews_files_in_parallel(cyclic_llm):
    """All files in a multi-file PR must appear in output (parallelism smoke check)."""
    from arete_agents.models.pr import FileChange, PRContext
    from arete_agents.orchestrator import ReviewOrchestrator
    files = [
        FileChange(path="src/a.py", patch="+x=1", additions=1, deletions=0),
        FileChange(path="src/b.py", patch="+y=2", additions=1, deletions=0),
        FileChange(path="src/c.py", patch="+z=3", additions=1, deletions=0),
    ]
    pr = PRContext(repo="x/y", pr_number=2, title="Multi", description="", files=files)
    result = ReviewOrchestrator(llm=cyclic_llm).run(pr)
    reviewed = {fr.path for fr in result.file_reviews}
    assert reviewed == {"src/a.py", "src/b.py", "src/c.py"}


def test_orchestrator_survives_agent_exception(sample_pr):
    """An agent that raises must not crash the run — produces error FileReview."""
    from unittest.mock import MagicMock

    from arete_agents.orchestrator import ReviewOrchestrator
    boom = MagicMock()
    boom.with_retry.return_value = boom
    boom.invoke.side_effect = RuntimeError("boom")
    result = ReviewOrchestrator(llm=boom).run(sample_pr)
    assert isinstance(result.risk_level, str)
    all_summaries = [fr.summary for fr in result.file_reviews]
    assert any("error" in s.lower() or "boom" in s.lower() for s in all_summaries)


def test_all_agents_fail_sets_analysis_status_failed(sample_pr):
    """Total LLM outage: every agent call raises -> analysis_status is
    'failed' so callers can tell 'never reviewed' from 'reviewed and clean'.
    risk_level behavior is unchanged (still 'low' with zero comments)."""
    from arete_agents.orchestrator import ReviewOrchestrator
    boom = MagicMock()
    boom.with_retry.return_value = boom
    boom.invoke.side_effect = RuntimeError("total LLM outage")
    result = ReviewOrchestrator(llm=boom).run(sample_pr)
    assert result.analysis_status == "failed"
    assert result.risk_level == "low"


def test_partial_agent_failure_keeps_analysis_status_complete(sample_pr):
    """If SOME agents succeed, the review is not a total failure."""
    from arete_agents.orchestrator import ReviewOrchestrator

    sec_response = (
        '{"comments": [{"path": "src/auth.py", "line": 5, "body": "SQL '
        'injection.", "severity": "error", "category": "security"}], '
        '"summary": "SQL injection."}'
    )
    synth_response = (
        '{"file_reviews": [{"path": "src/auth.py", "comments": '
        '[{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
        '"severity": "error", "category": "security"}], '
        '"summary": "SQL injection."}], '
        '"overall_summary": "One security issue.", "risk_level": "high"}'
    )

    def fake_invoke(messages, **kwargs):
        system = messages[0].content
        if "Synthesizer" in system:
            return AIMessage(content=synth_response)
        if "security engineer" in system:
            return AIMessage(content=sec_response)
        raise RuntimeError("provider outage for this agent")

    mock = MagicMock()
    mock.with_retry.return_value = mock
    mock.invoke.side_effect = fake_invoke

    result = ReviewOrchestrator(llm=mock).run(sample_pr)
    assert result.analysis_status == "complete"


def test_all_agents_succeed_analysis_status_complete(sample_pr, cyclic_llm):
    """Healthy run: default status stays 'complete' (unchanged behavior)."""
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    assert result.analysis_status == "complete"


def test_empty_pr_analysis_status_complete(cyclic_llm):
    """No files to review is NOT a failure — there was just nothing to do."""
    from arete_agents.models.pr import PRContext
    from arete_agents.orchestrator import ReviewOrchestrator
    empty = PRContext(repo="x/y", pr_number=1, title="Empty", description="", files=[])
    result = ReviewOrchestrator(llm=cyclic_llm).run(empty)
    assert result.analysis_status == "complete"


def test_review_result_analysis_status_defaults_to_complete(sample_pr):
    """Additive field: existing constructors that don't pass analysis_status
    keep working and get 'complete'."""
    result = ReviewResult(
        pr_context=sample_pr,
        file_reviews=[],
        overall_summary="ok",
        risk_level="low",
    )
    assert result.analysis_status == "complete"


def test_review_result_critic_dropped_count_defaults_to_zero(sample_pr):
    """Additive field: existing constructors that don't pass
    critic_dropped_count keep working and get 0."""
    result = ReviewResult(
        pr_context=sample_pr,
        file_reviews=[],
        overall_summary="ok",
        risk_level="low",
    )
    assert result.critic_dropped_count == 0


def _comment(severity: str, line: int = 1) -> ReviewComment:
    return ReviewComment(
        path="a.py", line=line, body="issue", severity=severity, category="security"
    )


def test_risk_level_empty_comments_is_low():
    from arete_agents.orchestrator import _risk_level
    fr = [FileReview(path="a.py", comments=[], summary="clean")]
    assert _risk_level(fr) == "low"


def test_risk_level_single_error_is_high_not_critical():
    from arete_agents.orchestrator import _risk_level
    comments = [_comment("error"), _comment("info")]
    fr = [FileReview(path="a.py", comments=comments, summary="")]
    assert _risk_level(fr) == "high"


def test_risk_level_two_errors_is_critical():
    from arete_agents.orchestrator import _risk_level
    comments = [_comment("error"), _comment("error")]
    fr = [FileReview(path="a.py", comments=comments, summary="")]
    assert _risk_level(fr) == "critical"


def test_risk_level_warnings_only_is_medium():
    from arete_agents.orchestrator import _risk_level
    comments = [_comment("warning"), _comment("info")]
    fr = [FileReview(path="a.py", comments=comments, summary="")]
    assert _risk_level(fr) == "medium"


def test_risk_level_info_only_is_low():
    from arete_agents.orchestrator import _risk_level
    comments = [_comment("info"), _comment("info")]
    fr = [FileReview(path="a.py", comments=comments, summary="")]
    assert _risk_level(fr) == "low"


def test_risk_level_mixed_across_files_uses_global_max_and_error_count():
    """Severities spread across multiple FileReviews must be aggregated
    together, not evaluated per-file."""
    from arete_agents.orchestrator import _risk_level
    fr = [
        FileReview(path="a.py", comments=[_comment("error")], summary=""),
        FileReview(path="b.py", comments=[_comment("warning")], summary=""),
        FileReview(path="c.py", comments=[_comment("error")], summary=""),
    ]
    # Two errors total across files -> critical, even though no single file
    # has more than one error comment.
    assert _risk_level(fr) == "critical"


def test_synthesizer_invalid_json_falls_back_without_rerunning_agents(sample_pr):
    """When the Synthesizer's LLM response isn't valid JSON, the orchestrator
    must fall back to a blind merge of the reviews it already has — NOT
    re-invoke every specialist agent from scratch (that would double LLM
    cost/latency for a failure unrelated to the agents themselves)."""
    from arete_agents.orchestrator import ReviewOrchestrator

    valid_agent_response = '{"comments": [], "summary": "No issues."}'
    invalid_synth_response = "Sorry, I can't produce JSON right now."

    mock = MagicMock()
    mock.with_retry.return_value = mock
    # sample_pr has 1 file -> 6 specialist-agent calls, then 1 synthesizer
    # call. The synthesizer call is always chronologically last because the
    # synthesize_reviews node only runs after every execute_agent_review
    # Send has completed and merged into state.
    mock.invoke.side_effect = (
        [AIMessage(content=valid_agent_response)] * 6
        + [AIMessage(content=invalid_synth_response)] * 10
    )

    result = ReviewOrchestrator(llm=mock).run(sample_pr)

    assert isinstance(result, ReviewResult)
    # Exactly 7 calls: 6 agents + 1 (failed) synthesizer. If the old
    # behavior (full re-run via run()'s outer except) were still present,
    # this would be 13 (6 + 1 + 6 again).
    assert mock.invoke.call_count == 7


def _make_synth_llm(response: str) -> MagicMock:
    mock = MagicMock()
    mock.with_retry.return_value = mock
    mock.invoke.return_value = AIMessage(content=response)
    return mock


def test_synthesizer_drops_hallucinated_comment(sample_pr):
    """A raw comment referencing a symbol that appears nowhere in the diff
    (`frobnicate_user`) must not survive synthesis when the verification pass
    filters it; the well-grounded comment must survive."""
    import json

    from arete_agents.orchestrator import SynthesizerAgent

    hallucinated = ReviewComment(
        path="src/auth.py",
        line=3,
        body="The call to `frobnicate_user()` is missing a null check.",
        severity="error",
        category="security",
    )
    grounded = ReviewComment(
        path="src/auth.py",
        line=1,
        body="Unparameterized SELECT with user_id enables SQL injection.",
        severity="error",
        category="security",
    )
    raw = [
        FileReview(
            path="src/auth.py",
            comments=[hallucinated, grounded],
            summary="Mixed findings.",
        )
    ]
    filtered = json.dumps(
        {
            "file_reviews": [
                {
                    "path": "src/auth.py",
                    "comments": [grounded.model_dump()],
                    "summary": "Verified SQL injection finding.",
                }
            ],
            "overall_summary": "One verified security issue.",
            "risk_level": "high",
            "dropped_count": 1,
        }
    )
    llm = _make_synth_llm(filtered)
    result = SynthesizerAgent(llm).synthesize(sample_pr, raw)

    bodies = [c.body for fr in result.file_reviews for c in fr.comments]
    assert not any("frobnicate_user" in b for b in bodies)
    assert any("SQL injection" in b for b in bodies)
    assert result.dropped_count == 1


def test_synthesizer_keeps_grounded_comment_and_reports_zero_dropped(sample_pr):
    """Inverse case: a well-grounded comment survives and dropped_count is 0."""
    import json

    from arete_agents.orchestrator import SynthesizerAgent

    grounded = ReviewComment(
        path="src/auth.py",
        line=1,
        body="Unparameterized SELECT with user_id enables SQL injection.",
        severity="error",
        category="security",
    )
    raw = [FileReview(path="src/auth.py", comments=[grounded], summary="One finding.")]
    passthrough = json.dumps(
        {
            "file_reviews": [
                {
                    "path": "src/auth.py",
                    "comments": [grounded.model_dump()],
                    "summary": "Verified.",
                }
            ],
            "overall_summary": "One verified security issue.",
            "risk_level": "high",
            "dropped_count": 0,
        }
    )
    llm = _make_synth_llm(passthrough)
    result = SynthesizerAgent(llm).synthesize(sample_pr, raw)

    bodies = [c.body for fr in result.file_reviews for c in fr.comments]
    assert any("SQL injection" in b for b in bodies)
    assert result.dropped_count == 0


def test_synthesizer_missing_dropped_count_defaults_to_zero(sample_pr):
    """Backward compatibility: a synthesizer response without dropped_count
    still parses (older prompt shape / partial LLM compliance)."""
    from arete_agents.orchestrator import SynthesizerAgent

    response = (
        '{"file_reviews": [], "overall_summary": "Clean.", "risk_level": "low"}'
    )
    llm = _make_synth_llm(response)
    result = SynthesizerAgent(llm).synthesize(
        sample_pr,
        [FileReview(path="src/auth.py", comments=[], summary="clean")],
    )
    assert result.dropped_count == 0


def test_synthesizer_prompt_instructs_verification(sample_pr):
    """The system prompt must contain the verification contract: drop
    low-confidence/hallucinated findings and gate ```suggestion blocks."""
    from arete_agents.orchestrator import SynthesizerAgent

    llm = _make_synth_llm(
        '{"file_reviews": [], "overall_summary": "ok", "risk_level": "low", '
        '"dropped_count": 0}'
    )
    SynthesizerAgent(llm).synthesize(
        sample_pr, [FileReview(path="src/auth.py", comments=[], summary="clean")]
    )
    system_content = llm.invoke.call_args[0][0][0].content  # SystemMessage
    assert "DROP" in system_content
    assert "suggestion" in system_content
    assert "dropped_count" in system_content


def test_synthesizer_prompt_does_not_require_mermaid(sample_pr):
    """The Mermaid diagram must no longer be a hard requirement of every
    summary — at most an at-your-judgment option."""
    from arete_agents.orchestrator import SynthesizerAgent

    llm = _make_synth_llm(
        '{"file_reviews": [], "overall_summary": "ok", "risk_level": "low", '
        '"dropped_count": 0}'
    )
    SynthesizerAgent(llm).synthesize(
        sample_pr, [FileReview(path="src/auth.py", comments=[], summary="clean")]
    )
    system_content = llm.invoke.call_args[0][0][0].content
    assert "MUST include a ````mermaid" not in system_content
    lower = system_content.lower()
    # No phrasing that makes a diagram mandatory.
    assert "must include a diagram" not in lower
    assert "must include a mermaid" not in lower


def test_large_raw_reviews_payload_is_truncated(sample_pr):
    """Raw-reviews JSON over MAX_RAW_REVIEWS_CHARS must be truncated before
    being sent to the Synthesizer LLM, with an explicit truncation note."""
    from arete_agents.orchestrator import MAX_RAW_REVIEWS_CHARS, SynthesizerAgent

    llm = _make_synth_llm(
        '{"file_reviews": [], "overall_summary": "ok", "risk_level": "low", '
        '"dropped_count": 0}'
    )
    huge_summary = "x" * (MAX_RAW_REVIEWS_CHARS + 10_000)
    raw = [FileReview(path="src/auth.py", comments=[], summary=huge_summary)]
    SynthesizerAgent(llm).synthesize(sample_pr, raw)

    human_content = llm.invoke.call_args[0][0][1].content  # HumanMessage
    assert len(human_content) < len(huge_summary)
    assert "[Raw reviews truncated:" in human_content


def test_small_raw_reviews_payload_is_not_truncated(sample_pr):
    """Payloads under the cap must be passed through untouched."""
    from arete_agents.orchestrator import SynthesizerAgent

    llm = _make_synth_llm(
        '{"file_reviews": [], "overall_summary": "ok", "risk_level": "low", '
        '"dropped_count": 0}'
    )
    raw = [FileReview(path="src/auth.py", comments=[], summary="small")]
    SynthesizerAgent(llm).synthesize(sample_pr, raw)
    human_content = llm.invoke.call_args[0][0][1].content
    assert "[Raw reviews truncated:" not in human_content


def test_large_patch_is_truncated(cyclic_llm):
    """Patches over MAX_PATCH_CHARS must be truncated before being sent to LLM."""
    from arete_agents.agents.base import MAX_PATCH_CHARS
    from arete_agents.agents.security import SecurityAgent
    from arete_agents.models.pr import FileChange, PRContext
    big_patch = "+" + "x" * (MAX_PATCH_CHARS + 1000)
    file = FileChange(path="big.py", patch=big_patch, additions=1, deletions=0)
    pr = PRContext(repo="x/y", pr_number=3, title="Big", description="", files=[file])
    agent = SecurityAgent(llm=cyclic_llm)
    result = agent.review_file(file, pr)
    assert result is not None
    # Verify the LLM saw a prompt shorter than the raw patch
    call_args = cyclic_llm.invoke.call_args[0][0]
    human_content = call_args[1].content  # HumanMessage is index 1
    assert len(human_content) < len(big_patch)
    assert "[Diff truncated:" in human_content
