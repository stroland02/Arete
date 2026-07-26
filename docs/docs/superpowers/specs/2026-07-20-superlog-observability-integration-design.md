# Superlog Methodology Integration — Design & Roadmap

**Date:** 2026-07-20
**Status:** Approved design (pending implementation plan)
**Basis:** `docs/SUPERLOG.md`, `docs/SUPERLOG_ARCHITECTURE.md`, `docs/SUPERLOG_AGENT_RUNNER.md`, `docs/SUPERLOG_SECURITY.md` (Rev2/source-verified docs are authoritative; Rev1 copies retained for provenance)
**Relation to existing roadmap:** Extends `docs/roadmap/2026-07-15-superlog-phased-roadmap.md`. This initiative slots in where that roadmap deferred "telemetry ingestion platform" (its Phase 4) and supplies the observability foundation the other phases assumed. The roadmap doc gets a pointer to this spec as a Phase-0 work item.

---

## 1. Goal

Apply the engineering methodology documented in the SUPERLOG reference docs to Areté itself, in this order of value:

1. **Instrument ourselves first** — make Areté fully observable using vendor-neutral OpenTelemetry, fixing the known gaps (two dark wires, hardcoded exporter, 108 unstructured `console.*` calls, missing health checks).
2. **Upgrade the healing engine** with the agent-runner patterns (rubrics, budgets, memory, dispatch-before-ack).
3. **Build the tenant telemetry platform last**, informed by running our own pipeline.

Security findings from the threat model are **woven into every phase as Definition-of-Done gates**, never a separate deferred phase — the core lesson being that secrets leaked into telemetry stores are effectively permanent.

## 2. Decisions locked with the user (2026-07-20)

| Decision | Choice |
|---|---|
| Primary goal | Instrument Areté first; platform features later |
| Backend | Own local stack: Collector → ClickHouse (+ Jaeger v2, Prometheus), promoted into the default `infra/docker-compose.yml` |
| Agent split | By service/language: Agent A = TypeScript, Agent B = Python + infra |
| Roadmap fit | Extend the existing 2026-07-15 roadmap; same ledger/spec/status process |
| Phase order after instrumentation | Healing-agent upgrade next; tenant platform last |
| Security | Woven into every phase as DoD gates |
| Ceremony | Existing process + DoD checklists, prioritized backlog file, phase-end retros |
| Policy-as-code | Two agent-readable skills delivered in Phase 1 |
| Phase 0 | Yes — CI/quality-gate hardening before instrumentation |
| Dashboards | Jaeger + our own dashboard charts; alerting lands in Phase 2; no Grafana |
| Git flow | Lane branches → PR per work item → `integration-preview` → serving branch at phase boundaries |
| Logging | Real libraries: pino (TS), structlog (Python) |
| Code shape | Shared `packages/telemetry` (TS) + single `arete_agents/observability.py`; dashboard uses a thin `@vercel/otel` instrumentation.ts sharing only conventions/redaction config |

## 3. Phases

### Phase 0 — Trustworthy gates (small; both agents)

The SUPERLOG verification discipline ("evidence per signal, never declare success without it") only works if CI actually runs the tests.

- CI jobs for the four uncovered packages: `orchestration`, `topology`, `net-guard`, `db`.
- Root aggregate script: one command runs every package's tests (TS + Python).
- ESLint for `packages/webhook` (its "lint" is currently only `tsc --noEmit`).
- Fix or quarantine the flaky `pipeline.integration.test.ts` (shared-mock interference under parallelism).
- Fix pre-existing ClickHouse SQL interpolation in `packages/dashboard/src/lib/queries.ts` (~line 788, `installationIds` string-joined into SQL) — that read path is about to become hot.
- Coverage reporting turned on, thresholds advisory (not blocking) initially.

**Exit criteria:** every package gated in CI; one-command test run; all green; flake resolved or quarantined with an issue.

### Phase 1 — Instrument Areté (core phase; two parallel lanes)

**Signals and where they come from:**

- **Traces:** webhook HTTP entry (Express instrumentation) → BullMQ enqueue → worker job processing (first-party `bullmq-otel` propagates context through Redis automatically) → agents FastAPI (service-to-service) → LangGraph nodes → LLM calls (`gen_ai.*`) → outbound HTTP. One trace covers a full PR review.
- **Metrics:** review lifecycle counters/histograms, LLM token usage + duration, queue depth/latency, HTTP server durations. Explicit histogram boundaries up to 300 s for LLM/review durations (default 10 s ceiling silently corrupts p95/p99 — Superlog hit exactly this).
- **Logs:** every existing log call structured (pino / structlog), auto-stamped with `trace_id`/`span_id`, shipped via OTLP alongside file/console output. Existing `[tag]` prefixes become a structured `component` field.

