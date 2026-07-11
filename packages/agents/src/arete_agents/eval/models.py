from typing import Literal

from pydantic import BaseModel, Field

from arete_agents.models.pr import PRContext
from arete_agents.models.review import ReviewComment


class PlantedDefect(BaseModel):
    id: str
    path: str
    line: int
    target_agent: str
    description: str
    severity: Literal["info", "warning", "error"]


class EvalFixture(BaseModel):
    id: str
    pr: PRContext
    planted_defects: list[PlantedDefect] = Field(default_factory=list)
    clean: bool = False


class MatchResult(BaseModel):
    defect_id: str | None
    comment: ReviewComment
    localization_ok: bool
    description_ok: bool | None


class AgentScore(BaseModel):
    agent: str
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    f1: float
    fp_rate: float


class FixtureAgentResult(BaseModel):
    fixture_id: str
    agent: str
    relevant_defects: list[PlantedDefect]
    comments: list[ReviewComment]
    match_results: list[MatchResult]


class EvalReport(BaseModel):
    per_agent: list[AgentScore]
    overall: AgentScore
    misses: list[PlantedDefect]
    false_positives: list[ReviewComment]
    meta: dict[str, str] = Field(default_factory=dict)
