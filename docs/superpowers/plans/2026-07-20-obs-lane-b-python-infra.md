# Observability Lane B — Python (arete-agents) + Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md` (§3 Phase 0 + Phase 1, §5 frozen conventions, §6 security gates, §7 Agent B lane, §8 process). This plan is the **Agent B — Python + infra lane** only; Lane A (TypeScript) is a separate plan.

**Goal:** Make the `arete-agents` FastAPI service fully observable (traces + metrics + logs over env-driven OTLP, redacted at every sink, never crashing the app) and promote the local Collector → ClickHouse/Jaeger v2/Prometheus stack into the default infra, with Phase 0 gate fixes first.

**Architecture:** A single `packages/agents/src/arete_agents/observability.py` module owns the whole Python telemetry bootstrap — resource, tracer/meter/logger providers, histogram Views, an in-process span scrubber, the structlog → stdlib → OTel logging bridge, and the genai/LangChain instrumentation hooks — called once from `server.py` inside the uvicorn worker process. Telemetry flows to an OTel Collector (contrib 0.156.x, promoted into `infra/docker-compose.yml`) whose pipelines apply redaction + transform processors and fan out to ClickHouse (our DDL, `create_schema: false`, TTLs), Jaeger v2 (OTLP), and Prometheus. Verification is per-signal, evidence-first: a harness drives one span/metric/log through the real bootstrap and inspects HTTP status **and** OTLP partial-success payloads.

**Tech Stack (research-pinned 2026-07-20 — use these, do not substitute):**
- `opentelemetry-api` / `opentelemetry-sdk` **1.44.0**; `opentelemetry-exporter-otlp-proto-http` **1.44.0** (Logs SDK is stable: `LoggerProvider` + `BatchLogRecordProcessor` + `OTLPLogExporter` + `LoggingHandler`).
- Contrib instrumentations **0.65b0**: `opentelemetry-instrumentation-fastapi` (`FastAPIInstrumentor.instrument_app(app, excluded_urls="health")`), plus the contrib **instrumentation-genai** set: `opentelemetry-instrumentation-anthropic`, `opentelemetry-instrumentation-google-genai`, `opentelemetry-instrumentation-openai-v2` (Ollama rides openai-v2 via its OpenAI-compatible `/v1` endpoint).
- `opentelemetry-instrumentation-langchain` **>=0.62.0,<0.63** — **this PyPI name is Traceloop's package**; pinned knowingly as the LangGraph/LangChain *callback-layer* instrumentation only. Never two instrumentations of the same layer.
- `structlog` **>=25.1** via `structlog.stdlib.ProcessorFormatter` bridge; censor processor mutates `event_dict` before any renderer/bridge.
- gen_ai semconv: `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`; `gen_ai.provider.name` (NOT deprecated `gen_ai.system`); `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`; content capture OFF.
- Histogram Views: `opentelemetry.sdk.metrics.view.View(instrument_name=..., aggregation=ExplicitBucketHistogramAggregation(boundaries=[...]))` passed to `MeterProvider(views=[...])`.
- Collector: `otel/opentelemetry-collector-contrib:0.156.0`; `redaction` processor (`allow_all_keys: true`, `blocked_key_patterns`, `blocked_values`) + `transform` (OTTL `replace_pattern`); ClickHouse exporter (traces/logs beta, metrics alpha) with `create_schema: false`; Jaeger v2 all-in-one `jaegertracing/jaeger:2.13.0` (OTLP only — v1 + npm Jaeger exporter are legacy).
- Dashboard fix: `@clickhouse/client` 1.23.x `query_params` with `{name: Type}` server-side bound placeholders.

## Global Constraints

- **Branch:** `stroland02/obs-py-infra`. Every work item: worktree → lane branch → **PR into `integration-preview`** with CI green + the DoD checklist below in the PR body → reviewed merge. `integration-preview` → serving branch at phase boundaries only. PR bundles for this plan: PR-1 = Tasks 1–2 (Phase 0), PR-2 = Tasks 3–6, PR-3 = Tasks 7–8, PR-4 = Tasks 9–11, PR-5 = Tasks 12–15 (Task 16's evidence goes in PR-5's body).
- **DoD checklist (spec §8, verbatim, every PR body):**
  - [ ] Tests written first and green (TDD); no skipped/quarantined tests added
  - [ ] Per-signal verification evidence pasted (status codes + partial-success check)
  - [ ] No new bare `console.*` / `print` in server code
  - [ ] Redaction tests updated if the attribute/log surface grew
  - [ ] Conventions (§5) followed; cardinality rule checked for any new metric
  - [ ] Docs/skills updated if behavior or conventions moved
- **Conventions §5 are FROZEN** — neither lane edits them unilaterally; changes require a spec amendment. Exact values used throughout this plan:
  - Resource attributes: `service.name` = `arete-agents`, `service.version`, `deployment.environment.name` (env-var override; default `development`, `production` only when explicitly set), `service.instance.id`.
  - Metric namespace: `arete.review.runs`, `arete.review.duration`, `arete.agent.duration`, `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, `arete.queue.jobs`.
  - Span tree: `review.run` → `review.context.build` / `agent.review` (attr `agent.role`) → `llm.generate` (gen_ai.* attrs) → auto HTTP client spans; `scan.run`, `fix.run`, `chat.turn` same pattern.
- **Cardinality rule (hard):** metric dimensions must be closed, low-cardinality sets (role, outcome, provider, model). Repo names, PR numbers, installation ids, SHAs, tenant ids → **span attributes only, never metric dimensions**. Violations are a review-blocking defect.
- **Redaction (all sinks), §5:** key-based blocklist (`authorization`, `x-api-key`, `api_key`, `token`, `secret`, `password`, `cookie`, `set-cookie`) + value patterns (bearer tokens, `sk-`/`ghs_`/`ghp_`-style key shapes, `[?&]key=` / `[?&]api_key=` in URLs). Applied in the structlog censor processor, the in-process span scrubber, and the collector `redaction` processor. **Credentials go in headers, never URLs — audited, not assumed.**
- **Prompt/completion content NOT captured** (`gen_ai.input.messages`/`output.messages` off) — token counts and metadata only.
- **Telemetry must never take the app down:** every init wrapped; failure logs one warning and the service runs without telemetry.
- **No new bare `print` / `console.*` in server code.** (Existing interactive-CLI `print` sites in `cli.py`/`mcp/`/`skills/manager.py` are out of scope; the count must not grow.)
- **Shared env seam (goes in `.env.example`, Task 5):** `OTEL_EXPORTER_OTLP_ENDPOINT` (unset ⇒ telemetry no-op; local dev `http://localhost:4318`), `DEPLOYMENT_ENVIRONMENT` (default `development`).
- All commands below run from the repo root `C:\Users\strol\orca\workspaces\Arete\horseshoe` unless a `working-directory` is shown; Python commands run from `packages/agents`.

---

### Task 1: Phase 0 — Parameterize the ClickHouse `installationIds` query (dashboard)

`packages/dashboard/src/lib/queries.ts:788` string-joins caller-influenced installation ids straight into SQL (`installationIds.map(id => `'${id}'`).join(', ')`) and interpolates `LIMIT ${limitMinutes}`. Fix with `@clickhouse/client` server-side bound params.

**Files**
- Modify: `packages/dashboard/src/lib/queries.ts` (lines 781–810, `getAgentEventsPerMinute`)
- Test (create): `packages/dashboard/src/lib/queries.clickhouse.test.ts` (colocated `*.test.ts`, vitest — repo convention)

**Interfaces**
- Consumes: `clickhouse.query({ query, query_params, format })` from `packages/dashboard/src/lib/clickhouse.ts` (`@clickhouse/client` `createClient(...).query`)
- Produces: unchanged signature `getAgentEventsPerMinute(installationIds: string[], limitMinutes?: number): Promise<AgentEventData[]>`

**Steps**

- [ ] Create the lane branch: `git checkout -b stroland02/obs-py-infra`
- [ ] Write the failing test at `packages/dashboard/src/lib/queries.clickhouse.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('./clickhouse', () => ({
  clickhouse: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { getAgentEventsPerMinute } from './queries';

describe('getAgentEventsPerMinute', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      json: async () => [
        { minute: '2026-07-20 10:01:00', count: '4' },
        { minute: '2026-07-20 10:00:00', count: '2' },
      ],
    });
  });

  it('returns [] without querying when no installations are authorized', async () => {
    expect(await getAgentEventsPerMinute([])).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('binds installation ids via query_params, never string interpolation', async () => {
    const hostile = "x') OR 1=1 --";
    await getAgentEventsPerMinute([hostile, 'inst_2'], 60);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0][0] as {
      query: string;
      query_params: Record<string, unknown>;
    };
    // SQL text carries only bound placeholders — zero caller data.
    expect(call.query).toContain('IN ({installationIds: Array(String)})');
    expect(call.query).toContain('LIMIT {limitMinutes: UInt32}');
    expect(call.query).not.toContain(hostile);
    expect(call.query_params).toEqual({
      installationIds: [hostile, 'inst_2'],
      limitMinutes: 60,
    });
  });

  it('maps rows to chronological AgentEventData', async () => {
    const rows = await getAgentEventsPerMinute(['inst_1']);
    expect(rows).toEqual([
      { minute: new Date('2026-07-20 10:00:00'), count: 2 },
      { minute: new Date('2026-07-20 10:01:00'), count: 4 },
    ]);
  });
});
```

- [ ] Run it — expect the interpolation assertions to fail (query contains the hostile string; `query_params` is `undefined`):
  `pnpm --filter @arete/dashboard exec vitest run src/lib/queries.clickhouse.test.ts`
- [ ] Replace the body of `getAgentEventsPerMinute` in `packages/dashboard/src/lib/queries.ts` (delete the `inClause` line entirely):

```ts
export async function getAgentEventsPerMinute(
  installationIds: string[],
  limitMinutes: number = 60
): Promise<AgentEventData[]> {
  if (installationIds.length === 0) return [];

  // project_id maps to installationId in Areté's schema adaptation.
  // Server-side bound parameters ({name: Type} + query_params) — never string
  // interpolation: installation ids are caller-influenced and this read path
  // becomes hot once the promoted collector writes otel_* (obs spec §3 Phase 0).
  const result = await clickhouse.query({
    query: `
      SELECT
        minute,
        sum(c) as count
      FROM superlog.events_per_minute
      WHERE project_id IN ({installationIds: Array(String)})
      GROUP BY minute
      ORDER BY minute DESC
      LIMIT {limitMinutes: UInt32}
    `,
    query_params: {
      installationIds,
      limitMinutes: Math.max(1, Math.floor(limitMinutes)),
    },
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();

  return rows.map(r => ({
    minute: new Date(r.minute),
    count: Number(r.count),
  })).reverse(); // chronological order
}
```

