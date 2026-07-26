"""fix.run span tree + arete.fix.* metrics (Phase 2 Task 14).

Spec §5 (frozen): `fix.run` is a root span in the same naming tree as
`review.run`/`scan.run`/`chat.turn`. Before this task fix_pipeline.py had no
span or metric instrumentation at all.

Test-isolation note: fix_pipeline resolves its tracer/meter via
arete_agents.observability.get_tracer/get_meter, imported by NAME into
fix_pipeline's module namespace. This lets us monkeypatch
`arete_agents.fix_pipeline.get_tracer`/`get_meter` to point at a private,
in-memory SDK provider WITHOUT ever calling the global
`opentelemetry.trace.set_tracer_provider()` -- that call is a process-wide
one-shot (a `Once()` guard) and would leak into every other test in the
session, exactly the trap test_span_scrubber.py already avoids by
constructing its own local TracerProvider instead of going through
`trace.get_tracer()`.
"""

import json
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from arete_agents import fix_pipeline
from arete_agents.config import Settings
from arete_agents.models.fix import FixItem, FixRepo, FixRequest

_FIXED_FILE_CONTENT = (
    "import { db } from '../data/db'\n"
    "export function reports(q) {\n"
    "  return db.raw('SELECT * FROM reports WHERE q = ?', [q])\n"
    "}\n"
)


def _checkout(tmp_path, installation_id=42, repo_slug="acme/shop"):
    repo_dir = tmp_path / str(installation_id) / repo_slug
    target = repo_dir / "app" / "api" / "reports.ts"
    target.parent.mkdir(parents=True)
    target.write_text(
        "import { db } from '../data/db'\n"
        "export function reports(q) {\n"
        "  return db.raw(q)\n"
        "}\n",
        encoding="utf-8",
    )
    return repo_dir


def _request(**overrides):
    base = dict(
        containerId="cont_1",
        installationId=42,
        repo=FixRepo(fullName="acme/shop", defaultBranch="main", token="tok"),
        item=FixItem(
            kind="issue",
            title="SQL built from raw request input",
            detail="reports() passes q straight into db.raw.",
            dimension="security",
            confidence=0.8,
            evidence=[{"path": "app/api/reports.ts", "line": 3, "excerpt": "db.raw(q)"}],
        ),
    )
    base.update(overrides)
    return FixRequest(**base)


def _author_reply(files, summary="fixed it"):
    llm = MagicMock()
    llm.with_retry.return_value = llm
    llm.invoke.return_value = AIMessage(content=json.dumps({"files": files, "summary": summary}))
    return llm


def _span_provider():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider, exporter


def _meter_provider():
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    return provider, reader


def _metric_points(reader, name):
    data = reader.get_metrics_data()
    if data is None:
        return []
    points = []
    for rm in data.resource_metrics:
        for sm in rm.scope_metrics:
            for metric in sm.metrics:
                if metric.name == name:
                    points.extend(metric.data.data_points)
    return points


def _run_fixed(tmp_path, monkeypatch, tracer_provider=None):
    provider, exporter = tracer_provider or _span_provider()
    monkeypatch.setattr(fix_pipeline, "get_tracer", lambda name: provider.get_tracer(name))

    checkout = _checkout(tmp_path)
    req = _request()
    llm = _author_reply([{"path": "app/api/reports.ts", "content": _FIXED_FILE_CONTENT, "isNew": False}])

    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
        "arete_agents.fix_pipeline.verify_resolved", return_value=True
    ):
        result = fix_pipeline.run_fix(
            req,
            {"security": llm},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )
    return result, exporter


# --- span tree ---------------------------------------------------------------


def test_fix_run_span_tree_for_a_fixed_drive(tmp_path, monkeypatch):
    result, exporter = _run_fixed(tmp_path, monkeypatch)

    assert result.status == "fixed"
    spans = exporter.get_finished_spans()
    names = {s.name for s in spans}
    assert names == {
        "fix.run",
        "fix.checkout",
        "fix.findings",
        "fix.evidence",
        "fix.author",
        "fix.ground_files",
        "fix.verify",
    }

    root = next(s for s in spans if s.name == "fix.run")
    children = [s for s in spans if s.name != "fix.run"]
    assert len(children) == 6
    for child in children:
        assert child.parent is not None, child.name
        assert child.parent.span_id == root.context.span_id, child.name
        assert child.context.trace_id == root.context.trace_id, child.name

    assert root.attributes["arete.fix.outcome"] == "fixed"
    assert root.attributes["arete.fix.stage"] == "complete"
    # Global Constraint 1: repo/container/installation ids are SPAN
    # attributes only -- fine here, forbidden on the metric (see below).
    assert root.attributes["arete.repo.full_name"] == "acme/shop"
    assert root.attributes["arete.container.id"] == "cont_1"


def test_fix_run_span_tree_stops_at_findings_gate_when_ungrounded(tmp_path, monkeypatch):
    provider, exporter = _span_provider()
    monkeypatch.setattr(fix_pipeline, "get_tracer", lambda name: provider.get_tracer(name))

    checkout = _checkout(tmp_path)
    # No excerpt -> from_fix_item drops the evidence entirely -> no grounded finding.
    req = _request(
        item=FixItem(
            kind="issue",
            title="t",
            detail="d",
            dimension="security",
            confidence=0.9,
            evidence=[{"path": "app/api/reports.ts", "line": 3}],
        )
    )

    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout):
        result = fix_pipeline.run_fix(
            req,
            {"security": MagicMock()},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )

    assert result.status == "fix_failed"
    assert result.reason == "no_grounded_findings"
    names = {s.name for s in exporter.get_finished_spans()}
    # The gate must reject BEFORE evidence read / author / ground / verify.
    assert names == {"fix.run", "fix.checkout", "fix.findings"}

    root = next(s for s in exporter.get_finished_spans() if s.name == "fix.run")
    assert root.attributes["arete.fix.outcome"] == "fix_failed"
    assert root.attributes["arete.fix.stage"] == "findings"