**The two dark wires get lit:**
- ClickHouse: the promoted collector writes `otel_traces`/`otel_logs`/`otel_metrics_*`, feeding the dashboard's existing read path (`clickhouse.ts`, `queries.ts:getAgentEventsPerMinute`).
- Redis SSE: the worker publishes review-lifecycle events to the `agent_metrics` channel that `sse-handler.ts` already consumes.

**Infra promotion:** `infra/docker-compose-otel.yml` contents merge into the default stack — OTel Collector Contrib, ClickHouse, Jaeger v2 all-in-one (v1 + npm Jaeger exporter are legacy), Prometheus. Collector config gains `redaction` + `transform` processors; ClickHouse exporter runs with `create_schema: false` and we own the DDL — **with TTLs** (raw signals 30 days, rollups 90 days, revisit per table) and a documented deletion path. This deliberately avoids Superlog's worst defect (indefinite retention, no deletion).

**Telemetry must never take the app down:** every init wrapped; failure logs one warning and the service runs without telemetry. The agents service's current unconditional hardcoded exporter (`server.py` → `localhost:4317` gRPC) is replaced by env-driven config with graceful no-op, clearing its E402/F401 lint debt in the same change.

**Policy-as-code skills (delivered this phase):**
1. `instrument-every-feature` — new code must arrive with spans/metrics/logs per our conventions; includes the cardinality and redaction rules and the per-signal verification steps.
2. `debug-from-telemetry` — when debugging, query the local stack (Jaeger/ClickHouse) before guessing.
Both fit the existing AGENTS.md-per-package steering convention.

**Exit criteria:**
- One real PR review traced end-to-end and visible in Jaeger (webhook → queue → worker → agents → LLM spans with token counts).
- Dashboard Telemetry charts render live data; SSE metrics stream shows events during a review.
- LLM token usage + estimated cost visible per review (pricing computed centrally, never hardcoded per call site — embedded pricing tables go stale silently).
- Every log line in all three services carries `trace_id` when in a span; zero remaining bare `console.*` in server-side code.
- `/health` on all three services; agents' excluded from tracing.
- All security gates in §6 for Phase 1 pass.
- Both skills committed; conventions doc (§5) committed.

### Phase 2 — Healing-agent upgrade + alerting

Apply the agent-runner patterns (SUPERLOG_AGENT_RUNNER.md) to the fix/healing engine:

- **Findings-first gate:** terminal actions require a prior structured findings report.
- **Calibrated rubrics:** confidence 0–10 with concrete criteria (10 = verbatim quote from a file read this session AND observed/reproduced failure; 7–9 quote-backed; ≤3 speculative); SEV definitions; evidence format mandated as `path:line` + fenced verbatim quote. Tool descriptions carry the rubrics — in a tool-calling agent, tool descriptions ARE the prompt.
- **Budgets with motivating rationale:** runtime cap from provider-reported active time, wall-clock backstop, human-resume cap, cooldowns; parked/awaiting-human time excluded; idempotent terminate.
- **Dispatch-before-ack:** server-side effects (PR creation, resolution) execute before the model receives a success ack; failures reject the tool call and keep the turn alive for retry. The agent never believes something happened that didn't.
- **Typed memory store:** kinds `feedback | terminology | infra | project`, size-capped, tenant-guarded, injected in full (no vector DB for a small bounded store).
- **Alerting:** error-rate alerts AND the p95 latency rule (error-driven pipelines are constitutionally blind to graceful-but-slow degradation). Alerts create incidents that flow into the same healing pipeline — one model, not two systems.
- **Telemetry-fed investigations:** the healing agent consumes Phase-1 telemetry (trace/log context for the incident) through an internal query surface.

**Exit criteria:** a fix run triggered by an alert-created incident completes with rubric-scored findings, enforced budgets, and dispatch-before-ack semantics; Phase 2 security gates pass.

#### Phase 2 amendments (2026-07-21)

