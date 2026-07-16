import logging
from typing import Any, Dict

from fastapi import BackgroundTasks, FastAPI
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from arete_agents.agents.chat import ChatAgent
from arete_agents.config import get_settings
from arete_agents.context_map.graph_export import GraphExportError, build_graph_export
from arete_agents.context_map.indexer import IndexerError, index_repository
from arete_agents.context_map.repo_cache import RepoCacheError, ensure_repo_checked_out
from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui

_logger = logging.getLogger(__name__)
from arete_agents.llm.base import get_llms_by_role, role_tiers
from arete_agents.models.pr import PRContext
from arete_agents.orchestrator import ReviewOrchestrator

app = FastAPI()

# OpenTelemetry Auto-Instrumentation
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource, SERVICE_NAME

# Set up the tracer provider with service name
resource = Resource(attributes={SERVICE_NAME: "arete-agents"})
provider = TracerProvider(resource=resource)

# Export traces to the OTel Collector in the infra stack
# The infra docker-compose sets up the collector at localhost:4317
otlp_exporter = OTLPSpanExporter(endpoint="http://localhost:4317", insecure=True)
processor = BatchSpanProcessor(otlp_exporter)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

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


def _require_llm_config():
    try:
        return get_settings()
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
        settings = _require_llm_config()
        _orchestrator = ReviewOrchestrator(
            llm=get_llms_by_role(settings), tiers=role_tiers(settings)
        )
    return _orchestrator


def _get_chat_agent() -> ChatAgent:
    global _chat_agent
    if _chat_agent is None:
        settings = _require_llm_config()
        _chat_agent = ChatAgent(llm=get_llms_by_role(settings)["chat"])
    return _chat_agent


@app.post("/review")
def review(pr: PRContext):
    return _get_orchestrator().run(pr)


@app.post("/chat")
def chat(context: Dict[str, Any]):
    return _get_chat_agent().reply(context)


@app.get("/context-map/ui-url/{installation_id}")
def context_map_ui_url(installation_id: int):
    try:
        url = get_or_start_ui(installation_id)
        return {"available": True, "url": url}
    except ContextMapUIError as exc:
        return {"available": False, "url": None, "reason": str(exc)}


@app.get("/context-map/graph/{installation_id}")
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


@app.post("/context-map/index")
def context_map_index(req: IndexRequest, background: BackgroundTasks):
    """Trigger a code-map build for one repo. Returns immediately and does the
    clone+index in the background so the calling webhook handler stays fast;
    indexing itself fails open (see _index_installation_repo)."""
    background.add_task(_index_installation_repo, req)
    return {"accepted": True}
