from arete_agents.eval.models import (
    AgentScore,
    FixtureAgentResult,
    MatchResult,
    PlantedDefect,
)
from arete_agents.eval.scorer import (
    aggregate_overall,
    clean_file_stats,
    collect_false_positives,
    collect_misses,
    f1_regressed,
    score_agent,
    score_by_severity,
)
from arete_agents.models.review import ReviewComment


def _defect(did: str, agent: str = "security") -> PlantedDefect:
    return PlantedDefect(
        id=did, path="a.py", line=5, target_agent=agent,
        description="d", severity="error",
    )


def _comment(agent: str = "security") -> ReviewComment:
    return ReviewComment(
        path="a.py", line=5, body="b", severity="error", category=agent
    )


def _tp_result() -> FixtureAgentResult:
    d = _defect("d1")
    c = _comment()
    return FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[d], comments=[c],
        match_results=[
            MatchResult(
                defect_id="d1", comment=c, localization_ok=True, description_ok=True
            )
        ],
    )


def _fp_result() -> FixtureAgentResult:
    c = _comment()
    return FixtureAgentResult(
        fixture_id="f2", agent="security", relevant_defects=[], comments=[c],
        match_results=[
            MatchResult(
                defect_id=None, comment=c, localization_ok=False, description_ok=None
            )
        ],
    )


def _fn_result() -> FixtureAgentResult:
    d = _defect("d2")
    return FixtureAgentResult(
        fixture_id="f3", agent="security", relevant_defects=[d],
        comments=[], match_results=[],
    )


def test_perfect_true_positive():
    s = score_agent("security", [_tp_result()])
    assert (s.tp, s.fp, s.fn) == (1, 0, 0)
    assert s.precision == 1.0 and s.recall == 1.0 and s.f1 == 1.0
    assert s.fp_rate == 0.0


def test_false_positive_only():
    s = score_agent("security", [_fp_result()])
    assert (s.tp, s.fp, s.fn) == (0, 1, 0)
    assert s.precision == 0.0
    assert s.fp_rate == 1.0


def test_false_negative_only():
    s = score_agent("security", [_fn_result()])
    assert (s.tp, s.fp, s.fn) == (0, 0, 1)
    assert s.recall == 0.0


def test_mixed_prf1():
    s = score_agent("security", [_tp_result(), _fp_result(), _fn_result()])
    assert (s.tp, s.fp, s.fn) == (1, 1, 1)
    assert s.precision == 0.5
    assert s.recall == 0.5
    assert s.f1 == 0.5


def test_duplicate_confirm_is_single_tp_not_fp():
    d = _defect("d1")
    c1, c2 = _comment(), _comment()
    r = FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[d], comments=[c1, c2],
        match_results=[
            MatchResult(
                defect_id="d1", comment=c1, localization_ok=True, description_ok=True
            ),
            MatchResult(
                defect_id="d1", comment=c2, localization_ok=True, description_ok=True
            ),
        ],
    )
    s = score_agent("security", [r])
    assert (s.tp, s.fp, s.fn) == (1, 0, 0)


def test_zero_division_guard_empty():
    s = score_agent("security", [])
    assert (s.tp, s.fp, s.fn) == (0, 0, 0)
    assert s.precision == 0.0 and s.recall == 0.0 and s.f1 == 0.0 and s.fp_rate == 0.0


def test_aggregate_overall_sums_counts():
    a = AgentScore(
        agent="security", tp=1, fp=1, fn=1,
        precision=0.5, recall=0.5, f1=0.5, fp_rate=0.5,
    )
    b = AgentScore(
        agent="quality", tp=3, fp=0, fn=1,
        precision=1.0, recall=0.75, f1=0.857, fp_rate=0.0,
    )
    o = aggregate_overall([a, b])
    assert o.agent == "overall"
    assert (o.tp, o.fp, o.fn) == (4, 1, 2)
    assert round(o.precision, 3) == 0.8
    assert round(o.recall, 3) == 0.667


def test_collect_misses_and_fps():
    results = [_tp_result(), _fp_result(), _fn_result()]
    misses = collect_misses(results)
    fps = collect_false_positives(results)
    assert [m.id for m in misses] == ["d2"]
    assert len(fps) == 1


