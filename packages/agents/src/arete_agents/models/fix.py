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


class FixSignalSpan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    timestamp: str
    service: str
    span_name: str = Field(alias="spanName")
    trace_id: str = Field(alias="traceId")
    status_message: str = Field(alias="statusMessage")
    duration_ms: float = Field(alias="durationMs")


class FixSignalLog(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    timestamp: str
    service: str
    severity: str
    body: str
    trace_id: str = Field(alias="traceId")


class FixSignalException(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    exception_type: str = Field(alias="exceptionType")
    exception_message: str = Field(alias="exceptionMessage")
    service: str
    occurrences: int
    last_seen: str = Field(alias="lastSeen")


class FixSignalOmitted(BaseModel):
    """How many rows the webhook's prompt-budget caps dropped, per kind. Sent so
    the agent is never shown a truncated sample that looks complete."""

    spans: int = 0
    logs: int = 0
    exceptions: int = 0


class FixSignals(BaseModel):
    """Runtime context from the incident that opened this work item — the error
    spans, logs and exceptions around the alert.

    Produced by packages/webhook/src/fix/incident-signals.ts. Timestamps arrive
    as ISO-8601 strings and stay strings: they are rendered into a prompt, never
    computed with, and parsing them here would only add a failure mode.

    `availability` carries WHY the lists are empty, and the three values are not
    interchangeable: "denied" (not the platform installation, so nothing was
    queried), "unavailable" (the telemetry backend could not answer), "granted"
    (we looked — empty really means the window was quiet). Collapsing these
    would tell the author model "nothing was wrong" when the truth is "nobody
    looked", which is exactly how a confident patch gets written for a problem
    that was never observed.
    """

    model_config = ConfigDict(populate_by_name=True)

    incident_id: str = Field(alias="incidentId")
    alert_name: str = Field(alias="alertName")
    severity: str
    status: str
    summary: str
    starts_at: str = Field(alias="startsAt")
    resolved_at: str | None = Field(default=None, alias="resolvedAt")
    service: str | None = None
    availability: str  # "granted" | "denied" | "unavailable"
    spans: list[FixSignalSpan] = Field(default_factory=list)
    logs: list[FixSignalLog] = Field(default_factory=list)
    exceptions: list[FixSignalException] = Field(default_factory=list)
    omitted: FixSignalOmitted = Field(default_factory=FixSignalOmitted)


class FixRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    container_id: str = Field(alias="containerId")
    installation_id: int = Field(alias="installationId")  # see module docstring
    repo: FixRepo
    item: FixItem
    # Optional in BOTH directions. Most work items are scan-born and have no
    # incident behind them, so its absence is the normal case, not a degraded
    # one — and a webhook and an agents service at different versions keep
    # interoperating during a rollout.
    signals: FixSignals | None = None
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
