from datetime import datetime

from pydantic import BaseModel, Field


class TelemetrySnapshot(BaseModel):
    """Normalized production/business context from one connector for one PR.

    Deliberately loose rather than a rigid scalar schema (e.g. a fixed
    error_count/latency_p95/incident_count shape) — different providers
    return fundamentally different kinds of data (CI pass rate vs. product
    funnel conversion), and forcing everything into fixed numeric fields
    would throw away exactly the linked, textual detail the review feature
    depends on ("which incident, which run, a link to it").
    """

    provider: str
    source_ref: str
    summary_text: str
    metrics: dict[str, float] = Field(default_factory=dict)
    links: list[str] = Field(default_factory=list)
    fetched_at: datetime
