import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, START, END

from arete_agents.agents.business_logic import BusinessLogicAgent
from arete_agents.agents.deployment_safety import DeploymentSafetyAgent
from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.agents.test_coverage import TestCoverageAgent
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


class GraphState(TypedDict):
    pr: PRContext
    raw_reviews: list[FileReview]
    final_result: ReviewResult


class SynthesizerAgent:
    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    def synthesize(self, pr: PRContext, raw_reviews: list[FileReview]) -> ReviewResult:
        if not raw_reviews:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files reviewed.",
                risk_level="low",
            )
            
        system_prompt = """You are the Areté Synthesizer.
Your task is to merge raw code reviews from multiple specialist agents.
1. Read the raw comments provided.
2. Remove duplicates and resolve contradictions.
3. Group the finalized comments by file.
4. Provide a summarized string for each file.
5. Provide an overall summary.
6. Calculate risk level ("low", "medium", "high", "critical") based on severity.

Return ONLY valid JSON with this exact structure:
{
  "file_reviews": [
    {
      "path": "...",
      "comments": [
        {
          "path": "...",
          "line": 123,
          "body": "...",
          "severity": "info|warning|error",
          "category": "..."
        }
      ],
      "summary": "..."
    }
  ],
  "overall_summary": "...",
  "risk_level": "low"
}"""

        if pr.custom_rules:
            system_prompt += "\n\nCRITICAL: The user has defined custom Standard Operating Procedures (SOP) rules for this repository in .arete.yml. You MUST ensure the final output strictly obeys these rules:\n"
            system_prompt += "\n".join(f"- {rule}" for rule in pr.custom_rules)

        raw_reviews_json = [fr.model_dump() for fr in raw_reviews]
        
        user_prompt = f"""Synthesize the following raw reviews for PR #{pr.pr_number}:
        
Raw Reviews:
{json.dumps(raw_reviews_json, indent=2)}
"""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
        
        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        clean = re.sub(
            r"```(?:json)?\n?|```$", "", raw, flags=re.MULTILINE
        ).strip()
        data = json.loads(clean)
        
        if "file_reviews" not in data:
            raise ValueError("Synthesizer failed to produce 'file_reviews'.")
            
        file_reviews = [FileReview(**fr) for fr in data.get("file_reviews", [])]
        
        risk = data.get("risk_level", "low").lower()
        if risk not in ("low", "medium", "high", "critical"):
            risk = "low"
            
        return ReviewResult(
            pr_context=pr,
            file_reviews=file_reviews,
            overall_summary=data.get("overall_summary", "Synthesized reviews."),
            risk_level=risk
        )


def _fallback_synthesize(pr: PRContext, flat_results: list[FileReview]) -> ReviewResult:
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
            f"Found {total} issue(s) across security, performance, quality, "
            f"test coverage, deployment safety, and business logic checks. "
            f"Risk level: {risk.upper()}."
        ),
        risk_level=risk,
    )


class ReviewOrchestrator:
    def __init__(self, llm: BaseChatModel) -> None:
        self.llm = llm
        self._agents = [
            SecurityAgent(llm),
            PerformanceAgent(llm),
            QualityAgent(llm),
            TestCoverageAgent(llm),
            DeploymentSafetyAgent(llm),
            BusinessLogicAgent(llm),
        ]
        self.synthesizer = SynthesizerAgent(llm)
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(GraphState)

        workflow.add_node("run_review_agents", self._run_review_agents)
        workflow.add_node("synthesize_reviews", self._synthesize_reviews)

        workflow.add_edge(START, "run_review_agents")
        workflow.add_edge("run_review_agents", "synthesize_reviews")
        workflow.add_edge("synthesize_reviews", END)

        return workflow.compile()

    def _run_review_agents(self, state: GraphState) -> dict:
        pr = state["pr"]
        if not pr.files:
            return {"raw_reviews": []}

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

        return {"raw_reviews": flat_results}

    def _synthesize_reviews(self, state: GraphState) -> dict:
        pr = state["pr"]
        raw_reviews = state.get("raw_reviews", [])
        
        if not raw_reviews:
            return {"final_result": ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )}

        final_result = self.synthesizer.synthesize(pr, raw_reviews)
        return {"final_result": final_result}

    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )
            
        try:
            state = self.graph.invoke({"pr": pr})
            return state["final_result"]
        except Exception as exc:
            import logging
            logging.warning(f"LangGraph orchestration failed: {exc}. Falling back to blind merge.")
            
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
                    except Exception as e:
                        flat_results.append(
                            FileReview(
                                path=file.path,
                                comments=[],
                                summary=f"{agent.agent_name} error: {e}",
                            )
                        )
            
            return _fallback_synthesize(pr, flat_results)
