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
from arete_agents.context_map import ensure_indexed
from arete_agents.critic import CriticAgent
from arete_agents.grounding import has_quoted_evidence, valid_lines_for_patch
from arete_agents.llm.base import ROLE_KEYS
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewResult

_SEVERITY_WEIGHT = {"error": 3, "warning": 2, "info": 1}

# Cap on the serialized raw-reviews JSON sent to the Synthesizer in one call.
# Mirrors MAX_PATCH_CHARS in agents/base.py: for a large PR (many files x 6
# agents x comments) an unbounded payload can blow the context window or
# produce mangled/hallucinated line numbers, so degrade gracefully instead.
MAX_RAW_REVIEWS_CHARS = 150_000

# Default category->tier mapping used for critic routing when the caller
# doesn't supply live settings-derived tiers via the `tiers` constructor
# param. Mirrors config.py's DEFAULT tier values for the 6 specialist
# categories (not necessarily the live/env-overridden values — pass
# tiers=role_tiers(settings) explicitly at the production call sites in
# server.py/cli.py to respect real per-installation overrides).
_DEFAULT_CATEGORY_TIERS: dict[str, str] = {
    "security": "opus",
    "performance": "sonnet",
    "quality": "sonnet",
    "test_coverage": "sonnet",
    "deployment_safety": "opus",
    "business_logic": "opus",
}


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
Your task is to merge raw code reviews from multiple specialist agents into one verified, high-signal review.
1. Read the raw comments provided.
2. Remove duplicates and resolve contradictions.
3. VERIFY every remaining comment against the diff content quoted inside it and the other raw reviews. A comment is well-grounded only if it references an actual line, symbol, or pattern visible in the review material. DROP any comment that is low-confidence, speculative, vague, or hallucinated (e.g. it names a variable or function that does not appear anywhere in the reviewed diff content) — do NOT include dropped comments in the output. Count how many you dropped and report it as "dropped_count".
4. NEVER include a ```suggestion code block unless you can verify the suggested replacement actually addresses the diff shown: it must reference real variable/function names that appear in the diff content and match the surrounding code's indentation. If a suggestion cannot be verified, strip the ```suggestion block and keep only the prose explanation (or drop the whole comment if nothing verifiable remains).
5. Group the finalized comments by file.
6. Provide a summarized string for each file.
7. Provide an overall summary. You may optionally include a ```mermaid diagram in it, but ONLY if this PR's changes are complex enough (multi-component data/control flow) that a diagram genuinely aids understanding — for simple or small PRs, omit it.
8. Calculate risk level ("low", "medium", "high", "critical") based on severity.

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
  "risk_level": "low",
  "dropped_count": <integer: number of raw comments you dropped as unverified/hallucinated in step 3>
}"""

        if pr.custom_rules:
            system_prompt += "\n\nCRITICAL: The user has defined custom Standard Operating Procedures (SOP) rules for this repository in .arete.yml. You MUST ensure the final output strictly obeys these rules:\n"
            system_prompt += "\n".join(f"- {rule}" for rule in pr.custom_rules)

        from arete_agents.skills.loader import load_installed_skills
        installed_skills = load_installed_skills()
        if installed_skills:
            system_prompt += "\n\nYou are also equipped with the following skills and global instructions. Adhere to them strictly when synthesizing reviews:\n"
            system_prompt += "\n\n---\n\n".join(installed_skills)

        raw_reviews_json = [fr.model_dump() for fr in raw_reviews]
        serialized = json.dumps(raw_reviews_json, indent=2)
        truncation_note = ""
        if len(serialized) > MAX_RAW_REVIEWS_CHARS:
            serialized = serialized[:MAX_RAW_REVIEWS_CHARS]
            truncation_note = (
                f"\n[Raw reviews truncated: showing first {MAX_RAW_REVIEWS_CHARS} "
                "chars only — the JSON above may be cut off mid-structure; "
                "synthesize what is visible and do not invent content for the "
                "missing remainder]"
            )

        user_prompt = f"""Synthesize the following raw reviews for PR #{pr.pr_number}:

Raw Reviews:
{serialized}{truncation_note}
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

        # Explicit verification-pass accounting (see system prompt step 3).
        # Defensive parse: older/non-compliant responses simply report 0.
        try:
            dropped_count = max(0, int(data.get("dropped_count", 0)))
        except (TypeError, ValueError):
            dropped_count = 0

        return ReviewResult(
            pr_context=pr,
            file_reviews=file_reviews,
            overall_summary=data.get("overall_summary", "Synthesized reviews."),
            risk_level=risk,
            dropped_count=dropped_count,
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
    def __init__(
        self,
        llm: BaseChatModel | dict[str, BaseChatModel],
        tiers: dict[str, str] | None = None,
    ) -> None:
        # Accept either a single client (used for every role — the common case
        # in tests and simple callers) or a per-role dict from
        # get_llms_by_role() so each agent runs on its configured tier.
        if isinstance(llm, dict):
            self._llms = llm
        else:
            self._llms = {role: llm for role in ROLE_KEYS}
        self._agents = [
            SecurityAgent(self._llms["security"]),
            PerformanceAgent(self._llms["performance"]),
            QualityAgent(self._llms["quality"]),
            TestCoverageAgent(self._llms["test_coverage"]),
            DeploymentSafetyAgent(self._llms["deployment_safety"]),
            BusinessLogicAgent(self._llms["business_logic"]),
        ]
        self.synthesizer = SynthesizerAgent(self._llms["synthesizer"])
        self._critic_opus = CriticAgent(self._llms["critic_opus"])
        self._critic_sonnet = CriticAgent(self._llms["critic_sonnet"])
        self._category_tiers = tiers or _DEFAULT_CATEGORY_TIERS
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
            agent = CIAgent(self._llms["ci_diagnostics"])
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

        final_result = self._apply_critic(pr, final_result)
        final_result = self._apply_grounding(pr, final_result)

        # "failed" only when every agent errored (total outage) — partial
        # failures still produced a real (if incomplete) review.
        if state.get("agent_failures", 0) > 0 and state.get("agent_successes", 0) == 0:
            final_result.analysis_status = "failed"

        # Deterministic risk-tiered verdict — computed LAST, after grounding
        # (which can drop comments) and after the failed-status assignment
        # above, so it reflects the final analysis_status and risk_level.
        from arete_agents.verdict import decide_verdict
        final_result.verdict, final_result.verdict_reason = decide_verdict(final_result)

        return {"final_result": final_result}

    def _apply_critic(self, pr: PRContext, result: ReviewResult) -> ReviewResult:
        """Independent second gate on the Synthesizer's output. Every
        surviving comment's category maps to its authoring tier; it is
        critiqued by the OPPOSITE tier's critic. Binary keep/drop only.
        Fails open on any critic error (see CriticAgent.critique)."""
        flat: list[tuple[int, int]] = [
            (fi, ci)
            for fi, fr in enumerate(result.file_reviews)
            for ci in range(len(fr.comments))
        ]
        if not flat:
            return result

        opus_authored: list[tuple[int, int]] = []
        sonnet_authored: list[tuple[int, int]] = []
        for fi, ci in flat:
            category = result.file_reviews[fi].comments[ci].category
            tier = self._category_tiers.get(category)
            if tier == "opus":
                opus_authored.append((fi, ci))
            elif tier == "sonnet":
                sonnet_authored.append((fi, ci))
            # else: unrecognized category -> kept as-is, uncritiqued.

        drop_keys: set[tuple[int, int]] = set()

        if opus_authored:
            comments = [result.file_reviews[fi].comments[ci] for fi, ci in opus_authored]
            dropped = self._critic_sonnet.critique(pr, comments)
            drop_keys |= {opus_authored[i] for i in dropped}

        if sonnet_authored:
            comments = [result.file_reviews[fi].comments[ci] for fi, ci in sonnet_authored]
            dropped = self._critic_opus.critique(pr, comments)
            drop_keys |= {sonnet_authored[i] for i in dropped}

        if not drop_keys:
            return result

        new_file_reviews = []
        for fi, fr in enumerate(result.file_reviews):
            kept = [c for ci, c in enumerate(fr.comments) if (fi, ci) not in drop_keys]
            new_file_reviews.append(FileReview(path=fr.path, comments=kept, summary=fr.summary))

        result.file_reviews = new_file_reviews
        result.critic_dropped_count = len(drop_keys)
        return result

    def _apply_grounding(self, pr: PRContext, result: ReviewResult) -> ReviewResult:
        """Deterministic (non-LLM) final gate, run after the Critic stage.
        Every surviving comment's line number must exist in its file's real
        diff (any category); security comments must additionally quote real
        code from that diff. Both checks for a given file are skipped
        together when that file's patch can't be parsed at all (pass
        every comment through unfiltered) — a bug in this gate must never
        make a review worse than not having it, and Gate 2 must never run
        against a diff we don't trust ourselves to have parsed correctly.
        A security comment with no quoted evidence, on a patch that DID
        parse, is dropped outright — the one deliberate fail-closed
        exception to that rule."""
        patches_by_path = {f.path: f.patch for f in pr.files}

        citation_dropped = 0
        security_evidence_dropped = 0
        new_file_reviews = []

        for fr in result.file_reviews:
            patch = patches_by_path.get(fr.path)
            valid_lines = valid_lines_for_patch(patch) if patch is not None else None

            if valid_lines is None:
                new_file_reviews.append(fr)
                continue

            kept = []
            for c in fr.comments:
                if c.line not in valid_lines:
                    citation_dropped += 1
                    continue
                if c.category == "security" and not has_quoted_evidence(c.body, patch):
                    security_evidence_dropped += 1
                    continue
                kept.append(c)
            new_file_reviews.append(FileReview(path=fr.path, comments=kept, summary=fr.summary))

        result.file_reviews = new_file_reviews
        result.citation_dropped_count = citation_dropped
        result.security_evidence_dropped_count = security_evidence_dropped
        return result

    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )

        try:
            ensure_indexed(pr)
        except Exception as exc:
            # ensure_indexed already fails open internally on every known
            # failure mode (RepoCacheError, IndexerError). This is a second,
            # defensive layer so a genuinely unexpected bug in that path
            # still can't fail the review itself.
            logging.warning(
                f"Context-mapping raised unexpectedly: {exc}. Continuing without it."
            )

        try:
            state = self.graph.invoke({"pr": pr})
            return state["final_result"]
        except Exception as exc:
            logging.warning(f"LangGraph orchestration failed: {exc}. Falling back to blind merge.")

            if pr.ci_logs is not None:
                agents = [CIAgent(self._llms["ci_diagnostics"])]
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