- [ ] Run again — expect 3 passing tests: `pnpm --filter @arete/dashboard exec vitest run src/lib/queries.clickhouse.test.ts`
- [ ] Run the whole dashboard suite + lint: `pnpm --filter @arete/dashboard test` and `pnpm --filter @arete/dashboard lint` — expect green.
- [ ] Commit:
  `git add packages/dashboard/src/lib/queries.ts packages/dashboard/src/lib/queries.clickhouse.test.ts && git commit -m "fix(dashboard): bind ClickHouse installationIds via query_params, not SQL interpolation" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 2: Phase 0 — Compose/collector validation job in CI

Config-only task: the "test" is the exact verification command + expected output.

**Files**
- Modify: `.github/workflows/ci.yml` (append a new job after `test-dashboard`)
- No agents-job change needed for upcoming deps: `uv sync --extra dev` (ci.yml line 22) installs whatever `pyproject.toml` declares, and the `Lint`/`Test` steps already gate ruff + pytest. Confirm and record this in the PR body.

**Interfaces**
- Consumes: `infra/docker-compose.yml`, `infra/docker-compose-otel.yml`, `infra/otel-collector-config.yaml`
- Produces: CI job `validate-infra` that fails the build when any infra config no longer parses.

**Steps**

- [ ] Verify the commands locally first (these are the "tests" — run before editing CI):
  - `docker compose -f infra/docker-compose.yml config --quiet` → exit 0, no output.
  - `docker compose -f infra/docker-compose-otel.yml config --quiet` → exit 0 (a `version` is obsolete warning is acceptable; the file is deleted in Task 11).
  - `docker run --rm -v "$PWD/infra/otel-collector-config.yaml:/etc/otelcol/config.yaml" otel/opentelemetry-collector-contrib:0.100.0 validate --config=/etc/otelcol/config.yaml` → exit 0. (Pinned to the compose file's current collector version; Task 11 bumps both to 0.156.0 together.)
- [ ] Append this job to `.github/workflows/ci.yml`:

```yaml
  validate-infra:
    name: Infra config validation
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate default compose file
        run: docker compose -f infra/docker-compose.yml config --quiet

      - name: Validate otel compose file
        run: docker compose -f infra/docker-compose-otel.yml config --quiet

      # Must stay pinned to the same image tag infra uses. Task 11 of the
      # obs-lane-b plan bumps this to 0.156.0 when the config is rewritten.
      - name: Validate collector config
        run: |
          docker run --rm \
            -v "$PWD/infra/otel-collector-config.yaml:/etc/otelcol/config.yaml" \
            otel/opentelemetry-collector-contrib:0.100.0 \
            validate --config=/etc/otelcol/config.yaml
```

- [ ] Re-run all three commands from the first step — exit 0 each; paste outputs into the PR body as evidence.
- [ ] Commit:
  `git add .github/workflows/ci.yml && git commit -m "ci(infra): validate compose files and collector config on every push" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 3: Pin observability dependencies in `pyproject.toml`

**Files**
- Modify: `packages/agents/pyproject.toml` (replace the three loose `opentelemetry-*>=1.24.0` lines; add instrumentations + structlog)

**Interfaces**
- Consumes: PyPI (via `uv sync`)
- Produces: importable modules `opentelemetry.sdk`, `opentelemetry.exporter.otlp.proto.http.*`, `opentelemetry.instrumentation.fastapi`, `opentelemetry.instrumentation.anthropic`, `opentelemetry.instrumentation.google_genai`, `opentelemetry.instrumentation.openai_v2`, `opentelemetry.instrumentation.langchain`, `structlog`

**Steps**

- [ ] "Failing test" (run first, expect `ModuleNotFoundError` for structlog/fastapi instrumentation), from `packages/agents`:

```
uv run python -c "import structlog; from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor; print('deps ok')"
```

- [ ] In `packages/agents/pyproject.toml`, replace

```toml
    "opentelemetry-api>=1.24.0",
    "opentelemetry-sdk>=1.24.0",
    "opentelemetry-exporter-otlp>=1.24.0",
```

with

```toml
    "opentelemetry-api==1.44.0",
    "opentelemetry-sdk==1.44.0",
    "opentelemetry-exporter-otlp-proto-http==1.44.0",
    "opentelemetry-instrumentation-fastapi==0.65b0",
    "opentelemetry-instrumentation-anthropic==0.65b0",
    "opentelemetry-instrumentation-google-genai==0.65b0",
    "opentelemetry-instrumentation-openai-v2==0.65b0",
    "opentelemetry-instrumentation-langchain>=0.62.0,<0.63",
    "structlog>=25.1",
```

  (`opentelemetry-exporter-otlp` → the HTTP-only exporter: the harness asserts per-endpoint HTTP statuses on `/v1/{traces,logs,metrics}`, and one protocol everywhere removes the gRPC dependency the old hardcoded block needed. `opentelemetry-instrumentation-langchain` is Traceloop's publisher — pinned knowingly, callback layer only.)
- [ ] `uv sync --extra dev` → resolves and installs; then re-run the import check above → prints `deps ok`.
- [ ] Also verify every instrumentation imports:

```
uv run python -c "from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor; from opentelemetry.instrumentation.google_genai import GoogleGenAiSdkInstrumentor; from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor; from opentelemetry.instrumentation.langchain import LangchainInstrumentor; print('instrumentations ok')"
```

  If a symbol name differs in the installed 0.65b0/0.62 wheels, fix the import name here and use the corrected name in Tasks 5/8 — do not proceed with an unverified name.
- [ ] `uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` (env: `LLM_PROVIDER=gemini`, `GEMINI_API_KEY=test-key-not-real`) → suite still green.
- [ ] Commit:
  `git add packages/agents/pyproject.toml packages/agents/uv.lock && git commit -m "build(agents): pin OTel 1.44.0/0.65b0 stack, genai + langchain instrumentations, structlog" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 4: Redaction primitives + in-process span scrubber

Pure, provider-independent pieces first: `scrub_text`, `is_blocked_key`, and `ScrubbingSpanProcessor` (strips URL query strings and secret patterns from attributes, exception events, and status text — the exact Superlog `?key=` incident class).

**Files**
- Create: `packages/agents/src/arete_agents/observability.py` (module skeleton + redaction section)
- Test (create): `packages/agents/tests/test_span_scrubber.py`

**Interfaces**
- Consumes: `opentelemetry.sdk.trace.SpanProcessor` / `ReadableSpan`, `opentelemetry.trace.status.Status`
- Produces:
  - `REDACTED: str = "[REDACTED]"`
  - `BLOCKLIST_KEYS: tuple[str, ...]` (§5 list, verbatim)
  - `scrub_text(value: str) -> str`
  - `is_blocked_key(key: str) -> bool`
  - `class ScrubbingSpanProcessor(SpanProcessor)` with `on_end(self, span: ReadableSpan) -> None`

**Steps**

- [ ] Write the failing tests at `packages/agents/tests/test_span_scrubber.py`:

```python
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
```

- [ ] Run: `uv run pytest tests/test_span_scrubber.py -v` → expect `ModuleNotFoundError: No module named 'arete_agents.observability'`.
- [ ] Create `packages/agents/src/arete_agents/observability.py`:

```python
"""Single OpenTelemetry bootstrap + redaction point for arete-agents.

Owns (obs spec §5/§7, Lane B): redaction primitives, the in-process span
scrubber, the structlog censor/bridge (Task 7), histogram Views, and
init_observability() (Task 5). server.py calls init_observability() exactly
once at import time — inside the uvicorn worker process.
"""

from __future__ import annotations

import logging
import re

from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor
from opentelemetry.trace.status import Status

_logger = logging.getLogger(__name__)

# --- §5 redaction conventions (FROZEN — spec amendment required to change) ---

REDACTED = "[REDACTED]"

BLOCKLIST_KEYS: tuple[str, ...] = (
    "authorization",
    "x-api-key",
    "api_key",
    "token",
    "secret",
    "password",
    "cookie",
    "set-cookie",
)

# Blocked keys match as whole '-'/'_'/'.'-delimited segments, never bare
# substrings: "gen_ai.usage.input_tokens" must NOT match "token".
_BLOCKED_KEY_RES: tuple[re.Pattern[str], ...] = tuple(
    re.compile(rf"(?:^|[^a-z0-9])({re.escape(key)})(?:$|[^a-z0-9])")
    for key in BLOCKLIST_KEYS
)

# Value patterns (§5): bearer tokens, sk-/ghs_/ghp_-style key shapes,
# [?&]key= / [?&]api_key= in URLs.
_VALUE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=\-]+"), REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}\b"), REDACTED),
    (re.compile(r"\bgh[ps]_[A-Za-z0-9]{16,}\b"), REDACTED),
    (re.compile(r"(?i)([?&](?:api_)?key=)[^&#\s]+"), r"\1" + REDACTED),
)

_URL_ATTR_KEYS = ("http.url", "url.full")


def scrub_text(value: str) -> str:
    """Mask every §5 secret-shaped substring in ``value``."""
    for pattern, replacement in _VALUE_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def is_blocked_key(key: str) -> bool:
    """True when ``key`` contains a §5 blocklisted name as a whole segment."""
    lowered = key.lower()
    return any(regex.search(lowered) for regex in _BLOCKED_KEY_RES)


class ScrubbingSpanProcessor(SpanProcessor):
    """In-process span scrubber (§5: redaction at every sink).

    Registered FIRST on the TracerProvider so on_end mutates the span before
    the (later-registered) batch processor hands it to the OTLP exporter.
    Scrubs: URL query strings on http.url/url.full (the Superlog Gemini
    ``?key=`` incident class), blocklisted attribute keys, secret-shaped
    values in string attributes, exception-event attributes, and the span
    status description. Never raises — a scrubbing bug loses the scrub for
    that span, never the span pipeline or the app.
    """

    def on_start(self, span, parent_context=None) -> None:  # pragma: no cover
        pass

    def on_end(self, span: ReadableSpan) -> None:
        try:
            if span._attributes:
                span._attributes = {
                    key: self._scrub_attribute(key, value)
                    for key, value in span._attributes.items()
                }
            for event in span._events:
                if event.attributes:
                    event._attributes = {
                        key: self._scrub_attribute(key, value)
                        for key, value in event.attributes.items()
                    }
            status = span._status
            if status is not None and status.description:
                scrubbed = scrub_text(status.description)
                if scrubbed != status.description:
                    span._status = Status(status.status_code, scrubbed)
        except Exception:
            _logger.warning(
                "span scrubber failed; span exported unscrubbed", exc_info=True
            )

    @staticmethod
    def _scrub_attribute(key: str, value):
        if is_blocked_key(key):
            return REDACTED
        if isinstance(value, str):
            if key in _URL_ATTR_KEYS:
                return value.split("?", 1)[0]
            return scrub_text(value)
        return value

    def shutdown(self) -> None:  # pragma: no cover
        pass

    def force_flush(self, timeout_millis: int = 30_000) -> bool:  # pragma: no cover
        return True