Recorded at Phase 2 close (Task 10). A source survey at Phase 2 kickoff found four places where the
Phase 2 bullets above assume behaviour the code does not have; the implementation plan
(`docs/superpowers/plans/2026-07-21-obs-phase-2-healing-alerting.md`, "Scope decisions") ruled on
each and **those rulings govern**. This block records them against the spec so a future reader does
not re-derive them. **§5 conventions are untouched and remain frozen.**

| Bullet above | What the code actually is | Amendment |
|---|---|---|
| "Tool descriptions carry the rubrics — in a tool-calling agent, tool descriptions ARE the prompt" | The **fix agent has no tool loop.** `fix_pipeline.py` invokes the LLM directly for a JSON blob; tool-calling exists only on the review side (`agents/base.py`). There is no tool description to carry anything. | Rubrics live in the **fix prompt**. The sentence is correct *about tool-calling agents* and simply does not apply to this one. Giving the fix pipeline a tool loop → Phase 2b. |
| "confidence 0–10 with concrete criteria" | 0–1 floats in five consumers — `StatusReport`, `AgentStatus`, `FixItem`, `WorkItem.confidence` (Prisma), `escalationTier()` — and the UI renders `confidence * 100`. | **Keep 0–1.** Adopt the *criteria* (the load-bearing half) anchored on the existing scale: ≥0.9 verbatim quote from a file read this run **and** an observed failure; 0.7–0.9 quote-backed, failure inferred; 0.4–0.7 grounded but paraphrased or argued; ≤0.3 speculative. No conversion boundary, no consumer touched. |
| "Dispatch-before-ack … must be built" | **Already correct.** approve/send/apply perform the effect and then ack; `propose_pr`'s description already tells the model it only validates. | Reduces to an **audit plus regression tests** that pin the ordering (Task 9), not a rewrite. The one deliberate inversion — `/fix/trigger`'s `202` before the drive — is safe because what the client then streams is container *state*, never a completion claim. |
| "Budgets: runtime cap, wall-clock backstop, cooldowns" | A 280s wall-clock cap already existed. **The real hole was elsewhere:** `POST /fix/trigger` ran `void driveFix(...)` in-process on the webhook HTTP server — no queue, no concurrency cap, and no cooldown after a run failed back to `open`. (`MAX_TOOL_ROUNDS` / `MAX_PATCH_CHARS`, often cited as fix budgets, are review-path constants that never gate a fix drive at all.) | Build the **missing** guard: fix drives onto BullMQ at `FIX_QUEUE_CONCURRENCY = 2`, plus an exponential cooldown (5 min → 1 h) enforced at both entry points. |

**What Phase 2 discovered that contradicts this spec's own assumptions.** Each was found only by a
*consumer* exercising Phase 1's output, which is why none was visible to Phase 1's green suites:

- **§4's "dashboards built on stable names" was not true of the shipped names.** The collector's
  `prometheus` exporter applied `namespace: arete` on top of instruments already named `arete.*`,
  exposing `arete_arete_review_runs_total` and mangling semconv metrics into
  `arete_http_client_…`. Fixed in Phase 2. Any spec claim about metric names must be verified
  against `:8889/metrics`, not against the instrument name in source.
- **§5's canonical scrubber was not reachable.** `scrubLogValue` existed in
  `packages/telemetry/src/redaction.ts` but was never re-exported from the package's `index.ts` — a
  frozen convention nothing outside the package could actually apply. Phase 2 also had to add
  `scrubSinkText`/`scrubSinkValue`, which *compose* the frozen §5 sets (value patterns + key
  blocklist + URL-query strip) for persistence sinks; composition, not amendment — §5's sets are
  unchanged.
- **§5's redaction is shape-based, so prose credentials survive.** `password: hunter2` written as
  ordinary prose has no secret shape, and the key blocklist binds to object *keys*, not words in a
  string. Catching it needs an amendment to the frozen pattern set with real false-positive risk on
  human text. Filed, deliberately not done here.
- **§6 gate 4 ("internal endpoints keep the fail-closed bearer-token pattern") had never been
  implemented on the agents service** — `POST /review` and friends had no authentication at all, and
  two `GET /context-map/{installation_id}` routes returned any tenant's code graph to any caller.
  Closed in Phase 2. A gate written in a spec is not a gate until something asserts it.