def test_f1_regressed():
    assert f1_regressed(0.50, 0.60, 0.05) is True
    assert f1_regressed(0.56, 0.60, 0.05) is False
    assert f1_regressed(0.60, 0.60, 0.05) is False


def test_score_agent_sums_errors_across_results():
    r1 = FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[],
        comments=[], match_results=[], errors=2,
    )
    r2 = FixtureAgentResult(
        fixture_id="f2", agent="security", relevant_defects=[],
        comments=[], match_results=[], errors=1,
    )
    s = score_agent("security", [r1, r2])
    assert s.errors == 3


def test_aggregate_overall_sums_errors():
    a = AgentScore(
        agent="security", tp=0, fp=0, fn=0,
        precision=0.0, recall=0.0, f1=0.0, fp_rate=0.0, errors=2,
    )
    b = AgentScore(
        agent="quality", tp=0, fp=0, fn=0,
        precision=0.0, recall=0.0, f1=0.0, fp_rate=0.0, errors=1,
    )
    o = aggregate_overall([a, b])
    assert o.errors == 3


def _severity_mixed_results() -> list[FixtureAgentResult]:
    matched_error = PlantedDefect(
        id="e1", path="a.py", line=5, target_agent="security",
        description="d", severity="error",
    )
    missed_warning = PlantedDefect(
        id="w1", path="a.py", line=9, target_agent="security",
        description="d", severity="warning",
    )
    error_comment = ReviewComment(
        path="a.py", line=5, body="b", severity="error", category="security"
    )
    info_comment = ReviewComment(
        path="a.py", line=20, body="b", severity="info", category="security"
    )
    return [
        FixtureAgentResult(
            fixture_id="f1", agent="security",
            relevant_defects=[matched_error, missed_warning],
            comments=[error_comment, info_comment],
            match_results=[
                MatchResult(
                    defect_id="e1", comment=error_comment,
                    localization_ok=True, description_ok=True,
                ),
                MatchResult(
                    defect_id=None, comment=info_comment,
                    localization_ok=False, description_ok=None,
                ),
            ],
        )
    ]


def test_score_by_severity_mixed():
    scores = score_by_severity(_severity_mixed_results())
    by_sev = {s.severity: s for s in scores}
    assert [s.severity for s in scores] == ["error", "warning", "info"]
    assert (by_sev["error"].tp, by_sev["error"].fp, by_sev["error"].fn) == (1, 0, 0)
    assert by_sev["error"].precision == 1.0
    assert by_sev["error"].recall == 1.0
    assert (by_sev["warning"].tp, by_sev["warning"].fp, by_sev["warning"].fn) == (
        0, 0, 1
    )
    assert by_sev["warning"].recall == 0.0
    assert (by_sev["info"].tp, by_sev["info"].fp, by_sev["info"].fn) == (0, 1, 0)
    assert by_sev["info"].fp_rate == 1.0


def test_score_by_severity_omits_absent_severities():
    scores = score_by_severity([_tp_result()])  # only an error defect/comment
    assert [s.severity for s in scores] == ["error"]


def _clean_result(
    fixture_id: str, agent: str, comments: list[ReviewComment]
) -> FixtureAgentResult:
    return FixtureAgentResult(
        fixture_id=fixture_id, agent=agent, relevant_defects=[],
        comments=comments, match_results=[], clean=True,
    )


def test_clean_file_stats_flagged_and_unflagged():
    flagged = [
        _clean_result("clean-1", "security", [_comment()]),
        _clean_result("clean-1", "quality", []),
    ]
    unflagged = [
        _clean_result("clean-2", "security", []),
        _clean_result("clean-2", "quality", []),
    ]
    defect = [_tp_result()]  # not clean, must be ignored
    stats = clean_file_stats(flagged + unflagged + defect)
    assert stats.clean_fixtures == 2
    assert stats.clean_fixtures_flagged == 1
    assert stats.false_alarm_rate == 0.5


def test_clean_file_stats_no_clean_fixtures():
    stats = clean_file_stats([_tp_result()])
    assert stats.clean_fixtures == 0
    assert stats.clean_fixtures_flagged == 0
    assert stats.false_alarm_rate == 0.0
