import logging
from typing import Any, Dict

import structlog
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from pydantic import BaseModel, ValidationError

from arete_agents.agents.chat import ChatAgent
from arete_agents.config import Settings, get_settings
from arete_agents.context_map.graph_export import GraphExportError, build_graph_export
from arete_agents.context_map.indexer import IndexerError, index_repository
from arete_agents.context_map.repo_cache import RepoCacheError, ensure_repo_checked_out
from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui
from arete_agents.fix_pipeline import run_fix
from arete_agents.internal_auth import require_internal_token
from arete_agents.llm.base import (
    get_llms_by_role,
    get_llms_by_role_from_config,
    role_tiers,
)
from arete_agents.llm.ollama import (
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_OLLAMA_MODEL,
    ollama_unavailable_reason,
)
from arete_agents.models.fix import FixRequest, FixResponse
from arete_agents.models.pr import LLMConfig, PRContext, ScanRequest
from arete_agents.observability import configure_structlog, init_observability
from arete_agents.orchestrator import ReviewOrchestrator
from arete_agents.remediation import RemediationGraph
from arete_agents.scan import ScanUnavailableError, run_scan
from arete_agents.tools.executor import CommandExecutionError, get_command_executor

# Telemetry bootstrap. Import time == inside the uvicorn worker process
# (`uvicorn arete_agents.server:app`) — exporter threads must live in the
# serving process. No-ops (one INFO line) when OTEL_EXPORTER_OTLP_ENDPOINT is
# unset; never raises (telemetry must never take the app down). Replaces the
# old unconditional hardcoded gRPC exporter to localhost:4317.
init_observability()
# AFTER init_observability (OTel LoggingHandler already on root), per the
# bootstrap ordering contract documented in observability.py.
configure_structlog()

_logger = structlog.get_logger(__name__).bind(component="server")

app = FastAPI()

