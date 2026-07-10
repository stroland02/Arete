from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, computed_field

if TYPE_CHECKING:
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

    @computed_field
    @property
    def total_comments(self) -> int:
        return sum(len(fr.comments) for fr in self.file_reviews)


# Needed so pydantic can resolve the forward-referenced PRContext at runtime.
from arete_agents.models.pr import PRContext  # noqa: E402, F811

ReviewResult.model_rebuild()
