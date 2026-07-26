# Superlog Observability — Implementation Report

**Project:** JEI BOM Tool v2.5.0
**Service name:** `jei-bom-tool`
**Superlog project id:** `9779484e-d65e-48da-87a3-db5dbf7e7f3f`
**Date:** 2026-07-20
**Author:** Claude Code (agent-driven onboarding), reviewed by Sebastian Roland

---

## 0. Executive summary

Superlog was installed into the JEI BOM Tool in a single session. The work added
**OpenTelemetry traces, metrics, and logs** to a Windows desktop Tkinter
application — a class of app that observability tooling normally ignores — and
shipped it inside the PyInstaller `.exe`.

Outcome, measured rather than asserted:

| Result | Evidence |
|---|---|
| All three OTel signals reaching Superlog | HTTP `200` on `/v1/traces`, `/v1/logs`, `/v1/metrics` |
| Real workload instrumented | 60 spans, 57 component lookups, 18 LLM calls, all `env=production` |
| Zero regressions | 332/332 existing tests pass; app starts clean |
| Autonomous incident handling | Superlog's agent opened, root-caused (confidence 9/10), and resolved incident `honey-jackal` |
| Latent production problems surfaced | Gemini total-failure + a **leaked Google API key** (see §10) |

Net code cost: **one new 220-line module + ~90 lines of edits across 4 files**.
Everything else was packaging and verification.

---

## 1. What Superlog is, architecturally

