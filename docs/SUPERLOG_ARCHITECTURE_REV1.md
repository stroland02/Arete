# Superlog — Technical Architecture & Design Analysis

**Companion to:** `docs/SUPERLOG.md` (the implementation report)
**Audience:** engineers who want to know *how the machine actually works*
**Date:** 2026-07-20

---

## 0. Epistemic note — read this first

I do not have Superlog's source code. Fabricating their internals would make
this document worthless. Every claim below is therefore tagged:

| Tag | Meaning |
|---|---|
| ✅ **Verified** | Directly observed, or public/spec-defined and independently checkable |
| 🔍 **Inferred** | Reverse-engineered from the API contract or observed data, evidence shown |
| ❓ **Unknown** | Not determinable from outside; stated as open |

The reverse-engineering is legitimate: an MCP tool schema is a **machine-readable
contract**, and contracts leak design. Argument types, enum values, validation
bounds, and error semantics tell you a great deal about what sits behind them.

---

## 1. The core architectural thesis

Superlog's central design decision, from which everything else follows:

> **The vendor owns zero code inside your process.**

Layer 1 (instrumentation) is 100% upstream OpenTelemetry. Superlog enters as a
URL and an HTTP header. There is no agent daemon, no sidecar, no proprietary
SDK, no bytecode weaving.

This is a deliberate trade:

| Gives up | Gains |
|---|---|
| Vendor-specific magic (auto-profiling, proprietary APM traces) | Zero lock-in; swap backends by changing one URL |
| Control over the client | Client bugs are upstream's problem, fixed by the ecosystem |
| Differentiation at the collection layer | Differentiation moves to **query + investigation** |

The strategic consequence: **Superlog is not competing on data collection — it
is competing on what happens after ingest.** That is why the investigation agent
and MCP surface are so developed while the client story is "just use OTel."

---

## 2. Layer 1 — The OpenTelemetry data model

✅ **Verified** (OTel specification; independently checkable)

Everything downstream is shaped by this model, so it is worth being precise.

### 2.1 Three signals, one resource

```
Resource                       ← identity of the emitting process (immutable)
├── InstrumentationScope       ← which library produced the record
│   ├── Span                   ← trace signal
│   ├── LogRecord              ← log signal
│   └── Metric                 ← metric signal
```

**Resource** is a set of key/value attributes describing *the process*, attached
to every record it emits. Ours:

```python
Resource.create({
    "service.name": "jei-bom-tool",
    "service.version": "2.5.0",
    "deployment.environment.name": "development" | "production",
    "vcs.repository.url.full": "https://github.com/stroland02/BOM-Tool-V2.4.9-",
})
```

The SDK auto-adds `service.instance.id` (a UUID per process), plus
`telemetry.sdk.{name,language,version}`.

**Why this matters architecturally:** resource attributes are written once per
export batch, not once per span. They are the cheap, always-present dimension —
which is why they became the dashboard's global filters and the alert engine's
`group_by` domain (§8.1).

### 2.2 A span is an interval with causality

```
Span {
  trace_id      : 16 bytes    ← shared by every span in one operation
  span_id       :  8 bytes
  parent_span_id:  8 bytes    ← "" for a root span
  name          : string      ← LOW cardinality (it is a group key)
  kind          : INTERNAL | CLIENT | SERVER | PRODUCER | CONSUMER
  start, end    : uint64 nanos
  attributes    : map         ← HIGH cardinality tolerated
  status        : UNSET | OK | ERROR
  events        : [(ts, name, attributes)]   ← exceptions live here
}
```

Two fields are routinely misunderstood and both bit us:

**`name` must be low-cardinality.** It is a `GROUP BY` key. `part.lookup` is
correct; `lookup 97763A141` would create one series per part. The MPN goes in
`attributes`, which is designed for high cardinality.

**`status` is not an HTTP status.** Per the HTTP semantic conventions, only 5xx
*server* responses auto-set `ERROR`. A `429` or `503` on a **client** span
leaves status `UNSET`. The MCP schema says this outright:

> "By the OTel HTTP semconv, only 5xx server responses auto-set ERROR — 4xx
> (including 410) stays UNSET."

This is exactly the trap the investigation agent walked into (§7.4): it read
`part.lookup` spans as `Unset` and concluded "not blocked," when in fact
`UNSET` only means *nobody explicitly marked it failed*.

### 2.3 Exceptions are span events, not fields

`span.record_exception(e)` appends an **event** named `exception` with
attributes `exception.type`, `exception.message`, `exception.stacktrace`.