- **§6 Phase 2's "with expiry" is not satisfied and is recorded as an open finding**, not a pass:
  `INTERNAL_API_TOKEN` is a static shared secret with no `exp`, `iat`, rotation, or revocation, and
  the MCP token store has no expiry field at all (its OAuth flow fabricates
  `simulated_token_for_<code>` rather than exchanging one). Evidence in
  `.superpowers/sdd/phase-2-gate-report.md` §1 gate 2. The GitHub *installation* token — the
  credential that reaches a customer's repo — does expire and is minted per drive; the gap is on the
  internal/MCP surface.
- **Alerting cannot take tenancy from the wire.** All shipped rules are platform-wide, and §5's hard
  cardinality rule forbids tenant ids as metric dimensions — so an alert has no trustworthy tenant.
  Every incoming alert is attributed to a configured `ARETE_PLATFORM_INSTALLATION_ID`; an
  `installationId` label is **not read**. Per-tenant alerting, when it comes, must arrive as a
  trusted server-side mapping, never as a label.

**Deferred to Phase 2b** (filed in `docs/roadmap/backlog.md`): telemetry-fed investigations — the
last Phase 2 bullet above — which need an internal query surface that does not yet exist (only
`getAgentEventsPerMinute` reaches ClickHouse today); the fix-pipeline tool loop; expiry/rotation for
the internal and MCP credentials; and the Minor findings accumulated in `.superpowers/sdd/progress.md`.

### Phase 3 — Tenant telemetry platform (scoped at Phase 2 close)

The deferred Phase 4 of the 2026-07-15 roadmap, built on everything above: two-tier ingest (thin auth/quota/admission edge reusing `net-guard` + internal-token patterns → stock Collector → ClickHouse), strip-then-stamp tenancy (delete client-supplied tenant attributes, stamp server-side; tenant id denormalized into every row), admission-control backpressure with the OTLP status-code contract (permanent 400/402/413 vs retryable 5xx), deterministic fingerprint grouping before any LLM grouping, purpose-built rollups with arrival-ordered cursors, background telemetry poller + snapshot history. **Detailed spec deliberately deferred** — it must be informed by operating our own pipeline through Phases 1–2.

## 4. Technical stack (research-verified 2026-07-20)

Ecosystem checks were run against current registries/docs before locking these; several SUPERLOG-era patterns are already stale.

| Concern | Choice | Rationale / stale-pattern avoided |
|---|---|---|
| TS SDK | `@opentelemetry/sdk-node` (0.220.x) + stable 2.x packages; init file loaded via `--require`/`--import` before app code | SDK 2.x changed APIs: `resourceFromAttributes()`, object-based Views, `ATTR_*` constants — most online snippets predate this |
| Express/Redis | Official contrib instrumentations (via `auto-instrumentations-node`) | Maintained; suppress BullMQ blocking-poll noise via ioredis config |
| Queue tracing | **`bullmq-otel`** (first-party, taskforcesh) on both `Queue` and `Worker` | BullMQ grew native telemetry (v5.22+); producer→worker context propagation is automatic. Monkey-patch libs and manual traceparent-in-job-data are obsolete |
| TS logging | **pino 10** + `@opentelemetry/instrumentation-pino` (trace correlation + OTLP log bridge); pino `redact` for scrubbing | One SDK, consistent resource attrs; redaction at log-creation time |
| Dashboard | `instrumentation.ts` + **`@vercel/otel`**; Next's native App Router spans | Monkey-patching auto-instrumentations inside Next bundles is unreliable; `instrumentationHook` flag is gone (stable since 15) |
| Python SDK | `opentelemetry-sdk` 1.44.x + contrib 0.65b0; FastAPI instrumentation with `excluded_urls="health"`; init per worker process | Logs SDK is now stable (the "experimental" caveat is stale) |
| LLM spans | **Official contrib genai instrumentations** (`-anthropic`, `-google-genai`, `-openai-v2`; Ollama via OpenAI-compatible endpoint) + OpenLLMetry LangChain callback layer for graph structure; `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` | Official packages post-date most guides. Use `gen_ai.provider.name` (not deprecated `gen_ai.system`), `gen_ai.usage.input_tokens/output_tokens`, `gen_ai.input.messages/output.messages`. **Trap:** PyPI `opentelemetry-instrumentation-langchain` is Traceloop's package — verify publisher when pinning. Never run two instrumentations of the same layer (duplicate spans). Swap to official langchain instrumentation when it stabilizes |
| Python logging | **structlog** → stdlib bridge → OTel `LoggingHandler`; censor processor as the redaction point | Processors run before every sink — secrets never reach file, console, or OTLP. Init OTel before structlog |
| Histograms | Explicit boundaries via Views: JS object-form views; Python `View`/`explicit_bucket_boundaries_advisory`; LLM/review durations up to 300 s | Superlog's latent defect: default 10 s ceiling made p95/p99 unusable exactly where it mattered |
| HTTP semconv | `OTEL_SEMCONV_STABILITY_OPT_IN=http/dup` (JS); dashboards built on stable names (`http.server.request.duration`, seconds) | JS emits legacy names by default until SDK v3; `http/dup` bridges the migration |
| Collector | `opentelemetry-collector-contrib` (0.156.x); pipelines: OTLP in → `redaction` + `transform` processors → ClickHouse exporter + Jaeger (OTLP) + Prometheus | Redaction processor: allowlist + `blocked_values` regexes; transform (OTTL) for surgical patterns |
| ClickHouse | Exporter with `create_schema: false`; DDL owned in `packages/db/clickhouse/` **with TTLs** and deletion path | Exporter defaults create schema at startup (race between replicas; no TTLs). Traces/logs beta, metrics alpha — acceptable for self-observability; revisit at Phase 3 |
| Trace UI | **Jaeger v2** all-in-one (collector-based) in default compose | v1 and `@opentelemetry/exporter-jaeger` are legacy; OTLP only |

