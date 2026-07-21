"""Single OpenTelemetry bootstrap + redaction point for arete-agents.

Owns (obs spec §5/§7, Lane B): redaction primitives, the in-process span
scrubber, the structlog censor/bridge (Task 7), histogram Views, and
init_observability() (Task 5). server.py calls init_observability() exactly
once at import time — inside the uvicorn worker process.
"""

from __future__ import annotations

import atexit
import logging
import os
import re
import sys
import uuid
from importlib import metadata as importlib_metadata

import structlog
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.status import Status

try:  # Logs SDK is stable in 1.44; keep the pre-stable path importable too.
    from opentelemetry.sdk.logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk.logs.export import BatchLogRecordProcessor
except ImportError:  # pragma: no cover - older module layout
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry._logs import set_logger_provider

_logger = logging.getLogger(__name__)

# --- §5 redaction conventions (FROZEN — spec amendment required to change) ---

REDACTED = "[REDACTED]"

BLOCKLIST_KEYS: tuple[str, ...] = (
    "authorization",
    "x-api-key",
    "api_key",
    "token",
    "secret",
    "password",
    "cookie",
    "set-cookie",
)

# Blocked keys match as whole '-'/'_'/'.'-delimited segments, never bare
# substrings: "gen_ai.usage.input_tokens" must NOT match "token".
_BLOCKED_KEY_RES: tuple[re.Pattern[str], ...] = tuple(
    re.compile(rf"(?:^|[^a-z0-9])({re.escape(key)})(?:$|[^a-z0-9])")
    for key in BLOCKLIST_KEYS
)

# Value patterns (§5): bearer tokens, sk-/ghs_/ghp_-style key shapes,
# [?&]key= / [?&]api_key= in URLs.
_VALUE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=\-]+"), REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}\b"), REDACTED),
    (re.compile(r"\bgh[ps]_[A-Za-z0-9]{16,}\b"), REDACTED),
    (re.compile(r"(?i)([?&](?:api_)?key=)[^&#\s]+"), r"\1" + REDACTED),
)

_URL_ATTR_KEYS = ("http.url", "url.full")


def scrub_text(value: str) -> str:
    """Mask every §5 secret-shaped substring in ``value``."""
    for pattern, replacement in _VALUE_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def is_blocked_key(key: str) -> bool:
    """True when ``key`` contains a §5 blocklisted name as a whole segment."""
    lowered = key.lower()
    return any(regex.search(lowered) for regex in _BLOCKED_KEY_RES)


class ScrubbingSpanProcessor(SpanProcessor):
    """In-process span scrubber (§5: redaction at every sink).

    Registered FIRST on the TracerProvider so on_end mutates the span before
    the (later-registered) batch processor hands it to the OTLP exporter.
    Scrubs: URL query strings on http.url/url.full (the Superlog Gemini
    ``?key=`` incident class), blocklisted attribute keys, secret-shaped
    values in string attributes, exception-event attributes, and the span
    status description. Never raises — a scrubbing bug loses the scrub for
    that span, never the span pipeline or the app.
    """

    def on_start(self, span, parent_context=None) -> None:  # pragma: no cover
        pass

    def on_end(self, span: ReadableSpan) -> None:
        try:
            if span._attributes:
                span._attributes = {
                    key: self._scrub_attribute(key, value)
                    for key, value in span._attributes.items()
                }
            for event in span._events:
                if event.attributes:
                    event._attributes = {
                        key: self._scrub_attribute(key, value)
                        for key, value in event.attributes.items()
                    }
            status = span._status
            if status is not None and status.description:
                scrubbed = scrub_text(status.description)
                if scrubbed != status.description:
                    span._status = Status(status.status_code, scrubbed)
        except Exception:
            _logger.warning(
                "span scrubber failed; span exported unscrubbed", exc_info=True
            )

    @staticmethod
    def _scrub_attribute(key: str, value):
        if is_blocked_key(key):
            return REDACTED
        if isinstance(value, str):
            if key in _URL_ATTR_KEYS:
                return value.split("?", 1)[0]
            return scrub_text(value)
        if isinstance(value, (list, tuple)):
            return tuple(
                (
                    (element.split("?", 1)[0] if key in _URL_ATTR_KEYS else scrub_text(element))
                    if isinstance(element, str)
                    else element
                )
                for element in value
            )
        return value

    def shutdown(self) -> None:  # pragma: no cover
        pass

    def force_flush(self, timeout_millis: int = 30_000) -> bool:  # pragma: no cover
        return True


# --- bootstrap -------------------------------------------------------------

SERVICE_NAME_VALUE = "arete-agents"  # §5 frozen

LLM_DURATION_BOUNDARIES: tuple[float, ...] = (
    1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 180.0, 300.0,
)

_INITIALIZED = False


def get_tracer(name: str) -> trace.Tracer:
    """Module-scope safe: before init this is a ProxyTracer that upgrades
    automatically once init_observability() installs the real provider."""
    return trace.get_tracer(name)


