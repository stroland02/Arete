import logging
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ValidationError

from arete_agents.agents.chat import ChatAgent
from arete_agents.config import Settings, get_settings
from arete_agents.llm.ollama import (
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_OLLAMA_MODEL,
    ollama_unavailable_reason,
)
from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui
from arete_agents.llm.base import (
    get_llms_by_role,
    get_llms_by_role_from_config,
    role_tiers,
)
from arete_agents.models.pr import PRContext
from arete_agents.orchestrator import ReviewOrchestrator
from arete_agents.remediation import RemediationGraph
from arete_agents.tools.executor import CommandExecutionError, get_command_executor

app = FastAPI()

# OpenTelemetry Auto-Instrumentation
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# Set up the tracer provider with service name
resource = Resource(attributes={SERVICE_NAME: "arete-agents"})
provider = TracerProvider(resource=resource)

# Export traces to the OTel Collector in the infra stack
# The infra docker-compose sets up the collector at localhost:4317
otlp_exporter = OTLPSpanExporter(endpoint="http://localhost:4317", insecure=True)
processor = BatchSpanProcessor(otlp_exporter)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

# Module-level singletons — LangGraph graph compilation is expensive;
# one orchestrator and one chat agent serve all requests. Fail-fast on
# missing/invalid config is intentional (better to crash at startup than
# serve requests with a broken LLM client) — but the raw pydantic
# ValidationError is not actionable on its own, so we log a clear pointer
# to the required env vars before letting the exception propagate and
# take down the process.
try:
    _settings = get_settings()
except ValidationError:
    # No usable primary provider key (e.g. ANTHROPIC_API_KEY unset). Rather than
    # crash, fall back to local Ollama as the safety net so the service still
    # runs. If Ollama isn't reachable/pulled, /review returns an honest 503
    # ("ollama pull <model>") — never a fabricated or falsely-clean review.
    logging.warning(
        "No usable primary LLM provider key configured; falling back to local "
        "Ollama (%s @ %s) as the safety net. Connect your own model per /review "
        "request, or set a provider API key, to use a cloud model.",
        DEFAULT_OLLAMA_MODEL,
        DEFAULT_OLLAMA_BASE_URL,
    )
    _settings = Settings(llm_provider="ollama")
except Exception:
    logging.critical(
        "Areté agents server failed to start: invalid or missing configuration.",
        exc_info=True,
    )
    raise
_llms = get_llms_by_role(_settings)
_orchestrator = ReviewOrchestrator(llm=_llms, tiers=role_tiers(_settings))
_chat_agent = ChatAgent(llm=_llms["chat"])
# Applies operator-approved infra commands and resumes the run. Singleton so
# its checkpointer persists across requests within the process — that shared
# state is what makes POST /approvals/apply idempotent for a redelivered job.
# Executor defaults to the mock; deploy sets ARETE_COMMAND_EXECUTOR=subprocess.
_remediation = RemediationGraph(get_command_executor())


@app.post("/review")
def review(pr: PRContext):
    # Per-request BYO model: when the caller supplies pr.llm, build the review's
    # LLM clients from THAT config (get_llms_by_role_from_config) — a fresh
    # orchestrator on the user's own model — instead of the server's global
    # Settings-derived singleton. Callers that omit pr.llm keep the default.
    if pr.llm is not None:
        if pr.llm.provider == "ollama":
            reason = ollama_unavailable_reason(
                pr.llm.base_url or DEFAULT_OLLAMA_BASE_URL,
                pr.llm.model or DEFAULT_OLLAMA_MODEL,
                _settings.deployment_tier,
            )
            if reason:
                # Honest empty state: refuse rather than emit a review-shaped
                # (falsely "clean") result when no model actually ran.
                raise HTTPException(status_code=503, detail=reason)
        try:
            llms = get_llms_by_role_from_config(
                provider=pr.llm.provider,
                model=pr.llm.model,
                api_key=pr.llm.api_key,
                base_url=pr.llm.base_url,
            )
        except ValueError as exc:
            # Unknown provider is a client error, not a server fault.
            raise HTTPException(status_code=400, detail=str(exc))
        return ReviewOrchestrator(llm=llms).run(pr)

    # Default path — this may be the Ollama safety fallback (no primary key).
    if _settings.llm_provider == "ollama":
        reason = ollama_unavailable_reason(
            _settings.ollama_base_url,
            _settings.ollama_model,
            _settings.deployment_tier,
        )
        if reason:
            raise HTTPException(status_code=503, detail=reason)
    return _orchestrator.run(pr)


class ApplyApprovalRequest(BaseModel):
    approvalId: str
    reviewId: str
    command: str


@app.post("/approvals/apply")
def apply_approval(req: ApplyApprovalRequest):
    """Apply an operator-approved infrastructure command and resume the run.
    Driven by the approval-exec worker after a human approved the ApprovalPrompt.
    Idempotent per approvalId — a redelivered job never double-applies."""
    try:
        result = _remediation.apply_and_resume(
            req.approvalId, req.reviewId, req.command
        )
    except CommandExecutionError as exc:
        # The command could not be launched — nothing was applied. Surface a 503
        # so the approval-exec queue redelivers; the retry is safe because
        # apply_and_resume is idempotent and never double-applies.
        raise HTTPException(
            status_code=503, detail=f"transient execution failure: {exc}"
        )
    return {
        "status": "applied" if result.applied else "failed",
        "detail": result.detail,
        "resumedRunId": req.approvalId,
    }


@app.post("/chat")
def chat(context: Dict[str, Any]):
    return _chat_agent.reply(context)


@app.get("/context-map/ui-url/{installation_id}")
def context_map_ui_url(installation_id: int):
    try:
        url = get_or_start_ui(installation_id)
        return {"available": True, "url": url}
    except ContextMapUIError as exc:
        return {"available": False, "url": None, "reason": str(exc)}
