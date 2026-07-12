from arete_agents.eval.models import (
    AgentScore,
    EvalFixture,
    FixtureAgentResult,
    MatchResult,
    PlantedDefect,
)
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import ReviewComment


def _pr() -> PRContext:
    return PRContext(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="d",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )


def test_planted_defect_fields():
    d = PlantedDefect(
        id="sqli-001",
        path="a.py",
        line=5,
        target_agent="security",
        description="SQL injection",
        severity="error",
    )
    assert d.id == "sqli-001"
    assert d.target_agent == "security"


def test_eval_fixture_defaults():
    f = EvalFixture(id="f1", pr=_pr())
    assert f.planted_defects == []
    assert f.clean is False


def test_match_result_allows_none_defect():
    c = ReviewComment(
        path="a.py", line=5, body="b", severity="error", category="security"
    )
    m = MatchResult(
        defect_id=None, comment=c, localization_ok=False, description_ok=None
    )
    assert m.defect_id is None


def test_agent_score_and_report_container():
    score = AgentScore(
        agent="security", tp=1, fp=0, fn=0,
        precision=1.0, recall=1.0, f1=1.0, fp_rate=0.0,
    )
    far = FixtureAgentResult(
        fixture_id="f1", agent="security",
        relevant_defects=[], comments=[], match_results=[],
    )
    assert score.f1 == 1.0
    assert far.fixture_id == "f1"