🔍 **Inferred:** Superlog flattens these at query time. Every `query_traces` row
carries `exception_event_index`, `exception_type`, `exception_message`,
`exception_stacktrace` — i.e. "find the index of the exception event in the
nested Events array, then project its attributes into flat columns." That is a
ClickHouse `Nested` column access pattern (§6.2).

This flattening is what let the investigation agent quote our stack trace
without parsing anything.

---

## 3. Layer 2 — The instrumentation runtime, in depth

✅ **Verified** (OTel Python SDK behaviour, observed in our install)

### 3.1 The pipeline

```
        API surface                 SDK implementation              transport
┌────────────────────┐      ┌──────────────────────────┐    ┌──────────────────┐
│ trace.get_tracer() │─────▶│ TracerProvider           │    │                  │
│  .start_as_current │      │  └ BatchSpanProcessor    │───▶│ OTLPSpanExporter │
│                    │      │      (queue + thread)    │    │  protobuf/HTTP   │
├────────────────────┤      ├──────────────────────────┤    ├──────────────────┤
│ metrics.get_meter()│─────▶│ MeterProvider            │    │                  │
│  .create_counter() │      │  └ PeriodicExportingReader│──▶│OTLPMetricExporter│
├────────────────────┤      ├──────────────────────────┤    ├──────────────────┤
│ logging.getLogger()│─────▶│ LoggerProvider           │    │                  │
│  (stdlib!)         │      │  └ BatchLogRecordProcessor│──▶│ OTLPLogExporter  │
└────────────────────┘      └──────────────────────────┘    └──────────────────┘
```

The API/SDK split is the key structural idea: **libraries depend only on the
API**; the application chooses the SDK. If no SDK is installed, every API call
is a cheap no-op.

### 3.2 The proxy-provider mechanism — why our module-scope code is correct

This is the single most important runtime detail in our install, and it is
non-obvious.

We create tracers and instruments at **module scope**:

```python
# api/gemini.py — executes at import time
_tracer = trace.get_tracer("jei-bom-tool.gemini")
_meter  = metrics.get_meter("jei-bom-tool.gemini")
_llm_requests = _meter.create_counter("llm.requests", unit="1")
```

But `api/gemini.py` can be imported **before** `init_observability()` runs.
Naively that should bind to a no-op provider and silently discard everything
forever.

It does not, because of the **proxy indirection** in the OTel API:

```
get_tracer() before set_tracer_provider()
   └─▶ ProxyTracerProvider.get_tracer()  →  ProxyTracer (holds no real tracer)

first .start_as_current_span() call
   └─▶ ProxyTracer resolves the *current* global provider
        └─▶ real Tracer, cached from then on
```

The metrics API does the same with `_ProxyMeter` and proxy instruments
(`_ProxyCounter`, `_ProxyHistogram`, …), which swap in real instruments once a
`MeterProvider` is set.

**Consequence:** module-scope acquisition is safe regardless of import order,
*provided the provider is set before the first recorded operation* — not before
import. Our bootstrap satisfies this: `init_observability()` runs in `main.py`
long before any user clicks "Run API for All."

**Consequence 2:** this is why the OTel style guides insist on module-scope
tracers. It is not just a performance micro-optimisation (avoiding a dict lookup
per call) — it is safe *by design*.

### 3.3 BatchSpanProcessor — the buffer that decides your data-loss profile

Defaults (SDK 1.44):

| Parameter | Default | Effect |
|---|---|---|
| `max_queue_size` | 2048 | spans buffered; **silently dropped** when full |
| `schedule_delay_millis` | 5000 | max latency before a batch ships |
| `max_export_batch_size` | 512 | spans per OTLP request |
| `export_timeout_millis` | 30000 | per-request timeout |

A background worker thread waits on a condition variable, waking on timer or
when the batch size is reached.

Three operational facts that shaped our verification:

1. **~5 s dashboard latency for traces is structural**, not slowness.
2. `force_flush()` drains synchronously — the only way to make a test
   deterministic.
3. **`SIGKILL` loses the buffer.** Our `taskkill /F` during exe testing meant
   `atexit` never ran, so those launches produced initialisation logs but no
   spans. That was diagnostic noise we created ourselves.

For a desktop app the queue is generously sized; a high-throughput service
would need tuning, and silent drop-on-full is the failure mode to watch.

### 3.4 Metrics — aggregation temporality and the histogram trap

`PeriodicExportingMetricReader` (default 60 s) **pulls** aggregated state and
exports it. Unlike spans, metrics are aggregated *in-process* — a counter
incremented 10,000 times between intervals produces one data point.

**Temporality.** ✅ Observed cumulative: successive exports at
19:11:08.04 / 19:11:08.49 / 19:11:09.15 all reported
`component.lookups{source=cache,found=true} = 19` — the same running total
re-sent, not deltas. This is the OTLP default for counters.

