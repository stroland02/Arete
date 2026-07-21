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
| Jaeger v2 UI | http://localhost:16686 | trace waterfalls; services `arete-webhook`, `arete-worker`, `arete-agents`, `arete-dashboard` |
| ClickHouse | `docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client -u superlog --password superlog` | raw spans/logs/metrics SQL |
| Prometheus | http://localhost:9090 | metric queries (`arete_*` namespace) |
| Collector | OTLP at localhost:4318 (HTTP) / 4317 (gRPC) | is telemetry flowing at all? |

## Recipes

**Where the spans actually live** (verify before writing a WHERE clause —
these names are what the code emits today, not what the spec aspires to):

| Service | Spans it emits |
|---|---|
| `arete-webhook` | HTTP server spans; `add review-pr` (bullmq producer) |
| `arete-worker` | `process review-pr` (bullmq consumer) → `review.run` (root of a review) → `review.context.build`, `review.publish` |
| `arete-agents` | FastAPI server spans; `agent_review:{agent_name}`, `synthesize_reviews`; LLM spans named by the gen_ai contrib instrumentations (e.g. `chat {model}`) |
| `arete-dashboard` | Next.js server spans |

A whole review is ONE trace spanning webhook → worker → agents: context
propagates through Redis (bullmq-otel) and the HTTP hop. Start from
`review.run` on `arete-worker`, not from `arete-agents`.

**Find the trace for a failing review** (Jaeger UI: service `arete-worker`,
operation `review.run`; or SQL — drop the ServiceName filter to catch a
failure anywhere in the chain):

    SELECT ServiceName, TraceId, SpanName, StatusCode, StatusMessage,
           Duration / 1e9 AS seconds
    FROM superlog.otel_traces
    WHERE StatusCode = 'STATUS_CODE_ERROR'
    ORDER BY Timestamp DESC LIMIT 20;

**All logs for one trace** (every structured log line carries trace_id):

    SELECT Timestamp, SeverityText, Body
    FROM superlog.otel_logs
    WHERE TraceId = '<trace-id-from-above>'
    ORDER BY Timestamp;

**LLM cost/latency for a review** (token counts live on the gen_ai spans the
contrib instrumentations emit — there is no span literally named
`llm.generate`, so select on the attribute's presence rather than a name):

    SELECT ServiceName, SpanName,
           SpanAttributes['gen_ai.provider.name']        AS provider,
           SpanAttributes['gen_ai.request.model']        AS model,
           SpanAttributes['gen_ai.usage.input_tokens']   AS input_tokens,
           SpanAttributes['gen_ai.usage.output_tokens']  AS output_tokens,
           Duration / 1e9                                AS seconds
    FROM superlog.otel_traces
    WHERE TraceId = '<trace-id>'
      AND mapContains(SpanAttributes, 'gen_ai.usage.input_tokens')
    ORDER BY Timestamp;

Prompt and completion bodies are deliberately never captured (§5) — if you
need to see what was sent, reproduce locally; do not widen capture.

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
