"""Per-signal OTLP verification harness (obs spec §5 'Verification').

Part A drives one span, one metric batch, and one log through the REAL
bootstrap (init_observability + force_flush) — proving the in-process
pipeline end-to-end. Part B posts one minimal raw OTLP/HTTP payload per
endpoint and inspects status code AND partialSuccess, because the SDK
exporters hide the HTTP response and a 200 can still drop records.

Usage (collector up via `pnpm infra:up`):
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
        uv run python scripts/verify_telemetry.py
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


def _drive_through_bootstrap() -> None:
    init_observability()
    tracer = get_tracer("verify_telemetry")
    with tracer.start_as_current_span("verify.bootstrap") as span:
        span.set_attribute("verify.signal", "traces")
        logging.getLogger("verify_telemetry").info("verify.bootstrap log line")
    meter = get_meter("verify_telemetry")
    meter.create_histogram(
        "arete.review.duration", unit="s"
    ).record(1.5, {"outcome": "verify"})
    trace.get_tracer_provider().force_flush()
    metrics.get_meter_provider().force_flush()


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