def test_fix_run_stage_tag_reflects_grounding_violation(tmp_path, monkeypatch):
    provider, exporter = _span_provider()
    monkeypatch.setattr(fix_pipeline, "get_tracer", lambda name: provider.get_tracer(name))

    checkout = _checkout(tmp_path)
    req = _request()
    # Path doesn't exist in the checkout and isn't marked new -> _ground_files violation.
    llm = _author_reply([{"path": "app/api/does-not-exist.ts", "content": "whatever", "isNew": False}])

    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout):
        result = fix_pipeline.run_fix(
            req,
            {"security": llm},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )

    assert result.status == "fix_failed"
    root = next(s for s in exporter.get_finished_spans() if s.name == "fix.run")
    assert root.attributes["arete.fix.stage"] == "ground_files"
    names = {s.name for s in exporter.get_finished_spans()}
    assert "fix.verify" not in names  # a grounding violation never reaches verification


# --- trace continuity across the ThreadPoolExecutor boundary ------------------


def test_fix_run_joins_the_callers_active_trace_not_an_orphan(tmp_path, monkeypatch):
    """run_fix bounds the whole drive in a ThreadPoolExecutor (the 280s wall-
    clock budget). concurrent.futures worker threads do NOT inherit the
    calling thread's contextvars context by default, so a fix.run span
    created naively inside that worker thread would start a brand-new trace
    -- exactly the orphan the brief's trace-continuity requirement warns
    against. This asserts fix.run lands in the SAME trace as whatever span
    was active on the calling thread (standing in for the webhook-side
    drive's incoming HTTP request span)."""
    provider, exporter = _span_provider()
    monkeypatch.setattr(fix_pipeline, "get_tracer", lambda name: provider.get_tracer(name))
    caller_tracer = provider.get_tracer("caller")

    checkout = _checkout(tmp_path)
    req = _request()
    llm = _author_reply([{"path": "app/api/reports.ts", "content": _FIXED_FILE_CONTENT, "isNew": False}])

    with caller_tracer.start_as_current_span("webhook.drive") as outer_span:
        outer_trace_id = outer_span.get_span_context().trace_id
        with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
            "arete_agents.fix_pipeline.verify_resolved", return_value=True
        ):
            fix_pipeline.run_fix(
                req,
                {"security": llm},
                verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
                repo_root=tmp_path,
            )

    fix_run_span = next(s for s in exporter.get_finished_spans() if s.name == "fix.run")
    assert fix_run_span.context.trace_id == outer_trace_id


# --- metrics: closed dimensions only (Global Constraint 1) --------------------


def test_fix_run_emits_closed_dimension_metrics_on_success(tmp_path, monkeypatch):
    tracer_provider, exporter = _span_provider()
    meter_provider, reader = _meter_provider()
    monkeypatch.setattr(fix_pipeline, "get_tracer", lambda name: tracer_provider.get_tracer(name))
    monkeypatch.setattr(fix_pipeline, "get_meter", lambda name: meter_provider.get_meter(name))

    checkout = _checkout(tmp_path)
    req = _request()
    llm = _author_reply([{"path": "app/api/reports.ts", "content": _FIXED_FILE_CONTENT, "isNew": False}])

    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
        "arete_agents.fix_pipeline.verify_resolved", return_value=True
    ):
        fix_pipeline.run_fix(
            req,
            {"security": llm},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )

    meter_provider.force_flush()
    runs = _metric_points(reader, "arete.fix.runs")
    assert len(runs) == 1
    attrs = dict(runs[0].attributes)
    assert attrs == {"outcome": "fixed", "stage": "complete"}
    # Cardinality rule (review-blocking): only closed low-cardinality keys —
    # never repo/container/installation identifiers on a metric.
    assert set(attrs) == {"outcome", "stage"}
    for forbidden in ("repo", "repo_full_name", "container_id", "installation_id", "item_id"):
        assert forbidden not in attrs

    durations = _metric_points(reader, "arete.fix.duration")
    assert len(durations) == 1
    assert dict(durations[0].attributes) == {"outcome": "fixed"}
    assert durations[0].sum >= 0


def test_fix_run_metrics_failure_never_fails_the_run(tmp_path, monkeypatch):
    """Global Constraint 3: telemetry must never take the app down. A broken
    metrics call must not swallow (or corrupt) the real FixResponse."""
    tracer_provider, exporter = _span_provider()
    monkeypatch.setattr(fix_pipeline, "get_tracer", lambda name: tracer_provider.get_tracer(name))

    def _boom(name):
        raise RuntimeError("meter provider exploded")

    monkeypatch.setattr(fix_pipeline, "get_meter", _boom)

    checkout = _checkout(tmp_path)
    req = _request()
    llm = _author_reply([{"path": "app/api/reports.ts", "content": _FIXED_FILE_CONTENT, "isNew": False}])

    with patch("arete_agents.fix_pipeline.ensure_repo_checked_out", return_value=checkout), patch(
        "arete_agents.fix_pipeline.verify_resolved", return_value=True
    ):
        result = fix_pipeline.run_fix(
            req,
            {"security": llm},
            verify_settings=Settings(llm_provider="anthropic", anthropic_api_key="sk-test"),
            repo_root=tmp_path,
        )

    assert result.status == "fixed"  # the real result survives a broken meter
    assert len(result.patch) == 1
