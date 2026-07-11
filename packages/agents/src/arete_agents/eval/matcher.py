from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import MatchResult, PlantedDefect

DEFAULT_WINDOW = 3

_JUDGE_SYSTEM = (
    "You are a strict evaluation judge. You are given a REVIEWER COMMENT and a "
    "GROUND-TRUTH DEFECT description. Answer with a single word: YES if the "
    "comment identifies the same underlying defect as the ground truth, "
    "otherwise NO. Do not explain."
)


def localization_candidates(
    comment: ReviewComment,
    defects: list[PlantedDefect],
    window: int = DEFAULT_WINDOW,
) -> list[PlantedDefect]:
    return [
        d
        for d in defects
        if comment.path == d.path
        and comment.category == d.target_agent
        and abs(comment.line - d.line) <= window
    ]


class StubJudge:
    def confirm(self, comment_body: str, defect_description: str) -> bool:
        return True


class LLMJudge:
    def __init__(self, llm) -> None:
        self._llm = llm

    def confirm(self, comment_body: str, defect_description: str) -> bool:
        messages = [
            SystemMessage(content=_JUDGE_SYSTEM),
            HumanMessage(
                content=(
                    f"REVIEWER COMMENT:\n{comment_body}\n\n"
                    f"GROUND-TRUTH DEFECT:\n{defect_description}\n\n"
                    "Same defect? YES or NO."
                )
            ),
        ]
        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        return "yes" in raw.strip().lower()[:5]


def build_judge(
    mode: str,
    gemini_api_key: str = "",
    anthropic_api_key: str = "",
) -> tuple[object, bool]:
    if mode == "stub":
        return StubJudge(), True
    if mode == "gemini":
        from arete_agents.llm.gemini import build_gemini_llm

        return LLMJudge(build_gemini_llm(gemini_api_key)), False
    if mode == "anthropic":
        from arete_agents.llm.anthropic import build_anthropic_llm

        return LLMJudge(build_anthropic_llm(anthropic_api_key)), False
    raise ValueError(f"Unknown judge mode: {mode!r}")


def match_comments(
    comments: list[ReviewComment],
    defects: list[PlantedDefect],
    judge,
    is_stub: bool,
    window: int = DEFAULT_WINDOW,
) -> list[MatchResult]:
    results: list[MatchResult] = []
    for comment in comments:
        candidates = localization_candidates(comment, defects, window)
        if not candidates:
            results.append(
                MatchResult(
                    defect_id=None, comment=comment,
                    localization_ok=False, description_ok=None,
                )
            )
            continue
        if is_stub:
            results.append(
                MatchResult(
                    defect_id=candidates[0].id, comment=comment,
                    localization_ok=True, description_ok=None,
                )
            )
            continue
        confirmed = None
        for cand in candidates:
            if judge.confirm(comment.body, cand.description):
                confirmed = cand
                break
        if confirmed is not None:
            results.append(
                MatchResult(
                    defect_id=confirmed.id, comment=comment,
                    localization_ok=True, description_ok=True,
                )
            )
        else:
            results.append(
                MatchResult(
                    defect_id=None, comment=comment,
                    localization_ok=True, description_ok=False,
                )
            )
    return results
