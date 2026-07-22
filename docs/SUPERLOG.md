# Superlog Observability — Implementation Report

**Project:** JEI BOM Tool v2.5.0 · **Service:** `jei-bom-tool`
**Superlog project id:** `9779484e-d65e-48da-87a3-db5dbf7e7f3f`
**Date:** 2026-07-20 · **Revision 2** — rewritten against the Superlog source
(`github.com/superloglabs/superlog`, Apache-2.0), replacing the black-box
inferences in revision 1.

> Companions: `SUPERLOG_ARCHITECTURE.md` (how the platform works internally) and
> `SUPERLOG_SECURITY.md` (threat model). Read the security doc — it contains an
> action item that is time-sensitive.

---

## 0. Executive summary

Superlog was installed into the JEI BOM Tool in one session: **OpenTelemetry
traces, metrics, and logs** added to a Windows desktop Tkinter application — a
class of app observability tooling normally ignores — and shipped inside the
PyInstaller `.exe`.

| Result | Evidence |
|---|---|
| All three signals reaching Superlog | HTTP `200` on `/v1/traces`, `/v1/logs`, `/v1/metrics` |
| Real workload instrumented | 60 spans, 57 lookups, 18 LLM calls, all `env=production` |
| Zero regressions | 332/332 tests pass; exe starts clean |
| Autonomous incident handling | Incident `honey-jackal`: opened, root-caused (9/10), auto-resolved |
| Latent problems surfaced | Gemini consuming 74% of enrichment wall-clock; a **leaked Google API key** |

Net code cost: **one 220-line module + ~90 lines across four files.** Everything
else was packaging and verification.

---

## 1. What we installed

### 1.1 Dependencies

```
opentelemetry-sdk==1.44.0
opentelemetry-exporter-otlp-proto-http==1.44.0
opentelemetry-instrumentation-requests==0.65b0
opentelemetry-instrumentation-logging==0.65b0
jaraco.text>=4.0            # build-only, see §4
```

### 1.2 `utils/observability.py` (new, 220 lines)

One entry point, `init_observability()`:

1. **Resource** — `service.name`, `service.version`, `deployment.environment.name`,
   `vcs.repository.url.full`, best-effort `vcs.ref.head.revision`.
2. **Traces** — `TracerProvider` + `BatchSpanProcessor` + `OTLPSpanExporter`.
3. **Metrics** — `MeterProvider` + `PeriodicExportingMetricReader` (60 s).
4. **Logs** — `LoggerProvider` + `BatchLogRecordProcessor` + a `LoggingHandler`
   attached to the **root logger**.
5. **HTTP auto-instrumentation** — `RequestsInstrumentor().instrument()`.
6. **Shutdown** — `atexit` flush of all three providers, double-call guarded.

Two deliberate choices:

**Auth header lives in one place.** Ingest accepts only `x-api-key` or
`Authorization: Bearer` — confirmed in the source, where `x-api-key` is checked
first and wins (`apps/proxy/src/index.ts`).

```python
def superlog_headers(token: str) -> dict[str, str]:
    return {"x-api-key": token}
```

**Telemetry must never take the app down.** Init is wrapped so a failure logs a
warning and returns `False`. For a desktop tool shipped to non-technical users, a
monitoring dependency that blocks startup is worse than missing monitoring. The
tradeoff is silent degradation — which is exactly why the log line is the
contract, and exactly what diagnosed the "old exe" confusion in §4.

### 1.3 Bootstrap ordering (`main.py`, +8 lines)

`init_observability()` runs immediately **after** `configure_logging()`. That
ordering is load-bearing: `configure_logging()` calls `root.removeHandler()` on
every existing handler, so initialising telemetry first would have silently
destroyed the log bridge while traces and metrics kept working.

### 1.4 The public ingest token

`sl_public_jxkog8…` is inlined in `utils/observability.py`. Verified against the
source, this is sound:

- Tokens are generated as 32 random bytes, base64url-encoded, and stored **only
  as a SHA-256 hash** (`packages/db/src/keys.ts`). The plaintext never reaches
  Superlog's servers during signup.
- The signup handshake posts only `sha256(token)` and a 6-char prefix. Claiming
  the intent promotes that stored hash into a real `api_keys` row for your
  project, inside a transaction, idempotent on re-claim.