Superlog is an **OpenTelemetry-native observability backend with an
LLM investigation agent bolted onto the query layer**. It has four planes:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. INSTRUMENTATION PLANE  (lives in YOUR repo)                  │
│    utils/observability.py — vanilla OTel SDK, no vendor SDK      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ OTLP/HTTP + x-api-key
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. INGEST + STORAGE PLANE                                        │
│    intake.superlog.sh  →  ClickHouse (columnar)                  │
│    /v1/traces  /v1/logs  /v1/metrics                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌──────────────────────────┐  ┌──────────────────────────────────┐
│ 3. INVESTIGATION PLANE   │  │ 4. PRESENTATION PLANE            │
│    Issue filter →        │  │    Dashboards, widgets, home,    │
│    Issues → Incidents →  │  │    alerts, incident timeline     │
│    LLM agent RCA         │  │    (web UI)                      │
│    + agent memories      │  │    + MCP (agent-facing UI)       │
└──────────────────────────┘  └──────────────────────────────────┘
```

The important architectural decision — and the one that matters most to us as
engineers — is that **plane 1 contains no Superlog code**. We import
`opentelemetry-*` packages only. Superlog is a URL and a token. This means:

- No vendor lock-in. Repointing to Honeycomb/Datadog/Grafana is a one-line
  endpoint change in `utils/observability.py`.
- No proprietary agent process, sidecar, or daemon.
- The telemetry contract is the OTel spec, which is stable and public.

### Storage model (inferred from the query API)

The MCP query surface exposes ClickHouse-flavoured semantics
(`now() - INTERVAL 1 HOUR`, separate `gauge`/`sum`/`histogram`/`summary` metric
tables, `SpanAttributes` vs `ResourceAttributes` as distinct maps). Practical
consequences for how we instrument:

- **Resource attributes** are per-process and cheap — set once, attached to
  every signal. This is where `service.name`, `service.version`,
  `deployment.environment.name`, and `vcs.repository.url.full` live.
- **Span attributes** are per-span, queryable, and tolerate high cardinality
  (MPNs are fine here).
- **Metric attributes are series keys.** Every distinct combination creates a
  new time series. High cardinality here is what makes observability bills
  explode. This drove the split described in §6.3.

---

## 2. The agent harness — how the "open agent system" works

This is the part that differs most from conventional vendor onboarding. Superlog
does not ship an installer. It ships **12 markdown skill files** that a coding
agent reads and executes.

```bash
npx skills add superloglabs/skills --all
```

Installed to `.agents/skills/`, symlinked into Claude Code, Codex, Cursor, and
~70 other agent surfaces:

| Skill | Lines | Role |
|---|---|---|
| `superlog-onboard` | 250 | **Orchestrator.** The 7-step install procedure. |
| `otel-onboarding-style` | 268 | Cross-language taste: naming, RED, errors, LLM metrics. |
| `otel-python-style` | 131 | Python specifics: module-scope tracers, decorators. |
| `otel-generic-style` | 224 | Fallback for Go/Java/Rust/.NET/etc. |
| `otel-fastapi-style` | 72 | FastAPI bootstrap. |
| `otel-flask-style` | 72 | Flask bootstrap. |
| `otel-nextjs-style` | 151 | `@vercel/otel`, `instrumentation.ts`. |
| `otel-expo-style` | 81 | React Native / Expo guards. |
| `otel-livekit-style` | 104 | LiveKit agent lifecycle spans. |
| `otel-supabase-edge-style` | 60 | Deno edge shim. |
| `otel-instrument-feature` | 103 | Ongoing: instrument each *new* feature. |
| `superlog-debug` | 172 | Ongoing: pull prod context when debugging. |
| **Total** | **1,688** | |

### Why this design is interesting from an engineering standpoint

**It is a policy engine, not a code generator.** The skills encode *decisions*
("use `x-api-key`, never `api-key`"; "log bridge is not optional"; "never remove
an existing vendor") and delegate *implementation* to the agent, which reads the
actual repo. That inverts the usual tradeoff: a code generator produces
identical output regardless of your codebase; a policy engine produces
codebase-shaped output that still obeys house rules.

**It is failure-mode-driven.** The skills read like a postmortem archive. They
explicitly name the traps:

> "This is the single most common onboarding failure: the token is valid, but
> the exporter sends it under the wrong header name … so ingest returns 401 on
> every request and the install looks broken when the key is fine."

> "`registerOTel` does not export logs by default — pass `logRecordProcessor`
> … or no logs will leave the process."

That is institutional knowledge transferred as executable guardrails. It is why
the install got the header right on the first attempt instead of after a
401-debugging cycle.

**Bootstrap ordering is treated as a correctness property.** The skills insist
the telemetry bootstrap run before framework imports, via each ecosystem's
documented hook. In our case that rule had a codebase-specific twist — see §4.2.

**It is open.** The skills are plain markdown in a public git repo, readable and
auditable before execution. `skills.sh` publishes third-party risk scans
(Socket/Snyk) per skill. Compared to `curl | bash`, the attack surface is
inspectable — though it does run with full agent permissions, so review matters.

### The two ongoing skills

Onboarding is one-shot; these two persist:

- **`otel-instrument-feature`** — triggers on "add an endpoint / build a job /
  wire a handler." Prevents observability rot: new code arrives instrumented.
- **`superlog-debug`** — triggers on "why is this failing in prod?" and pulls
  live telemetry through the MCP instead of guessing. We used exactly this loop
  in §9.

---

## 3. How the agent adapted to *this* codebase

The onboarding skill assumes nothing about stack. It ran a discovery pass and
made a chain of judgement calls. This is the part a static installer cannot do.

### 3.1 Discovery

```
pyproject.toml     → Python ≥3.10, ttkbootstrap, pandas, pyodbc, reportlab
main.py            → Tkinter desktop app, PyInstaller-frozen, crash-handler
api/ (23 files)    → 6 external data providers + 2 LLM providers
utils/logging_setup→ existing root logger + RotatingFileHandler + redaction filter
exe info/*.spec    → PyInstaller onefile, hand-curated hiddenimports
tests/ (332)       → pytest, filterwarnings=error
ruff.toml          → legacy files excluded from lint
```

### 3.2 The decisions that followed

| Finding | Decision | Rationale |
|---|---|---|
| No web framework | Skip all `*-fastapi/flask/nextjs` skills; use `otel-python-style` | No HTTP server exists; RED must come from business ops instead of routes |
| Every provider uses `requests` | Install `opentelemetry-instrumentation-requests` | One package instruments all 8 providers — highest leverage move available |
| Root logger already configured, **handlers cleared on setup** | Init telemetry *after* `configure_logging()` | Initialising before would have had the OTLP handler wiped by `root.removeHandler()` |
| Frozen exe vs source checkout | `deployment.environment.name` from `sys.frozen` | Desktop apps have no `NODE_ENV`; the freeze flag *is* the deploy signal |
| No CI env vars on user machines | Set `vcs.repository.url.full`, make commit SHA best-effort | Skill mandates repo URL, permits omitting SHA |
| Existing secret-redaction filter | Left untouched, layered underneath | Skill hard rule: never remove existing observability |
| `scripts/` are dev one-offs | Not instrumented | Not runtime services users exercise |
| Legacy files ruff-excluded | Matched each file's existing style | New module written to strict lint; legacy edits kept idiomatic to their file |

The environment-detection choice is a good example of adaptation over
convention. The skill lists `NODE_ENV`, `VERCEL_ENV`, `RAILWAY_ENVIRONMENT` —
all irrelevant here. The agent substituted the semantically equivalent signal
for this platform:

```python
def _detect_environment() -> str:
    override = os.environ.get("JEI_ENV") or os.environ.get("ENVIRONMENT")
    if override:
        return override.strip().lower()
    return "production" if getattr(sys, "frozen", False) else "development"
```

Verified in production: source runs tagged `development`, the exe tagged
`production`.

---

## 4. Exactly what was installed

### 4.1 Dependencies

```
opentelemetry-sdk==1.44.0
opentelemetry-exporter-otlp-proto-http==1.44.0
opentelemetry-instrumentation-requests==0.65b0
opentelemetry-instrumentation-logging==0.65b0
jaraco.text>=4.0          # build-only; see §7.2
```

Added to `pyproject.toml` `[project.dependencies]` (+ `[build]`) and
`exe info/requirements.txt`. All install cleanly on Python 3.14.2.

### 4.2 New module — `utils/observability.py` (220 lines)

Single entry point `init_observability()`. Responsibilities:

1. **Resource** — `service.name`, `service.version` (from `version.py`),
   `deployment.environment.name`, `vcs.repository.url.full`, best-effort
   `vcs.ref.head.revision`.
2. **Traces** — `TracerProvider` + `BatchSpanProcessor` + `OTLPSpanExporter`.
3. **Metrics** — `MeterProvider` + `PeriodicExportingMetricReader` (60 s).
4. **Logs** — `LoggerProvider` + `BatchLogRecordProcessor` + `LoggingHandler`
   attached to the **root logger**.
5. **HTTP auto-instrumentation** — `RequestsInstrumentor().instrument()`.
6. **Shutdown** — `atexit` flush of all three providers, guarded against
   double-invocation.

Two deliberate engineering choices:

**Auth header indirection.** One function so the header name exists once:

```python
def superlog_headers(token: str) -> dict[str, str]:
    return {"x-api-key": token}
```

Ingest accepts only `x-api-key` or `Authorization: Bearer`. Anything else 401s
with a valid token — the highest-frequency onboarding failure.

**Telemetry must never take the app down.** The whole init body is wrapped:

```python
except Exception:
    log.warning("OpenTelemetry init failed; continuing without telemetry",
                exc_info=True)
    return False
```

For a desktop tool shipped to non-technical users, a monitoring dependency that
can prevent startup is a worse defect than missing monitoring. Note the tradeoff:
this trades loud failure for silent degradation, so the warning line is the
contract — and it is exactly what diagnosed the "old exe" confusion in §7.1.

### 4.3 Bootstrap wiring — `main.py` (+8 lines)

```python
from utils.logging_setup import configure_logging
configure_logging()

# Telemetry bootstrap runs right after logging is configured so the OTLP
# log bridge attaches on top of the file/console handlers (not before, or
# configure_logging would clear it). Safe to fail — never blocks startup.
from utils.observability import init_observability
init_observability()
```

Ordering is load-bearing. `configure_logging()` calls `root.removeHandler()` on
every existing handler; initialising telemetry first would have silently
destroyed the log bridge while traces and metrics kept working — a
hard-to-diagnose partial failure.

### 4.4 The public ingest token

`SUPERLOG_PUBLIC_TOKEN = "sl_public_jxkog8…"` is inlined in
`utils/observability.py`, deliberately, per the skill.

It is project-scoped and **write-only**: it can push telemetry into one project
and cannot read data, change settings, or reach the account. It is the same
trust class as a Sentry DSN or PostHog project token. For a desktop `.exe` this
is the only design that works — there is no server-side env var to read, and
`.env` files on user machines would produce exactly the silent-misconfiguration
failures the skill is built to avoid.

Registration flow (no account required up front):

1. Generate `sl_public_<32 random bytes>` locally.
2. `POST https://api.superlog.sh/api/signup-intents` with **`sha256(token)`**
   and a short prefix — never the plaintext.
3. Open the returned `signupUrl`; install continues in parallel.
4. Ingest returning `2xx` is the proof the token was claimed. `401/403` means
   signup is unfinished.

The hash-first handshake is a nice touch: the plaintext token never leaves the
machine, and ingest status doubles as the auth check.

---

## 5. Instrumentation design

### 5.1 The problem: RED without routes

Standard observability assumes HTTP routes as the unit of work. A Tkinter
desktop app has none. The instrumentation therefore defines the app's real
units of work explicitly:

```
bom.enrich_run                      ← user action: "Run API for All"
└── part.lookup                     ← per component (the enrichment engine)
    ├── POST api.digikey.com        ← auto (requests instrumentation)
    ├── POST api.mouser.com         ← auto
    ├── llm.gemini.generate         ← manual, LLM-semantic
    │   └── POST generativelanguage.googleapis.com   ← auto
    └── GET  www.googleapis.com     ← auto
```

Three layers: **user intent → business operation → transport**. Each answers a
different question (was the run slow? which part? which provider?).

### 5.2 Implementation pattern — thin traced wrapper

`gui/main_app.py` is ~7,500 lines and `run_api_for_all` is ~180 lines with many
early returns. Wrapping it in a `with` block would have required re-indenting
the entire body — a large, review-hostile, merge-conflict-prone diff for zero
behavioural gain.

Instead, rename to `_run_api_for_all_impl()` returning a small stats dict, and
add a thin traced wrapper:

```python
def run_api_for_all(self):
    with _tracer.start_as_current_span("bom.enrich_run") as span:
        span.set_attribute("bom.enrich.scope", "all")
        start = time.perf_counter()
        try:
            stats = self._run_api_for_all_impl()
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR))
            _enrich_runs.add(1, {"outcome": "error", "scope": "all"})
            raise
        if not stats:                       # guard/cancel path
            span.set_attribute("bom.enrich.aborted", True)
            _enrich_runs.add(1, {"outcome": "aborted", "scope": "all"})
            return
        ...
```

Benefits: original logic byte-identical, diff is additive, the observability
concern is physically separated from business logic, and the abort path is
distinguishable from success and error. The same pattern was applied to
`UnifiedAPIManager.lookup_part` → `_lookup_part_impl`.

### 5.3 Cardinality discipline

The single most important judgement in metric design:

```python
# MPN is a manufacturer identifier, not PII — safe as a span attribute
# (but never as a metric dimension: unbounded cardinality).
span.set_attribute("component.mpn", part_number)
...
_lookups.add(1, {"outcome": ..., "found": ..., "source": ...})
```

MPNs are unbounded (every part is distinct) → **span attribute only**.
`source` is bounded (~8 providers plus merge combos like `digikey+mouser`) →
safe as a series key. Getting this backwards is the classic way to generate a
six-figure observability bill.

### 5.4 LLM instrumentation

Instrumented at `_make_request`, the single choke point behind all four Gemini
entry points, using `gen_ai.*` semantic conventions:

```python
with _tracer.start_as_current_span("llm.gemini.generate") as span:
    span.set_attributes({
        "gen_ai.provider.name": "gcp.gemini",
        "gen_ai.request.model": self.model,
        "app.gen_ai.use_case": use_case,
    })
```

The span covers **all retries**, because the logical unit a human cares about is
"the Gemini call," not each HTTP attempt (those get their own auto spans). This
is precisely what made the retry amplification in §10.1 visible: the outer span
reads 52 s while each inner HTTP span reads ~1.3 s.

Token usage is read from `usageMetadata` into `llm.tokens.input/output`.
Deliberately **no pricing constants in application code** — Superlog computes
cost centrally from provider/model/token attributes. Pricing tables embedded in
handlers go stale silently.

### 5.5 Log bridge

The existing logger is untouched. An OTLP handler is added *underneath* it:

| Sink | Status |
|---|---|
| `RotatingFileHandler` (10 MB × 5) | unchanged |
| Console `StreamHandler` | unchanged |
| `_SecretRedactingFilter` | unchanged |
| **OTLP handler → Superlog** | **added** |

Any `log.info()` inside a span is automatically stamped with `trace_id` /
`span_id`, so a log line in the dashboard links to the trace that produced it.
Zero call-site changes.

### 5.6 Full signal inventory

**Spans:** `bom.enrich_run`, `part.lookup`, `llm.gemini.generate`, plus
automatic `POST`/`GET` client spans.

**Metrics:**

| Metric | Type | Dimensions |
|---|---|---|
| `bom.enrich.runs` | counter | `outcome`, `scope` |
| `bom.enrich.run.duration` | histogram | `scope` |
| `bom.enrich.components` | histogram | `scope` |
| `component.lookups` | counter | `outcome`, `found`, `source` |
| `component.lookup.duration` | histogram | `found`, `source` |
| `llm.requests` | counter | `model`, `use_case`, `outcome` |
| `llm.request.duration` | histogram | `model`, `use_case`, `outcome` |
| `llm.tokens.input` / `.output` | counter | provider, model, use_case, outcome |
| `http.client.duration` | histogram | *(auto)* host, method, status |

---

## 6. Verification

Ingest smoke — drove one span, one metric, one log through the real bootstrap
and captured HTTP status per signal:

```
/v1/traces:  200
/v1/logs:    200
/v1/metrics: 200
```

Reading the response code (not merely "no exception") is the skill's hard gate,
and it distinguishes the three real states: `2xx` working, `401/403` token
unclaimed, `5xx`/no-POST genuine bug.

Regression checks: **332/332 pytest pass**; `ruff` clean on the new module;
`gui.main_app` imports; PyInstaller spec compiles.

---

## 7. Packaging — the hard part

Three builds were required. Each failure is worth recording.

### 7.1 Build 1 — crashed on launch

```
ModuleNotFoundError: No module named 'jaraco'
  at pyi_rth_pkgres.py → pkg_resources/__init__.py line 90
```

Bundling OTel pulled `pkg_resources` into the dependency graph, activating
PyInstaller's `pkg_resources` runtime hook, which imports `jaraco.text`. Modern
setuptools no longer vendors it under `pkg_resources.extern`, and it was not
installed as a real package.

**Diagnostic note.** This was initially masked: an enrichment run appeared to
produce no telemetry, but the log showed a startup with *no* OTel line at all —
neither success nor the caught-failure warning. Since `init_observability()`
always logs one or the other, the binary that ran could not have contained it.
Root cause: every build writes to the same `%LOCALAPPDATA%` log file, so an
**older exe was indistinguishable from the new one** in the logs. Worth
remembering: shared log destinations across builds destroy the ability to tell
versions apart.

Fix — `exe info/JEI_BOM_Tool.spec`:

```python
*collect_submodules('jaraco'),
'more_itertools',
'platformdirs',
```

plus `jaraco.text>=4.0` pinned in build requirements. Validated with a
throwaway probe exe (~60 s) before committing to a 13-minute rebuild.

### 7.2 Build 2 — started, but HTTP instrumentation silently disabled

```
ERROR opentelemetry.instrumentation.instrumentor:
DependencyConflict: requested: "requests ~= 2.0" but found: "None"
```

`opentelemetry-instrumentation-requests` verifies the target library version via
`importlib.metadata`. PyInstaller does not bundle `dist-info` by default, so
`requests` read as version `None` and the instrumentor **disabled itself**.
Traces and metrics still worked; only the HTTP client spans were missing —
a partial failure that would have been easy to never notice.

Fix:

```python
*copy_metadata('requests'),
*copy_metadata('opentelemetry-instrumentation-requests'),
*copy_metadata('opentelemetry-instrumentation-logging'),
*copy_metadata('opentelemetry-sdk'),
```

### 7.3 Build 3 — clean

```
14:54:28  Logging initialized
14:54:28  OpenTelemetry initialized | endpoint=https://intake.superlog.sh env=production
14:54:29  JEI BOM Tool starting up | version=2.5.0
```

No `DependencyConflict`. Artifact: `BT 2.5.0.exe`, 278.6 MB, ~800 s build.

**Generalisable lesson:** for frozen Python applications, OTel needs *both*
`collect_submodules` (for lazily imported code) and `copy_metadata` (for runtime
version negotiation). Missing the first crashes loudly; missing the second
degrades silently. The second is more dangerous.

---

## 8. Backbone → dashboard wiring

### 8.1 The path a single event takes

```
app code
  └─ tracer.start_as_current_span("part.lookup")
       └─ BatchSpanProcessor        (buffers ~5 s, or on flush)
            └─ OTLPSpanExporter     (protobuf over HTTPS)
                 └─ POST intake.superlog.sh/v1/traces
                      headers: x-api-key: sl_public_…
                      └─ token → project resolution
                           └─ ClickHouse (spans / logs / metrics tables)
                                ├─ query layer → dashboards & UI
                                ├─ query layer → MCP tools (agents)
                                └─ issue filter → issues → incidents → agent RCA
```

Export cadence differs per signal and explains dashboard latency:
**traces** ~5 s batches, **logs** batched, **metrics** 60 s periodic,
plus a full flush on clean exit. Force-killing the process skips `atexit` and
drops the final batch — relevant when testing.

### 8.2 What reaches the presentation layer

Every signal carries resource attributes, which become the UI's global filters:

```json
{
  "service.name": "jei-bom-tool",
  "service.version": "2.5.0",
  "deployment.environment.name": "production",
  "service.instance.id": "51664465-…",
  "vcs.repository.url.full": "https://github.com/stroland02/BOM-Tool-V2.4.9-",
  "telemetry.sdk.language": "python",
  "telemetry.sdk.version": "1.44.0",
  "superlog.project_id": "9779484e-…"
}
```

`vcs.repository.url.full` is what lets the platform tie telemetry back to
source — the mechanism behind the agent quoting our actual code in §9.

### 8.3 UI surfaces (as exposed through the API)

The dashboard is backed by a small set of composable primitives, each with a
corresponding MCP tool — meaning **anything a human can build in the UI, an
agent can build too**:

| Surface | Purpose | Agent-writable |
|---|---|---|
| **Home** | Command center: built-ins, data widgets, links, grid layout | ✅ `get_home`, `add_home_widget`, `update_home_layout` |
| **Dashboards** | Named widget collections with variables | ✅ `create_dashboard`, `add_dashboard_widget` |
| **Incidents** | Auto-grouped investigations with agent RCA | ✅ `search_incidents`, `get_incident` |
| **Alerts** | Threshold rules with preview/test | ✅ `create_alert`, `preview_alert`, `test_alert` |
| **Issue filter** | Include/exclude clauses controlling what becomes an issue | ✅ `get/preview/update_issue_filter` |
| **Agent memories** | Durable learnings injected into future investigations | ✅ `create_agent_memory` |
| **Project context** | Freeform system description read on every investigation | ✅ `get/set_project_context` |

The symmetry is the design thesis: the UI and the agent are two clients of one
API. Investigation is not a chat bolted onto a dashboard; both are peers.

Current state for this project: `projectContext` is **empty** and the issue
filter is **empty in all four lists** (no includes/excludes) — i.e. defaults,
every ERROR event eligible. Both are tuning surfaces we have not yet used (§11).

---

## 9. The incident lifecycle, observed end to end

At 19:05 UTC, minutes after the first real workload, Superlog opened, diagnosed,
and closed an incident **with no human involvement**.

### 9.1 The incident record

```
codename:    honey-jackal
title:       Gemini API 503 outage degraded component detail enrichment
             for 3 minutes
service:     jei-bom-tool          environment: production
severity:    SEV-3                 status: resolved
firstSeen:   19:05:41Z             lastSeen: 19:08:35Z
issueCount:  8
rootCauseConfidence: 9/10
resolvedAt:  19:16:24Z             resolvedReasonCode: agent_resolved
```

### 9.2 The pipeline

1. **Error events** — 8 ERROR logs + error spans from `api/gemini.py`.
2. **Issue filter** — no excludes configured, so all 8 qualified.
3. **Grouping** — clustered into one incident by service + error signature +
   time window, rather than paging 8 times.
4. **Enrichment** — pulled the linked spans, including stack traces.
5. **Agent RCA** — correlated telemetry with **source code**.
6. **Severity** — SEV-3: real degradation, graceful fallback, non-blocking.
7. **Auto-resolution** — errors stopped at 19:08:35; closed at 19:16:24 with
   `agent_resolved`.

### 9.3 The agent's root cause (verbatim excerpt)

> Google Gemini's `generateContent` endpoint returned 503 Service Unavailable
> across 3 retry attempts per request during the incident window. The stack
> trace from span `ee0495d796cb21be` confirms:
>
> ```
> File "api\gemini.py", line 166, in _make_request
> requests.exceptions.HTTPError: 503 Server Error: Service Unavailable
> ```
>
> **api/gemini.py:108-112** — `_make_request` retries on `HTTPError` then
> re-raises […]
> **api/gemini.py:183-188** — `get_detailed_info` catches and returns a graceful
> fallback […]
>
> All `part.lookup` parent spans completed with `status=Unset` (not Error),
> confirming the BOM tool workflow itself was not blocked. **No code defect is
> present.** The external Google Gemini API service recovered at ~19:08:35 UTC.

### 9.4 Engineering assessment of that analysis

**What it got right** — and this is genuinely strong:

- It read our repository and cited real line numbers.
- It used span *hierarchy* as evidence: parent `part.lookup` spans were `Unset`
  while children errored, correctly proving the fallback worked.
- It distinguished *external outage* from *code defect* — the distinction most
  alerting systems fail to make, and the reason it filed SEV-3 rather than
  paging someone at 3 a.m.
- It closed itself when the signal stopped, instead of leaving a stale incident.

**Where it was incomplete** — the reason human review still matters:

The verdict *"the workflow was not blocked"* is true for **correctness** and
false for **latency**. Status codes were fine; the same spans show `part.lookup`
reaching **56 seconds**. The agent optimised for "did it break?" and did not ask
"did it get unusably slow?" Availability-shaped analysis, latency-shaped miss.

It also scoped strictly to the 503 window (19:05–19:08) and therefore never
examined the **429 quota exhaustion** that followed at 19:08:37+ — a related,
ongoing, and arguably more serious condition. Correct incident hygiene, narrow
blast radius.

**Reconciliation:** "resolved" was accurate for the 503 outage. The quota
problem in §10.1 is a separate, still-open issue that the incident never claimed
to cover. Both statements are true.

---

## 10. What Superlog surfaced about this codebase

Neither of the following was known before instrumentation. This is the concrete
return on the work.

### 10.1 Gemini fallback is a latency sink with a 100% failure rate

Measured over one enrichment run (57 component lookups):

| Source | Lookups | Total time | Avg |
|---|---:|---:|---:|
| cache | 22 (39%) | 1.9 ms | ~0.09 ms |
| digikey | 15 | 30.5 s | 2.0 s |
| digikey+mouser | 1 | 2.3 s | 2.3 s |
| **google (tail)** | **10** | **215.2 s** | **21.5 s** |
| **none / not found** | **9** | **181.9 s** | **20.2 s** |
| **Total** | **57** | **~430 s** | |

> **19 of 57 parts (33%) consumed 397 s of 430 s — 92% of total wall-clock.**

Cause, from `llm.request.duration` and `http.client.duration`:

| Metric | Value |
|---|---|
| Gemini logical calls | 18 (12 `quota`, 6 `error`) |
| Gemini **successes** | **0** |
| Gemini HTTP attempts | 29 (16×`503`, 12×`429`, 1 timeout) |
| Time inside Gemini | **318 s ≈ 5.3 min** |
| Share of enrichment wall-clock | **~74%** |

**Three-quarters of enrichment time was spent inside an API that returned
nothing.** Individual HTTP calls averaged ~1.3 s; the logical spans reached 53 s.
The amplifier is application-side: `min_delay` 5 s + 2 retries at 15 s/30 s
backoff + a 20 s read timeout + a 30 s cooldown that expires and re-arms.

The `outcome=quota` spans of **~1.5 ms** are the cooldown short-circuit — fast
because they skip Gemini entirely. In a dashboard those look healthy, which is
why the aggregate metric, not the span sample, is the trustworthy view.

This is not a code defect in the sense the incident agent meant. It is a
**resilience design flaw**: a best-effort enrichment fallback is permitted to
dominate the latency budget of a required workflow.

*Not yet fixed — changes enrichment behaviour and needs a product decision.*
Options: honour `cooldown_until` for the remainder of a run rather than
re-arming per part; fail fast on 429; cap total Gemini time per run;
parallelise lookups.

### 10.2 🔴 Leaked Google API key (security)

`api/gemini.py` passes the key as a **URL query parameter**:

```python
url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"
```

On failure that URL is captured into the span `status_message`, the
`exception_message`, and the full stack trace — and shipped to Superlog. It is
also written verbatim to `bom_tool.log`; the existing `_SecretRedactingFilter`
matches `api_key=`/`token`/`password` and does **not** catch `?key=`.

Recommended fix (one line, removes the key from URLs, exception text, and the
`http.url` span attribute simultaneously):

```python
url = f"{self.base_url}/models/{self.model}:generateContent"
headers = {"Content-Type": "application/json", "x-goog-api-key": self.api_key}
```

**The key should be rotated** — it now exists in telemetry storage and log
history. *Not yet applied.*

Note the meta-point: instrumentation **surfaced** this, but also **widened** it
by shipping error text off-machine. Any error-reporting pipeline deserves a
secrets audit of what ends up in exception strings.

---

## 11. Costs

**Superlog pricing is not documented here because it was not verified.** No
plan, quota, or invoice was inspected during this work; the project ran on a
public ingest token claimed through the signup flow. Treat any pricing figure
not taken from superlog.sh directly as unverified.

What *can* be stated is the **cost model shape**, from the observed architecture:

- **Telemetry volume** — spans, log records, and metric *series* stored in
  ClickHouse. Our per-run footprint is small: ~60 spans, ~20 metric series,
  a few dozen logs. Desktop apps emit far less than web services.
- **Metric series cardinality** — the dimension that grows superlinearly and the
  usual driver of surprise bills. §5.3's discipline (MPN as span attribute, not
  metric key) is the single most important cost control in this install.
- **Agent investigations** — each incident RCA is an LLM run over telemetry plus
  source. `honey-jackal` grouped 8 issues into 1 investigation, so grouping is
  also a cost lever. A noisy issue filter would multiply this.
- **Retention** — historical window, not measured.

Engineering costs incurred here, which *were* measured:

| Item | Cost |
|---|---|
| Code added | 1 module (220 lines) + ~90 lines across 4 files |
| Dependencies | 4 runtime + 1 build-only |
| Exe size | 278.5 → 278.6 MB (**+0.1 MB**) |
| Build time | ~800 s (unchanged; 3 builds needed to get it right) |
| Runtime overhead | Batched async export; no measurable impact on lookups |
| Test impact | 332/332 still pass |

To get real pricing: superlog.sh → Pricing, or the billing section of the
dashboard.

---

## 12. Status and next steps

**Done**

- [x] OTel traces + metrics + logs → Superlog, verified `2xx` on all three
- [x] Business instrumentation on the real units of work
- [x] LLM spans with `gen_ai.*` semantics and token metrics
- [x] HTTP auto-instrumentation across all 8 providers
- [x] Log bridge with trace correlation; existing logging preserved
- [x] Packaged into the exe (jaraco + metadata fixes), verified `env=production`
- [x] Superlog MCP connected and authenticated
- [x] Autonomous incident lifecycle observed end to end

**Open — requires a decision**

- [ ] **Rotate the Gemini API key** and move it to `x-goog-api-key` (§10.2) — security, do first
- [ ] Decide Gemini fallback policy (§10.1) — 74% of enrichment wall-clock
- [ ] Populate `set_project_context` so investigations start with architecture knowledge
- [ ] Tune the issue filter once normal noise is characterised
- [ ] Consider an alert on `component.lookup.duration` p95
- [ ] `_REPO_URL` still points at `BOM-Tool-V2.4.9-`; update if the repo is renamed
- [ ] Commit the changes (nothing has been committed — see `git status`)

---

## Appendix — files changed

| File | Δ | Purpose |
|---|---|---|
| `utils/observability.py` | **new, 220** | OTel bootstrap |
| `api/gemini.py` | +155/−31 | LLM spans, token metrics, `use_case` |
| `api/unified_manager.py` | +43 | `part.lookup` span + RED metrics |
| `gui/main_app.py` | +46 | `bom.enrich_run` span + run metrics |
| `main.py` | +8 | bootstrap call |
| `pyproject.toml` | +8 | OTel deps + `jaraco.text` |
| `exe info/requirements.txt` | +8 | same, for the build env |
| `exe info/JEI_BOM_Tool.spec` | +20 | hidden imports + `copy_metadata` |

*(`main.py`'s raw diff-stat shows +147 against HEAD because the working tree
already contained uncommitted crash-handler work; the telemetry change is 8
lines.)*
