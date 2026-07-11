from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import PlantedDefect
from arete_agents.eval.matcher import (
    DEFAULT_WINDOW,
    StubJudge,
    build_judge,
    localization_candidates,
    match_comments,
)


def _defect(line: int = 5, agent: str = "security", path: str = "a.py") -> PlantedDefect:
    return PlantedDefect(
        id="d1", path=path, line=line, target_agent=agent,
        description="SQL injection via string formatting", severity="error",
    )


def _comment(line: int = 5, category: str = "security", path: str = "a.py") -> ReviewComment:
    return ReviewComment(path=path, line=line, body="SQLi risk", severity="error", category=category)


def test_exact_localization_matches():
    assert localization_candidates(_comment(5), [_defect(5)]) != []


def test_within_window_matches():
    assert localization_candidates(_comment(8), [_defect(5)], window=3) != []


def test_out_of_window_no_match():
    assert localization_candidates(_comment(9), [_defect(5)], window=3) == []


def test_wrong_category_no_match():
    assert localization_candidates(_comment(5, category="performance"), [_defect(5)]) == []


def test_wrong_path_no_match():
    assert localization_candidates(_comment(5, path="b.py"), [_defect(5, path="a.py")]) == []


def test_default_window_is_three():
    assert DEFAULT_WINDOW == 3


def test_stub_match_produces_tp():
    results = match_comments([_comment(6)], [_defect(5)], StubJudge(), is_stub=True)
    assert len(results) == 1
    assert results[0].defect_id == "d1"
    assert results[0].localization_ok is True
    assert results[0].description_ok is None


def test_unlocalized_comment_is_fp():
    results = match_comments([_comment(50)], [_defect(5)], StubJudge(), is_stub=True)
    assert results[0].defect_id is None
    assert results[0].localization_ok is False


def test_llm_judge_rejection_becomes_fp():
    class NoJudge:
        def confirm(self, comment_body: str, defect_description: str) -> bool:
            return False

    results = match_comments([_comment(5)], [_defect(5)], NoJudge(), is_stub=False)
    assert results[0].defect_id is None
    assert results[0].localization_ok is True
    assert results[0].description_ok is False


def test_llm_judge_confirmation_is_tp():
    class YesJudge:
        def confirm(self, comment_body: str, defect_description: str) -> bool:
            return True

    results = match_comments([_comment(5)], [_defect(5)], YesJudge(), is_stub=False)
    assert results[0].defect_id == "d1"
    assert results[0].description_ok is True


def test_build_judge_stub():
    judge, is_stub = build_judge("stub")
    assert is_stub is True
    assert judge.confirm("x", "y") is True