```

  Note: the private-field writes (`span._attributes`, `event._attributes`, `span._status`) are the established pattern for pre-export scrubbing in opentelemetry-python 1.44 — `on_end` receives the live span object that later processors export. The tests above are the contract; if an SDK minor changes the field names, the tests catch it.
- [ ] Run: `uv run pytest tests/test_span_scrubber.py -v` → 5 passed.
- [ ] Lint: `uv run ruff check src/arete_agents/observability.py tests/test_span_scrubber.py` → clean.
- [ ] Commit:
  `git add packages/agents/src/arete_agents/observability.py packages/agents/tests/test_span_scrubber.py && git commit -m "feat(agents): §5 redaction primitives + in-process span scrubber" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---### Task 5: `init_observability()` — env-driven, no-op-safe bootstrap

Replaces (in Task 6) the hardcoded exporter block in `server.py` (lines 36–52: unconditional gRPC `OTLPSpanExporter(endpoint="http://localhost:4317")`).

**Files**
- Modify: `packages/agents/src/arete_agents/observability.py` (append bootstrap section)
- Modify: `.env.example` (append OTel section — the shared lane seam)
- Test (create): `packages/agents/tests/test_observability.py`

**Interfaces**
- Consumes: env `OTEL_EXPORTER_OTLP_ENDPOINT`, `DEPLOYMENT_ENVIRONMENT`; `ScrubbingSpanProcessor` (Task 4)
- Produces:
  - `init_observability() -> None` (idempotent, never raises)
  - `get_tracer(name: str) -> opentelemetry.trace.Tracer` (module-scope safe)
  - `get_meter(name: str) -> opentelemetry.metrics.Meter` (module-scope safe)
  - `LLM_DURATION_BOUNDARIES: tuple[float, ...] = (1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 180.0, 300.0)`
  - private: `_init_providers(endpoint: str) -> None`, `_build_resource() -> Resource`, `_histogram_views() -> list[View]`, `_instrument_llm_layers() -> None` (stub here; filled in Task 8)

**Steps**

- [ ] Write the failing tests at `packages/agents/tests/test_observability.py`:

```python
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
```

- [ ] Run: `uv run pytest tests/test_observability.py -v` → expect `AttributeError` (`init_observability` missing).
- [ ] Append to `packages/agents/src/arete_agents/observability.py` (imports go at the top of the file with the existing ones):

```python
import atexit
import os
import uuid
from importlib import metadata as importlib_metadata

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

try:  # Logs SDK is stable in 1.44; keep the pre-stable path importable too.
    from opentelemetry.sdk.logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk.logs.export import BatchLogRecordProcessor
except ImportError:  # pragma: no cover - older module layout
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry._logs import set_logger_provider
```

then the bootstrap section:

```python
# --- bootstrap -------------------------------------------------------------

SERVICE_NAME_VALUE = "arete-agents"  # §5 frozen

LLM_DURATION_BOUNDARIES: tuple[float, ...] = (
    1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 180.0, 300.0,
)

_INITIALIZED = False


def get_tracer(name: str) -> trace.Tracer:
    """Module-scope safe: before init this is a ProxyTracer that upgrades
    automatically once init_observability() installs the real provider."""
    return trace.get_tracer(name)


def get_meter(name: str) -> metrics.Meter:
    """Module-scope safe (ProxyMeter; see get_tracer)."""
    return metrics.get_meter(name)


def _build_resource() -> Resource:
    try:
        service_version = importlib_metadata.version("arete-agents")
    except importlib_metadata.PackageNotFoundError:  # editable/dev checkout
        service_version = "0.0.0-dev"
    return Resource.create(
        {
            "service.name": SERVICE_NAME_VALUE,
            "service.version": service_version,
            # §5: default development; "production" only when explicitly set.
            "deployment.environment.name": os.getenv(
                "DEPLOYMENT_ENVIRONMENT", "development"
            ),
            "service.instance.id": str(uuid.uuid4()),
        }
    )


def _histogram_views() -> list[View]:
    """Explicit boundaries to 300s for LLM/review durations — the default
    10s ceiling silently corrupts p95/p99 (Superlog's latent defect)."""
    return [
        View(
            instrument_name=name,
            aggregation=ExplicitBucketHistogramAggregation(
                boundaries=list(LLM_DURATION_BOUNDARIES)
            ),
        )
        for name in (
            "gen_ai.client.operation.duration",
            "arete.review.duration",
            "arete.agent.duration",
        )
    ]


def _instrument_llm_layers() -> None:
    """Filled in by the LLM-instrumentation work item (plan Task 8)."""


def _init_providers(endpoint: str) -> None:
    base = endpoint.rstrip("/")
    resource = _build_resource()

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(ScrubbingSpanProcessor())  # FIRST: scrub
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{base}/v1/traces"))
    )
    trace.set_tracer_provider(tracer_provider)

    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[
            PeriodicExportingMetricReader(
                OTLPMetricExporter(endpoint=f"{base}/v1/metrics")
            )
        ],
        views=_histogram_views(),
    )
    metrics.set_meter_provider(meter_provider)

    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(
        BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{base}/v1/logs"))
    )
    set_logger_provider(logger_provider)
    # ORDERING (load-bearing): this handler lands on the root logger AFTER any
    # code that clears root handlers (nothing in arete_agents does today — keep
    # it that way) and BEFORE configure_structlog() installs the
    # ProcessorFormatter bridge, so both console and OTLP sinks see every
    # (already-censored) record.
    root = logging.getLogger()
    root.addHandler(LoggingHandler(level=logging.INFO, logger_provider=logger_provider))
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

    def _shutdown() -> None:
        # Flush at exit so short-lived runs (CLI, tests) keep the tail.
        for provider in (tracer_provider, meter_provider, logger_provider):
            try:
                provider.shutdown()
            except Exception:  # pragma: no cover - best effort at exit
                pass

    atexit.register(_shutdown)


def init_observability() -> None:
    """Idempotent, never-raises telemetry bootstrap.

    Called from server.py at import time, which under
    ``uvicorn arete_agents.server:app`` executes inside the worker process —
    required: BatchSpanProcessor/PeriodicExportingMetricReader threads must be
    created in the serving process, never a parent that forks.

    Env contract (shared seam, .env.example):
      OTEL_EXPORTER_OTLP_ENDPOINT   unset -> graceful no-op (one INFO line)
      DEPLOYMENT_ENVIRONMENT        -> deployment.environment.name resource attr
    """
    global _INITIALIZED
    if _INITIALIZED:
        return
    _INITIALIZED = True

    # gen_ai semconv opt-in + content capture OFF (§5) — set before any
    # instrumentation reads them, even in the no-op path so a later manual
    # init can't accidentally capture prompt bodies.
    os.environ.setdefault(
        "OTEL_SEMCONV_STABILITY_OPT_IN", "gen_ai_latest_experimental"
    )
    os.environ.setdefault(
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "false"
    )

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        _logger.info(
            "OTEL_EXPORTER_OTLP_ENDPOINT is not set; running without telemetry "
            "export (no-op providers)."
        )
        return

    try:
        _init_providers(endpoint)
        _instrument_llm_layers()
        _logger.info("observability initialized; OTLP/HTTP -> %s", endpoint)
    except Exception:
        # Telemetry must never take the app down: one warning, run dark.
        _logger.warning(
            "observability init failed; continuing without telemetry",
            exc_info=True,
        )
```

- [ ] Run: `uv run pytest tests/test_observability.py tests/test_span_scrubber.py -v` → all pass.
- [ ] Update `.env.example`. **Shared-seam rule (both lanes edit this file):** Lane A
  Task 9 owns the canonical OpenTelemetry block. If that block is already present
  (grep for `OTEL_EXPORTER_OTLP_ENDPOINT`), do **not** duplicate it — only confirm
  `OTEL_SEMCONV_STABILITY_OPT_IN` contains the `gen_ai_latest_experimental` token
  and move on. If the block is absent (this lane landed first), append it verbatim:

```bash
# -----------------------------------------------------------------------------
# OpenTelemetry (all services) — spec: 2026-07-20-superlog-observability §5
# -----------------------------------------------------------------------------

# OTLP/HTTP endpoint of the local collector. UNSET => telemetry is a graceful
# no-op in every service (never a localhost default).
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Stamped as deployment.environment.name on every signal. Only ever set
# "production" explicitly.
DEPLOYMENT_ENVIRONMENT=development

# Comma-separated opt-in tokens. `http/dup` bridges the JS HTTP semconv
# migration (Lane A); `gen_ai_latest_experimental` selects current gen_ai
# attribute names in the Python genai instrumentations (Lane B). Each SDK
# ignores tokens it does not recognize, so both live here together.
OTEL_SEMCONV_STABILITY_OPT_IN=http/dup,gen_ai_latest_experimental

# Set to "true" to run any service with telemetry fully off.
OTEL_SDK_DISABLED=
```

- [ ] Lint + full suite: `uv run ruff check src/ tests/ && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` → green.
- [ ] Commit:
  `git add packages/agents/src/arete_agents/observability.py packages/agents/tests/test_observability.py .env.example && git commit -m "feat(agents): env-driven init_observability() with views, log bridge, atexit flush" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6: Rewire `server.py` — kill the hardcoded exporter, clear lint debt, add `/health`, instrument FastAPI

**Files**
- Modify: `packages/agents/src/arete_agents/server.py` (delete lines 36–52 hardcoded OTel block; move the stragglers at lines 26–32 up into the import block; drop unused `PlainTextResponse` (F401); add `init_observability()` call, `/health`, `FastAPIInstrumentor`)
- Test (create): `packages/agents/tests/test_health.py`

**Interfaces**
- Consumes: `init_observability()` (Task 5), `FastAPIInstrumentor.instrument_app(app, excluded_urls="health")`
- Produces: `GET /health` → `200 {"status": "ok"}`, excluded from tracing; `server.py` passes `ruff check` with the existing `[tool.ruff.lint] select = ["E", "F", "I"]` gate (E402/F401 debt cleared)

**Steps**

- [ ] Write the failing tests at `packages/agents/tests/test_health.py`:

```python
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
```

- [ ] Run: `uv run pytest tests/test_health.py -v` → 404 on `/health` and empty `captured` → both fail.
- [ ] Also capture the current lint debt as evidence: `uv run ruff check src/arete_agents/server.py` → expect E402 findings (imports at lines 26–32 and 37–41 sit below executable statements) and F401 (`PlainTextResponse` imported, never used).
- [ ] Rewrite the head of `server.py`. The entire region from line 1 through the old line 52 (`trace.set_tracer_provider(provider)`) becomes:

```python
import logging
from typing import Any, Dict

from fastapi import BackgroundTasks, FastAPI, HTTPException
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from pydantic import BaseModel, ValidationError