## 5. Conventions (frozen here so lanes never block each other)

**Resource attributes (every service):** `service.name` (`arete-webhook` | `arete-worker` | `arete-dashboard` | `arete-agents`), `service.version`, `deployment.environment.name` (env-var override; default `development`, `production` only when explicitly set), `service.instance.id`.

**Span naming tree (user intent → business op → transport):**

```
review.run                        ← one PR review end-to-end (worker root, linked from webhook receipt)
├── review.context.build          ← PR context + telemetry connector fetches
├── agent.review                  ← per specialist; attr agent.role = security|performance|…
│   └── llm.generate              ← per logical LLM call, covers all retries (gen_ai.* attrs)
│       └── POST api.anthropic.com   ← auto HTTP client spans
├── review.synthesize / review.critique
└── review.publish                ← GitHub comment/check-run
scan.run, fix.run, chat.turn      ← same pattern for discovery/healing/chat
```

**Metric namespace:** `arete.review.runs` (counter: `outcome`, `trigger`), `arete.review.duration` (histogram), `arete.agent.duration` (histogram: `agent.role`), `gen_ai.client.token.usage` / `gen_ai.client.operation.duration` (semconv, dims: provider, model, role tier), `arete.queue.jobs` (counter: `queue`, `outcome`).

**Cardinality rule (hard):** metric dimensions must be closed, low-cardinality sets (role, outcome, provider, model). Repo names, PR numbers, installation ids, SHAs, tenant ids → **span attributes only, never metric dimensions**. This is the single biggest cost control; violations are a review-blocking defect.

**Redaction (all sinks):** key-based blocklist (`authorization`, `x-api-key`, `api_key`, `token`, `secret`, `password`, `cookie`, `set-cookie`) + value patterns (bearer tokens, `sk-`/`ghs_`/`ghp_`-style key shapes, `[?&]key=`/`[?&]api_key=` in URLs). Applied in pino `redact`, structlog censor processor, an in-process span scrubber (strips URL query strings on `http.url`/`url.full`, scans exception messages), and the collector `redaction` processor. **Credentials go in headers, never URLs** — audited, not assumed.

**Prompt/completion content:** NOT captured by default (`gen_ai.input.messages`/`output.messages` off) — Areté reviews third-party tenant code; prompt bodies routinely contain other people's source. Token counts and metadata only. Revisit per-tenant with consent at Phase 3.

**Verification (per signal, every time):** drive one span, one metric batch, one log through the real bootstrap; confirm HTTP 2xx per endpoint (`/v1/traces`, `/v1/logs`, `/v1/metrics`) **and** inspect OTLP partial-success payloads (a 200 can still drop records). "Traces work" says nothing about logs.

## 6. Security gates (DoD, woven per phase)

