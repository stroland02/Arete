"""§6 gate 2: canary secrets must never reach an exporter sink.

CANARY shapes match the §5 value patterns (sk-/ghp_/bearer). In-memory
exporters are the assertion point: they receive the same objects the OTLP
exporters serialize, so a pass here means the secret cannot leave the process.
"""

import logging

import pytest
import structlog
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

try:
    from opentelemetry.sdk.logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk.logs.export import (
        InMemoryLogExporter,
        SimpleLogRecordProcessor,
    )
except ImportError:  # pre-stable module layout (installed opentelemetry-sdk==1.44.0:
    # no opentelemetry.sdk.logs at all yet; InMemoryLogExporter lives directly on
    # opentelemetry.sdk._logs.export, not a nested .in_memory_log_exporter
    # submodule — mirrors the import style already used in observability.py)
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import (
        InMemoryLogExporter,
        SimpleLogRecordProcessor,
    )

from arete_agents.observability import (
    REDACTED,
    ScrubbingSpanProcessor,
    censor_processor,
)

SK_CANARY = "sk-canary1234567890abcdef"
GH_CANARY = "ghp_CANARYABCDEFGHIJKLMNOP1234"


def _span_sink() -> tuple[TracerProvider, InMemorySpanExporter]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(ScrubbingSpanProcessor())
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider, exporter


def _span_dump(exporter: InMemorySpanExporter) -> str:
    parts = []
    for span in exporter.get_finished_spans():
        parts.append(str(dict(span.attributes or {})))
        parts.append(str(span.status.description or ""))
        for event in span.events:
            parts.append(str(dict(event.attributes or {})))
    return " ".join(parts)


def test_canary_in_span_attribute_never_reaches_sink():
    provider, exporter = _span_sink()
    tracer = provider.get_tracer("canary")
    with tracer.start_as_current_span("llm.generate") as span:
        span.set_attribute("anthropic_api_key", SK_CANARY)  # blocked key
        span.set_attribute("note", f"retrying with {GH_CANARY}")  # value shape
    dump = _span_dump(exporter)
    assert SK_CANARY not in dump
    assert GH_CANARY not in dump
    assert REDACTED in dump


def test_canary_in_raised_exception_never_reaches_sink():
    provider, exporter = _span_sink()
    tracer = provider.get_tracer("canary")
    with pytest.raises(RuntimeError):
        with tracer.start_as_current_span("llm.generate"):
            raise RuntimeError(f"provider rejected key {SK_CANARY}")
    dump = _span_dump(exporter)
    assert SK_CANARY not in dump
    assert REDACTED in dump


def test_canary_in_log_line_never_reaches_sink():
    exporter = InMemoryLogExporter()
    provider = LoggerProvider()
    provider.add_log_record_processor(SimpleLogRecordProcessor(exporter))
    handler = LoggingHandler(level=logging.INFO, logger_provider=provider)
    stdlib_logger = logging.getLogger("canary-log-test")
    stdlib_logger.addHandler(handler)
    stdlib_logger.setLevel(logging.INFO)
    # DEVIATION (documented): the brief's exact code restores via
    # `structlog.reset_defaults()`, but that resets structlog's GLOBAL config
    # to the library's bare defaults, not to whatever configure_structlog()
    # (observability.py) may already have installed earlier in the test
    # session. Since configure_structlog() is deliberately idempotent
    # (_STRUCTLOG_CONFIGURED guard) it never re-runs once wiped, so
    # reset_defaults() here permanently broke test_structlog_pipeline.py
    # later in the same pytest session (order-dependent pollution — 2
    # failures, `hello-bridge` / `once-only` no longer reaching capsys).
    # Snapshotting and restoring the actual prior config is a faithful
    # "restore", not a reset to a different config.
    previous_config = structlog.get_config()
    try:
        # structlog path: censor runs before the stdlib bridge hands the
        # event to ANY handler — including the OTel one.
        structlog.configure(
            processors=[
                censor_processor,
                structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
            ],
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=False,
        )
        structlog.get_logger("canary-log-test").info(
            "provider call failed",
            api_key=SK_CANARY,
            detail=f"bearer {SK_CANARY}",
        )
    finally:
        stdlib_logger.removeHandler(handler)
        structlog.configure(**previous_config)

    dump = " ".join(
        str(data.log_record.body) + str(dict(data.log_record.attributes or {}))
        for data in exporter.get_finished_logs()
    )
    assert SK_CANARY not in dump
    assert REDACTED in dump
