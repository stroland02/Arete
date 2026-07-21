"""Per-signal OTLP verification harness (obs spec §5 'Verification').

Part A drives one span, one metric batch, and one log through the REAL
bootstrap (init_observability + force_flush) — proving the in-process
pipeline end-to-end. Part B posts one minimal raw OTLP/HTTP payload per
endpoint and inspects status code AND partialSuccess, because the SDK
exporters hide the HTTP response and a 200 can still drop records.

Usage (collector up via `pnpm infra:up`):
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
        uv run python scripts/verify_telemetry.py

Timing / worst-case duration when the collector is DOWN (nothing listening
on the configured port, e.g. connection refused):
    The OTLP/HTTP exporters (opentelemetry-exporter-otlp-proto-http 1.44.0)
    retry with exponential backoff (1s, 2s, 4s, ...) up to a per-exporter
    deadline set by the exporter's own `timeout` (seconds), which this
    script bounds via OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_TIMEOUT
    (default 3s each, overridable by the caller) — NOT by the
    force_flush(timeout_millis=...) argument below. As of SDK 1.44.0,
    BatchSpanProcessor/BatchLogRecordProcessor.force_flush() ignores its
    timeout_millis entirely (a known upstream gap, see
    open-telemetry/opentelemetry-python#4568) and PeriodicExportingMetricReader
    threads timeout_millis through to the exporter but the exporter still
    computes its retry deadline from its own constructor `timeout`, not the
    passed value. We pass force_flush(timeout_millis=...) anyway for
    forward-compatibility once that upstream gap is fixed, but the actual
    bound today comes entirely from the exporter timeout env vars set
    below, which cut the number of exponential-backoff retries the
    exporter will attempt before giving up.

    Measured on this repo's Windows dev sandbox (connection actively
    refused on 127.0.0.1/localhost:4318, nothing listening): baseline
    (unbounded 10s-per-exporter default) ~68.6s wall time; with this fix
    (3s-per-exporter bound) ~50s wall time — a real reduction, but not
    "well under 30s" on THIS box, because Windows' TCP stack takes an
    unusually long ~2-4s to fail a single connect() to a refused port
    (confirmed by timing bare `requests.post()` calls against the same
    dead port, independent of any OTel code), and the OTLP exporter's
    `_export()` makes that same connect attempt TWICE per try (an
    unconditional inline retry-once-on-ConnectionError inside the SDK,
    separate from the outer backoff loop this timeout bounds) — so a
    single attempt alone can already cost ~8s here regardless of the
    configured timeout. On a typical Linux CI runner a refused connection
    fails in microseconds, so the same bounded-timeout fix should bring
    the collector-down path to low single-digit seconds there, not ~50s.
    Do not be surprised if this script takes tens of seconds to fail on
    Windows specifically; that latency is an OS/network-stack property of
    the sandbox it was measured on, not something this script's config
    can eliminate — the fix still meaningfully shrinks retry count and
    is the correct, minimal change available from this script alone.
Exit 0 = every signal accepted with zero rejections. Never exits 0 otherwise.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import urllib.request

from opentelemetry import metrics, trace

from arete_agents.observability import get_meter, get_tracer, init_observability

_TRACE_ID = "3f0f0af31da8e4b1e1b5b1d2c3d4e5f6"
_SPAN_ID = "00f067aa0ba902b7"

# Bounds the OTLP exporters' own retry-backoff deadline (seconds). This is
# the ONLY thing that actually caps wall time on a down collector — see the
# module docstring for why force_flush(timeout_millis=...) alone does not.
# setdefault() so a caller who has already set these explicitly is respected.
_EXPORT_TIMEOUT_SECONDS = "3"


def _bound_exporter_timeouts() -> None:
    for var in (
        "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT",
        "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT",
        "OTEL_EXPORTER_OTLP_LOGS_TIMEOUT",
    ):
        os.environ.setdefault(var, _EXPORT_TIMEOUT_SECONDS)


def _drive_through_bootstrap() -> None:
    _bound_exporter_timeouts()
    init_observability()
    tracer = get_tracer("verify_telemetry")
    with tracer.start_as_current_span("verify.bootstrap") as span:
        span.set_attribute("verify.signal", "traces")
        logging.getLogger("verify_telemetry").info("verify.bootstrap log line")
    meter = get_meter("verify_telemetry")
    meter.create_histogram(
        "arete.review.duration", unit="s"
    ).record(1.5, {"outcome": "verify"})
    trace.get_tracer_provider().force_flush(timeout_millis=5_000)
    metrics.get_meter_provider().force_flush(timeout_millis=5_000)


def _post(base: str, path: str, payload: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read()
        return resp.status, (json.loads(body) if body else {})


def _payloads() -> dict[str, dict]:
    now = time.time_ns()
    resource = {
        "attributes": [
            {"key": "service.name", "value": {"stringValue": "arete-agents-verify"}}
        ]
    }
    return {
        "/v1/traces": {
            "resourceSpans": [{
                "resource": resource,
                "scopeSpans": [{
                    "scope": {"name": "verify"},
                    "spans": [{
                        "traceId": _TRACE_ID,
                        "spanId": _SPAN_ID,
                        "name": "verify.raw",
                        "kind": 1,
                        "startTimeUnixNano": str(now - 1_000_000),
                        "endTimeUnixNano": str(now),
                    }],
                }],
            }]
        },
        "/v1/logs": {
            "resourceLogs": [{
                "resource": resource,
                "scopeLogs": [{
                    "scope": {"name": "verify"},
                    "logRecords": [{
                        "timeUnixNano": str(now),
                        "severityNumber": 9,
                        "severityText": "INFO",
                        "body": {"stringValue": "verify.raw log record"},
                    }],
                }],
            }]
        },
        "/v1/metrics": {
            "resourceMetrics": [{
                "resource": resource,
                "scopeMetrics": [{
                    "scope": {"name": "verify"},
                    "metrics": [{
                        "name": "arete.verify.gauge",
                        "gauge": {"dataPoints": [{
                            "timeUnixNano": str(now),
                            "asDouble": 1.0,
                        }]},
                    }],
                }],
            }]
        },
    }


_REJECTION_KEYS = ("rejectedSpans", "rejectedLogRecords", "rejectedDataPoints")


def main() -> int:
    base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip().rstrip("/")
    if not base:
        print("FAIL: OTEL_EXPORTER_OTLP_ENDPOINT is not set", file=sys.stderr)
        return 2

    _drive_through_bootstrap()

    failures = 0
    for path, payload in _payloads().items():
        try:
            status, body = _post(base, path, payload)
        except Exception as exc:  # unreachable endpoint IS the finding
            print(f"FAIL POST {path} -> {exc}")
            failures += 1
            continue
        partial = body.get("partialSuccess", {})
        rejected = {k: v for k, v in partial.items() if k in _REJECTION_KEYS and int(v)}
        ok = 200 <= status < 300 and not rejected
        print(
            f"{'PASS' if ok else 'FAIL'} POST {path} -> {status} "
            f"partialSuccess={json.dumps(partial)}"
        )
        if not ok:
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