# /health is excluded from tracing (spec §3): a container healthcheck on a
# 5s interval would otherwise dominate span volume for zero information.
try:
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health")
except Exception:
    _logger.warning("FastAPI instrumentation failed; serving untraced", exc_info=True)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe for compose healthchecks and LB checks. Excluded from
    tracing via excluded_urls above; must stay dependency-free (no DB, no
    LLM) so it answers even on a keyless boot."""
    return {"status": "ok"}

# LLM-backed singletons are built LAZILY, on the first /review or /chat call.
# LangGraph graph compilation is expensive (one orchestrator + one chat agent
# serve all requests) and — critically — requires a configured LLM provider key.
# The code-map endpoints (/context-map/*) are pure code-graph operations that
# need NO LLM, so the server MUST boot and serve them even when no key is set.
# We therefore defer the key requirement to the endpoints that actually need it,
# instead of crashing the whole process at import (which also took the code map
# down with it).
_orchestrator: ReviewOrchestrator | None = None
_chat_agent: ChatAgent | None = None


def _resolve_settings() -> Settings:
    try:
        return get_settings()
    except ValidationError:
        # No usable primary provider key (e.g. ANTHROPIC_API_KEY unset). Rather
        # than fail, fall back to local Ollama as the safety net. If Ollama isn't
        # reachable/pulled, /review returns an honest 503 ("ollama pull <model>")
        # — never a fabricated or falsely-clean review.
        logging.warning(
            "No usable primary LLM provider key configured; falling back to local "
            "Ollama (%s @ %s) as the safety net. Connect your own model per /review "
            "request, or set a provider API key, to use a cloud model.",
            DEFAULT_OLLAMA_MODEL,
            DEFAULT_OLLAMA_BASE_URL,
        )
        return Settings(llm_provider="ollama")
    except Exception:
        logging.critical(
            "Areté agents: LLM configuration is invalid or missing. Set a valid "
            "GEMINI_API_KEY (with LLM_PROVIDER=gemini) or ANTHROPIC_API_KEY (with "
            "LLM_PROVIDER=anthropic). The code-map endpoints (/context-map/*) work "
            "without it; /review and /chat require it.",
            exc_info=True,
        )
        raise


def _get_orchestrator() -> ReviewOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        settings = _resolve_settings()
        _orchestrator = ReviewOrchestrator(
            llm=get_llms_by_role(settings), tiers=role_tiers(settings)
        )
    return _orchestrator


def _get_chat_agent() -> ChatAgent:
    global _chat_agent
    if _chat_agent is None:
        settings = _resolve_settings()
        _chat_agent = ChatAgent(llm=get_llms_by_role(settings)["chat"])
    return _chat_agent


# Applies operator-approved infra commands and resumes the run. Singleton so
# its checkpointer persists across requests within the process — that shared
# state is what makes POST /approvals/apply idempotent for a redelivered job.
# Executor defaults to the mock; deploy sets ARETE_COMMAND_EXECUTOR=subprocess.
# Needs no LLM, so eager construction is safe on a keyless boot.
_remediation = RemediationGraph(get_command_executor())

# Service-to-service surface guard (review finding B4; spec section 6 gate 4).
# Every POST below is called ONLY by our own server-side processes
# (packages/webhook's review-bridge / scan-trigger / fix-trigger / chat-handler
# / approval-worker / context-map-index, and packages/dashboard's agent-chat),
# each of which mints its own short-lived internal token (obs Phase 3 Task 4 --
# arete_agents/internal_token.py, the Python counterpart of
# @arete/internal-token). They all spend money, mutate state, or -- in
# /review and /chat's case -- can induce an add_project_memory write into a
# CALLER-NAMED tenant using this process's own credential. The hop is
# therefore authenticated with the same signed-token scheme and the same
# fail-closed posture the webhook uses (internal_auth.py).
#
# GET /health is deliberately NOT behind this guard; see internal_auth.py.
#
# The read-only GET /context-map/ui-url/{id} and /context-map/graph/{id}
# routes WERE left open here (review finding B4 covered only the write/spend
# POST surface above) -- but they take an installation id straight from the
# URL path and return that tenant's code graph, so leaving them open is a
# cross-tenant READ leak to anyone with network reach to this port. Their
# only caller (packages/dashboard/src/lib/context-map-client.ts, called
# server-side from the overview/map pages) mints its own internal token the
# same way, so they get the same guard below (spec section 6 gate 4; see
# docs/roadmap/backlog.md for the original finding).
_INTERNAL = [Depends(require_internal_token)]


@app.post("/review", dependencies=_INTERNAL)
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
                _resolve_settings().deployment_tier,
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
    settings = _resolve_settings()
    if settings.llm_provider == "ollama":
        reason = ollama_unavailable_reason(
            settings.ollama_base_url,
            settings.ollama_model,
            settings.deployment_tier,
        )
        if reason:
            raise HTTPException(status_code=503, detail=reason)
    return _get_orchestrator().run(pr)


@app.post("/scan", dependencies=_INTERNAL)
def scan(req: ScanRequest):
    """Repo-wide discovery scan (work-item inbox). Mirrors /review's structure
    exactly: per-request BYO `llm` block builds fresh clients via
    get_llms_by_role_from_config; the Ollama safety fallback returns an honest
    503 (with the pull hint) when unreachable; keyless boot is unaffected —
    the LLM requirement stays deferred to this endpoint."""
    from arete_agents.context_map.graph_export import GraphExportError

    def _execute(llms):
        try:
            return run_scan(req, llms)
        except (GraphExportError, ScanUnavailableError) as exc:
            # No code map / no checkout yet — an honest "can't scan yet",
            # never an empty-but-complete result.
            raise HTTPException(status_code=503, detail=str(exc))

    if req.llm is not None:
        if req.llm.provider == "ollama":
            reason = ollama_unavailable_reason(
                req.llm.base_url or DEFAULT_OLLAMA_BASE_URL,
                req.llm.model or DEFAULT_OLLAMA_MODEL,
                _resolve_settings().deployment_tier,
            )
            if reason:
                raise HTTPException(status_code=503, detail=reason)
        try:
            llms = get_llms_by_role_from_config(
                provider=req.llm.provider,
                model=req.llm.model,
                api_key=req.llm.api_key,
                base_url=req.llm.base_url,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return _execute(llms)

    # Default path — may be the Ollama safety fallback (no primary key).
    settings = _resolve_settings()
    if settings.llm_provider == "ollama":
        reason = ollama_unavailable_reason(
            settings.ollama_base_url,
            settings.ollama_model,
            settings.deployment_tier,
        )
        if reason:
            raise HTTPException(status_code=503, detail=reason)
    return _execute(get_llms_by_role(settings))


@app.post("/fix", dependencies=_INTERNAL)
def fix(req: FixRequest) -> FixResponse:
    """POST /fix — author a real file patch for one work item's evidence,
    verified by auto_resolver's core, an honest fix_failed when it can't
    (healing-loop v1 §3). Per-request BYO model, mirroring /review and /scan:
    req.llm builds fresh clients via get_llms_by_role_from_config; omitted
    falls back to the service default (Ollama safety net).

    Unlike /review and /scan, EVERY "could not do it" case here — an
    unreachable Ollama, a checkout failure, a grounding violation, a failed
    verification, a timeout — is reported as HTTP 200 with
    FixResponse(status="fix_failed", reason=...), never a 503/400. FixResponse
    already carries success/failure in its own `status` field, so callers
    (the fix worker) have exactly one place to check, not two. Only a genuine
    unhandled server error surfaces as a 500."""
    if req.llm is not None:
        if req.llm.provider == "ollama":
            reason = ollama_unavailable_reason(
                req.llm.base_url or DEFAULT_OLLAMA_BASE_URL,
                req.llm.model or DEFAULT_OLLAMA_MODEL,
                _resolve_settings().deployment_tier,
            )
            if reason:
                return FixResponse(status="fix_failed", reason=reason)
        try:
            llms = get_llms_by_role_from_config(
                provider=req.llm.provider,
                model=req.llm.model,
                api_key=req.llm.api_key,
                base_url=req.llm.base_url,
            )
        except ValueError as exc:
            return FixResponse(status="fix_failed", reason=str(exc))
        return run_fix(req, llms, verify_settings=_resolve_settings())

    settings = _resolve_settings()
    if settings.llm_provider == "ollama":
        reason = ollama_unavailable_reason(
            settings.ollama_base_url,
            settings.ollama_model,
            settings.deployment_tier,
        )
        if reason:
            return FixResponse(status="fix_failed", reason=reason)
    return run_fix(req, get_llms_by_role(settings), verify_settings=settings)


class ApplyApprovalRequest(BaseModel):
    approvalId: str
    reviewId: str
    command: str


@app.post("/approvals/apply", dependencies=_INTERNAL)
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


@app.post("/chat", dependencies=_INTERNAL)
def chat(payload: Dict[str, Any]):
    # Per-request BYO model (mirrors /review): when the caller includes an `llm`
    # block, this reply runs on THAT model — the tenant's connected model — not
    # the server default singleton. Keyless Ollama is guarded the same way
    # /review is, so an unreachable/unpulled model returns an honest 503 rather
    # than a silent fallback to a different model.
    llm_raw = payload.pop("llm", None) if isinstance(payload, dict) else None
    if llm_raw:
        cfg = LLMConfig.model_validate(llm_raw)
        if cfg.provider == "ollama":
            reason = ollama_unavailable_reason(
                cfg.base_url or DEFAULT_OLLAMA_BASE_URL,
                cfg.model or DEFAULT_OLLAMA_MODEL,
                _resolve_settings().deployment_tier,
            )
            if reason:
                raise HTTPException(status_code=503, detail=reason)
        llms = get_llms_by_role_from_config(
            provider=cfg.provider,
            model=cfg.model,
            api_key=cfg.api_key,
            base_url=cfg.base_url,
        )
        return ChatAgent(llm=llms["chat"]).reply(payload)
    return _get_chat_agent().reply(payload)


@app.get("/context-map/ui-url/{installation_id}", dependencies=_INTERNAL)
def context_map_ui_url(installation_id: int):
    try:
        url = get_or_start_ui(installation_id)
        return {"available": True, "url": url}
    except ContextMapUIError as exc:
        return {"available": False, "url": None, "reason": str(exc)}


@app.get("/context-map/graph/{installation_id}", dependencies=_INTERNAL)
def context_map_graph(installation_id: int):
    """Return the normalized code-graph JSON (GraphExport) for an installation's
    indexed repo, for the dashboard's Sensorium map. Mirrors the /context-map/
    ui-url envelope: honest {available: False} when nothing is indexed yet,
    never a fabricated graph."""
    try:
        return {"available": True, "graph": build_graph_export(installation_id)}
    except GraphExportError as exc:
        return {"available": False, "graph": None, "reason": str(exc)}


class IndexRequest(BaseModel):
    """A request to build the code map for one repo of an installation.

    The webhook service fires this the moment the Kuma app is installed on a
    repo (or a repo is added later), so the Sensorium code map is built on
    connect instead of only after the repo's first PR review."""

    installation_id: int
    repo_slug: str  # "owner/repo"
    clone_url: str  # "https://github.com/owner/repo.git"
    installation_token: str  # short-lived GitHub App installation token