from arete_agents.agents.chat import ChatAgent
from arete_agents.config import Settings, get_settings
from arete_agents.context_map.graph_export import GraphExportError, build_graph_export
from arete_agents.context_map.indexer import IndexerError, index_repository
from arete_agents.context_map.repo_cache import RepoCacheError, ensure_repo_checked_out
from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui
from arete_agents.fix_pipeline import run_fix
from arete_agents.llm.base import (
    get_llms_by_role,
    get_llms_by_role_from_config,
    role_tiers,
)
from arete_agents.llm.ollama import (
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_OLLAMA_MODEL,
    ollama_unavailable_reason,
)
from arete_agents.models.fix import FixRequest, FixResponse
from arete_agents.models.pr import LLMConfig, PRContext, ScanRequest
from arete_agents.observability import init_observability
from arete_agents.orchestrator import ReviewOrchestrator
from arete_agents.remediation import RemediationGraph
from arete_agents.scan import ScanUnavailableError, run_scan
from arete_agents.tools.executor import CommandExecutionError, get_command_executor

# Telemetry bootstrap. Import time == inside the uvicorn worker process
# (`uvicorn arete_agents.server:app`) — exporter threads must live in the
# serving process. No-ops (one INFO line) when OTEL_EXPORTER_OTLP_ENDPOINT is
# unset; never raises (telemetry must never take the app down). Replaces the
# old unconditional hardcoded gRPC exporter to localhost:4317.
init_observability()

_logger = logging.getLogger(__name__)

app = FastAPI()

