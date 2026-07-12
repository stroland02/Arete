import pytest
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.eval.matcher import (
    DEFAULT_WINDOW,
    LLMJudge,
    StubJudge,
    build_judge,
    localization_candidates,
    match_comments,
)
from arete_agents.eval.models import PlantedDefect
from arete_agents.models.review import ReviewComment


def _defect(
    line: int = 5, agent: str = "security", path: str = "a.py"
) -> PlantedDefect:
    return PlantedDefect(
        id="d1", path=path, line=line, target_agent=agent,
        description="SQL injection via string formatting", severity="error",
    )


def _comment(
    line: int = 5, category: str = "security", path: str = "a.py"
) -> ReviewComment:
    return ReviewComment(
        path=path, line=line, body="SQLi risk", severity="error", category=category
    )


def test_exact_localization_matches():
    assert localization_candidates(_comment(5), [_defect(5)]) != []


def test_within_window_matches():
    assert localization_candidates(_comment(8), [_defect(5)], window=3) != []


def test_out_of_window_no_match():
    assert localization_candidates(_comment(9), [_defect(5)], window=3) == []


def test_wrong_category_no_match():
    assert (
        localization_candidates(_comment(5, category="performance"), [_defect(5)])
        == []
    )


def test_wrong_path_no_match():
    assert (
        localization_candidates(_comment(5, path="b.py"), [_defect(5, path="a.py")])
        == []
    )


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
    assert results[0].description_ok is None


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
    assert results[0].localization_ok is True
    assert results[0].description_ok is True


def test_build_judge_stub():
    judge, is_stub = build_judge("stub")
    assert is_stub is True
    assert judge.confirm("x", "y") is True


class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeLLM:
    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.last_messages = None

    def with_retry(self, **kwargs):
        return self

    def invoke(self, messages):
        self.last_messages = messages
        return _FakeMessage(self._reply)


def test_llm_judge_confirms_on_yes():
    assert LLMJudge(_FakeLLM("YES")).confirm("body", "desc") is True


def test_llm_judge_rejects_on_no():
    assert LLMJudge(_FakeLLM("NO")).confirm("body", "desc") is False


def test_llm_judge_rejects_substring_yes():
    assert LLMJudge(_FakeLLM("a yes-like reply")).confirm("body", "desc") is False


def test_llm_judge_sends_system_and_human_messages():
    fake = _FakeLLM("YES")
    LLMJudge(fake).confirm(
        "SQLi in query builder", "SQL injection via string formatting"
    )
    assert isinstance(fake.last_messages[0], SystemMessage)
    assert isinstance(fake.last_messages[1], HumanMessage)
    assert "SQLi in query builder" in fake.last_messages[1].content
    assert "SQL injection via string formatting" in fake.last_messages[1].content


def test_build_judge_gemini_and_anthropic_are_not_stub():
    judge, is_stub = build_judge("gemini", gemini_api_key="k")
    assert is_stub is False
    assert hasattr(judge, "confirm")

    judge, is_stub = build_judge("anthropic", anthropic_api_key="k")
    assert is_stub is False
    assert hasattr(judge, "confirm")


def test_build_judge_unknown_mode_raises():
    with pytest.raises(ValueError):
        build_judge("bogus")
