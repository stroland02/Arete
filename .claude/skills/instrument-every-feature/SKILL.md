---
name: instrument-every-feature
description: Use when adding or changing any feature in Areté (TS or Python) — new code must arrive with spans, metrics, and logs per the frozen conventions, with redaction and per-signal verification. Required by the PR DoD checklist.
---

# Instrument Every Feature

New behavior ships with telemetry in the same PR. "Works on my machine" is
not evidence; a span in Jaeger is. Source of truth:
`docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md`
(§5 conventions are FROZEN — changing a name requires a spec amendment).

## Spans (user intent → business op → transport)

Name spans after the business operation, parented under the user-intent root:
`review.run` → `review.context.build` / `agent.review` (attr `agent.role`) →
`llm.generate` → auto HTTP client spans; `review.synthesize`/`review.critique`,
`review.publish`. Same pattern for `scan.run`, `fix.run`, `chat.turn`.

TypeScript (webhook/worker): use `runWithReviewSpan`/`withChildSpan` from
`packages/webhook/src/observability.ts`, or `trace.getTracer(...)` +
`startActiveSpan` for new trees. Init is already wired via `--import`
(`src/otel.ts` / `src/otel-worker.ts`) — never re-init the SDK in app code.

## Metrics

Namespace `arete.*`: `arete.review.runs` (counter: `outcome`, `trigger`),
`arete.review.duration` (histogram, s), `arete.agent.duration` (histogram:
`agent.role`), `arete.queue.jobs` (counter: `queue`, `outcome`), plus semconv
`gen_ai.client.token.usage` / `gen_ai.client.operation.duration`.

**Cardinality rule (review-blocking):** metric dimensions must be CLOSED
low-cardinality sets (role, outcome, provider, model). Repo names, PR
numbers, installation ids, SHAs, tenant ids → span attributes ONLY, never
metric dimensions.

Durations that can exceed 10 s (anything touching an LLM) need explicit
bucket boundaries up to 300 s — see `DURATION_HISTOGRAM_BOUNDARIES` in
`@arete/telemetry` and register a view for any new duration histogram.

## Logs

No bare `console.*` / `print` in server code (ESLint enforces it in
packages/webhook). TS: `logger.child({ component: '<module>' })` from
`packages/webhook/src/logger.ts` (pino via `@arete/telemetry`); Python:
structlog per `arete_agents/observability.py`. Put values in structured
fields, never string interpolation; errors as `{ err }`. `trace_id`/`span_id`
stamping is automatic when a span is active.

## Redaction (spec §5 — all sinks)

Blocklist keys: `authorization`, `x-api-key`, `api_key`, `token`, `secret`,
`password`, `cookie`, `set-cookie`. Value shapes: bearer tokens,
`sk-`/`ghp_`/`ghs_`/`glpat-`/`whsec_` keys, `?key=`/`?api_key=` URL params.
Credentials go in HTTP headers, never URLs. If your change adds attributes or
log fields that could carry secrets, extend the canary tests
(`packages/telemetry/src/scrub-processor.test.ts`, `logger.test.ts`) in the
same PR.

## Per-signal verification (paste evidence in the PR body)

A green build says nothing about telemetry. Drive one span, one metric batch,
and one log through the REAL bootstrap and verify each endpoint:

```bash
# Collector lives in the default stack once Lane B's Task 11 promotes it;
# until then it is in infra/docker-compose-otel.yml — use whichever exists:
docker compose -f infra/docker-compose.yml up -d 2>/dev/null || docker compose -f infra/docker-compose-otel.yml up -d
# exercise your code path, then check each signal independently:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/traces  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'   # expect 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/metrics -H 'Content-Type: application/json' -d '{"resourceMetrics":[]}'  # expect 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/logs    -H 'Content-Type: application/json' -d '{"resourceLogs":[]}'     # expect 200
```

A 200 can still drop records: check the response body's `partialSuccess`
field — it must be empty/absent. Then confirm your spans appear in Jaeger
(http://localhost:16686) under the right `service.name`. "Traces work" says
nothing about logs — verify each signal you touched.