**🔴 The histogram trap — a real defect in our current instrumentation.**

OTel's default explicit bucket boundaries are:

```
[0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]  (ms)
```

The top finite bucket is **10 s**. Our measured values:

| Histogram | max observed |
|---|---|
| `component.lookup.duration{source=google}` | **55,996 ms** |
| `llm.request.duration{outcome=quota}` | **52,805 ms** |

Everything above 10 s falls into the single `+Inf` overflow bucket. So
**bucket-derived percentiles (p95/p99) are unusable in exactly the latency range
we care about** — the query layer cannot distinguish 11 s from 56 s.

We were rescued by ClickHouse storing `count`, `sum`, `min`, and `max` per
histogram point (visible in `query_metrics` output), so the aggregate analysis
in the implementation report is sound. But the widget aggregations `p95`/`p99`
(§8.2) would lie.

**Fix** — attach a `View` with domain-appropriate boundaries at provider
construction:

```python
from opentelemetry.sdk.metrics.view import View, ExplicitBucketHistogramAggregation

MeterProvider(
    resource=resource,
    metric_readers=[...],
    views=[
        View(
            instrument_name="component.lookup.duration",
            aggregation=ExplicitBucketHistogramAggregation(
                boundaries=[10, 50, 100, 250, 500, 1_000, 2_500, 5_000,
                            10_000, 20_000, 30_000, 45_000, 60_000, 120_000]
            ),
        ),
        View(instrument_name="llm.request.duration", aggregation=...),
    ],
)
```

*Not yet applied — logged as an open item.*

### 3.5 The log bridge — why it needs explicit wiring

Traces and metrics have a single global entry point. Logs do not: Python's
`logging` module predates OTel by decades and is not going to be replaced.

So the bridge is an **adapter**, implemented as a stdlib `logging.Handler`:

```python
otlp_handler = LoggingHandler(level=logging.INFO, logger_provider=_logger_provider)
logging.getLogger().addHandler(otlp_handler)   # root logger
```

On each `emit(record)` it translates `LogRecord` → OTel `LogRecord`, mapping
`levelno` → `SeverityNumber`, `getMessage()` → `Body`, extras → `LogAttributes`,
**and — critically — reads the current span from context to stamp `trace_id` /
`span_id`.** That correlation is automatic and requires zero call-site changes.

This explains the skill's insistence that the log bridge "is not optional and is
not covered by SDK init alone." It is the one signal that cannot be inferred.

**Ordering hazard, concretely.** `utils/logging_setup.configure_logging()` does:

```python
for existing in list(root.handlers):
    root.removeHandler(existing)
```

Initialising telemetry before that call would have had the OTLP handler removed
while traces and metrics kept working — a *partial* failure, far harder to
diagnose than a total one. Hence the comment in `main.py` marking the ordering
as load-bearing.

### 3.6 Auto-instrumentation — monkeypatching with a version contract

`RequestsInstrumentor().instrument()` wraps `requests.Session.send` (via
`wrapt`) so every outbound call opens a CLIENT span.

Before patching, `BaseInstrumentor` enforces a declared dependency range:

```python
_instruments = ("requests ~= 2.0",)
```

It resolves the installed version through `importlib.metadata.version("requests")`
and, on mismatch, **logs an error and declines to instrument** rather than
patching blindly.

✅ This is precisely the failure we hit in the frozen exe:

```
DependencyConflict: requested: "requests ~= 2.0" but found: "None"
```

PyInstaller had bundled the `requests` *code* but not its `dist-info` metadata,
so version resolution returned `None`. The design is defensible — refusing to
patch an unknown version beats corrupting it — but the failure is **silent by
construction**: traces and metrics continue, only HTTP spans vanish. Fixed with
`copy_metadata('requests')`.

**Design critique:** a `WARNING`-level "instrumentation disabled" that only
appears in application logs is weak signalling for a capability loss. A
self-reported health attribute on the resource would be better.

### 3.7 The recursion guard

Our OTLP exporters use `requests`. We instrumented `requests`. Naively:

```
span exported → exporter POSTs via requests → instrumented → new span
             → exported → POSTs → … ∞
```

OTel prevents this with a context flag. Exporters attach
`_SUPPRESS_INSTRUMENTATION_KEY = True` around their HTTP calls; instrumentations
check it and no-op.

✅ Verified in our data: `intake.superlog.sh` appears in **zero** spans, while
`api.digikey.com`, `api.mouser.com`, and `generativelanguage.googleapis.com` all
appear. The suppression works.

Note the subtlety this created during verification: to capture exporter HTTP
status codes I monkeypatched `requests.Session.post` *underneath* the
instrumentation, because the instrumentation layer itself was suppressed.