**Phase 1 cannot close without:**
1. **Credential audit** of all provider clients (`anthropic.py`, `gemini.py`, `openai.py`, `ollama.py`, telemetry connectors, Octokit/Stripe usage): keys in headers, never URLs or query params. (Superlog's case study: a Gemini key passed as `?key=` was captured into span status + stacktraces, retained indefinitely — the fix was one line, plus a forced key rotation.)
2. **Canary scrub test in CI:** a fake secret injected into a log line, span attribute, and raised exception must not appear in exporter output (asserted against an in-memory/collector test sink).
3. **Retention policy applied:** TTLs in the ClickHouse DDL + a documented deletion path (per-project purge).
4. **Egress compliance:** telemetry exporters route per `net-guard` policy; internal endpoints keep the fail-closed bearer-token pattern.

**Phase 2 adds:** healing-agent repo access scoped to instrumented repos only (never heuristic-broad); MCP/internal tokens treated as write credentials with expiry; no secrets in AGENTS.md/skill files.

**Phase 3 adds (when scoped):** strip-then-stamp tenancy tests (spoofed `arete.*` attributes must be structurally impossible), per-tenant retention/deletion, admission-control status-code contract tests.

## 7. Two-agent execution model

| | **Agent A — TypeScript lane** | **Agent B — Python + infra lane** |
|---|---|---|
| Branch | `stroland02/obs-ts` | `stroland02/obs-py-infra` |
| Owns | `packages/telemetry` (new), webhook server + worker instrumentation, `console.*`→pino migration (108 sites), `agent_metrics` Redis publisher, dashboard `instrumentation.ts` + health route, webhook ESLint (Phase 0 share), `instrument-every-feature` skill | `arete_agents/observability.py` (replaces hardcoded-exporter block + clears its E402/F401 debt), FastAPI instrumentation + `/health`, genai instrumentations + token/cost capture, structlog migration, infra compose promotion, collector config + redaction, ClickHouse DDL + TTLs, Jaeger v2, per-signal verification harness, `debug-from-telemetry` skill |
| Phase 0 share | orchestration/topology/net-guard/db CI jobs, root test script, flaky-test fix | agents-side CI touches, ClickHouse SQL interpolation fix, compose validation in CI |

**Coordination rules:** conventions in §5 are frozen — neither lane edits them unilaterally; changes require a spec amendment. File overlap is near zero by construction; the one shared seam (collector endpoint env names, `OTEL_EXPORTER_OTLP_ENDPOINT` et al.) is defined in §5 and `.env.example`. Each work item: worktree → lane branch → PR into `integration-preview` with CI green + DoD checklist in the PR body → reviewed merge; `integration-preview` → serving branch at phase boundaries only. This restores the documented convergence process the 2026-07-20 wrap-up flagged as bypassed. Ledger-first coordination (`.claude/ade-coordination.md`) and status contracts continue unchanged.

## 8. Process additions

1. **DoD checklist template** (goes in the PR body of every work item):
   - [ ] Tests written first and green (TDD); no skipped/quarantined tests added
   - [ ] Per-signal verification evidence pasted (status codes + partial-success check)
   - [ ] No new bare `console.*` / `print` in server code
   - [ ] Redaction tests updated if the attribute/log surface grew
   - [ ] Conventions (§5) followed; cardinality rule checked for any new metric
   - [ ] Docs/skills updated if behavior or conventions moved
2. **Backlog:** `docs/roadmap/backlog.md` — single prioritized list; phases pull from the top; anything discovered mid-phase gets appended, not smuggled into scope.
3. **Phase-end retrospective:** short doc per phase (`docs/status/`); its action items must appear in the next phase's spec — the inspect-and-adapt loop.
4. **Standing research rule:** every spec includes a "current best practice check" with date, verifying library/pattern choices against the live ecosystem before locking them (this design's research pass invalidated four patterns from the reference docs).

## 9. Out of scope (this initiative)

- Grafana / external alerting vendors (alerts land in Phase 2 on our own stack).
- Production deploy pipeline / hosting (separate initiative; observability config is env-driven so it ports).
- Tenant-facing prompt/content capture (revisit Phase 3 with consent model).
- Replacing the existing telemetry SaaS connectors (they continue as review context; the background poller is Phase 3).

## 10. Open questions deferred to implementation planning

- Exact pino/structlog field-name mapping for the `[tag]` → `component` migration (mechanical; decided in the plan).
- Whether worker and webhook share one process's SDK init or two (depends on current entry wiring; Agent A resolves in its first work item).
- ClickHouse TTL numbers per table (30/90-day defaults proposed; confirm against disk budget when real volume is visible).
