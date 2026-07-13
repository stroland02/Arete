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
    errors: int = 0


class FixtureAgentResult(BaseModel):
    fixture_id: str
    agent: str
    relevant_defects: list[PlantedDefect]
    comments: list[ReviewComment]
    match_results: list[MatchResult]
    errors: int = 0
    clean: bool = False


class SeverityScore(BaseModel):
    severity: Literal["info", "warning", "error"]
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    f1: float
    fp_rate: float


class CleanFileStats(BaseModel):
    clean_fixtures: int          # fixtures with clean=True
    clean_fixtures_flagged: int  # of those, how many drew >=1 comment
    false_alarm_rate: float      # flagged / clean_fixtures (0.0 if none)


class DatasetComposition(BaseModel):
    total_fixtures: int
    clean_fixtures: int
    defect_fixtures: int
    total_defects: int
    by_category: dict[str, int]   # target_agent -> defect count
    by_severity: dict[str, int]   # severity -> defect count
    dataset_hash: str             # sha256 of canonical fixture content


class EvalReport(BaseModel):
    per_agent: list[AgentScore]
    overall: AgentScore
    misses: list[PlantedDefect]
    false_positives: list[ReviewComment]
    meta: dict[str, str] = Field(default_factory=dict)
    per_severity: list[SeverityScore] = Field(default_factory=list)
    clean_file: CleanFileStats | None = None
    composition: DatasetComposition | None = None