---

## 4. Layer 3 — The wire protocol

✅ **Verified** (OTLP spec + observed behaviour)

```http
POST /v1/traces HTTP/1.1
Host: intake.superlog.sh
Content-Type: application/x-protobuf
x-api-key: sl_public_…
<binary ExportTraceServiceRequest>
```

Three separate endpoints — `/v1/traces`, `/v1/logs`, `/v1/metrics` — which is
why the skill demands checking all three independently. "Traces work" says
nothing about logs.

**Protobuf, not JSON.** Compact and schema-checked; also why you cannot debug
this with `tcpdump` alone.

**HTTP over gRPC, deliberately.** The skill mandates it: gRPC pulls in native
bindings (`grpcio` C extensions) that break bundlers and complicate containers.
For a PyInstaller app this is not a preference, it is a requirement.

**Auth: exactly two accepted forms.**

```
x-api-key: <token>
Authorization: Bearer <token>      # literal "Bearer " prefix required
```

Anything else 401s with a perfectly valid token. We centralised this so the
header name exists in exactly one place:

```python
def superlog_headers(token: str) -> dict[str, str]:
    return {"x-api-key": token}
```

**Partial success is a first-class response.** OTLP defines
`ExportTracePartialSuccess { rejected_spans, error_message }` — a 200 can still
mean some records were dropped. Our verification checked status codes only; a
production-grade check would inspect the partial-success payload too.
*Gap acknowledged.*

**Retry semantics.** The exporter retries on 429/502/503/504 with exponential
backoff, honouring `Retry-After`. 4xx (except 429) is permanent → drop, do not
retry.

---

## 5. Layer 4 — Ingest and multi-tenancy

🔍 **Inferred, with direct evidence.**

### 5.1 Server-side resource enrichment

Our code never sets `superlog.project_id`. Yet every stored record has it:

```json
"resource_attrs": {
  "service.name": "jei-bom-tool",
  "superlog.project_id": "9779484e-d65e-48da-87a3-db5dbf7e7f3f",   ← we never sent this
  ...
}
```

**Therefore:** ingest resolves `x-api-key` → project, then **injects the project
id into the resource attribute map before storage**. Tenancy is materialised
into the row rather than enforced only at query time.

Engineering read: denormalising the tenant key into every row is the standard
ClickHouse play. It makes the tenant filter a cheap predicate on a
`LowCardinality` column, and it lets tenant become part of the sort key — at the
cost of a few bytes per row, which columnar compression makes negligible.

### 5.2 The write-only token model

```
sl_public_<43 chars base64url>
```

Capabilities: append telemetry to exactly one project. It cannot read, mutate
configuration, or reach the account. Same trust class as a Sentry DSN.

🔍 The registration handshake is the interesting part:

```
client                                        server
  │ generate token (≥32 bytes entropy)
  │ keyHash   = sha256(token)  (hex)
  │ keyPrefix = "sl_public_" + token[:6]
  ├──── POST /api/signup-intents {keyHash, keyPrefix, returnTo} ──▶
  │                                          store hash, mint intent id
  ◀──── {id, signupUrl, expiresAt} ──────────
  │ open signupUrl                            user authenticates
  │                                           claim: token hash ↔ project
  ├──── POST /v1/traces  x-api-key: <plaintext> ─────────────▶
  │                                           sha256(presented) == stored?
  ◀──── 200 (claimed) | 401 (unclaimed) ─────
```

Properties worth naming:

- **The plaintext token never leaves the machine before first use.** The server
  stores only a hash — the same discipline as password storage.
- **Ingest status doubles as the auth oracle.** No separate "is my key valid?"
  endpoint; `2xx` vs `401` *is* the answer. The skill leans on this as its
  install gate.
- **Install proceeds in parallel with signup**, because the token is generated
  locally and works retroactively once claimed. Removing the account-creation
  step from the critical path is a genuinely nice bit of flow design.

---

## 6. Layer 5 — Storage

🔍 **Inferred, strong evidence.**

### 6.1 The engine is ClickHouse

Evidence:

1. Time ranges accept ClickHouse expressions verbatim:
   `"now() - INTERVAL 1 HOUR"`.
2. Metrics split into **four kinds** — `gauge`, `sum`, `histogram`, `summary` —
   which is exactly the table split used by the official ClickHouse OTel
   exporter.
3. `ResourceAttributes` / `SpanAttributes` / `LogAttributes` are distinct
   key-value maps, matching that schema's `Map(LowCardinality(String), String)`.
4. Nested-event flattening via `exception_event_index` matches ClickHouse
   `Nested` columns (`Events.Timestamp`, `Events.Name`, `Events.Attributes`).