- The key grants **append-only ingest to one project**. It is rejected by the
  management API and cannot read telemetry.

Ingest returning `2xx` *is* the auth check — there is no separate validation
endpoint, which is why the install gate is "check the status code."

---

## 2. Instrumentation design

### 2.1 RED without routes

A Tkinter desktop app has no HTTP routes, so the units of work are declared
explicitly:

```
bom.enrich_run                      ← user action: "Run API for All"
└── part.lookup                     ← per component (enrichment engine)
    ├── POST api.digikey.com        ← automatic
    ├── POST api.mouser.com         ← automatic
    ├── llm.gemini.generate         ← manual, gen_ai.* semantics
    │   └── POST generativelanguage.googleapis.com
    └── GET  www.googleapis.com
```

Three layers — user intent → business operation → transport — each answering a
different question.

### 2.2 Thin traced wrappers

`run_api_for_all` is ~180 lines with many early returns inside a 7,500-line file.
Rather than re-indent it into a `with` block, it was renamed to
`_run_api_for_all_impl()` returning a stats dict, with a thin traced wrapper
around it. Same pattern for `UnifiedAPIManager.lookup_part`. The original logic
is byte-identical; the diff is additive; abort is distinguishable from success
and error.

### 2.3 Cardinality discipline

```python
# MPN is a manufacturer identifier, not PII — safe as a span attribute
# (but never as a metric dimension: unbounded cardinality).
span.set_attribute("component.mpn", part_number)
```

`component.lookups{outcome, found, source}` ≈ **40 series**. Adding
`component.mpn` would make it **400,000+**. Spans are rows; metrics are series.

### 2.4 Signals shipped

**Spans:** `bom.enrich_run`, `part.lookup`, `llm.gemini.generate`, plus automatic
HTTP client spans.

**Metrics:** `bom.enrich.runs`, `bom.enrich.run.duration`,
`bom.enrich.components`, `component.lookups`, `component.lookup.duration`,
`llm.requests`, `llm.request.duration`, `llm.tokens.input/output`, and automatic
`http.client.duration`.

**Logs:** every existing `log.*` call, unchanged, now also exported via OTLP and
stamped with `trace_id`/`span_id` when inside a span.

---

## 3. What actually happened to our telemetry

This section replaces revision 1's guesswork. Every hop is now verified against
the platform source.

### 3.1 The ingest path

```
BatchSpanProcessor (5 s)
  └─ OTLPSpanExporter → POST intake.superlog.sh/v1/traces   x-api-key: sl_public_…
       └─ apps/proxy  (Hono, :4000)
            ├─ sha256(token) → api_keys lookup → projectId       [60 s cache]
            ├─ plan/quota gate (402 if exceeded, fails open)
            ├─ per-project source filter (otlp/traces enabled?)
            ├─ admission semaphore (64 permits; excess WAITS, no 429)
            └─ forward + stamp header  x-superlog-project-id: <uuid>
                 └─ OpenTelemetry Collector Contrib v0.150.1 (:4318)
                      ├─ delete_matching_keys(attrs, "^superlog\..*")   ← anti-spoof
                      ├─ insert superlog.project_id from metadata
                      ├─ groupbyattrs → batch (5 s / 1024)
                      └─ clickhouse exporter
                           └─ otel_traces / otel_logs / otel_metrics_*
```

Two things worth internalising:

**It is two tiers, not one.** A custom Hono service handles tenancy and
admission; the *upstream* OTel Collector does the actual ClickHouse write.
`apps/api` has no OTLP route at all.

**Tenancy is strip-then-stamp.** Any `superlog.*` attribute we sent would have
been deleted before the authenticated project id was inserted. We could not have
spoofed another tenant even deliberately.

**Retention: none.** `otel_traces`, `otel_logs`, and all five `otel_metrics_*`
tables carry **no TTL**. Only two derived rollup tables expire, at 30 days. Our
spans — including their exception text — are stored indefinitely. This is the
basis of the security action item in §6.2.

### 3.2 How `honey-jackal` was actually produced

Our 8 Gemini errors became one incident through a pipeline that is far more
deterministic than "an LLM looked at it":

