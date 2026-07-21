---
name: debug-from-telemetry
description: Use when debugging any Areté bug, failed review, slow request, or unexplained behavior — query the local telemetry stack (Jaeger, ClickHouse, Prometheus) for the actual trace/log evidence BEFORE guessing or adding print statements.
---

# Debug from telemetry

Evidence before hypotheses. Areté instruments itself (obs spec
`docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md`);
the local stack already recorded what happened. Query it first.

## Stack (started with `pnpm infra:up`)

| Tool | Where | Use for |
|---|---|---|
| Jaeger v2 UI | http://localhost:16686 | trace waterfalls; service `arete-agents` |
| ClickHouse | `docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client -u superlog --password superlog` | raw spans/logs/metrics SQL |
| Prometheus | http://localhost:9090 | metric queries (`arete_*` namespace) |
| Collector | OTLP at localhost:4318 (HTTP) / 4317 (gRPC) | is telemetry flowing at all? |

## Recipes

**Find the trace for a failing request** (Jaeger UI: service `arete-agents`,
operation e.g. `review.run`; or SQL):

    SELECT TraceId, SpanName, StatusCode, StatusMessage,
           Duration / 1e9 AS seconds
    FROM superlog.otel_traces
    WHERE ServiceName = 'arete-agents' AND StatusCode = 'STATUS_CODE_ERROR'
    ORDER BY Timestamp DESC LIMIT 20;

**All logs for one trace** (every structured log line carries trace_id):

    SELECT Timestamp, SeverityText, Body
    FROM superlog.otel_logs
    WHERE TraceId = '<trace-id-from-above>'
    ORDER BY Timestamp;

**LLM cost/latency for a review** (token counts live on llm spans;
prompt/completion bodies are deliberately never captured):

    SELECT SpanName,
           SpanAttributes['gen_ai.provider.name']        AS provider,
           SpanAttributes['gen_ai.usage.input_tokens']   AS input_tokens,
           SpanAttributes['gen_ai.usage.output_tokens']  AS output_tokens,
           Duration / 1e9                                AS seconds
    FROM superlog.otel_traces
    WHERE TraceId = '<trace-id>' AND SpanName = 'llm.generate';

**Is telemetry itself broken?** Run the per-signal harness — it checks HTTP
status AND partial-success per endpoint (a 200 can still drop records):

    cd packages/agents
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 uv run python scripts/verify_telemetry.py

## Rules

- Query before guessing; paste the trace id / SQL result into your findings.
- No telemetry for the incident? That IS a finding — run the harness, check
  `docker compose -f infra/docker-compose.yml logs otel-collector`, then fix
  instrumentation first.
- Never paste secrets into findings. If you see an unredacted secret in any
  signal, that is a review-blocking §6 defect: fix the scrubber
  (`arete_agents/observability.py`) or collector redaction, and rotate the key.
- Retention: raw 30d, rollups 90d (`packages/db/clickhouse/RETENTION.md`) —
  older incidents have no raw signals.