# /health is excluded from tracing (spec §3): a container healthcheck on a
# 5s interval would otherwise dominate span volume for zero information.
try:
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health")
except Exception:
    _logger.warning("FastAPI instrumentation failed; serving untraced", exc_info=True)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe for compose healthchecks and LB checks. Excluded from
    tracing via excluded_urls above; must stay dependency-free (no DB, no
    LLM) so it answers even on a keyless boot."""
    return {"status": "ok"}
```

  Everything from the old line 54 comment (`# LLM-backed singletons are built LAZILY...`) onward is unchanged. Deleted entirely: the `PlainTextResponse` import, the two straggler import groups (old lines 26–32), and the whole `# OpenTelemetry Auto-Instrumentation` block (old lines 36–52).
- [ ] Run: `uv run pytest tests/test_health.py -v` → 2 passed.
- [ ] Ruff gate now clean: `uv run ruff check src/arete_agents/server.py` → no findings. (The gate itself is the existing CI `Lint` step + `select = ["E", "F", "I"]` — this task makes server.py actually pass it; do not add any `# noqa`.)
- [ ] Full suite: `uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` → green (server import no longer spins a gRPC exporter, so no behavior regression in existing endpoint tests).
- [ ] Commit:
  `git add packages/agents/src/arete_agents/server.py packages/agents/tests/test_health.py && git commit -m "feat(agents): replace hardcoded OTel block with init_observability(); add /health; clear E402/F401" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 7: structlog pipeline — censor processor + stdlib bridge + trace correlation

structlog → `ProcessorFormatter.wrap_for_formatter` → stdlib root handlers (console JSON + the OTel `LoggingHandler` Task 5 installed). Censor runs before any renderer/bridge, so secrets never reach console, file, or OTLP. Existing `logging.getLogger` call sites keep working and get censored via `foreign_pre_chain`.

**Files**
- Modify: `packages/agents/src/arete_agents/observability.py` (append structlog section)
- Modify: `packages/agents/src/arete_agents/server.py` (call `configure_structlog()` after `init_observability()`; make `_logger` a structlog logger with a `component` field)
- Test (create): `packages/agents/tests/test_structlog_pipeline.py`

**Interfaces**
- Consumes: `structlog` (Task 3), `is_blocked_key` / `scrub_text` / `REDACTED` (Task 4), root-logger `LoggingHandler` (Task 5)
- Produces:
  - `censor_processor(logger, method_name, event_dict) -> dict` (structlog processor signature)
  - `add_trace_context(logger, method_name, event_dict) -> dict`
  - `configure_structlog() -> None` (idempotent)

**Steps**

- [ ] Write the failing tests at `packages/agents/tests/test_structlog_pipeline.py`:

```python
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
    event = {
        "event": "llm call failed",
        "api_key": "sk-live1234567890",
        "detail": "retry with Bearer abc.def",
        "input_tokens": 42,
    }
    out = censor_processor(None, "info", dict(event))
    assert out["api_key"] == REDACTED
    assert "abc.def" not in out["detail"]
    assert REDACTED in out["detail"]
    assert out["input_tokens"] == 42  # token counts survive (§5 cardinality)


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
```

- [ ] Run: `uv run pytest tests/test_structlog_pipeline.py -v` → `ImportError` (names missing).
- [ ] Append to `observability.py` (add `import structlog` at the top of the file):

```python
# --- structlog pipeline ----------------------------------------------------

_STRUCTLOG_CONFIGURED = False


def censor_processor(logger, method_name, event_dict):
    """§5 redaction at log-creation time. Runs BEFORE any renderer or the
    stdlib bridge, so secrets never reach console, file, or the OTLP
    LoggingHandler — every sink sees only the censored event_dict."""
    for key in list(event_dict):
        value = event_dict[key]
        if is_blocked_key(key):
            event_dict[key] = REDACTED
        elif isinstance(value, str):
            event_dict[key] = scrub_text(value)
    return event_dict


def add_trace_context(logger, method_name, event_dict):
    """Stamp trace_id/span_id (spec §3: every log line carries trace_id when
    in a span). The OTel LoggingHandler adds them to the OTLP record on its
    own; this makes the console/file JSON carry them too."""
    ctx = trace.get_current_span().get_span_context()
    if ctx.is_valid:
        event_dict["trace_id"] = format(ctx.trace_id, "032x")
        event_dict["span_id"] = format(ctx.span_id, "016x")
    return event_dict


def configure_structlog() -> None:
    """structlog -> stdlib ProcessorFormatter bridge -> root handlers.

    ORDERING (load-bearing): call AFTER init_observability() — the OTel
    LoggingHandler must already sit on the root logger; this function only
    ADDS a console handler and never clears existing root handlers. Existing
    logging.getLogger() call sites flow through foreign_pre_chain, so they are
    censored and trace-stamped identically.
    """
    global _STRUCTLOG_CONFIGURED
    if _STRUCTLOG_CONFIGURED:
        return
    _STRUCTLOG_CONFIGURED = True

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        censor_processor,  # before ANY renderer/bridge (§5)
        add_trace_context,
        structlog.processors.TimeStamper(fmt="iso"),
    ]

    structlog.configure(
        processors=shared_processors
        + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )
    console_handler = logging.StreamHandler()  # stderr
    console_handler.setFormatter(formatter)
    root = logging.getLogger()
    root.addHandler(console_handler)
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)
```

- [ ] In `server.py`, directly under `init_observability()` add:

```python
from arete_agents.observability import configure_structlog, init_observability

init_observability()
# AFTER init_observability (OTel LoggingHandler already on root), per the
# bootstrap ordering contract documented in observability.py.
configure_structlog()
```

  and replace `_logger = logging.getLogger(__name__)` with:

```python
import structlog

_logger = structlog.get_logger(__name__).bind(component="server")
```

  (imports merged into the top import block, alphabetical — keep ruff `I` happy). The existing `_logger.info(...)`/`_logger.warning(...)` call sites in `server.py` keep their signatures (structlog's stdlib BoundLogger accepts %-style args). Other modules' `logging.getLogger` sites are intentionally left as-is — the `foreign_pre_chain` censors and trace-stamps them; migrating them to structlog field-style calls is mechanical follow-up owned by later feature work under the `instrument-every-feature` skill.
- [ ] Run: `uv run pytest tests/test_structlog_pipeline.py tests/test_health.py -v` → all pass.
- [ ] Full suite + lint: `uv run ruff check src/ tests/ && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` → green.
- [ ] Commit:
  `git add packages/agents/src/arete_agents/observability.py packages/agents/src/arete_agents/server.py packages/agents/tests/test_structlog_pipeline.py && git commit -m "feat(agents): structlog censor + stdlib bridge + trace-correlated logs" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 8: LLM instrumentation — genai hooks, LangChain callback layer, Ollama via openai-v2

Two layers, never doubled: provider-SDK layer = official contrib genai instrumentations (anthropic / google-genai / openai-v2); orchestration layer = Traceloop's `opentelemetry-instrumentation-langchain` (LangGraph/LangChain callbacks). Ollama must ride the openai-v2 hook, which requires switching `build_ollama_llm` from `ChatOllama` (native API — has **no** instrumentation) to `ChatOpenAI` against Ollama's OpenAI-compatible `/v1` endpoint. Token usage lands on spans as `gen_ai.usage.input_tokens`/`gen_ai.usage.output_tokens` and in `gen_ai.client.operation.duration` (bucketed by Task 5's Views) by the instrumentations themselves; provider identity is `gen_ai.provider.name` (never the deprecated `gen_ai.system`).

**Files**
- Modify: `packages/agents/src/arete_agents/observability.py` (fill in `_instrument_llm_layers`)
- Modify: `packages/agents/src/arete_agents/llm/ollama.py` (`build_ollama_llm` → `ChatOpenAI` on `/v1`)
- Modify: `packages/agents/pyproject.toml` (remove `langchain-ollama>=0.2.0` — no longer imported)
- Test (create): `packages/agents/tests/test_llm_instrumentation.py`
- Test (modify): `packages/agents/tests/test_llm_providers.py` (update any `ChatOllama` type expectation — check with `uv run pytest tests/test_llm_providers.py tests/test_ollama_fallback.py -q` and align assertions to `ChatOpenAI`)

**Interfaces**
- Consumes: `AnthropicInstrumentor`, `GoogleGenAiSdkInstrumentor`, `OpenAIInstrumentor`, `LangchainInstrumentor` (names verified in Task 3)
- Produces: `_instrument_llm_layers() -> None` (each hook individually wrapped, never raises); `build_ollama_llm(model: str = DEFAULT_OLLAMA_MODEL, base_url: str = DEFAULT_OLLAMA_BASE_URL) -> BaseChatModel`

**Steps**

- [ ] Write the failing tests at `packages/agents/tests/test_llm_instrumentation.py`:

```python
"""LLM instrumentation wiring: one hook per layer, never doubled; broken
instrumentation loses spans, never the service."""

import builtins
import sys
import types

from langchain_openai import ChatOpenAI

import arete_agents.observability as obs
from arete_agents.llm.ollama import DEFAULT_OLLAMA_MODEL, build_ollama_llm


def _fake_module(mod_name: str, cls_name: str, calls: list[str]) -> types.ModuleType:
    mod = types.ModuleType(mod_name)

    class _Instr:
        def instrument(self):
            calls.append(cls_name)

    setattr(mod, cls_name, _Instr)
    return mod


def test_instrument_llm_layers_calls_all_four(monkeypatch):
    calls: list[str] = []
    for mod_name, cls_name in (
        ("opentelemetry.instrumentation.anthropic", "AnthropicInstrumentor"),
        ("opentelemetry.instrumentation.google_genai", "GoogleGenAiSdkInstrumentor"),
        ("opentelemetry.instrumentation.openai_v2", "OpenAIInstrumentor"),
        ("opentelemetry.instrumentation.langchain", "LangchainInstrumentor"),
    ):
        monkeypatch.setitem(sys.modules, mod_name, _fake_module(mod_name, cls_name, calls))
    obs._instrument_llm_layers()
    assert calls == [
        "AnthropicInstrumentor",
        "GoogleGenAiSdkInstrumentor",
        "OpenAIInstrumentor",
        "LangchainInstrumentor",
    ]


def test_instrument_llm_layers_never_raises(monkeypatch):
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name.startswith("opentelemetry.instrumentation."):
            raise ImportError(f"forced failure for {name}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)
    obs._instrument_llm_layers()  # must not raise


def test_ollama_rides_the_openai_compatible_endpoint():
    llm = build_ollama_llm()
    # ChatOpenAI => the official openai-v2 genai instrumentation covers Ollama
    # (there is no Ollama-native instrumentation; never two hooks per layer).
    assert isinstance(llm, ChatOpenAI)
    assert str(llm.openai_api_base).rstrip("/") == "http://127.0.0.1:11434/v1"
    assert llm.model_name == DEFAULT_OLLAMA_MODEL


def test_ollama_custom_base_url_gets_v1_suffix():
    llm = build_ollama_llm(model="qwen2.5-coder", base_url="http://10.0.0.5:11434/")
    assert str(llm.openai_api_base).rstrip("/") == "http://10.0.0.5:11434/v1"
```

- [ ] Run: `uv run pytest tests/test_llm_instrumentation.py -v` → `_instrument_llm_layers` is a no-op stub and `build_ollama_llm` returns `ChatOllama` → failures.
- [ ] Replace the `_instrument_llm_layers` stub in `observability.py`:

```python
def _instrument_llm_layers() -> None:
    """Instrument the LLM stack — exactly one hook per layer (§4):

    * Provider-SDK layer: official contrib genai instrumentations. Emits
      llm client spans with gen_ai.provider.name (NOT deprecated
      gen_ai.system), gen_ai.usage.input_tokens / output_tokens, and the
      gen_ai.client.operation.duration histogram (bucketed by our Views).
      Ollama and OpenRouter ride the openai-v2 hook via their
      OpenAI-compatible endpoints (see llm/ollama.py, llm/openai.py).
    * Orchestration layer: Traceloop's LangChain callback instrumentation —
      LangGraph node/graph structure only. Traceloop's own provider-level
      packages must NEVER be installed alongside the contrib ones (duplicate
      spans; review-blocking).

    Content capture stays OFF (OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
    =false, set in init_observability): token counts and metadata only.
    Each hook is wrapped separately — a broken instrumentation loses that
    layer's spans, never the service.
    """
    try:
        from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor

        AnthropicInstrumentor().instrument()
    except Exception:
        _logger.warning("anthropic instrumentation unavailable", exc_info=True)
    try:
        from opentelemetry.instrumentation.google_genai import (
            GoogleGenAiSdkInstrumentor,
        )

        GoogleGenAiSdkInstrumentor().instrument()
    except Exception:
        _logger.warning("google-genai instrumentation unavailable", exc_info=True)
    try:
        from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor

        OpenAIInstrumentor().instrument()
    except Exception:
        _logger.warning("openai instrumentation unavailable", exc_info=True)
    try:
        from opentelemetry.instrumentation.langchain import LangchainInstrumentor

        LangchainInstrumentor().instrument()
    except Exception:
        _logger.warning("langchain instrumentation unavailable", exc_info=True)
```

- [ ] Rewrite `build_ollama_llm` in `packages/agents/src/arete_agents/llm/ollama.py` (drop the `from langchain_ollama import ChatOllama` import; everything else in the module — the probing helpers, constants, `_is_localhost` — stays byte-identical):

```python
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI


def build_ollama_llm(
    model: str = DEFAULT_OLLAMA_MODEL,
    base_url: str = DEFAULT_OLLAMA_BASE_URL,
) -> BaseChatModel:
    """Build a local Ollama chat client via Ollama's OpenAI-compatible /v1
    endpoint (ChatOpenAI), not langchain-ollama's native client. Deliberate
    (obs spec §4): the official opentelemetry-instrumentation-openai-v2 hook
    then covers Ollama calls — no Ollama-native instrumentation exists, and we
    never run two instrumentations of one layer. The "ollama" api_key is a
    placeholder the local server ignores (the OpenAI client requires one); it
    travels in the Authorization header like every real credential (§6 gate 1:
    headers, never URLs). Construction does not open a connection — an
    unreachable server or un-pulled model only surfaces on the first call,
    which the review path turns into an honest empty state via
    ollama_unavailable_reason (that probe still uses Ollama's native
    /api/tags, unchanged)."""
    return ChatOpenAI(
        model=model,
        api_key="ollama",
        base_url=f"{base_url.rstrip('/')}/v1",
        temperature=0.1,
    )
```

- [ ] Remove `"langchain-ollama>=0.2.0",` from `packages/agents/pyproject.toml` and run `uv sync --extra dev`.
- [ ] Run: `uv run pytest tests/test_llm_instrumentation.py -v` → 4 passed. Then `uv run pytest tests/test_llm_providers.py tests/test_ollama_fallback.py tests/test_review_byo.py -v`; update any assertion that expects `ChatOllama` to expect `ChatOpenAI` with `openai_api_base` ending in `/v1` (same semantics as `test_ollama_rides_the_openai_compatible_endpoint` above) — behavior contracts (honest-503 fallback, probe messages) must NOT change.
- [ ] Full suite + lint: `uv run ruff check src/ tests/ && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` → green.
- [ ] Commit:
  `git add packages/agents/src/arete_agents/observability.py packages/agents/src/arete_agents/llm/ollama.py packages/agents/pyproject.toml packages/agents/uv.lock packages/agents/tests/ && git commit -m "feat(agents): genai + langchain instrumentation; route Ollama through openai-v2 layer" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 9: ClickHouse DDL we own — single-node schema with TTLs + retention/deletion path

The exporter runs with `create_schema: false` (Task 10), so the DDL is ours. The mounted `schema/ha-replicated-otel.sql` is `ON CLUSTER superlog_ha` + `Replicated*MergeTree` — it **cannot execute on the single-node compose ClickHouse** (no such cluster/keeper), and most tables have no TTL. Produce a single-node variant matching the exporter's community table shapes (`otel_traces`, `otel_logs`, `otel_metrics_gauge/sum/summary/histogram/exp_histogram`) with spec TTLs: **raw signals 30 days, rollups 90 days**. Config task: the "test" is the verification command + expected output.

**Files**
- Create: `packages/db/clickhouse/schema/single-node-otel.sql` (derived mechanically from `ha-replicated-otel.sql` + TTL block)
- Create: `packages/db/clickhouse/migrations/008_full_retention_ttls.sql` (same TTLs for the HA deployment path)
- Create: `packages/db/clickhouse/RETENTION.md` (documented deletion path — §6 gate 3)

**Interfaces**
- Consumes: `packages/db/clickhouse/schema/ha-replicated-otel.sql` (source of table shapes — already matches the exporter's community DDL)
- Produces: an `init.sql`-mountable file that creates database `superlog` + all `otel_*` tables/MVs on a plain single-node server, every table carrying a TTL.

**Steps**

- [ ] Generate the single-node file mechanically (exact transform — no hand-editing of column lists):

```bash
cd packages/db/clickhouse
sed -E \
  -e 's/ ON CLUSTER superlog_ha//' \
  -e "s/ReplicatedMergeTree\('[^']*', '\{replica\}'\)/MergeTree/" \
  -e "s/ReplicatedSummingMergeTree\('[^']*', '\{replica\}'\)/SummingMergeTree/" \
  -e "s/ReplicatedAggregatingMergeTree\('[^']*', '\{replica\}'\)/AggregatingMergeTree/" \
  schema/ha-replicated-otel.sql > schema/single-node-otel.sql
```

- [ ] Append the retention block to `schema/single-node-otel.sql` (ALTERs run sequentially after the CREATEs in the same init file; `ttl_only_drop_parts = 1` is already set at creation, so enforcement drops whole expired parts):

```sql
-- ---------------------------------------------------------------------------
-- Retention (obs spec §3/§6 gate 3): raw signals 30 days, rollups/projections
-- 90 days. Revisit per table when real volume is visible (spec §10). The
-- documented deletion path lives in packages/db/clickhouse/RETENTION.md.
-- ---------------------------------------------------------------------------
-- Raw signal tables: 30 days.
ALTER TABLE superlog.otel_traces MODIFY TTL toDateTime(Timestamp) + toIntervalDay(30);
ALTER TABLE superlog.otel_logs MODIFY TTL TimestampTime + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_gauge MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_sum MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_summary MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_histogram MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_exp_histogram MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_traces_trace_id_ts MODIFY TTL Start + toIntervalDay(30);
-- Rollups / projections: 90 days.
ALTER TABLE superlog.otel_traces_recent MODIFY TTL toDateTime(ts) + toIntervalDay(90);
ALTER TABLE superlog.otel_traces_summary MODIFY TTL toDateTime(fromUnixTimestamp64Nano(end_unix_nano)) + toIntervalDay(90);
ALTER TABLE superlog.events_per_minute MODIFY TTL minute + toIntervalDay(90);
ALTER TABLE superlog.issue_activity_daily MODIFY TTL day + toIntervalDay(90);
ALTER TABLE superlog.otel_exceptions MODIFY TTL toDateTime(Timestamp) + toIntervalDay(90);
```

- [ ] Create `migrations/008_full_retention_ttls.sql` — the identical 13 statements with ` ON CLUSTER superlog_ha` inserted after each table name (pattern of `006_otel_traces_rollup_ttl.sql`), headed by:

```sql
-- Full retention pass (obs spec §3/§6 gate 3): raw signals 30d, rollups 90d.
-- Extends 006 (which capped only the trace-list rollups at 30d): rollups move
-- 30d -> 90d per spec; every raw otel_* table gains its missing 30d TTL.
-- MODIFY TTL is idempotent; ttl_only_drop_parts=1 enforces via part drops.
```

- [ ] Create `packages/db/clickhouse/RETENTION.md`:

```markdown
# Telemetry retention & deletion path

**Policy (obs spec §3/§6):** raw signals (`otel_traces`, `otel_logs`,
`otel_metrics_*`, `otel_traces_trace_id_ts`) — 30 days; rollups/projections
(`otel_traces_recent`, `otel_traces_summary`, `events_per_minute`,
`issue_activity_daily`, `otel_exceptions`) — 90 days. Numbers revisited per
table once real volume is visible (spec §10).

**Enforcement:** table-level `TTL` with `ttl_only_drop_parts = 1` — expiry
drops whole parts, no row rewrites. Single-node DDL:
`schema/single-node-otel.sql` (mounted as compose init). HA DDL:
`schema/ha-replicated-otel.sql` + `migrations/008_full_retention_ttls.sql`.

**On-demand deletion (per-project purge — run against every table):**

    ALTER TABLE superlog.otel_traces
      DELETE WHERE ResourceAttributes['superlog.project_id'] = {project:String};
    ALTER TABLE superlog.otel_logs
      DELETE WHERE ResourceAttributes['superlog.project_id'] = {project:String};
    -- repeat for otel_metrics_gauge/sum/summary/histogram/exp_histogram
    -- (same predicate), then the rollups by their project_id column:
    ALTER TABLE superlog.events_per_minute DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.issue_activity_daily DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.otel_exceptions DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.otel_traces_recent DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.otel_traces_summary DELETE WHERE project_id = {project:String};

Mutations are async: verify completion with
`SELECT * FROM system.mutations WHERE is_done = 0`. Full teardown:
`docker compose -f infra/docker-compose.yml down -v` drops the
`clickhouse_data` volume.
```

- [ ] Verify (the config-task "test"):

```bash
docker run --rm -d --name ch-ddl-test \
  -e CLICKHOUSE_DB=superlog -e CLICKHOUSE_USER=superlog -e CLICKHOUSE_PASSWORD=superlog \
  -v "$PWD/packages/db/clickhouse/schema/single-node-otel.sql:/docker-entrypoint-initdb.d/init.sql" \
  clickhouse/clickhouse-server:24.3-alpine
sleep 20
docker exec ch-ddl-test clickhouse-client -u superlog --password superlog \
  -q "SELECT count() FROM system.tables WHERE database='superlog'"
# expected: 20  (7 otel signal tables + trace_id_ts + 5 rollup tables + 7 MVs)
docker exec ch-ddl-test clickhouse-client -u superlog --password superlog \
  -q "SELECT count() FROM system.tables WHERE database='superlog' AND engine LIKE '%MergeTree%' AND NOT create_table_query LIKE '%TTL %'"
# expected: 0   (every MergeTree-family table carries a TTL)
docker exec ch-ddl-test clickhouse-client -u superlog --password superlog \
  -q "SHOW CREATE TABLE superlog.otel_traces" | grep -c "toIntervalDay(30)"
# expected: 1
docker rm -f ch-ddl-test
```

- [ ] Commit:
  `git add packages/db/clickhouse/schema/single-node-otel.sql packages/db/clickhouse/migrations/008_full_retention_ttls.sql packages/db/clickhouse/RETENTION.md && git commit -m "feat(db): single-node otel DDL with 30d/90d TTLs + documented deletion path" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 10: Collector config — redaction + transform processors, ClickHouse `create_schema: false`, Jaeger OTLP, logs pipeline

Config task: the "test" is `validate --config` against the 0.156.0 image.

**Files**
- Modify: `infra/otel-collector-config.yaml` (full rewrite below)

**Interfaces**
- Consumes: OTLP on `:4317` (gRPC) / `:4318` (HTTP) from all services; ClickHouse DDL (Task 9)
- Produces: pipelines `traces` → ClickHouse + Jaeger, `metrics` → ClickHouse + Prometheus (`:8889`), `logs` → ClickHouse; §5 redaction enforced collector-side as the last line of defense.

**Steps**

- [ ] Replace `infra/otel-collector-config.yaml` in full:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  # §5 redaction, collector-side (defense in depth behind the in-process
  # scrubbers). Allowlist mode OFF: allow_all_keys + key blocklist + value
  # patterns. Key patterns match whole segments so gen_ai.usage.input_tokens
  # is never masked by "token".
  redaction:
    allow_all_keys: true
    blocked_key_patterns:
      - (?i).*(^|[^a-z0-9])(authorization|x-api-key|api_key|token|secret|password|cookie|set-cookie)([^a-z0-9]|$).*
    blocked_values:
      - (?i)bearer\s+[a-z0-9._~+/=\-]+
      - sk-[A-Za-z0-9_\-]{8,}
      - gh[ps]_[A-Za-z0-9]{16,}
      - (?i)[?&](api_)?key=[^&#\s]+
    summary: info
  # Surgical OTTL passes for the places redaction's attribute scan can't
  # reach: URL attributes lose their entire query string; status/body text
  # loses key-in-URL shapes (the Superlog Gemini incident class).
  transform:
    error_mode: ignore
    trace_statements:
      - context: span
        statements:
          - replace_pattern(attributes["url.full"], "\\?.*$", "")
          - replace_pattern(attributes["http.url"], "\\?.*$", "")
          - replace_pattern(status.message, "(?i)[?&](api_)?key=[^&#\\s]+", "?key=[REDACTED]")
    log_statements:
      - context: log
        statements:
          - replace_pattern(body.string, "(?i)bearer\\s+[a-z0-9._~+/=\\-]+", "[REDACTED]")
          - replace_pattern(body.string, "(?i)[?&](api_)?key=[^&#\\s]+", "?key=[REDACTED]")
  batch: {}

exporters:
  clickhouse:
    endpoint: tcp://clickhouse:9000?dial_timeout=10s&compress=lz4
    database: superlog
    username: superlog
    password: superlog
    # We own the DDL (packages/db/clickhouse, TTLs included). The exporter
    # must never race replicas creating TTL-less tables at startup.
    create_schema: false
    traces_table_name: otel_traces
    logs_table_name: otel_logs
    metrics_table_name: otel_metrics
    timeout: 5s
    retry_on_failure:
      enabled: true
  # Jaeger v2 speaks OTLP — the legacy jaeger exporter is gone.
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true
  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: arete
  # Debug exporter (the old `logging:` exporter was removed upstream).
  debug:
    verbosity: basic

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [redaction, transform, batch]
      exporters: [clickhouse, otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [redaction, batch]
      exporters: [clickhouse, prometheus]
    logs:
      receivers: [otlp]
      processors: [redaction, transform, batch]
      exporters: [clickhouse]
```

- [ ] Verify (expected: exit 0, no error output):

```bash
docker run --rm -v "$PWD/infra/otel-collector-config.yaml:/etc/otelcol/config.yaml" \
  otel/opentelemetry-collector-contrib:0.156.0 validate --config=/etc/otelcol/config.yaml
```

  If `validate` rejects a field name (processor schemas drift between contrib minors), fix the field per the error message and re-run until exit 0 — the pipeline shape and the §5 pattern set above are the contract and must not be reduced.
- [ ] Update the CI `Validate collector config` step (Task 2) image tag `0.100.0` → `0.156.0` in `.github/workflows/ci.yml` (same commit — CI must validate with the runtime image).
- [ ] Commit:
  `git add infra/otel-collector-config.yaml .github/workflows/ci.yml && git commit -m "feat(infra): collector redaction+transform pipelines, clickhouse create_schema:false, jaeger otlp, logs pipeline" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 11: Promote the OTel stack into the default `infra/docker-compose.yml`

Merge `docker-compose-otel.yml` into the default stack (spec: "the promoted collector"), replacing Jaeger v1 with the v2 all-in-one, bumping the collector to contrib 0.156.0, and mounting the Task-9 single-node DDL. Config task: verification commands below.

**Files**
- Modify: `infra/docker-compose.yml` (add `otel-collector`, `jaeger`, `prometheus`; switch the clickhouse init mount)
- Delete: `infra/docker-compose-otel.yml`
- Modify: `.github/workflows/ci.yml` (drop the now-deleted otel compose validation step)
- Unchanged: `infra/prometheus.yml` (already scrapes `otel-collector:8889`)

**Interfaces**
- Consumes: `infra/otel-collector-config.yaml` (Task 10), `packages/db/clickhouse/schema/single-node-otel.sql` (Task 9)
- Produces: `pnpm infra:up` boots postgres, redis, clickhouse (with otel DDL), otel-collector (4317/4318/8889), jaeger v2 (UI 16686), prometheus (9090) on the compose default network.

**Steps**

- [ ] Rewrite `infra/docker-compose.yml` in full:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: arete
      POSTGRES_PASSWORD: arete
      POSTGRES_DB: arete
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U arete"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  clickhouse:
    image: clickhouse/clickhouse-server:24.3-alpine
    environment:
      CLICKHOUSE_DB: superlog
      CLICKHOUSE_USER: superlog
      CLICKHOUSE_PASSWORD: superlog
    ports:
      - "8123:8123"
      - "9000:9000"
    volumes:
      - clickhouse_data:/var/lib/clickhouse
      # Single-node DDL with TTLs (packages/db/clickhouse/RETENTION.md). The
      # HA schema (ha-replicated-otel.sql) is ON CLUSTER and cannot boot here.
      - ../packages/db/clickhouse/schema/single-node-otel.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8123/ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  # --- observability stack (obs spec §3 "Infra promotion") -------------------

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.156.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"  # OTLP gRPC in
      - "4318:4318"  # OTLP HTTP in (services default here)
      - "8889:8889"  # Prometheus scrape endpoint
    depends_on:
      clickhouse:
        condition: service_healthy
      jaeger:
        condition: service_started

  # Jaeger v2 all-in-one (OTLP-native). v1 + the npm Jaeger exporter are
  # legacy; the collector exports OTLP to jaeger:4317 on the compose network.
  jaeger:
    image: jaegertracing/jaeger:2.13.0
    ports:
      - "16686:16686"  # UI

  prometheus:
    image: prom/prometheus:v2.52.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"  # UI

volumes:
  postgres_data:
  redis_data:
  clickhouse_data:
```

- [ ] `git rm infra/docker-compose-otel.yml` and delete the `Validate otel compose file` step from `.github/workflows/ci.yml` (the remaining steps now validate the one true stack).
- [ ] Verify — parse: `docker compose -f infra/docker-compose.yml config --quiet` → exit 0, no warnings.
- [ ] Verify — boot (destroy the old clickhouse volume so init.sql re-runs):

```bash
docker compose -f infra/docker-compose.yml down -v
pnpm infra:up
sleep 25
docker compose -f infra/docker-compose.yml ps          # all services Up; clickhouse healthy
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:16686   # 200 (Jaeger v2 UI)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9090/-/ready  # 200 (Prometheus)
curl -s -X POST http://localhost:4318/v1/traces -H "Content-Type: application/json" -d '{"resourceSpans":[]}'
# expected: {"partialSuccess":{}}   (collector OTLP/HTTP alive)
docker exec infra-clickhouse-1 clickhouse-client -u superlog --password superlog \
  -q "SELECT count() FROM system.tables WHERE database='superlog'"
# expected: 20
docker logs infra-otel-collector-1 --tail 20   # no exporter errors (clickhouse reachable, schema found)
```

  (If the compose project prefixes container names differently, use `docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client ...` / `... logs otel-collector`.)
- [ ] Commit:
  `git add infra/docker-compose.yml .github/workflows/ci.yml && git rm infra/docker-compose-otel.yml && git commit -m "feat(infra): promote otel collector 0.156, jaeger v2, prometheus into default compose" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 12: Per-signal verification harness

Spec §5 Verification, verbatim contract: drive one span, one metric batch, one log through the real bootstrap; confirm HTTP 2xx per endpoint (`/v1/traces`, `/v1/logs`, `/v1/metrics`) **and** inspect OTLP partial-success payloads (a 200 can still drop records). "Traces work" says nothing about logs.

**Files**
- Create: `packages/agents/scripts/verify_telemetry.py`

**Interfaces**
- Consumes: `init_observability`, `get_tracer`, `get_meter` (Task 5); running collector (Task 11); env `OTEL_EXPORTER_OTLP_ENDPOINT`
- Produces: exit 0 only when all three signals return 2xx with an empty/absent partial-success rejection; prints one evidence line per endpoint (paste into PR bodies).

**Steps**

- [ ] Create `packages/agents/scripts/verify_telemetry.py`:

```python
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
```

- [ ] "Failing test" run first — collector **down** (`docker compose -f infra/docker-compose.yml stop otel-collector`), from `packages/agents`:
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 uv run python scripts/verify_telemetry.py` → three `FAIL POST ... Connection refused` lines, exit 1. (Proves the harness cannot false-positive.)
- [ ] Bring the collector back (`docker compose -f infra/docker-compose.yml start otel-collector`) and re-run → expected output, exit 0:

```
PASS POST /v1/traces -> 200 partialSuccess={}
PASS POST /v1/logs -> 200 partialSuccess={}
PASS POST /v1/metrics -> 200 partialSuccess={}
```

- [ ] Confirm the bootstrap-driven signals landed in ClickHouse (Part A end-to-end):

```bash
docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client -u superlog --password superlog \
  -q "SELECT count() FROM superlog.otel_traces WHERE ServiceName='arete-agents' AND SpanName='verify.bootstrap'"
# expected: >= 1
docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client -u superlog --password superlog \
  -q "SELECT count() FROM superlog.otel_logs WHERE ServiceName='arete-agents' AND Body LIKE '%verify.bootstrap%'"
# expected: >= 1
docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client -u superlog --password superlog \
  -q "SELECT MetricName, ExplicitBounds FROM superlog.otel_metrics_histogram WHERE MetricName='arete.review.duration' LIMIT 1"
# expected: arete.review.duration  [1,2,5,10,30,60,120,180,300]  <- Views applied
```

- [ ] `uv run ruff check scripts/verify_telemetry.py` → clean.
- [ ] Commit:
  `git add packages/agents/scripts/verify_telemetry.py && git commit -m "feat(agents): per-signal OTLP verification harness (status + partial-success)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 13: Credential audit — keys in headers, never URLs (all four provider clients)

Phase-1 security gate 1 (spec §6). Superlog's case study: a Gemini key passed as `?key=` was captured into span status + stacktraces, retained indefinitely.

**Audit checklist (record PASS/FAIL per line in the PR body):**
1. `llm/anthropic.py` — `ChatAnthropic(api_key=...)` → anthropic SDK → `x-api-key` header. Verify via constructed-client inspection below.
2. `llm/openai.py` — `ChatOpenAI(api_key=...)` → openai SDK → `Authorization: Bearer` header. Verify via wire capture below (MockTransport).
3. `llm/ollama.py` — placeholder key in `Authorization` header via the same openai path (Task 8); `base_url` must never embed credentials.
4. `llm/gemini.py` — `ChatGoogleGenerativeAI(google_api_key=...)` hands the key to the Google client library (gRPC transport, `x-goog-api-key` request metadata). **Repo code does not build any URL from the key — verified by the greps below.** Residual risk is inside the SDK (its REST fallback historically used `?key=`): covered defense-in-depth by the Task-4 span scrubber (`url.full`/`http.url` query strips + `[?&]key=` value pattern) and the Task-10 collector redaction. If any future wire capture shows the key in a URL, the fix pattern is: pass the key ONLY via the client's header/credentials parameter (`google_api_key=`/`api_key=`), never concatenated into `base_url`, `endpoint`, or any query string — and rotate the exposed key immediately.
5. Telemetry-connector/Octokit/Stripe clients are Lane A's audit (TS side) — note the split in the PR body.

**Files**
- Test (create): `packages/agents/tests/test_credential_audit.py`

**Interfaces**
- Consumes: `build_anthropic_llm`, `build_gemini_llm`, `build_openai_llm`, `build_ollama_llm`
- Produces: a CI-enforced regression test that any provider client putting its key into a URL fails the build.

**Steps**

- [ ] Static sweep first (evidence for checklist lines; expected: no hits — any hit is a finding to fix in this task):

```bash
grep -rn "key=" packages/agents/src/arete_agents/llm/ --include="*.py" | grep -v "api_key=api_key\|google_api_key=\|api_key: \|api_key=\"ollama\"\|api_key or\|api_key=CANARY"
grep -rnE "f\".*(api_key|key)=\{" packages/agents/src/arete_agents/
```

- [ ] Write the test at `packages/agents/tests/test_credential_audit.py`:

```python
"""§6 gate 1: credentials travel in headers, never URLs or query params.