def _index_installation_repo(req: IndexRequest) -> None:
    """Clone (or fast-forward) the repo and index it into the per-installation
    codebase-memory session that build_graph_export later queries. Fails OPEN:
    a fresh install must never surface an error just because its code map
    couldn't be built yet — the Sensorium simply stays in its honest empty
    state until a later index (this one retried, or the first review) succeeds."""
    try:
        repo_dir = ensure_repo_checked_out(
            req.clone_url,
            req.installation_token,
            req.installation_id,
            req.repo_slug,
        )
        index_repository(req.installation_id, repo_dir)
        _logger.info(
            "context-map: indexed %s for installation %s on connect",
            req.repo_slug,
            req.installation_id,
        )
    except (RepoCacheError, IndexerError) as exc:
        _logger.warning(
            "context-map: index-on-connect failed for %s (installation %s): %s",
            req.repo_slug,
            req.installation_id,
            exc,
        )


@app.post("/context-map/index", dependencies=_INTERNAL)
def context_map_index(req: IndexRequest, background: BackgroundTasks):
    """Trigger a code-map build for one repo. Returns immediately and does the
    clone+index in the background so the calling webhook handler stays fast;
    indexing itself fails open (see _index_installation_repo)."""
    background.add_task(_index_installation_repo, req)
    return {"accepted": True}
