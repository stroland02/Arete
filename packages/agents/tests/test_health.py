"""GET /health (spec §3 exit criteria: /health on all three services; agents'
excluded from tracing)."""

import importlib

from fastapi.testclient import TestClient

from arete_agents.server import app


def test_health_returns_ok():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_fastapi_instrumented_with_health_excluded(monkeypatch):
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    captured: dict = {}

    def fake_instrument_app(app, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(
        FastAPIInstrumentor, "instrument_app", staticmethod(fake_instrument_app)
    )
    import arete_agents.server as server

    importlib.reload(server)
    assert captured["excluded_urls"] == "health"
