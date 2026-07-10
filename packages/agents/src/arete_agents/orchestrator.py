from concurrent.futures import ThreadPoolExecutor, as_completed

from langchain_core.language_models import BaseChatModel

from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewResult

_SEVERITY_WEIGHT = {"error": 3, "warning": 2, "info": 1}


def _risk_level(file_reviews: list[FileReview]) -> str:
    all_comments = [c for fr in file_reviews for c in fr.comments]
    if not all_comments:
        return "low"
    max_weight = max(_SEVERITY_WEIGHT.get(c.severity, 0) for c in all_comments)
    error_count = sum(1 for c in all_comments if c.severity == "error")
    if error_count >= 3 or (max_weight == 3 and error_count >= 2):
        return "critical"
    if max_weight == 3:
        return "high"
    if max_weight == 2:
        return "medium"
    return "low"


def _merge_reviews(reviews_per_agent: list[list[FileReview]]) -> list[FileReview]:
    merged: dict[str, tuple[list, list[str]]] = {}
    for agent_reviews in reviews_per_agent:
        for fr in agent_reviews:
            if fr.path not in merged:
                summaries = [fr.summary] if fr.summary else []
                merged[fr.path] = (list(fr.comments), summaries)
            else:
                merged[fr.path][0].extend(fr.comments)
                if fr.summary:
                    merged[fr.path][1].append(fr.summary)
    return [
        FileReview(path=path, comments=comments, summary=" ".join(summaries))
        for path, (comments, summaries) in merged.items()
    ]


class ReviewOrchestrator:
    def __init__(self, llm: BaseChatModel) -> None:
        self._agents = [SecurityAgent(llm), PerformanceAgent(llm), QualityAgent(llm)]

    def _review_file(self, file: FileChange, pr: PRContext) -> list[FileReview]:
        results: list[FileReview] = []
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {
                pool.submit(agent.review_file, file, pr): agent
                for agent in self._agents
            }
            for future in as_completed(futures):
                try:
                    results.append(future.result())
                except Exception as exc:
                    agent = futures[future]
                    results.append(
                        FileReview(
                            path=file.path,
                            comments=[],
                            summary=f"{agent.agent_name} error: {exc}",
                        )
                    )
        return results

    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )

        all_reviews = [self._review_file(f, pr) for f in pr.files]
        file_reviews = _merge_reviews(all_reviews)
        risk = _risk_level(file_reviews)
        total = sum(len(fr.comments) for fr in file_reviews)

        return ReviewResult(
            pr_context=pr,
            file_reviews=file_reviews,
            overall_summary=(
                f"Reviewed {len(pr.files)} file(s). "
                f"Found {total} issue(s) across security, performance, "
                f"and quality checks. Risk level: {risk.upper()}."
            ),
            risk_level=risk,
        )