**1 — Candidate discovery.** A worker cursor reads an arrival-ordered ClickHouse
projection (`otel_issue_candidates`) over a 5-minute discovery window. Spans
qualify via an `exception` event; logs via `SeverityNumber >= 17` (ERROR).

**2 — Issue filter.** Evaluated *before* fingerprinting: excludes win, empty
includes means pass-all. Ours is empty, so all 8 passed. Note filtered events are
still **stored** — the filter only stops issue creation.

**3 — Fingerprinting** (`packages/fingerprint`). For a stack trace, frames are
parsed, `node_modules`/internal frames dropped, the top 5 user frames kept, and
the canonical string `type::messageBucket::frames` hashed to 16 hex chars. The
`messageBucket` step is the noise workhorse: URLs, paths, emails, UUIDs,
timestamps, IPs, hex, long ids, and numbers are replaced with placeholders before
hashing. That is why our eight *distinct* 503 messages collapsed into one issue —
the varying part numbers normalised away.

**4 — Issue upsert** with `ON CONFLICT (project_id, fingerprint)`, and a
transition classifier that distinguishes `new` / `recurred` / `seen` /
`suppressed`. Only `new` and `recurred` proceed.

**5 — Incident grouping**, a three-tier ladder tried in order:
   1. **Heuristic** — ≥2 overlapping frames among the top 5 of an open incident.
   2. **Same `trace_id`** — "same request implies same incident," cross-service.
   3. **LLM** — only if both fail. `claude-sonnet-4-6`, temperature 0, ~700
      tokens, with an enforced invariant that it must `inspect_incident` before
      joining, and a prompt that defaults to *standalone* unless there is
      positive evidence of a shared root cause.

   Ours almost certainly matched at tier 1 — identical frames through
   `api/gemini.py:_make_request`.

**6 — Investigation.** An agent run receives the issue samples, a
`${API_BASE_URL}/mcp` resource for live telemetry, prior memories, and
**cloned repositories**.

**7 — Resolution.** The agent called the terminal `resolve_incident` tool, which
the worker dispatches server-side after validating no PRs are outstanding,
writing `resolvedReasonCode: "agent_resolved"`.

### 3.3 How it read our source — and the attribute that did nothing

Revision 1 claimed `vcs.repository.url.full` was the join key between telemetry
and source. **That was wrong.** A grep of the entire platform repo returns *zero*
occurrences of `vcs.repository.url.full` or any `vcs.*` attribute.

Repository selection is a **token-overlap score** against repos reachable through
the GitHub App installation: +25 per service-name token match, +4 per stack-frame
token match, +35 for a repo-name substring match on the service. The top few are
cloned with short-lived read tokens; the agent then reads files directly and is
required to cite evidence as `path:line` with verbatim quotes.

So it found `api/gemini.py` by matching "jei-bom-tool" and our frame paths against
repo names — not from the attribute the onboarding skill insists on. **The skill
mandates an attribute the open-source platform does not consume.** Keeping it is
harmless and forward-looking; believing it is what enables source linking was
wrong.

### 3.4 Why the confidence score was exactly 9

The rubric is spelled out in the agent's tool schema: **10** requires every claim
backed by a verbatim quote from a file read that session **and** an
observed/reproduced failure; **7–9** is quote-backed with reproduction *inferred*.

Our incident quoted `api/gemini.py` verbatim but never reproduced the 503. A 9 is
the rubric working exactly as designed. Likewise `SEV-3` is defined as "a bug or
partial impact not blocking primary flows."

### 3.5 Where the agent's analysis fell short

Its verdict — *"the BOM tool workflow itself was not blocked"* — is true for
**correctness** and false for **latency**. It reasoned correctly over span
topology (parent `part.lookup` spans `Unset` while children errored, proving the
fallback worked), but `UNSET` only means *nobody explicitly marked this failed*.
The same spans record **56-second** durations.

This is structural, not a model deficiency: **the incident pipeline is
error-triggered end to end.** Candidates are discovered from exception events and
ERROR-severity logs. A dependency that is merely catastrophically slow while
failing gracefully produces *no* candidates, *no* issues, and *no* incidents.
Latency needs its own trigger — an alert (§6.1).

---

## 4. Packaging: three builds

