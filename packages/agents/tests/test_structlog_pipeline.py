"""structlog censor + bridge (§5: redaction at log-creation time, before every
sink; trace_id stamped on every log line inside a span)."""

import re

import structlog
from opentelemetry.sdk.trace import TracerProvider

from arete_agents.observability import (
    REDACTED,
    add_trace_context,
    censor_processor,
    configure_structlog,
)


def test_censor_blocks_keys_and_scrubs_values():
    # Bearer payload is >=8 chars: the canonical §5 pattern set (mirrored from
    # packages/telemetry/src/redaction.ts) requires that length so short human
    # words after "bearer" aren't false-positived. Real tokens are far longer;
    # see test_bearer_below_threshold_is_left_alone for the boundary.
    event = {
        "event": "llm call failed",
        "api_key": "sk-live1234567890",
        "detail": "retry with Bearer abc.defghij",
        "input_tokens": 42,
    }
    out = censor_processor(None, "info", dict(event))
    assert out["api_key"] == REDACTED
    assert "abc.defghij" not in out["detail"]
    assert REDACTED in out["detail"]
    assert out["input_tokens"] == 42  # token counts survive (§5 cardinality)


def test_bearer_below_threshold_is_left_alone():
    """Pins the deliberate §5 threshold: <8 chars after "bearer" is prose, not
    a credential. Documented so a future widening is a conscious choice."""
    out = censor_processor(None, "info", {"detail": "retry with Bearer abc.def"})
    assert out["detail"] == "retry with Bearer abc.def"


def test_trace_context_stamped_when_in_span():
    provider = TracerProvider()
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("review.run"):
        out = add_trace_context(None, "info", {"event": "x"})
    assert re.fullmatch(r"[0-9a-f]{32}", out["trace_id"])
    assert re.fullmatch(r"[0-9a-f]{16}", out["span_id"])


def test_no_trace_context_outside_span():
    out = add_trace_context(None, "info", {"event": "x"})
    assert "trace_id" not in out


def test_configure_structlog_bridges_to_stdlib(capsys):
    configure_structlog()
    structlog.get_logger("bridge-test").info("hello-bridge", component="server")
    err = capsys.readouterr().err
    assert "hello-bridge" in err
    assert '"component": "server"' in err


def test_configure_structlog_is_idempotent(capsys):
    configure_structlog()
    configure_structlog()
    structlog.get_logger("bridge-test").info("once-only")
    err = capsys.readouterr().err
    assert err.count("once-only") == 1  # no duplicate handlers