### 6.2 Reconstructed schema

```sql
-- otel_traces
Timestamp DateTime64(9), TraceId String, SpanId String, ParentSpanId String,
SpanName LowCardinality(String), SpanKind LowCardinality(String),
ServiceName LowCardinality(String),
ResourceAttributes Map(LowCardinality(String), String),
SpanAttributes    Map(LowCardinality(String), String),
Duration UInt64, StatusCode LowCardinality(String), StatusMessage String,
Events Nested(Timestamp DateTime64(9), Name String, Attributes Map(...))

-- otel_logs
Timestamp, TraceId, SpanId, SeverityText LowCardinality(String), SeverityNumber,
ServiceName, Body String, ResourceAttributes Map, LogAttributes Map

-- otel_metrics_{sum,gauge,histogram,summary}
```

Why `LowCardinality(String)` matters: it is a per-column dictionary encoding.
`ServiceName` and `SpanName` compress to near-nothing and filter at dictionary
speed — the storage-level reason the OTel spec demands low-cardinality span
names. **The data model's cardinality rules are not stylistic; they are physical
storage constraints.**

### 6.3 Metric kinds are separate tables — visible in the API

The `query_metrics` response carries a `kind` discriminator and shape-dependent
fields:

| kind | fields |
|---|---|
| `sum`, `gauge` | `value` (scalar) |
| `histogram` | `count`, `sum`, `min`, `max` (no scalar) |
| `summary` | `count`, `sum` |

The schema documents this explicitly ("histogram/summary points carry count and
sum … instead, since they have no scalar value"). A union type surfaced honestly
rather than smashed into one nullable column.

---

## 7. Layer 6 — The derivation pipeline: events → issues → incidents

🔍 **Inferred from the API contract and one observed incident.**

This is where Superlog stops being a database and starts being a product.

```
ERROR spans / logs
   │
   ▼  [1] issue filter        excludes win; non-empty includes restrict
   │
   ▼  [2] issue               a distinct error signature + a STORED SAMPLE
   │
   ▼  [3] incident            issues grouped by service + signature + window
   │
   ▼  [4] investigation run   LLM agent: telemetry + source + memories
   │
   ▼  [5] resolution          auto-close when the signal stops
```

### 7.1 Stage 1 — the issue filter is a deny/allow evaluator

```json
{"excludeLogs": [], "includeLogs": [], "excludeSpans": [], "includeSpans": []}
```

Documented semantics: *"Excludes win; a non-empty include list means an event
must match at least one clause."*

That is the classic firewall evaluation order — deny-overrides, with includes
acting as default-deny **only when non-empty**. Empty = permissive. Our project
is at defaults: every ERROR event is eligible. This is the primary noise-control
knob, and `preview_issue_filter` exists so you can test a rule against real data
before committing — a dry-run affordance most alerting systems lack.

### 7.2 Stage 2 — issues store a denormalised sample

From `get_incident`:

> "every linked issue with a stored telemetry `sample` (trace_id, span_id,
> stacktrace, span/log/resource attributes)"

**This is an important design choice.** Rather than holding a pointer into
ClickHouse and re-querying, the issue **copies** a representative sample at
detection time. Consequences:

- Investigations survive telemetry retention expiry.
- Incident rendering is O(1) instead of a wide scan.
- The agent gets evidence without a query round-trip.
- Cost: duplicated storage, and the sample can drift from live data — which is
  exactly why the schema then tells you how to re-hydrate:
  *"To pull live telemetry, take a sample's trace_id and call query_traces."*

Store-a-sample-plus-a-pointer is a mature answer to "cheap to render, still
drillable."

### 7.3 Stage 3 — grouping is the anti-pager

Our incident bundled `issueCount: 8` into one record. Grouping keys are
evidently service + error signature + time proximity.

This is the difference between *8 alerts* and *1 incident*, and it is also a
**cost lever**: one investigation run instead of eight (§10.3).

The state machine includes `mergedIntoId`, implying incidents can be merged
post-hoc — a pointer to a canonical incident, i.e. union-find over incident
identity. Status enum:

```
open → resolved
     → autoresolved_noise      ← agent classified it as not worth a human
     → merged                  (mergedIntoId set)
```

`autoresolved_noise` is notable: the agent is trusted to *triage things away*,
and `search_incidents` **hides that bucket by default** while keeping it
inspectable via `status='autoresolved_noise'`. Aggressive filtering with an
audit trail — the right shape for an automated triage system.

### 7.4 Stage 4 — the investigation run

Observed output fields:

