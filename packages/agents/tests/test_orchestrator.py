from arete_agents.models.review import ReviewResult


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