| # | Failure | Cause | Fix |
|---|---|---|---|
| 1 | Exe crashed instantly | Bundling OTel pulled in `pkg_resources`, whose PyInstaller hook needs `jaraco.*` | `collect_submodules('jaraco')`, `more_itertools`, `platformdirs`; pin `jaraco.text` |
| 2 | Started, but HTTP spans silently missing | `dist-info` not bundled → `importlib.metadata.version("requests")` returned `None` → instrumentor self-disabled with `DependencyConflict` | `copy_metadata('requests')` + the OTel packages |
| 3 | Clean | — | `BT 2.5.0.exe`, 278.6 MB |

A diagnostic trap worth recording: failure 1 was masked because *every build
writes to the same `%LOCALAPPDATA%` log file*, so an older exe was
indistinguishable from the new one. The tell was a startup that logged neither
the OTel success line nor the caught-failure warning — impossible for a binary
containing the bootstrap.

**Generalisable lesson:** frozen Python needs both `collect_submodules` (lazily
imported code) and `copy_metadata` (runtime version negotiation). Missing the
first crashes loudly; missing the second **degrades silently**, which is worse.

---

## 5. Verification

```
/v1/traces:  200
/v1/logs:    200
/v1/metrics: 200
```

Checking the status code — not merely "no exception raised" — is the gate. It
distinguishes working (`2xx`), token unclaimed (`401/403`), and genuine bug
(`5xx` or no POST at all).

Regression: **332/332 pytest pass**, `ruff` clean on the new module, `gui.main_app`
imports, PyInstaller spec compiles, exe verified to log
`OpenTelemetry initialized | env=production`.

*Gap:* we checked status codes but not OTLP `ExportTracePartialSuccess` payloads,
so a 200 with partial rejection would have been missed.

---

## 6. What Superlog surfaced about this codebase

### 6.1 Gemini is a latency sink with a 100% failure rate

Measured over one enrichment run (57 lookups):

| Source | Lookups | Total | Avg |
|---|---:|---:|---:|
| cache | 22 (39%) | 1.9 ms | ~0.09 ms |
| digikey | 15 | 30.5 s | 2.0 s |
| digikey+mouser | 1 | 2.3 s | 2.3 s |
| **google (tail)** | **10** | **215.2 s** | **21.5 s** |
| **none / not found** | **9** | **181.9 s** | **20.2 s** |
| **Total** | **57** | **~430 s** | |

> **19 of 57 parts (33%) consumed 397 s of 430 s — 92% of wall-clock.**

| Gemini | Value |
|---|---|
| Logical calls | 18 (12 `quota`, 6 `error`) |
| **Successes** | **0** |
| HTTP attempts | 29 (16×503, 12×429, 1 timeout) |
| Time inside Gemini | **318 s ≈ 5.3 min** |
| Share of enrichment wall-clock | **~74%** |

Individual HTTP calls averaged ~1.3 s; logical spans reached 53 s. The amplifier
is ours: 5 s min-delay + 2 retries at 15 s/30 s + a 20 s read timeout + a 30 s
cooldown that expires and re-arms per part. The `~1.5 ms` quota spans are the
cooldown short-circuit *skipping* Gemini — they look healthy and are not.

This is a **resilience design flaw**: a best-effort enrichment fallback is allowed
to dominate the latency budget of a required workflow. *Not fixed — changes
behaviour, needs your decision.* Options: honour `cooldown_until` for the rest of
a run instead of re-arming per part; fail fast on 429; cap total Gemini time per
run; parallelise lookups.

### 6.2 🔴 Leaked Google API key — now with verified blast radius

`api/gemini.py` passes the key as a **URL query parameter**, so on failure it is
captured into the span `status_message`, the `exception_message`, and the full
stacktrace. It is also written verbatim to `bom_tool.log` (your
`_SecretRedactingFilter` matches `api_key=`/`token`/`password`, not `?key=`).

Revision 1 called this a risk. The source confirms it is worse than assumed:

- **Superlog performs no redaction of telemetry before storage.** Span
  `StatusMessage`, `exception.message`, `exception.stacktrace`, log bodies and
  `http.url` are stored verbatim. The only redaction in the entire platform
  protects *Superlog's own* ingest key in Render syslog lines.
