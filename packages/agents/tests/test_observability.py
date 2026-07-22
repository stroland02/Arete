"""init_observability(): env-driven, graceful no-op, never-crash (spec §3:
'Telemetry must never take the app down')."""

import logging
import os

import arete_agents.observability as obs


def _reset(monkeypatch):
    monkeypatch.setattr(obs, "_INITIALIZED", False)


def test_noop_when_endpoint_unset(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    installed = []
    monkeypatch.setattr(obs, "_init_providers", lambda endpoint: installed.append(endpoint))
    obs.init_observability()
    assert installed == []  # no providers, no exporters, no threads


def test_init_never_raises_on_broken_provider_setup(monkeypatch, caplog):
    _reset(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")

    def boom(endpoint):
        raise RuntimeError("exporter exploded")

    monkeypatch.setattr(obs, "_init_providers", boom)
    with caplog.at_level(logging.WARNING):
        obs.init_observability()  # must not raise
    assert "continuing without telemetry" in caplog.text


def test_init_is_idempotent(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    calls = []
    monkeypatch.setattr(obs, "_init_providers", lambda endpoint: calls.append(endpoint))
    monkeypatch.setattr(obs, "_instrument_llm_layers", lambda: None)
    obs.init_observability()
    obs.init_observability()
    assert calls == ["http://localhost:4318"]


def test_genai_env_contract(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.delenv("OTEL_SEMCONV_STABILITY_OPT_IN", raising=False)
    monkeypatch.delenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", raising=False)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    monkeypatch.setattr(obs, "_init_providers", lambda endpoint: None)
    monkeypatch.setattr(obs, "_instrument_llm_layers", lambda: None)
    obs.init_observability()
    assert os.environ["OTEL_SEMCONV_STABILITY_OPT_IN"] == "gen_ai_latest_experimental"
    # §5: prompt/completion content OFF — token counts and metadata only.
    assert os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] == "false"


def test_noop_when_sdk_disabled(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    installed = []
    monkeypatch.setattr(obs, "_init_providers", lambda endpoint: installed.append(endpoint))
    obs.init_observability()  # must not raise
    assert installed == []  # no providers, no exporters, no threads


def test_content_capture_forced_off_for_traceloop_instrumentors(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.delenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", raising=False)
    monkeypatch.delenv("TRACELOOP_TRACE_CONTENT", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    obs.init_observability()
    # §5: prompt/completion content OFF for the Traceloop-lineage instrumentors
    # (anthropic, langchain) too — they gate on TRACELOOP_TRACE_CONTENT, which
    # defaults to "true" when unset, not the genai capture var above.
    assert os.environ["TRACELOOP_TRACE_CONTENT"] == "false"
    assert os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] == "false"


def test_resource_attributes_follow_frozen_conventions(monkeypatch):
    monkeypatch.delenv("DEPLOYMENT_ENVIRONMENT", raising=False)
    attrs = obs._build_resource().attributes
    assert attrs["service.name"] == "arete-agents"
    assert attrs["deployment.environment.name"] == "development"
    assert attrs["service.version"]
    assert attrs["service.instance.id"]


def test_histogram_views_use_llm_boundaries():
    views = obs._histogram_views()
    names = {view._instrument_name for view in views}
    assert names == {
        "gen_ai.client.operation.duration",
        "arete.review.duration",
        "arete.agent.duration",
        "arete.fix.duration",
    }
    for view in views:
        assert view._aggregation._boundaries == list(obs.LLM_DURATION_BOUNDARIES)


def test_get_tracer_and_meter_safe_before_init():
    # ProxyTracer/ProxyMeter semantics: acquiring at module scope before init
    # is safe and upgrades automatically after init_observability().
    tracer = obs.get_tracer("module-scope-test")
    meter = obs.get_meter("module-scope-test")
    with tracer.start_as_current_span("noop"):
        pass
    meter.create_counter("arete.test.counter").add(1)


def test_resource_omits_project_id_when_self_id_unset(monkeypatch):
    monkeypatch.delenv("ARETE_SELF_PROJECT_ID", raising=False)
    resource = obs._build_resource()
    assert "superlog.project_id" not in resource.attributes


def test_resource_stamps_project_id_for_self_dogfooding(monkeypatch):
    monkeypatch.setenv("ARETE_SELF_PROJECT_ID", "11111111-1111-4111-8111-111111111111")
    resource = obs._build_resource()
    assert resource.attributes["superlog.project_id"] == (
        "11111111-1111-4111-8111-111111111111"
    )