def get_meter(name: str) -> metrics.Meter:
    """Module-scope safe (ProxyMeter; see get_tracer)."""
    return metrics.get_meter(name)


def _build_resource() -> Resource:
    try:
        service_version = importlib_metadata.version("arete-agents")
    except importlib_metadata.PackageNotFoundError:  # editable/dev checkout
        service_version = "0.0.0-dev"
    return Resource.create(
        {
            "service.name": SERVICE_NAME_VALUE,
            "service.version": service_version,
            # §5: default development; "production" only when explicitly set.
            "deployment.environment.name": os.getenv(
                "DEPLOYMENT_ENVIRONMENT", "development"
            ),
            "service.instance.id": str(uuid.uuid4()),
        }
    )


def _histogram_views() -> list[View]:
    """Explicit boundaries to 300s for LLM/review durations — the default
    10s ceiling silently corrupts p95/p99 (Superlog's latent defect)."""
    return [
        View(
            instrument_name=name,
            aggregation=ExplicitBucketHistogramAggregation(
                boundaries=list(LLM_DURATION_BOUNDARIES)
            ),
        )
        for name in (
            "gen_ai.client.operation.duration",
            "arete.review.duration",
            "arete.agent.duration",
        )
    ]


def _instrument_llm_layers() -> None:
    """Instrument the LLM stack — exactly one hook per layer (§4):

    * Provider-SDK layer: official contrib genai instrumentations. Emits
      llm client spans with gen_ai.provider.name (NOT deprecated
      gen_ai.system), gen_ai.usage.input_tokens / output_tokens, and the
      gen_ai.client.operation.duration histogram (bucketed by our Views).
      Ollama and OpenRouter ride the openai-v2 hook via their
      OpenAI-compatible endpoints (see llm/ollama.py, llm/openai.py).
    * Orchestration layer: Traceloop's LangChain callback instrumentation —
      LangGraph node/graph structure only. Traceloop's own provider-level
      packages must NEVER be installed alongside the contrib ones (duplicate
      spans; review-blocking).

    Content capture stays OFF for every layer: OTEL_INSTRUMENTATION_GENAI_
    CAPTURE_MESSAGE_CONTENT=false covers the openai-v2/google-genai contrib
    instrumentations; the Traceloop-lineage packages (anthropic, langchain)
    instead gate on TRACELOOP_TRACE_CONTENT, which is also forced to "false"
    in init_observability (it defaults to "true" when unset). Token counts
    and metadata only, on every layer.
    Each hook is wrapped separately — a broken instrumentation loses that
    layer's spans, never the service.
    """
    try:
        from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor

        AnthropicInstrumentor().instrument()
    except Exception:
        _logger.warning("anthropic instrumentation unavailable", exc_info=True)
    try:
        from opentelemetry.instrumentation.google_genai import (
            GoogleGenAiSdkInstrumentor,
        )

        GoogleGenAiSdkInstrumentor().instrument()
    except Exception:
        _logger.warning("google-genai instrumentation unavailable", exc_info=True)
    try:
        from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor

        OpenAIInstrumentor().instrument()
    except Exception:
        _logger.warning("openai instrumentation unavailable", exc_info=True)
    try:
        from opentelemetry.instrumentation.langchain import LangchainInstrumentor

        LangchainInstrumentor().instrument()
    except Exception:
        _logger.warning("langchain instrumentation unavailable", exc_info=True)


def _init_providers(endpoint: str) -> None:
    base = endpoint.rstrip("/")
    resource = _build_resource()

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(ScrubbingSpanProcessor())  # FIRST: scrub
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{base}/v1/traces"))
    )
    trace.set_tracer_provider(tracer_provider)

    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[
            PeriodicExportingMetricReader(
                OTLPMetricExporter(endpoint=f"{base}/v1/metrics")
            )
        ],
        views=_histogram_views(),
    )
    metrics.set_meter_provider(meter_provider)

    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(
        BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{base}/v1/logs"))
    )
    set_logger_provider(logger_provider)
    # ORDERING (load-bearing): this handler lands on the root logger AFTER any
    # code that clears root handlers (nothing in arete_agents does today — keep
    # it that way) and BEFORE configure_structlog() installs the
    # ProcessorFormatter bridge, so both console and OTLP sinks see every
    # (already-censored) record.
    root = logging.getLogger()
    root.addHandler(LoggingHandler(level=logging.INFO, logger_provider=logger_provider))
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

    def _shutdown() -> None:
        # Flush at exit so short-lived runs (CLI, tests) keep the tail.
        for provider in (tracer_provider, meter_provider, logger_provider):
            try:
                provider.shutdown()
            except Exception:  # pragma: no cover - best effort at exit
                pass

    atexit.register(_shutdown)


