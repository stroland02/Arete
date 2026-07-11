import json

from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import FixtureAgentResult, MatchResult, PlantedDefect
from arete_agents.eval.report import build_report, render_json, render_markdown


def _tp_result() -> FixtureAgentResult:
    d = PlantedDefect(id="d1", path="a.py", line=5, target_agent="security", description="x", severity="error")
    c = ReviewComment(path="a.py", line=5, body="b", severity="error", category="security")
    return FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[d], comments=[c],
        match_results=[MatchResult(defect_id="d1", comment=c, localization_ok=True, description_ok=True)],
    )


def test_build_report_has_all_six_agents():
    report = build_report([_tp_result()])
    assert len(report.per_agent) == 6
    names = {s.agent for s in report.per_agent}
    assert names == {
        "security", "performance", "quality",
        "test_coverage", "deployment_safety", "business_logic",
    }


def test_overall_reflects_tp():
    report = build_report([_tp_result()])
    assert report.overall.tp == 1
    assert report.overall.f1 == 1.0


def test_render_markdown_contains_table_and_meta():
    report = build_report([_tp_result()], meta={"judge": "stub"})
    md = render_markdown(report)
    assert "F1" in md
    assert "security" in md
    assert "judge" in md


def test_render_json_roundtrips():
    report = build_report([_tp_result()])
    data = json.loads(render_json(report))
    assert data["overall"]["tp"] == 1
