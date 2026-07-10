from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Literal

from langchain_core.language_models import BaseChatModel

from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.models.pr import PRContext
from arete_agents.models.review import FileReview, ReviewResult

_SEVERITY_WEIGHT = {"error": 3, "warning": 2, "info": 1}


def _risk_level(
    file_reviews: list[FileReview],
) -> Literal["low", "medium", "high", "critical"]:
    all_comments = [c for fr in file_reviews for c in fr.comments]
    if not all_comments:
        return "low"
    max_weight = max(_SEVERITY_WEIGHT.get(c.severity, 0) for c in all_comments)
    error_count = sum(1 for c in all_comments if c.severity == "error")
    if error_count >= 2:
        return "critical"
    if max_weight == 3:
        return "high"
    if max_weight == 2:
        return "medium"
    return "low"


def _merge_reviews(reviews_per_file: list[list[FileReview]]) -> list[FileReview]:
    merged: dict[str, tuple[list, list[str]]] = {}
    for agent_reviews in reviews_per_file:
        for fr in agent_reviews:
            if fr.path not in merged:
                merged[fr.path] = (
                    list(fr.comments),
                    [fr.summary] if fr.summary else [],
                )
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

    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )

        # Fan out all (file × agent) pairs in a single flat pool
        tasks = [(file, agent) for file in pr.files for agent in self._agents]
        flat_results: list[FileReview] = []

        with ThreadPoolExecutor(max_workers=min(len(tasks), 12)) as pool:
            futures = {
                pool.submit(agent.review_file, file, pr): (file, agent)
                for file, agent in tasks
            }
            for future in as_completed(futures):
                file, agent = futures[future]
                try:
                    flat_results.append(future.result())
                except Exception as exc:
                    flat_results.append(
                        FileReview(
                            path=file.path,
                            comments=[],
                            summary=f"{agent.agent_name} error: {exc}",
                        )
                    )

        # Group by path then merge
        by_path: dict[str, list[FileReview]] = {}
        for fr in flat_results:
            by_path.setdefault(fr.path, []).append(fr)

        file_reviews = _merge_reviews(list(by_path.values()))
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
