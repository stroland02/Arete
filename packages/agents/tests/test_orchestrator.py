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
