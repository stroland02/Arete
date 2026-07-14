from typing import Literal

from pydantic import BaseModel, Field, computed_field

from arete_agents.models.pr import PRContext


class NoiseDecision(BaseModel):
    """A silence_as_noise/place_under_observation tool call recorded during
    review_file()'s tool loop (see agents/base.py). issue_id is parsed into
    path/line before this model is built. escalate_on/threshold are only
    meaningful for action="observe" -- silence carries no threshold."""
    path: str
    line: int
    action: Literal["silence", "observe"]
    reason: str
    escalate_on: str | None = None
    threshold: int | None = None


class ReviewComment(BaseModel):
    path: str
    line: int
    body: str
    severity: Literal["info", "warning", "error"]
    category: str
    # Noise Classification (SP6). Defaults keep every existing constructor
    # call across the test suite working unchanged. Stamped deterministically
    # by ReviewOrchestrator._apply_noise_decisions AFTER synthesis -- never
    # set directly from the LLM's own JSON output.
    noise_state: Literal["OPEN", "SILENCED", "UNDER_OBSERVATION", "ESCALATED"] = "OPEN"
    escalate_on: str | None = None
    threshold: int | None = None


class FileReview(BaseModel):
    path: str
    comments: list[ReviewComment]
    summary: str
    # Tool calls recorded during this file's review_file() tool loop (see
    # agents/base.py). Consumed by orchestrator.py's GraphState reducer and
    # applied by _apply_noise_decisions before the final result is returned.
    # Note the field IS serialized as part of ReviewResult.file_reviews in
    # the /review HTTP response, but downstream consumers (the TS FileReview
    # type) don't declare or read it, so it's effectively inert past this
    # point.
    noise_decisions: list[NoiseDecision] = Field(default_factory=list)


class ReviewResult(BaseModel):
    pr_context: PRContext
    file_reviews: list[FileReview]
    overall_summary: str
    risk_level: Literal["low", "medium", "high", "critical"]
    # "failed" means every agent errored and NOTHING was actually reviewed —
    # distinguishes "no issues found" from "no review ever happened".
    analysis_status: Literal["complete", "failed"] = "complete"
    # Number of raw agent comments the Synthesizer's verification pass DROPPED
    # as low-confidence/hallucinated (part of the explicit synthesis contract,
    # so filtering is observable/testable rather than silent). 0 for the
    # deterministic fallback paths, which never filter.
    dropped_count: int = 0
    # Number of already-synthesized comments the independent critic stage
    # DROPPED as not evidence-backed against the diff (tracked separately
    # from dropped_count — that field is the Synthesizer's own same-model
    # self-check; this one is the genuinely independent cross-tier gate).
    # 0 when the critic bucket was empty or a critic call failed (fail-open).
    critic_dropped_count: int = 0
    # Number of already-synthesized-and-critiqued comments dropped by the
    # deterministic (non-LLM) grounding gate for citing a line number that
    # doesn't exist in the file's real diff. Distinct from dropped_count
    # (Synthesizer's own LLM self-check) and critic_dropped_count (the
    # independent cross-tier LLM critic) — this one is pure text parsing,
    # never an LLM judgment call.
    citation_dropped_count: int = 0
    # Number of security-category comments dropped specifically for lacking
    # any quoted code snippet that actually appears in the diff — a
    # stricter, security-only bar on top of the universal citation check
    # above.
    security_evidence_dropped_count: int = 0
    # Deterministic, non-LLM risk-tiered gate (see verdict.decide_verdict).
    # "pass"/"comment" are informational; "review-required"/"blocked" mean
    # a human must act before merge — this field is advisory data only,
    # never an auto-merge/auto-dismiss signal (human discussion is not
    # merge authorization).
    verdict: Literal["pass", "comment", "review-required", "blocked"] = "pass"
    verdict_reason: str = ""

    @computed_field
    @property
    def total_comments(self) -> int:
        return sum(len(fr.comments) for fr in self.file_reviews)
