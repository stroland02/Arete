"""In-process span scrubber (§5 redaction, all sinks; Phase-1 gate precursor).

Uses a real TracerProvider + InMemorySpanExporter: what these tests see is
byte-for-byte what the OTLP exporter would serialize.
"""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from arete_agents.observability import (
    REDACTED,
    ScrubbingSpanProcessor,
    is_blocked_key,
    scrub_text,
)


def _provider_with_scrubber() -> tuple[TracerProvider, InMemorySpanExporter]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(ScrubbingSpanProcessor())  # FIRST: scrub
    provider.add_span_processor(SimpleSpanProcessor(exporter))  # then export
    return provider, exporter


def test_scrub_text_masks_secret_shapes():
    assert REDACTED in scrub_text("auth used Bearer abc.def-ghi")
    assert "sk-live1234567890" not in scrub_text("key sk-live1234567890 leaked")
    assert "ghp_ABCDEFGHIJKLMNOP1234" not in scrub_text("token ghp_ABCDEFGHIJKLMNOP1234")
    assert scrub_text("https://x.test/v1?key=AIzaSECRET&x=1") == (
        "https://x.test/v1?key=" + REDACTED + "&x=1"
    )
    assert scrub_text("no secrets here") == "no secrets here"


def test_blocked_keys_match_segments_not_substrings():
    assert is_blocked_key("http.request.header.authorization")
    assert is_blocked_key("gemini_api_key")
    assert is_blocked_key("set-cookie")
    # §5 cardinality/token-count attrs must NOT be redacted:
    assert not is_blocked_key("gen_ai.usage.input_tokens")
    assert not is_blocked_key("gen_ai.usage.output_tokens")
    assert not is_blocked_key("max_tokens")


def test_url_attributes_lose_query_strings():
    provider, exporter = _provider_with_scrubber()
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("llm.generate") as span:
        span.set_attribute(
            "url.full",
            "https://generativelanguage.googleapis.com/v1beta/models?key=AIzaFAKE123",
        )
        span.set_attribute("http.url", "https://api.example.test/chat?api_key=SECRET")
    [finished] = exporter.get_finished_spans()
    assert finished.attributes["url.full"] == (
        "https://generativelanguage.googleapis.com/v1beta/models"
    )
    assert finished.attributes["http.url"] == "https://api.example.test/chat"


def test_blocked_attribute_key_is_redacted_but_token_counts_survive():
    provider, exporter = _provider_with_scrubber()
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("llm.generate") as span:
        span.set_attribute("http.request.header.authorization", "Bearer abc123")
        span.set_attribute("gen_ai.usage.input_tokens", 123)
    [finished] = exporter.get_finished_spans()
    assert finished.attributes["http.request.header.authorization"] == REDACTED
    assert finished.attributes["gen_ai.usage.input_tokens"] == 123


def test_array_attribute_values_are_scrubbed():
    provider, exporter = _provider_with_scrubber()
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("llm.generate") as span:
        span.set_attribute(
            "gen_ai.request.headers",
            ["Bearer sk-EXTREMELYSECRET12345", "no secrets here"],
        )
    [finished] = exporter.get_finished_spans()
    headers = finished.attributes["gen_ai.request.headers"]
    assert "sk-EXTREMELYSECRET12345" not in "".join(headers)
    assert REDACTED in headers[0]
    assert headers[1] == "no secrets here"


def test_exception_event_and_status_are_scrubbed():
    provider, exporter = _provider_with_scrubber()
    tracer = provider.get_tracer("test")
    with pytest.raises(RuntimeError):
        with tracer.start_as_current_span("llm.generate"):
            raise RuntimeError("call failed for key sk-EXTREMELYSECRET12345")
    [finished] = exporter.get_finished_spans()
    [event] = [e for e in finished.events if e.name == "exception"]
    assert "sk-EXTREMELYSECRET12345" not in event.attributes["exception.message"]
    assert REDACTED in event.attributes["exception.message"]
    assert "sk-EXTREMELYSECRET12345" not in (finished.status.description or "")