def init_observability() -> None:
    """Idempotent, never-raises telemetry bootstrap.

    Called from server.py at import time, which under
    ``uvicorn arete_agents.server:app`` executes inside the worker process —
    required: BatchSpanProcessor/PeriodicExportingMetricReader threads must be
    created in the serving process, never a parent that forks.

    Env contract (shared seam, .env.example):
      OTEL_SDK_DISABLED             "true" -> graceful no-op (one INFO line),
                                     checked first, same contract as the TS lane
      OTEL_EXPORTER_OTLP_ENDPOINT   unset -> graceful no-op (one INFO line)
      DEPLOYMENT_ENVIRONMENT        -> deployment.environment.name resource attr
    """
    global _INITIALIZED
    if _INITIALIZED:
        return
    _INITIALIZED = True

    # Kill switch first (§ TS lane parity): OTEL_SDK_DISABLED === 'true' is the
    # very first check on the TS side and no-ops before touching anything else.
    if os.environ.get("OTEL_SDK_DISABLED") == "true":
        _logger.info("OTEL_SDK_DISABLED is true; running without telemetry (no-op).")
        return

    # gen_ai semconv opt-in + content capture OFF (§5) — set before any
    # instrumentation reads them, even in the no-op path so a later manual
    # init can't accidentally capture prompt bodies.
    os.environ.setdefault(
        "OTEL_SEMCONV_STABILITY_OPT_IN", "gen_ai_latest_experimental"
    )
    os.environ.setdefault(
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "false"
    )
    # The Traceloop-lineage instrumentors (anthropic, langchain) don't read the
    # genai capture var above — they gate on TRACELOOP_TRACE_CONTENT, which
    # defaults to "true" when unset (opentelemetry-instrumentation-*'s own
    # utils.py: `os.getenv(TRACELOOP_TRACE_CONTENT) or "true"`). Force it off
    # here so prompt/completion bodies stay OFF across both instrumentation
    # lineages, not just openai-v2 + google-genai.
    os.environ.setdefault("TRACELOOP_TRACE_CONTENT", "false")

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        _logger.info(
            "OTEL_EXPORTER_OTLP_ENDPOINT is not set; running without telemetry "
            "export (no-op providers)."
        )
        return

    try:
        _init_providers(endpoint)
        _instrument_llm_layers()
        _logger.info("observability initialized; OTLP/HTTP -> %s", endpoint)
    except Exception:
        # Telemetry must never take the app down: one warning, run dark.
        _logger.warning(
            "observability init failed; continuing without telemetry",
            exc_info=True,
        )


# --- structlog pipeline ----------------------------------------------------

_STRUCTLOG_CONFIGURED = False


class _LiveStderr:
    """Forwards writes to whatever `sys.stderr` currently is, instead of
    binding to one stream object at handler-construction time.

    DEVIATION (documented): plain `logging.StreamHandler()` captures
    `sys.stderr` once, at construction. That is fine in production (stderr
    never changes underneath a running process) but breaks under pytest's
    `capsys`, which swaps/closes `sys.stderr` per test — the console handler
    survives across tests via configure_structlog()'s own idempotency, so a
    handler built during one test would write to a closed stream in the
    next, corrupting output. Resolving `sys.stderr` per write keeps identical
    real-world behavior while staying correct under capsys.
    """

    def write(self, message: str) -> None:
        sys.stderr.write(message)

    def flush(self) -> None:
        sys.stderr.flush()


def censor_processor(logger, method_name, event_dict):
    """§5 redaction at log-creation time. Runs BEFORE any renderer or the
    stdlib bridge, so secrets never reach console, file, or the OTLP
    LoggingHandler — every sink sees only the censored event_dict."""
    for key in list(event_dict):
        value = event_dict[key]
        if is_blocked_key(key):
            event_dict[key] = REDACTED
        elif isinstance(value, str):
            event_dict[key] = scrub_text(value)
    return event_dict


def add_trace_context(logger, method_name, event_dict):
    """Stamp trace_id/span_id (spec §3: every log line carries trace_id when
    in a span). The OTel LoggingHandler adds them to the OTLP record on its
    own; this makes the console/file JSON carry them too."""
    ctx = trace.get_current_span().get_span_context()
    if ctx.is_valid:
        event_dict["trace_id"] = format(ctx.trace_id, "032x")
        event_dict["span_id"] = format(ctx.span_id, "016x")
    return event_dict


def configure_structlog() -> None:
    """structlog -> stdlib ProcessorFormatter bridge -> root handlers.

    ORDERING (load-bearing): call AFTER init_observability() — the OTel
    LoggingHandler must already sit on the root logger; this function only
    ADDS a console handler and never clears existing root handlers. Existing
    logging.getLogger() call sites flow through foreign_pre_chain, so they are
    censored and trace-stamped identically.
    """
    global _STRUCTLOG_CONFIGURED
    if _STRUCTLOG_CONFIGURED:
        return
    _STRUCTLOG_CONFIGURED = True

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        censor_processor,  # before ANY renderer/bridge (§5)
        add_trace_context,
        structlog.processors.TimeStamper(fmt="iso"),
    ]

    structlog.configure(
        processors=shared_processors
        + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )
    console_handler = logging.StreamHandler(_LiveStderr())  # see _LiveStderr
    console_handler.setFormatter(formatter)
    root = logging.getLogger()
    root.addHandler(console_handler)
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)
