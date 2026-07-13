from typing import Literal

from pydantic import BaseModel, computed_field

from arete_agents.models.pr import PRContext


class ReviewComment(BaseModel):
    path: str
    line: int
    body: str
    severity: Literal["info", "warning", "error"]
    category: str


class FileReview(BaseModel):
    path: str
    comments: list[ReviewComment]
    summary: str


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

    @computed_field
    @property
    def total_comments(self) -> int:
        return sum(len(fr.comments) for fr in self.file_reviews)
