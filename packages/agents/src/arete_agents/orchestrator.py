import json
import logging
import operator
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Annotated, Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from arete_agents.agents.business_logic import BusinessLogicAgent
from arete_agents.agents.ci_agent import CIAgent
from arete_agents.agents.deployment_safety import DeploymentSafetyAgent
from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.agents.test_coverage import TestCoverageAgent
from arete_agents.models.pr import FileChange, PRContext
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
    raw_reviews: Annotated[list[FileReview], operator.add]
    # Explicit success/failure tallies from the fan-out, so "all agents
    # errored" can be detected deterministically instead of pattern-matching
    # error text in FileReview summaries after the fact.
    agent_successes: Annotated[int, operator.add]
    agent_failures: Annotated[int, operator.add]
    final_result: ReviewResult


class ReviewTaskState(TypedDict):
    pr: PRContext
    file: FileChange
    agent_name: str


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
5. Provide an overall summary. IMPORTANT: Your overall summary MUST include a ````mermaid ... ```` block containing an architectural sequence diagram or flow chart that visually maps out the impact of this Pull Request's changes.
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

        workflow.add_node("execute_agent_review", self._execute_agent_review)
        workflow.add_node("synthesize_reviews", self._synthesize_reviews)

        def route(state: GraphState):
            pr = state["pr"]
            if not pr.files:
                return "synthesize_reviews"
            
            sends = []
            if pr.ci_logs is not None:
                for file in pr.files:
                    sends.append(Send("execute_agent_review", ReviewTaskState(pr=pr, file=file, agent_name="CIAgent")))
            else:
                for file in pr.files:
                    for agent in self._agents:
                        sends.append(Send("execute_agent_review", ReviewTaskState(pr=pr, file=file, agent_name=agent.agent_name)))
            return sends

        workflow.add_conditional_edges(START, route, ["execute_agent_review", "synthesize_reviews"])
        workflow.add_edge("execute_agent_review", "synthesize_reviews")
        workflow.add_edge("synthesize_reviews", END)

        return workflow.compile()

    def _execute_agent_review(self, state: ReviewTaskState) -> dict:
        pr = state["pr"]
        file = state["file"]
        agent_name = state["agent_name"]

        agent = None
        if agent_name == "CIAgent":
            agent = CIAgent(self.llm)
        else:
            for a in self._agents:
                if a.agent_name == agent_name:
                    agent = a
                    break

        if not agent:
            return {
                "raw_reviews": [FileReview(
                    path=file.path,
                    comments=[],
                    summary=f"Unknown agent: {agent_name}",
                )],
                "agent_failures": 1,
            }

        try:
            result = agent.review_file(file, pr)
            return {"raw_reviews": [result], "agent_successes": 1}
        except Exception as exc:
            return {
                "raw_reviews": [FileReview(
                    path=file.path,
                    comments=[],
                    summary=f"{agent.agent_name} error: {exc}",
                )],
                "agent_failures": 1,
            }

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

        try:
            final_result = self.synthesizer.synthesize(pr, raw_reviews)
        except Exception as exc:
            # Catch synthesis failures (e.g. the LLM returned invalid JSON)
            # here, rather than letting them bubble up to run()'s outer
            # except. That outer handler re-runs every specialist agent from
            # scratch, doubling LLM cost/latency for a failure that has
            # nothing to do with the agents themselves. We already have all
            # the raw per-agent reviews in hand, so fall back to a blind
            # merge of them directly.
            logging.warning(
                f"Synthesizer failed: {exc}. Falling back to blind merge of "
                "already-gathered agent reviews (no agent LLM calls re-issued)."
            )
            final_result = _fallback_synthesize(pr, raw_reviews)

        # "failed" only when every agent errored (total outage) — partial
        # failures still produced a real (if incomplete) review.
        if state.get("agent_failures", 0) > 0 and state.get("agent_successes", 0) == 0:
            final_result.analysis_status = "failed"
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
            logging.warning(f"LangGraph orchestration failed: {exc}. Falling back to blind merge.")

            if pr.ci_logs is not None:
                agents = [CIAgent(self.llm)]
            else:
                agents = self._agents

            tasks = [(file, agent) for file in pr.files for agent in agents]
            flat_results: list[FileReview] = []
            successes = 0
            failures = 0

            # Agent calls are I/O-bound (network round trips to the LLM
            # provider), so run this last-resort path in parallel too —
            # otherwise a genuine graph-level failure degrades into a
            # sequential, num_files * num_agents round-trip pileup.
            with ThreadPoolExecutor(max_workers=min(len(tasks), 12)) as pool:
                futures = {
                    pool.submit(agent.review_file, file, pr): (file, agent)
                    for file, agent in tasks
                }
                for future in as_completed(futures):
                    file, agent = futures[future]
                    try:
                        flat_results.append(future.result())
                        successes += 1
                    except Exception as e:
                        failures += 1
                        flat_results.append(
                            FileReview(
                                path=file.path,
                                comments=[],
                                summary=f"{agent.agent_name} error: {e}",
                            )
                        )

            result = _fallback_synthesize(pr, flat_results)
            if failures > 0 and successes == 0:
                result.analysis_status = "failed"
            return result