The wire-level test uses httpx.MockTransport so the openai-compatible path
(openai, openrouter, ollama) is proven at the actual request; anthropic and
gemini are proven by constructed-client inspection (their SDKs own the wire).
"""

import httpx
from langchain_openai import ChatOpenAI

from arete_agents.llm.anthropic import build_anthropic_llm
from arete_agents.llm.gemini import build_gemini_llm
from arete_agents.llm.ollama import build_ollama_llm
from arete_agents.llm.openai import build_openai_llm

CANARY = "arete-audit-canary-key-12345"

_URL_FIELD_NAMES = (
    "base_url",
    "openai_api_base",
    "anthropic_api_url",
    "endpoint",
    "api_base",
)


def _url_fields(client) -> list[str]:
    values = []
    for name in _URL_FIELD_NAMES:
        value = getattr(client, name, None)
        if value:
            values.append(str(value))
    return values


def test_anthropic_key_never_in_url_fields():
    llm = build_anthropic_llm(CANARY)
    assert all(CANARY not in url for url in _url_fields(llm))


def test_openai_key_never_in_url_fields():
    llm = build_openai_llm(api_key=CANARY)
    assert all(CANARY not in url for url in _url_fields(llm))


def test_gemini_key_never_in_url_fields_or_transport_host():
    llm = build_gemini_llm(CANARY)
    assert all(CANARY not in url for url in _url_fields(llm))
    transport = getattr(getattr(llm, "client", None), "_transport", None)
    host = str(getattr(transport, "host", ""))
    assert CANARY not in host


def test_openai_compatible_wire_key_in_header_not_url():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization", "")
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-audit",
                "object": "chat.completion",
                "created": 0,
                "model": "audit-model",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "ok"},
                    "finish_reason": "stop",
                }],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            },
        )

    llm = ChatOpenAI(
        model="audit-model",
        api_key=CANARY,
        base_url="http://ollama.audit.test/v1",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    llm.invoke("ping")
    assert CANARY not in seen["url"]
    assert seen["authorization"] == f"Bearer {CANARY}"


def test_ollama_base_url_carries_no_credentials():
    llm = build_ollama_llm(base_url="http://127.0.0.1:11434")
    base = str(llm.openai_api_base)
    assert "key=" not in base and "@" not in base.split("//", 1)[1]
```

- [ ] Run: `uv run pytest tests/test_credential_audit.py -v`. Any failure here is a real §6 finding: apply the fix pattern from checklist item 4 (key to header/credentials param, never URL), then rotate the affected key and note it in the PR body. Expected with current code: 5 passed.
- [ ] Copy the completed checklist (PASS/FAIL + evidence lines) into the PR body.
- [ ] Commit:
  `git add packages/agents/tests/test_credential_audit.py && git commit -m "test(agents): credential audit — provider keys in headers, never URLs (§6 gate 1)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 14: Canary scrub test in CI (log + span attribute + raised exception)

Phase-1 security gate 2 (spec §6): a fake secret injected into a log line, a span attribute, and a raised exception must not appear in exporter output — asserted against in-memory SDK sinks, which see exactly what the OTLP exporters would serialize.

**Files**
- Test (create): `packages/agents/tests/test_canary_scrub.py`

**Interfaces**
- Consumes: `ScrubbingSpanProcessor`, `censor_processor`, `REDACTED` (Tasks 4/7); `InMemorySpanExporter`; `InMemoryLogExporter` + `LoggingHandler`
- Produces: CI-enforced gate — any regression that lets a secret shape reach a sink fails the build.

**Steps**

- [ ] Write the test at `packages/agents/tests/test_canary_scrub.py`:

```python
"""§6 gate 2: canary secrets must never reach an exporter sink.

