import json

from arete_agents.eval.models import (
    DatasetComposition,
    FixtureAgentResult,
    MatchResult,
    PlantedDefect,
)
from arete_agents.eval.report import (
    build_report,
    render_card,
    render_json,
    render_markdown,
)
from arete_agents.models.review import ReviewComment


def _tp_result() -> FixtureAgentResult:
    d = PlantedDefect(
        id="d1", path="a.py", line=5, target_agent="security",
        description="x", severity="error",
    )
    c = ReviewComment(
        path="a.py", line=5, body="b", severity="error", category="security"
    )
    return FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[d], comments=[c],
        match_results=[
            MatchResult(
                defect_id="d1", comment=c, localization_ok=True, description_ok=True
            )
        ],
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


def test_render_markdown_no_warning_when_no_errors():
    report = build_report([_tp_result()])
    md = render_markdown(report)
    assert "Errors" in md
    assert "WARNING" not in md


def test_render_markdown_warns_when_errors_present():
    errored = FixtureAgentResult(
        fixture_id="f2", agent="performance", relevant_defects=[],
        comments=[], match_results=[], errors=3,
    )
    report = build_report([_tp_result(), errored])
    md = render_markdown(report)
    assert report.overall.errors == 3
    assert "WARNING" in md
    assert "3 agent call(s)" in md


def _clean_flagged_result() -> FixtureAgentResult:
    c = ReviewComment(
        path="b.py", line=2, body="nit", severity="info", category="quality"
    )
    return FixtureAgentResult(
        fixture_id="clean-1", agent="quality", relevant_defects=[], comments=[c],
        match_results=[
            MatchResult(
                defect_id=None, comment=c, localization_ok=False, description_ok=None
            )
        ],
        clean=True,
    )


def _composition() -> DatasetComposition:
    return DatasetComposition(
        total_fixtures=2,
        clean_fixtures=1,
        defect_fixtures=1,
        total_defects=1,
        by_category={"security": 1},
        by_severity={"error": 1},
        dataset_hash="deadbeef" * 8,
    )


def test_build_report_populates_stratified_fields():
    report = build_report(
        [_tp_result(), _clean_flagged_result()], composition=_composition()
    )
    severities = [s.severity for s in report.per_severity]
    assert "error" in severities and "info" in severities
    assert report.clean_file is not None
    assert report.clean_file.clean_fixtures == 1
    assert report.clean_file.clean_fixtures_flagged == 1
    assert report.clean_file.false_alarm_rate == 1.0
    assert report.composition is not None
    assert report.composition.dataset_hash == "deadbeef" * 8


def test_build_report_backward_compatible_without_composition():
    report = build_report([_tp_result()])
    assert report.composition is None
    assert report.per_severity  # still computed from results
    assert report.clean_file is not None


def test_render_card_verified_banner():
    report = build_report(
        [_tp_result(), _clean_flagged_result()],
        meta={"judge_mode": "gemini"},
        composition=_composition(),
    )
    card = render_card(report, verified=True)
    assert "✅ VERIFIED BASELINE" in card
    assert "deadbeef" * 8 in card
    assert "| error |" in card
    assert "false-alarm rate" in card.lower()


def test_render_card_unverified_banner_with_reasons():
    errored = FixtureAgentResult(
        fixture_id="f2", agent="performance", relevant_defects=[],
        comments=[], match_results=[], errors=2,
    )
    report = build_report(
        [_tp_result(), errored],
        meta={"judge_mode": "stub"},
        composition=_composition(),
    )
    card = render_card(report, verified=False)
    assert "⚠️ ILLUSTRATIVE" in card
    assert "not a verified baseline" in card
    assert "stub judge" in card
    assert "error" in card
    assert "✅ VERIFIED BASELINE" not in card


def test_render_card_honest_empty_state_without_composition():
    report = build_report([_tp_result()])
    card = render_card(report, verified=False)
    assert "⚠️ ILLUSTRATIVE" in card
    assert "No dataset composition available" in card
