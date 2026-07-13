from arete_agents.eval.models import (
    AgentScore,
    CleanFileStats,
    DatasetComposition,
    EvalFixture,
    EvalReport,
    FixtureAgentResult,
    MatchResult,
    PlantedDefect,
    SeverityScore,
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


def test_severity_score_fields():
    s = SeverityScore(
        severity="error", tp=1, fp=2, fn=3,
        precision=0.333, recall=0.25, f1=0.286, fp_rate=0.667,
    )
    assert s.severity == "error"
    assert (s.tp, s.fp, s.fn) == (1, 2, 3)


def test_clean_file_stats_fields():
    c = CleanFileStats(
        clean_fixtures=3, clean_fixtures_flagged=1, false_alarm_rate=0.333
    )
    assert c.clean_fixtures == 3
    assert c.clean_fixtures_flagged == 1
    assert c.false_alarm_rate == 0.333


def test_dataset_composition_fields():
    d = DatasetComposition(
        total_fixtures=16,
        clean_fixtures=3,
        defect_fixtures=13,
        total_defects=26,
        by_category={"security": 4},
        by_severity={"error": 10},
        dataset_hash="abc123",
    )
    assert d.total_fixtures == 16
    assert d.by_category["security"] == 4
    assert d.dataset_hash == "abc123"


def test_fixture_agent_result_clean_defaults_false():
    far = FixtureAgentResult(
        fixture_id="f1", agent="security",
        relevant_defects=[], comments=[], match_results=[],
    )
    assert far.clean is False
    flagged = FixtureAgentResult(
        fixture_id="f1", agent="security",
        relevant_defects=[], comments=[], match_results=[], clean=True,
    )
    assert flagged.clean is True


def test_eval_report_backward_compatible_defaults():
    score = AgentScore(
        agent="overall", tp=0, fp=0, fn=0,
        precision=0.0, recall=0.0, f1=0.0, fp_rate=0.0,
    )
    # Old call site: none of the new fields supplied.
    report = EvalReport(
        per_agent=[score], overall=score, misses=[], false_positives=[]
    )
    assert report.per_severity == []
    assert report.clean_file is None
    assert report.composition is None


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