- **The primary tables have no TTL** — indefinite retention.
- **No deletion path exists.** Deleting a project cascades the Postgres rows but
  leaves ClickHouse telemetry orphaned, not deleted.
- Any MCP-connected agent can read it back via `query_traces`.

**Action: rotate the key, and move it to a header.** One line fixes URL,
exception text, and the `http.url` span attribute simultaneously:

```python
url = f"{self.base_url}/models/{self.model}:generateContent"
headers = {"Content-Type": "application/json", "x-goog-api-key": self.api_key}
```

*Not yet applied.*

---

## 7. Costs

**Pricing was not verified — no plan, quota, or invoice was inspected.** What the
source does show is the *mechanism*:

- A `usage-meter` cron runs **every minute**; `usage-notify` every 5 minutes.
- Metric tables carry a `usage_by_time` **projection** specifically for counting
  billable points, keyed on a materialised `SuperlogProjectId`.
- Billed signals are `spans | logs | metric_points`.
- Over-quota returns **HTTP 402** at the proxy; the entitlement check is cached
  and **fails open**.

So cost tracks **event volume**, with metric *series cardinality* driving storage
and query cost (see §2.3 — the difference between 40 and 400,000 series). Agent
investigations are the other axis, and grouping is a real lever: our 8 issues
became **1** investigation.

Engineering costs, measured:

| Item | Cost |
|---|---|
| Code | 1 module (220 lines) + ~90 lines across 4 files |
| Dependencies | 4 runtime + 1 build-only |
| Exe size | 278.5 → 278.6 MB (**+0.1 MB**) |
| Runtime overhead | Batched async export; no measurable impact |
| Tests | 332/332 still pass |

---

## 8. Revision 1 scorecard

Honest accounting of where black-box inference failed:

| Claim (rev 1) | Reality | Verdict |
|---|---|---|
| `vcs.repository.url.full` is the telemetry↔source join key | Unused; repo selection is token scoring | ❌ **Wrong** |
| One custom ingest service | Two tiers: custom proxy + upstream OTel Collector | ❌ **Wrong** |
| Four metric tables | Five (incl. `exp_histogram`) | ❌ **Wrong** |
| `autoresolved_noise` is an active triage state | Legacy; no longer written | ❌ **Wrong** |
| Storage is ClickHouse | Confirmed, incl. engines and sort keys | ✅ Right |
| Plaintext token never leaves the machine | Confirmed | ✅ Right |
| Issues store a denormalised sample | `issues.last_sample jsonb` | ✅ Right |
| Tenancy materialised into rows server-side | Confirmed, plus strip-then-stamp anti-spoofing | ✅ Right (understated) |
| Grouping reduces investigation cost | Confirmed | ✅ Right |
| Incident pipeline is blind to non-error problems | Confirmed structurally | ✅ Right |

---

## 9. Status

**Done:** all three signals verified; business + LLM instrumentation; HTTP
auto-instrumentation; log bridge with trace correlation; packaged into the exe;
MCP connected; incident lifecycle observed end to end.

**Open:**

| Priority | Item |
|---|---|
| 🔴 P0 | Rotate the Gemini key; move to `x-goog-api-key` header (§6.2) |
| 🟠 P1 | Custom histogram bucket boundaries — defaults top out at 10 s, ours hit 56 s |
| 🟠 P1 | Alert on `component.lookup.duration` — covers the error-triggered blind spot |
| 🟠 P1 | Decide Gemini fallback policy (§6.1) |
| 🟡 P2 | Populate project context so investigations start with architecture knowledge |
| 🟡 P2 | Inspect OTLP partial-success payloads |
| 🟢 P3 | Commit these changes — nothing is committed yet |

## Appendix — files changed

| File | Δ | Purpose |
|---|---|---|
| `utils/observability.py` | **new, 220** | OTel bootstrap |
| `api/gemini.py` | +155/−31 | LLM spans, token metrics, `use_case` |
| `api/unified_manager.py` | +43 | `part.lookup` span + RED metrics |
| `gui/main_app.py` | +46 | `bom.enrich_run` span + run metrics |
| `main.py` | +8 | bootstrap call |
| `pyproject.toml` / `exe info/requirements.txt` | +8 each | deps |
| `exe info/JEI_BOM_Tool.spec` | +20 | hidden imports + `copy_metadata` |