| Field | Our incident |
|---|---|
| `codename` | `honey-jackal` |
| `agentSummary` | prose narrative |
| `rootCauseText` | markdown **with our source code quoted** |
| `rootCauseConfidence` | `9` (1–10) |
| `estimatedImpactText` | scoped blast radius |
| `severity` | `SEV-3` |
| `resolvedReasonCode` | `agent_resolved` |

Design observations:

**Human-memorable codenames.** `honey-jackal` (adjective-animal, Docker-style)
because humans discuss "honey-jackal" and cannot discuss
`0ab460dd-a451-4b9e-af8a-b087cfc400f3`.

**Confidence is a first-class field.** A 1–10 self-rating is a calibration
surface — you can later ask "were 9s actually right?" Most LLM features hide
uncertainty; exposing it is the more honest engineering choice.

**Source access is real.** The agent quoted `api/gemini.py:108-112` and
`:183-188`. The mechanism is almost certainly `vcs.repository.url.full` — the
resource attribute the onboarding skill treats as mandatory ("skipping the SHA
is fine, skipping the URL is not"). That mandate now makes sense: **it is the
join key between telemetry and source.** ❓ Whether it clones the repo or uses a
Git integration is unknown.

**It reasoned over span topology, not just text.** It observed that parent
`part.lookup` spans were `Unset` while child spans errored, and concluded the
fallback worked. That is structural reasoning over the trace tree.

**And its blind spot was structural too.** `UNSET` means "nobody marked this
failed," *not* "this was fine." The same spans recorded 56 s durations. The
agent asked *did it break?* and never asked *did it get slow?* — availability
framing, latency miss. Worth internalising: **an error-triggered pipeline is
constitutionally blind to problems that do not raise errors.** No amount of
model quality fixes that; it requires a latency-triggered path (i.e. an alert on
`component.lookup.duration`).

### 7.5 Stage 5 — auto-resolution

Errors stopped 19:08:35; incident closed 19:16:24 → **~8 minutes of silence**
before `agent_resolved`. A hysteresis window preventing flapping on intermittent
faults.

### 7.6 The learning loop

Two write-back surfaces make investigations improve over time:

```python
create_agent_memory(kind=..., title=..., body=...)   # kind ∈ feedback|terminology|infra|project
set_project_context(text)                            # read on EVERY investigation
```

The typed `kind` enum is a small but real design decision: `feedback`
(corrections about *how to investigate*) is categorically different from
`infra` (facts about the system), and separating them lets retrieval weight them
differently.

Architecturally this is **retrieval-augmented investigation with a curated,
human-editable store** — not a vector database of chat history. Memories are
short, typed, addressable, and archivable (`status='archived'`). That is a
maintainable long-term-memory design; unbounded conversational memory is not.

Both stores are currently **empty** for this project, which is why the agent
reasoned from raw telemetry alone. Populating `project_context` is the
highest-leverage unclaimed improvement available to us.

---

## 8. Layer 7 — Presentation as declarative query builders

🔍 **Inferred from schemas.**

Neither dashboards nor alerts accept raw SQL. Both are **constrained
query-builder DSLs** — which is what makes them safe for an LLM to write.

### 8.1 The alert engine

```
source       : logs | traces | metric
aggregation  : count            (logs/traces)
             | sum | avg        (metric, metric_name required)
comparator   : gt | lt
threshold    : number
window_minutes           : 1 … 1440
evaluation_interval_secs : 15 … 3600
group_by     : a resource attribute, e.g. "service.name"
group_mode   : single | per_group
filter       : {service, spanName, statusCode, severity, minDurationMs, resourceAttrs[]}
```

This compiles to roughly:

```sql
SELECT <agg> FROM <source>
WHERE <filter> AND Timestamp > now() - INTERVAL <window> MINUTE
[GROUP BY <group_by>]
HAVING value <comparator> <threshold>
```

Cross-field validation is encoded in the contract ("for metric source it must be
`sum` or `avg` and `metric_name` is required"), so invalid alerts are rejected
at the schema boundary rather than at evaluation time.

`group_mode: per_group` — fire per distinct value rather than one rolled-up
alert — is the difference between "errors are up" and "errors are up *in
production*," and it is the reason `group_by` is restricted to **resource**
attributes: those are guaranteed present and low-cardinality on every row.

`preview_alert` / `test_alert` complete the pattern: dry-run before commit.

### 8.2 The widget model

```
types  : timeseries_count | timeseries_metric | trace_table | log_table | markdown
agg    : sum | avg | min | max | p95 | p99
grid   : 12 columns; {x:0-11, y, w:1-12, h}
units  : none | duration_ms | duration_s | bytes | percent
```

Two details worth calling out.

**Standard sizes are the default.** The schema says: *"Omit `layout` to use the
standard size for the type — recommended"* (charts `w:6 h:4`, tables `w:12 h:6`,
markdown `w:4 h:5`). An LLM asked to produce absolute coordinates generates
overlapping garbage; making layout optional with sane per-type defaults removes
that failure mode entirely. **API design shaped by knowing the caller is a
model.**

**Dashboard variables are late-bound templates.**

```json
{"key": "deployment.environment", "value": "$env"}
```

`$env` / `${env}` is substituted with the viewer's selection **at view time** —
one dashboard definition, N rendered views. Classic parameterised-view
templating.

⚠️ Recall §3.4: `p95`/`p99` here are computed from histogram buckets. With
default boundaries topping out at 10 s, those aggregations are **not
trustworthy** for our lookup latencies until custom Views are configured.

### 8.3 The symmetry thesis

Every UI surface has a matching MCP tool — `get_home` / `add_home_widget` /
`update_home_layout`, `create_dashboard`, `create_alert`, `update_issue_filter`.

**The UI and the agent are two clients of one API.** There is no privileged
"real" interface with a chatbot bolted on. That is the cleanest possible
statement of the product thesis, and it is verifiable from the tool list alone.

---

## 9. The skill system as a program

✅ **Verified** — the source is on disk (`.agents/skills/`, 1,688 lines).

### 9.1 It is policy-as-code, not codegen

A conventional installer emits fixed output. These skills emit **decisions** and
let the agent produce codebase-shaped implementations:

```markdown
Wrap it in a one-line helper so the header name lives in exactly one place, and
**define the helper** — never call an undefined `superlogHeaders`
```

Note the second clause. It is an anticipated LLM failure mode (referencing a
helper it forgot to define) written as a guardrail. The skills are, in large
part, **a catalogue of ways agents get this wrong.**

### 9.2 Routing via frontmatter

```yaml
name: superlog-onboard
description: "Onboard a project to Superlog … Triggers on requests like
  'install Superlog', 'set up Superlog', 'add Superlog telemetry' …"
```

The `description` is a **dispatch table** — the runtime matches user intent
against it. The skill system is effectively a router plus a set of handlers.

### 9.3 Progressive disclosure

```
superlog-onboard (250 lines, always read)
   ├─ otel-onboarding-style   (268)   ← always
   ├─ otel-python-style       (131)   ← if Python
   ├─ otel-nextjs-style       (151)   ← if Next.js
   └─ … 7 more, conditionally
```

Only ~650 of 1,688 lines were relevant to this repo. Loading all of it would
waste context and inject irrelevant patterns (the agent might have reached for
`FastAPIInstrumentor` in a Tkinter app). **Conditional loading is context
management as an architectural concern** — the prompt-engineering equivalent of
lazy imports.

### 9.4 Invariants

```markdown
## Hard rules
- Never modify files outside the project root.
- Never commit, push, or open PRs.
- Never run a production deploy command without explicit user confirmation…
- Never remove an existing observability vendor unless the user asks.
```

Assertions, not suggestions — and they held: nothing was committed, the exe
build was confirmed first, existing logging survived intact.

### 9.5 Verification as a gate, not a step

```markdown
Push real telemetry through prod and read the response code — for all three
signals. This is a hard gate.
   - All three 2xx → done.
   - Any 401/403 → token isn't claimed yet. …Don't declare success.
   - Any 5xx, time out, or never POST → real bug.
```

The skill distinguishes *"code ran without raising"* from *"the system works."*
It also names the trap: *"A bootstrap that loads but never POSTs — or POSTs
traces but no logs/metrics — is not a partial success."* This is the discipline
that produced a real, checkable install rather than a plausible-looking one.

---

## 10. Cost mechanics

### 10.1 Where cost actually comes from

❓ Pricing not verified (see `SUPERLOG.md` §11). The *mechanics*, however, follow
from the architecture:

```
cost ≈ f(rows_ingested, metric_series_count, retention_days, investigation_runs)
```

### 10.2 Series cardinality is the dominant term

For a metric, storage grows with the number of **distinct attribute
combinations**, not the number of recordings:

```
series = Π (distinct values per attribute key)
```

Our `component.lookups{outcome, found, source}`:

```
outcome ∈ {success, error}          →  2
found   ∈ {true, false}             →  2
source  ∈ {cache, digikey, mouser, octopart, siliconexpert,
           gemini, google, none, digikey+mouser, …}  ≈ 10
                                    ────────────────
                                       ~40 series
```

Had we followed the obvious instinct and added `component.mpn`:

```
40 × (every part number ever looked up) → 40 × 10⁴⁺ = 400,000+ series
```

That is the difference between a rounding error and a budget incident, from one
attribute. Hence the comment we left in the code:

```python
# MPN is a manufacturer identifier, not PII — safe as a span
# attribute (but never as a metric dimension: unbounded cardinality).
```

**Spans are the escape hatch.** Per-span attributes are rows, not series —
linear, not multiplicative. High-cardinality context belongs there.

### 10.3 Investigation cost

Each incident triggers an LLM run over telemetry + source + memories. Levers:

- **Grouping** — our 8 issues → 1 investigation. 8× saving, automatic.
- **Issue filter** — a noisy filter multiplies investigations directly.
- **`autoresolved_noise`** — cheap triage disposal without a full write-up.

The economic design is coherent: the expensive stage sits *behind* two
successive noise reducers.

---

## 11. Failure-mode catalogue

Everything that actually went wrong, with the generalisable lesson:

| # | Failure | Root cause | Signal | Lesson |
|---|---|---|---|---|
| 1 | Enrichment produced no telemetry | An **older exe** was launched | Startup log with *no* OTel line | Shared log paths across builds destroy version identity |
| 2 | New exe crashed instantly | `pkg_resources` hook → missing `jaraco` | Loud `ModuleNotFoundError` | Freezing pulls transitive runtime hooks; loud failures are the *good* case |
| 3 | HTTP spans silently absent | `dist-info` not bundled → version `None` → instrumentor self-disabled | One ERROR line, buried | **Silent capability loss is the dangerous failure** |
| 4 | Test launches emitted nothing | `taskkill /F` skipped `atexit` | No spans despite clean init | Batch processors make SIGKILL lossy |
| 5 | p95/p99 unusable >10 s | Default histogram buckets | None — *still latent* | Default buckets encode assumptions your domain may violate |
| 6 | API key in telemetry | Key in URL query → captured in exception text | None — found by reading | Error pipelines exfiltrate whatever is in exception strings |

Failures 3, 5, and 6 share a property: **the system kept working while producing
subtly wrong or unsafe output.** Those cost far more to find than crashes.

---

## 12. Design assessment

### Strong

1. **Zero vendor code in-process.** Rare discipline; eliminates lock-in and
   removes an entire class of vendor-agent bugs.
2. **Skills as policy-as-code.** Portable across agent runtimes, inspectable
   before execution, encodes failure modes rather than happy paths.
3. **UI/agent API symmetry.** No second-class automation surface.
4. **Hash-first token handshake.** Plaintext never leaves the machine; ingest
   status doubles as the auth check; signup is off the critical path.
5. **Denormalised issue samples.** Investigations outlive retention.
6. **Constrained DSLs over raw SQL.** Safe for models, validated at the
   boundary, dry-runnable (`preview_*`, `test_*`).
7. **Exposed confidence + audit-coded resolutions.** Automation you can grade.

### Weak / open

1. **Error-triggered blind spot.** No error → no issue → no incident. Our worst
   real problem (74% of wall-clock in a failing dependency) produced *zero*
   incidents because the fallback was graceful. Latency needs its own trigger.
2. **Silent instrumentation degradation.** A `DependencyConflict` should surface
   as a health signal on the resource, not one log line.
3. **Default histogram buckets** are wrong for multi-second operations and
   silently corrupt `p95`/`p99` widgets.
4. **No secret scrubbing at ingest.** Exception text is shipped verbatim; our
   Google API key rode along. A redaction pass on
   `exception_message`/`stacktrace` would be a high-value platform feature.
5. **Cold start.** `project_context` and memories start empty, so early
   investigations reason from telemetry alone.

### The one-sentence summary

> Superlog bets that collection is a commodity (so it uses stock OTel), that
> installation is an agent's job (so it ships skills rather than an installer),
> and that the durable value is turning stored telemetry into explained
> incidents (so its real product is the investigation loop and the API that
> exposes it symmetrically to humans and agents).

---

## 13. Open engineering items

| Priority | Item | Ref |
|---|---|---|
| 🔴 P0 | Move Gemini key to `x-goog-api-key` header; **rotate it** | `SUPERLOG.md` §10.2 |
| 🟠 P1 | Custom histogram `View` boundaries (0–120 s) | §3.4 |
| 🟠 P1 | Alert on `component.lookup.duration` — cover the latency blind spot | §7.4 |
| 🟡 P2 | Populate `set_project_context` with architecture facts | §7.6 |
| 🟡 P2 | Inspect OTLP partial-success payloads, not just status codes | §4 |
| 🟢 P3 | Tune issue filter once baseline noise is characterised | §7.1 |
| 🟢 P3 | Record agent memories for recurring patterns (Gemini quota) | §7.6 |