CANARY shapes match the §5 value patterns (sk-/ghp_/bearer). In-memory
exporters are the assertion point: they receive the same objects the OTLP
exporters serialize, so a pass here means the secret cannot leave the process.
"""

import logging

import pytest
import structlog
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

try:
    from opentelemetry.sdk.logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk.logs.export import SimpleLogRecordProcessor
    from opentelemetry.sdk.logs.export.in_memory_log_exporter import InMemoryLogExporter
except ImportError:  # pre-stable module layout
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import SimpleLogRecordProcessor
    from opentelemetry.sdk._logs.export.in_memory_log_exporter import InMemoryLogExporter

from arete_agents.observability import (
    REDACTED,
    ScrubbingSpanProcessor,
    censor_processor,
)

SK_CANARY = "sk-canary1234567890abcdef"
GH_CANARY = "ghp_CANARYABCDEFGHIJKLMNOP1234"


def _span_sink() -> tuple[TracerProvider, InMemorySpanExporter]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(ScrubbingSpanProcessor())
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider, exporter


def _span_dump(exporter: InMemorySpanExporter) -> str:
    parts = []
    for span in exporter.get_finished_spans():
        parts.append(str(dict(span.attributes or {})))
        parts.append(str(span.status.description or ""))
        for event in span.events:
            parts.append(str(dict(event.attributes or {})))
    return " ".join(parts)


def test_canary_in_span_attribute_never_reaches_sink():
    provider, exporter = _span_sink()
    tracer = provider.get_tracer("canary")
    with tracer.start_as_current_span("llm.generate") as span:
        span.set_attribute("anthropic_api_key", SK_CANARY)  # blocked key
        span.set_attribute("note", f"retrying with {GH_CANARY}")  # value shape
    dump = _span_dump(exporter)
    assert SK_CANARY not in dump
    assert GH_CANARY not in dump
    assert REDACTED in dump


def test_canary_in_raised_exception_never_reaches_sink():
    provider, exporter = _span_sink()
    tracer = provider.get_tracer("canary")
    with pytest.raises(RuntimeError):
        with tracer.start_as_current_span("llm.generate"):
            raise RuntimeError(f"provider rejected key {SK_CANARY}")
    dump = _span_dump(exporter)
    assert SK_CANARY not in dump
    assert REDACTED in dump


def test_canary_in_log_line_never_reaches_sink():
    exporter = InMemoryLogExporter()
    provider = LoggerProvider()
    provider.add_log_record_processor(SimpleLogRecordProcessor(exporter))
    handler = LoggingHandler(level=logging.INFO, logger_provider=provider)
    stdlib_logger = logging.getLogger("canary-log-test")
    stdlib_logger.addHandler(handler)
    stdlib_logger.setLevel(logging.INFO)
    try:
        # structlog path: censor runs before the stdlib bridge hands the
        # event to ANY handler — including the OTel one.
        structlog.configure(
            processors=[
                censor_processor,
                structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
            ],
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=False,
        )
        structlog.get_logger("canary-log-test").info(
            "provider call failed",
            api_key=SK_CANARY,
            detail=f"bearer {SK_CANARY}",
        )
    finally:
        stdlib_logger.removeHandler(handler)
        structlog.reset_defaults()

    dump = " ".join(
        str(data.log_record.body) + str(dict(data.log_record.attributes or {}))
        for data in exporter.get_finished_logs()
    )
    assert SK_CANARY not in dump
    assert REDACTED in dump
```

- [ ] Run: `uv run pytest tests/test_canary_scrub.py -v` → 3 passed (the scrubber and censor already exist; this task's value is the permanent CI gate — if any test fails, that is a live leak: fix the scrubber/censor, never the test).
- [ ] Prove it gates: temporarily comment out the `censor_processor` line inside the structlog `processors=[...]` list in the test, run → the log test must FAIL; restore it, run → green. (This mutation check is evidence the gate bites; do not commit the mutation.)
- [ ] Full suite: `uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q` → green.
- [ ] Commit:
  `git add packages/agents/tests/test_canary_scrub.py && git commit -m "test(agents): canary scrub gate — secrets never reach span/log sinks (§6 gate 2)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 15: `debug-from-telemetry` skill + agents-package steering file

Spec §3: policy-as-code skill #2, "when debugging, query the local stack (Jaeger/ClickHouse) before guessing", fitting the existing AGENTS.md-per-package steering convention (cf. `packages/dashboard/AGENTS.md` + `CLAUDE.md` → `@AGENTS.md`). The repo has no `.claude/skills/` yet — this creates it in the standard Claude Code layout; `packages/agents/AGENTS.md` (new) points at it.

**Files**
- Create: `.claude/skills/debug-from-telemetry/SKILL.md`
- Create: `packages/agents/AGENTS.md`
- Create: `packages/agents/CLAUDE.md` (one line: `@AGENTS.md`, matching the dashboard pattern)

**Interfaces**
- Consumes: the running stack (Task 11), harness (Task 12)
- Produces: an agent-readable skill; no secrets in any skill/AGENTS.md file (§6 Phase-2 rule honored from day one).

**Steps**

- [ ] Create `.claude/skills/debug-from-telemetry/SKILL.md`:

```markdown
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
```

- [ ] Create `packages/agents/AGENTS.md`:

```markdown
# arete-agents steering

- **Observability:** the ONLY telemetry bootstrap is
  `src/arete_agents/observability.py::init_observability()` (called from
  `server.py`, in-worker). Never construct exporters/providers elsewhere.
  Unset `OTEL_EXPORTER_OTLP_ENDPOINT` == telemetry off; telemetry failures
  must never crash the service.
- **Logging:** structlog through `configure_structlog()`; no new bare
  `print()` in server code. Secrets are censored by
  `observability.censor_processor` — extend `BLOCKLIST_KEYS`/value patterns
  (and their tests) when the log surface grows; §5 of the obs spec is frozen.
- **Metrics:** dimensions are closed low-cardinality sets (role, outcome,
  provider, model). Repo names, PR numbers, installation ids, SHAs → span
  attributes only, NEVER metric dimensions (review-blocking).
- **Debugging:** use the `debug-from-telemetry` skill
  (`.claude/skills/debug-from-telemetry/SKILL.md`) — query Jaeger/ClickHouse
  before guessing.
```

- [ ] Create `packages/agents/CLAUDE.md` containing exactly:

```markdown
@AGENTS.md
```

- [ ] Verify: every SQL/table/env name in the skill matches this plan (`superlog.otel_traces`, `gen_ai.usage.input_tokens`, port 16686, harness path); `grep -riE "sk-[a-z0-9]|ghp_|api[_-]?key *= *[A-Za-z0-9]" .claude/skills packages/agents/AGENTS.md` → no hits (no secrets in skill files).
- [ ] Commit:
  `git add .claude/skills/debug-from-telemetry/SKILL.md packages/agents/AGENTS.md packages/agents/CLAUDE.md && git commit -m "docs(agents): debug-from-telemetry skill + agents package steering" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 16: Final gate — full DoD run with per-signal evidence

Everything below must pass, with outputs captured verbatim into PR-5's body (and the phase status doc). No success claims without the command output in hand.

**Files**
- No new files. Evidence only.

**Interfaces**
- Consumes: everything above.
- Produces: the Lane-B slice of the Phase 0/1 exit evidence.

**Steps**

- [ ] **Test suites green:**
  - `pnpm --filter @arete/dashboard test` → 0 failures (includes Task 1's `queries.clickhouse.test.ts`).
  - From `packages/agents`: `uv run ruff check src/ tests/ scripts/` → no findings (E402/F401 debt gone, no `noqa` added).
  - `LLM_PROVIDER=gemini GEMINI_API_KEY=test-key-not-real uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -v` → 0 failures, **0 skipped tests added by this lane**.
- [ ] **Infra validation (the CI job, run locally):**
  - `docker compose -f infra/docker-compose.yml config --quiet` → exit 0.
  - `docker run --rm -v "$PWD/infra/otel-collector-config.yaml:/etc/otelcol/config.yaml" otel/opentelemetry-collector-contrib:0.156.0 validate --config=/etc/otelcol/config.yaml` → exit 0.
- [ ] **Per-signal verification evidence (spec §5, verbatim requirement — status codes AND partial-success):** with the stack up (`pnpm infra:up`), from `packages/agents`:
  - `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 uv run python scripts/verify_telemetry.py` → paste the three lines; required:
    ```
    PASS POST /v1/traces -> 200 partialSuccess={}
    PASS POST /v1/logs -> 200 partialSuccess={}
    PASS POST /v1/metrics -> 200 partialSuccess={}
    ```
    exit code 0. Any non-empty `rejectedSpans`/`rejectedLogRecords`/`rejectedDataPoints` is a FAIL even on HTTP 200 — diagnose via `docker compose -f infra/docker-compose.yml logs otel-collector` before proceeding.
- [ ] **End-to-end service check (real server, real stack):** from `packages/agents`:
  - `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 LLM_PROVIDER=gemini GEMINI_API_KEY=test-key-not-real uv run uvicorn arete_agents.server:app --port 8000` (background), then:
  - `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/health` → `200`.
  - Hit it 5×, wait ~10s (batch flush), then:
    `docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client -u superlog --password superlog -q "SELECT count() FROM superlog.otel_traces WHERE ServiceName='arete-agents' AND SpanName LIKE '%/health%'"` → `0` (**/health excluded from tracing** — spec §3 exit criterion).
  - `curl -s "http://localhost:16686/api/services" | grep -c arete-agents` → `1` (agents service visible in Jaeger v2).
  - Stop the server; unset `OTEL_EXPORTER_OTLP_ENDPOINT` and boot once more → starts clean with the single INFO no-op line (graceful-degradation evidence).
- [ ] **Security gates (§6):** paste the Task-13 audit checklist (all PASS) and the Task-14 canary results (`uv run pytest tests/test_canary_scrub.py tests/test_credential_audit.py -v` → all passed); TTL evidence: `docker compose -f infra/docker-compose.yml exec clickhouse clickhouse-client -u superlog --password superlog -q "SELECT count() FROM system.tables WHERE database='superlog' AND engine LIKE '%MergeTree%' AND NOT create_table_query LIKE '%TTL %'"` → `0`; deletion path = `packages/db/clickhouse/RETENTION.md` (link it).
- [ ] **No-new-print gate:** `grep -rc "print(" packages/agents/src/arete_agents --include="*.py" | awk -F: '{s+=$2} END {print s}'` → number ≤ the pre-lane baseline (record the baseline from `git show integration-preview -- packages/agents` at PR time; this lane adds zero).
- [ ] **DoD checklist:** copy the six-item §8 checklist (see Global Constraints) into PR-5's body with every box checked and the evidence above attached.
- [ ] Open the remaining PRs per the Global Constraints bundling; merge order PR-1 → PR-5 into `integration-preview` after review.

---

## Self-review (performed before saving this plan)

- **Lane-B spec coverage:** Phase 0 — queries.ts parameterization (T1), compose-validation CI (T2), agents CI deps (T2/T3). Phase 1 — `observability.py` bootstrap with resource/providers/env-endpoint/no-op/atexit/never-crash/proxy-safety (T5), E402/F401 + ruff gate (T6), FastAPI instrumentation + `/health` excluded (T6), structlog bridge + censor + OTel-before-structlog ordering (T7), genai instrumentations + Traceloop langchain + Ollama-via-openai-v2 + semconv opt-in + content-off + token attrs (T8), histogram Views [1..300] (T5, verified in T12), span scrubber (T4), compose promotion with collector 0.156/Jaeger v2/Prometheus/ClickHouse (T11), collector redaction+transform+`create_schema:false`+Jaeger OTLP+Prometheus (T10), ClickHouse DDL + TTLs 30/90 + deletion path (T9), per-signal harness with partial-success inspection (T12), credential audit incl. gemini (T13), canary scrub (T14), `debug-from-telemetry` skill (T15), final DoD + evidence (T16). ✔
- **Placeholder scan:** no "TBD", no "appropriate error handling", no "similar to Task N"; every code step is complete. ✔
- **Name consistency:** `init_observability` / `configure_structlog` / `censor_processor` / `add_trace_context` / `scrub_text` / `is_blocked_key` / `ScrubbingSpanProcessor` / `LLM_DURATION_BOUNDARIES` / `OTEL_EXPORTER_OTLP_ENDPOINT` / `DEPLOYMENT_ENVIRONMENT` used identically across Tasks 4–16. ✔
