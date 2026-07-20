"""Wire contract for POST /fix (healing-loop v1, Wave B — Eng3 lane).

Per docs/superpowers/specs/2026-07-19-healing-loop-design.md §3 (FROZEN).

installation_id is the NUMERIC external installation id (GitHub App
installation id), matching ScanRequest.installation_id exactly — NOT the
internal Prisma Installation uuid. This is a deliberate divergence from the
spec's illustrative JSON example (which shows "installationId": "uuid"):
context_map.repo_cache keys its on-disk checkout cache as
`root / str(installation_id) / repo_slug`, using the SAME numeric id /scan
already checks out and caches under. If /fix used the uuid instead, it would
resolve to a different, never-before-seen directory — silently missing the
checkout /scan already populated (or worse, caching a second, inconsistent
copy under a different key). The webhook /fix/trigger caller (Eng4) must
resolve and pass the numeric external id here, the same translation
resolveModelConnectionForReview / scan/trigger.ts already do before calling
agents /scan.
"""

from pydantic import BaseModel, ConfigDict, Field

from arete_agents.models.pr import LLMConfig


class FixRepo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    full_name: str = Field(alias="fullName")  # "owner/repo"
    default_branch: str = Field(alias="defaultBranch")
    # Short-lived webhook-minted GitHub App installation token. Passed straight
    # to context_map.repo_cache; never logged (repo_cache already redacts it
    # from any git stderr it raises).
    token: str


class FixEvidenceRef(BaseModel):
    path: str
    line: int
    excerpt: str | None = None


class FixItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: str  # "issue" | "opportunity"
    title: str
    detail: str
    dimension: str
    confidence: float = Field(ge=0, le=1)
    evidence: list[FixEvidenceRef]


class FixRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    container_id: str = Field(alias="containerId")
    installation_id: int = Field(alias="installationId")  # see module docstring
    repo: FixRepo
    item: FixItem
    llm: LLMConfig | None = None


class FixPatchFile(BaseModel):
    """Exactly the shape packages/webhook/src/staging/stage-pr.ts's
    StagedPatchFile expects — `content` is the COMPLETE new file content
    (never a unified diff), committed verbatim as a git blob at staging."""

    path: str
    content: str


class TranscriptReport(BaseModel):
    status: str  # "done" | "blocked"
    confidence: float | None = None
    blockers: list[str] = Field(default_factory=list)


class TranscriptStep(BaseModel):
    agent: str
    action: str  # "author" | "verify" | "compose"
    detail: str
    report: TranscriptReport


class FixVerification(BaseModel):
    verdict: str  # "verified" | "unverified"
    checks: list[str] = Field(default_factory=list)


class FixResponse(BaseModel):
    status: str  # "fixed" | "fix_failed"
    # Required (non-null) whenever status is "fix_failed" — honest,
    # user-renderable. Optional/omitted on "fixed".
    reason: str | None = None
    # Non-empty iff status == "fixed" — enforced by fix_pipeline, never by
    # convention alone.
    patch: list[FixPatchFile] = Field(default_factory=list)
    transcript: list[TranscriptStep] = Field(default_factory=list)
    verification: FixVerification | None = None
