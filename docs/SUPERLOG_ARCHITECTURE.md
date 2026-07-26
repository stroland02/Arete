# Superlog — Technical Architecture

**Revision 2.** Revision 1 reverse-engineered the platform from its API surface.
This revision is written against the source
(`github.com/superloglabs/superlog`, Apache-2.0, pnpm + Turborepo, YC P26).
Claims are cited to file paths; short fragments are quoted for analysis only.

**Companions:** `SUPERLOG.md` (what we installed) · `SUPERLOG_SECURITY.md`
(threat model).

---

## 1. Topology

```
apps/
  proxy    Hono edge — auth, tenancy, admission control, vendor normalization  :4000
  api      Hono — app API, Management API, MCP server
  worker   pg-boss — issue pipeline, incident grouping, agent runs, alerts
  web      Vite 6 + React 19 SPA
  sample   demo instrumented app
packages/
  db               Drizzle + Postgres 16 schema (3k+ lines), 39 migrations
  telemetry-query  the ONLY ClickHouse read path (~1,950 lines)
  fingerprint      error grouping hashes
  net-guard        SSRF egress guard
  billing topology cloudflare gcp-auth railway render
infra/
  collector        OpenTelemetry Collector Contrib v0.150.1
  clickhouse       DDL + 9 migrations
  aws-connect      CloudFormation
```

Five apps, ten packages. Two databases: **Postgres** for control plane,
**ClickHouse** for telemetry. Two runtimes on the write path (proxy + collector),
one on the read path (`telemetry-query`).

---

## 2. Ingest

### 2.1 Two tiers, not one

`apps/api` has **no** `/v1/traces|logs|metrics` route. Ingest is:

```
client OTLP/HTTP
  → apps/proxy (:4000)         custom: auth, tenancy, quota, admission, normalization
      → OTel Collector (:4318)  upstream: strip, stamp, group, batch, write
          → ClickHouse
```

The proxy is the tenant edge; the **upstream** collector is the writer. This
split is the platform's most consequential structural decision: everything
tenant-specific stays in code they control, while the ClickHouse write path is
stock, battle-tested OSS.

The proxy also normalizes non-OTLP sources into OTLP — Vercel log drains, GCP
Pub/Sub, Render syslog (an RFC5424 TCP listener) and stream, Railway/Render
pullers, and AWS Firehose — so everything downstream sees one format.

### 2.2 Authentication

Tokens are `randomBytes(32).toString("base64url")` behind a family prefix, stored
as **unsalted SHA-256 hex** (`packages/db/src/keys.ts`). Unsalted is defensible
for 256-bit random tokens: there is no dictionary to attack, and salting would
break the O(1) hash-index lookup that the ingest hot path depends on.

Header precedence (`apps/proxy/src/index.ts`): `x-api-key` first, then
`Authorization: Bearer`. A `?token=` query param is accepted **only** on Render
stream routes.

Lookup is a single Drizzle read on `api_keys.key_hash`, wrapped in a cache with
**60 s TTL, 50k entries, in-flight de-duplication**, and only positive results
cached. Consequence: **revocation propagates up to ~60 seconds late.**

### 2.3 Tenancy: strip, then stamp

The anti-spoofing control, implemented identically in both write paths:

1. Delete every key matching `^superlog\..*` from resource **and** record
   attributes (collector OTTL statements; mirrored in the proxy's direct writer).
2. Insert `superlog.project_id` from the authenticated context —
   `metadata.x-superlog-project-id`, a header the proxy stamps only after the key
   lookup succeeds.

A client cannot inject or override its own tenancy. The collector's
`include_metadata: true` is what makes the header visible to the processor.

### 2.4 Admission control — not rate limiting

There is **no rate limiter** on ingest. Instead:

- **Two counting semaphores** (`buffer`, `upload`), 64 permits each, selected by
  `Content-Length`. Excess requests **wait** rather than receive 429 —
  deliberate backpressure, with permits released in `finally` on every path and
  gauges exposing available permits and queue depth.
- **Body cap** 64 MiB → 413. `Content-Length: 0` is rejected pre-auth with 400.
- **Quota gate** → **402** for over-allowance free orgs; the check is a cached
  in-memory read that **fails open**.
- **Per-project source filters** ack-drop disabled `(source, signal)` pairs at
  the edge.

Status codes are chosen so OTLP exporters behave: 400/402/413 are permanent so
clients drop rather than retry-storm; anything else surfaces as 5xx and is
retried.

### 2.5 Durability options

- **SQS + S3 buffer** (optional): long-poll 20 s, visibility timeout 120 s, batch
  10, 4 consumers, S3 offload above ~240 KB. The producer returns 200 with an
  empty protobuf immediately on enqueue.
- **Direct-to-ClickHouse mode**: synchronous `JSONEachRow` insert with
  `insert_quorum: 2`, SQS message deleted only on success (at-least-once).
  Implements **logs and traces only** — metrics still route through the collector.

---

## 3. Storage

### 3.1 Core tables

All `ReplicatedMergeTree`, `index_granularity=8192`, `ttl_only_drop_parts=1`.

| Table | PARTITION BY | ORDER BY |
|---|---|---|
| `otel_traces` | `toDate(Timestamp)` | `(ServiceName, SpanName, toDateTime(Timestamp))` |
| `otel_logs` | `toDate(TimestampTime)` | `(ServiceName, TimestampTime, Timestamp)` |
| `otel_metrics_{gauge,sum,summary,histogram,exp_histogram}` | `toDate(TimeUnix)` | `(ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))` |

**Five** metric tables, not four — `exp_histogram` handles exponential histograms.

Notable columns and indexes:

- A **skip index** on `ResourceAttributes['superlog.project_id']` of type
  `set(0)` — the tenancy filter is the hottest predicate in the system, so it
  gets granule-level pruning.
- `otel_logs.Body` carries a **`tokenbf_v1` bloom filter** (32768, 3 hashes),
  making substring search viable at scale.
- `TimestampTime` is a `DEFAULT` column, which the direct writer must *not*
  insert — a real trap the code comments on.
- Metric tables carry `SuperlogProjectId` as a **MATERIALIZED** column extracted
  from the resource map, plus a `usage_by_time` **PROJECTION** existing purely to
  make billing counts cheap.

### 3.2 Derived tables — the read models

This is where the design gets sophisticated. Rather than query raw tables for
everything, the platform maintains purpose-built rollups:

| Table | Engine | Purpose |
|---|---|---|
| `issue_activity_daily` | SummingMergeTree | per-fingerprint daily counts, fed by MVs off exception events and `SeverityNumber >= 17` |
| `events_per_minute` | SummingMergeTree | volume by signal/service/severity |
| `otel_exceptions` | MergeTree | narrow exception projection |
| `otel_traces_recent` + `otel_traces_summary` | MergeTree / **AggregatingMergeTree** | trace-list fast path; readers must re-aggregate states |
| `metric_names_per_hour` | SummingMergeTree | metric catalogue |
| `otel_issue_candidates` | MergeTree | **arrival-ordered worker cursor** |
| `otel_traces_trace_id_ts` | MergeTree | trace-id → timestamp lookup |

`otel_issue_candidates` deserves attention: the issue pipeline does not scan
`otel_traces` looking for errors. It consumes an *arrival-ordered projection*,
which makes the worker a cursor-advancing consumer rather than a repeated
range-scanner — the difference between O(new events) and O(window) per tick.

### 3.3 Retention

**The primary tables have no TTL.** Only `otel_traces_recent` and
`otel_traces_summary` expire, at 30 days. Migrations 004 and 005 explicitly note
"no TTL clause" because the source tables have none.

Raw spans, logs, exception messages, and stacktraces are retained **indefinitely**
by default. See `SUPERLOG_SECURITY.md` §3.

---

## 4. The read path

`packages/telemetry-query` is the single ClickHouse read adapter — one file,
~1,950 lines, exporting `queryLogs`, `queryTraces`, `queryTracesAggregated`,
`getTraceDetail`, `queryMetrics`, `metricSeries`, `countSeries`, catalogue
listers, and `previewIssueFilterMatches`. The API and MCP both re-export it; the
MCP module is literally a one-line re-export.

**Every user value is a ClickHouse server-side bound parameter** (`{name:Type}`
+ `query_params`). Attribute filters bind **both key and value** — only the
*column* and the *operator* come from code, and the column is a closed union of
`ResourceAttributes | SpanAttributes | LogAttributes`.

Two deliberate interpolation paths, both clamped:

1. **`field.*` filters** route through an allowlist that returns `null` for
   anything outside `{trace_id, span_id, severity_number}`; non-matching keys are
   silently dropped so an arbitrary key can never reach the SQL.
2. **Time bounds.** The MCP advertises ClickHouse expressions like
   `now() - INTERVAL 1 HOUR`, and those *are* interpolated raw — but only after
   matching a fully-anchored regex permitting exactly that shape with a positive
   integer and one of six units. Anything else must match ISO-8601 **and** parse,
   then binds as a parameter.

Tenancy is the first predicate of every query. There is **no raw-SQL MCP tool** —
no escape hatch exists, which is the structural reason the injection surface
stays small.

---

## 5. The worker

### 5.1 Execution model

**pg-boss v12 on Postgres** — no Redis, BullMQ, or Temporal. Three layers:

**Cron jobs**, auto-discovered from a directory; each module exports
`{name, schedule, create(deps)}` and returning `null` from `create()` opts the job
out (e.g. missing API key). One exclusive-policy queue per job.

| Job | Schedule |
|---|---|
| `usage-meter`, `railway-pull`, `render-pull`, `gcp-authorization-cleanup` | every minute |
| `autorecovery`, `build-topologies`, `gcp-metrics-pull`, `usage-notify` | every 5 min |
| `agent-pr-lifecycle` | hourly |
| `cloudflare-reconcile` / `-refresh` | hourly / daily |

**Recurring chains** for sub-minute cadence, which cron cannot express — each a
self-perpetuating job plus a dead-chain reviver:

| Chain | Interval |
|---|---|
| `agent-chat-sweep`, `webhook-deliveries` | 5 s |
| `alert-evaluation` | 10 s |
| `digest-sweep`, `observation-sweep` | 60 s |

**A legacy tick loop** (3 s poll, batch 500) still owns the ClickHouse telemetry
scan and acts as fallback when pg-boss is unavailable.

The degradation policy is notably careful: when a chain fails to register, the
step goes **dormant rather than running locally**, because a local fallback could
run concurrently with another process's live chain and double-deliver webhooks.
Correctness is chosen over availability, explicitly.

**Agent runs** use a `stately` policy with `singletonKey = run id`, so at most one
queued and one active job exist per run. Default concurrency 10 (max 50), 90 s
job timeout.

### 5.2 Fingerprinting

`packages/fingerprint` produces a 16-hex-char SHA-256 prefix over a canonical
string:

- **With a stacktrace:** `type::messageBucket::top5NormalizedFrames`, after
  dropping `node_modules`, `node:internal`, and webpack frames.
- **Without:** `log::service::type::normalizedMessage`.

`messageBucketFor` is the noise-control workhorse: it unwraps provider error
envelopes, then replaces URLs, paths, emails, UUIDs, timestamps, IPs, hex, long
ids, and numbers with placeholders, lowercases, and truncates at 160 chars.
`collapseRequestPaths` exists specifically so a bot sweep (`/wp-admin`, `/.env`)
collapses to one issue per HTTP method rather than thousands. Path normalization
strips Next.js/Turbopack content hashes, iOS sandbox UUIDs, and Expo bundle names
so a rebuild doesn't re-fingerprint every error.

That last detail is the tell of a system shaped by production: most of the
complexity here is *not* about hashing, it is about preventing the same logical
error from splitting into thousands of fingerprints.

### 5.3 Issue lifecycle

Candidates are read from `otel_issue_candidates` over a 5-minute discovery window
with two cursors (spans, logs). Then:

1. **Issue filter** — evaluated *before* fingerprinting. Excludes win; empty
   includes means pass-all; non-empty includes OR-restrict. Keys match
   case-insensitively, values exactly. Filtered events never become issues but
   **are still stored**.
2. **Fingerprint**, then in-memory collapse per `(projectId, fingerprint)`.
3. **Upsert** — one statement, `ON CONFLICT (project_id, fingerprint) WHERE
   silenced_at IS NULL`.
4. **Transition classification**, driven by Postgres `xmax = 0` (genuinely
   inserted) plus prior status → `new` / `recurred` / `suppressed` / `seen`. Only
   `new` and `recurred` dispatch downstream.

Using `xmax` to distinguish insert from update inside an upsert is a nice piece of
Postgres craft — it avoids a second round trip.

### 5.4 Incident grouping — a three-tier ladder

Tried in order:

1. **Heuristic frame overlap** — requires ≥2 normalized frames; scores open
   candidates by overlap across the **top 5** frames; requires overlap **≥2**;
   picks the max. Service-filtered.
2. **Same `trace_id`** — "same request implies same incident." Deliberately
   *cross-service*, since one request spans services.
3. **LLM grouping** — only if both fail.

Special paths bypass the ladder: alert episodes key on `(alertId, groupKey)`, and
recurrences open a *new* incident chained via `previous_incident_id` rather than
reopening the old one.

**Concurrency:** the read-then-create tail is serialized on a key —
`trace:<traceId>` when available, else the issue id. The LLM call sits
**outside** the lock, so a slow model never serializes intake.

**The grouping LLM** (this one *is* in-repo): `claude-sonnet-4-6` by default,
temperature 0, ~700 max tokens, ≤5 tool iterations. Tools let it list, search,
and inspect incidents before a `decide_grouping` call. Two guardrails stand out:

- An enforced invariant that a *join* must be preceded by `inspect_incident` on
  that specific id — the model cannot join something it never looked at.
- A prompt that defaults to **standalone** unless there is positive evidence of a
  shared root cause, and forbids joining across differing
  `deployment.environment` values or mixing localhost with production traffic.

Every path stamps grouping state (`pending`/`grouped`/`standalone`/`failed`) with
source (`heuristic`/`llm`/`manual`) and guards for losing racers.

### 5.5 Agent runs

**The investigation agent's brain is not in this repository.** The runner
dispatches on runtime: `community` (a static stub that ships here and returns a
canned summary with `rootCause: null`), `disabled`, or `anthropic` — a **dynamic
import of `AGENT_RUNNER_ANTHROPIC_MODULE`**. The system prompt, model id, and turn
loop for the flagship feature live behind that env-var seam.

Everything *around* it is open, and that is most of the interesting engineering:

**Input assembly.** The run receives issue summaries (frames, stacktrace, trace
context, last sample, alert episode), repo candidates with clone URLs and
short-lived installation tokens, an MCP resource URL for live telemetry, prior
memories, predecessor incidents, and policy flags.

**Repo selection is scored, not declared.** Token overlap: +25 per service-name
token, +4 per stack-frame token, +35 for a repo-name substring match. Top-N are
mounted. Repo agent-instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
Copilot instructions) are probed on the default branch and surfaced to the agent.
Zero candidates pauses the run to ask a human which repo owns the incident.

> **Note for our install:** `vcs.repository.url.full` is **not read anywhere** in
> this repo — grep returns zero occurrences of any `vcs.*` attribute. The
> onboarding skill mandates it; the platform does not consume it.

**Tool contract.** One non-terminal tool, `report_findings`, and five terminal
ones: `propose_pr`, `complete_investigation`, `ask_human`,
`report_external_cause`, `resolve_incident`. Two design details worth stealing:

- Terminal side effects are **dispatched server-side before the success ack**, so
  a failed PR push keeps the agent's turn alive instead of ending it with a lie.
- Retired tool names are **error-acked with redirect guidance** rather than hard
  failing — graceful deprecation for a model that may have stale expectations.
- The tool set is **capability-gated**: `propose_pr` only appears when PR creation
  is enabled, and `complete_investigation` only when no intervention tool exists.

**Findings map 1:1 onto incident columns** — summary, root cause text +
confidence, estimated impact + confidence, suggested severity — and are written
on `awaiting_events` as well as `complete`.

**The rubrics are explicit**, which is why scores are interpretable:

- *Root-cause confidence 10* requires verbatim quotes from files read that
  session **and** an observed/reproduced failure; **7–9** is quote-backed with
  reproduction inferred; 4–6 is a hypothesised mechanism; 1–3 speculative.
- *Impact confidence 10* requires concrete signal — telemetry counts, error
  rates — not inference from a component name.
- *SEV-1* is customer-visible outage/data loss/revenue stop; *SEV-2* significant
  degradation; *SEV-3* a bug or partial impact not blocking primary flows.
- Evidence must be cited as a bold `path:line` header followed by a fenced block
  quoting the file verbatim.
- `propose_pr` branches must match `^superlog/`, and there is an explicit rule
  that a patch which merely quiets a signal is the wrong outcome.

That last rule is the difference between an agent that fixes bugs and one that
deletes alerts.

### 5.6 Resolution and hysteresis

`agent_resolved` has a **single write site**: the server-side dispatch of the
agent's `resolve_incident` call, which first validates that no PRs are open or
pending and that the run is current — refusing with a readable error the model
can act on.

**`autoresolved_noise` is legacy and no longer written.** Noise now silences the
linked *issues* and resolves the incident plainly with a noise reason. The status
survives only as a closed state for old rows, a webhook branch, and an API filter
value hidden by default.

Timing constants:

| Constant | Value | Purpose |
|---|---|---|
| Post-resolution investigation cooldown | **24 h** | only for `fixed_in_current_code` |
| Observation escalation window | **5 min** | rate-trigger floor |
| Autorecovery interval / dismissal / re-eval cooldown | 1 h / 24 h / 24 h | |

The 24-hour cooldown carries a comment citing the incident that motivated it —
nine agent runs in four hours all concluding "fix is on staging, awaiting
promotion." Constants earned in production, not chosen a priori.

### 5.7 Memory

Plain relational: `agent_memories` keyed by org + project, `kind ∈
{feedback, terminology, infra, project}`, `status ∈ {active, archived}`,
title ≤200 chars, body ≤4,000.

Retrieval is a filtered `findMany` ordered **oldest first** — "so prompts read in
the order the knowledge was learned" — and injected **in full**, with no ranking,
truncation, or similarity search. **There is no vector store or embedding call
anywhere in the tree.**

For a per-project store bounded at a few thousand tokens this is the right call:
retrieval infrastructure would add failure modes without improving recall.

Adjacent context uses the same plain-fetch approach: predecessor incidents walked
via `previous_incident_id` (chain limit 3) and a follow-up timeline capped at 20
lines.

### 5.8 Alerts

Evaluated on the 10-second chain. Per alert: compute the window, aggregate into
`Map<groupKey, number>`, apply comparator/threshold per group, classify each as
`new_firing | still_firing | recovered`, then stamp `markEvaluated`.

A `new_firing` opens an episode (a partial unique index over open rows is the
dedupe arbiter), creates a 1:1 issue of kind `alert`, and pushes it through the
same issue-transition path — so **alerts and errors converge on one incident
model** rather than living in parallel systems. That is a genuinely good
simplification.

Error semantics are deliberate: failures **propagate** so `markEvaluated` is
skipped and the next tick retries. The comment explains why — swallowing would
record a firing and stamp the timestamp, so a firing alert would page nobody.

---

## 6. API and MCP

### 6.1 Structure

**Hono** (not Express/Fastify/Next), organised as "mount functions": each feature
exports `mountX(app)` and the entry file calls them in order. Ordering is
security-relevant — public routes such as `POST /api/signup-intents` are mounted
*before* the session middleware, which is what makes them unauthenticated by
design rather than by accident.

Two surfaces: the session-cookie `/api/*` app API, and a public **Management
API** at `/api/v1/*` built with `hono-openapi`, authenticated by `sl_management_*`
org keys and self-documenting via OpenAPI + Scalar.

### 6.2 The MCP server

**Transport:** official SDK, HTTP streamable, **stateless** — a fresh `McpServer`
is constructed per request, its lifetime tied to the transport because the
response is an async-written event stream.

**Auth:** OAuth 2.1 with **mandatory PKCE S256**, RFC 7591 dynamic client
registration (public clients only), refresh-token **rotation**, RFC 8707
resource-indicator binding checked at authorize, token, refresh, *and* every
request. Exact redirect-URI matching; dangerous schemes blocked; `http:` allowed
only for loopback; single-use codes with a 5-minute TTL. Personal access tokens
are an alternative path. 401s emit a spec-shaped `WWW-Authenticate` challenge
pointing at the protected-resource metadata.

That is a more rigorous OAuth implementation than most products ship.

**Authorization is two-layered per tool call:** a token-scope clamp
(`superlog:org:<id>`) then a membership check, re-evaluated on **every** call —
so a stolen token cannot follow its user into a project they lost access to.

**Tools** are registered with Zod input shapes and return JSON as text content.
An analytics wrapper patches `registerTool` before any registration so every
invocation is instrumented. Registration is capability-gated: a
`superlog:telemetry` scope yields a telemetry-only session; otherwise alert,
dashboard, incident, and agent-config tools are all registered — i.e. **read and
write by default** (see the security doc).

### 6.3 Signup intents

`POST /api/signup-intents` is unauthenticated and accepts only a 64-hex SHA-256
digest plus a prefix — validated by regex. The claim endpoint is session-authed
and transactional: it checks expiry (410), prior consumption (409, or idempotent
success if the same project re-claims), verifies no other project already owns
that hash, then **promotes the hash into a real `api_keys` row** and marks the
intent consumed.

The plaintext token is never transmitted. Possession is proven later, implicitly,
by successful ingest.

---

## 7. Web

**Vite 6 + React 19 SPA** with react-router — *not* Next.js. Tailwind 3.4 with an
in-repo design system; headless primitives from `@base-ui/react` plus one Radix
package; **no shadcn/ui**. Two charting libraries by surface: **ECharts**
(tree-shaken) for dashboard widgets, **Recharts** for exploration and billing.

**Dashboards** use `react-grid-layout` on a 12-column grid, 60 px rows. New
widgets are placed at `y: 9999` so vertical compaction snaps them to the bottom —
a neat trick that removes "where do I put this?" from both the UI and the MCP
tool. Standard sizes per type (charts 6×4, tables 12×6, markdown 4×5) are
defaults, which is why the MCP tool can tell an LLM to *omit* layout. Layout
changes are diffed and **debounced 400 ms** before PATCH. Config and layout
persist as `jsonb`.

**Incident detail is polling, not streaming.** There is no SSE or WebSocket
endpoint in the API. A poll interval of **3 s** applies only while the agent run
is in an active state, returns `false` (stop polling) for terminal or dormant
states, and **fails closed** on unknown states. Root cause renders from the
incident columns with the agent-run result as fallback, through a markdown
renderer that turns `path:line` evidence citations into repo links.

Polling with a state-gated interval is the right engineering call here: agent
runs are minutes-long and bursty, so a persistent connection per viewer would
cost more than it saves.

---

## 8. Design assessment

### Strong

1. **Two-tier ingest.** Tenant logic in owned code; the ClickHouse write path is
   stock upstream collector.
2. **Strip-then-stamp tenancy.** Spoofing is structurally impossible, not merely
   validated against.
3. **Deterministic grouping before LLM grouping.** Two cheap heuristics run first;
   the model is the fallback, bounded to 5 iterations at temperature 0 with an
   inspect-before-join invariant. Most products would have reached for the model
   immediately.
4. **Purpose-built read models.** Rollups, projections, and an arrival-ordered
   candidate cursor instead of repeated range scans.
5. **Query safety by construction.** Bound parameters for keys *and* values, an
   allowlist for field filters, two regex-clamped interpolation paths, and no
   raw-SQL tool anywhere.
6. **Explicit, calibrated rubrics.** Confidence and severity are defined in the
   tool schema, so a "9" means something checkable.
7. **Alerts converge on the incident model** rather than forming a parallel
   universe.
8. **Failure semantics are argued in comments.** Alert errors propagate; dormant
   beats double-delivery; the 24 h cooldown cites its motivating incident.

### Weak / open

1. **The agentic core is closed.** For a project marketed as an open-source
   agentic telemetry system, the investigation prompt, model, and loop sit behind
   a dynamic import. Self-hosters get the `community` stub.
2. **Error-triggered blindness.** Candidates come from exception events and
   ERROR-severity logs. A dependency that is catastrophically slow but fails
   gracefully produces no incident — exactly our Gemini case.
3. **No telemetry redaction, no TTL, no deletion path.** See the security doc.
4. **Decentralised authorization.** ~10 independent `requireProjectAccess`
   implementations with two different semantics (active-org vs. any-membership).
   Correct today across all 152 project-scoped routes; structurally fragile.
5. **Advertised-but-unenforced scope.** `mcp:read` appears in OAuth metadata and
   is not enforced anywhere.
6. **Revocation lag.** 60 s ingest-key cache TTL.

### One sentence

> Superlog bets that collection is a commodity (stock OTel end to end),
> that installation is an agent's job (skills, not an installer), and that the
> durable value is turning stored telemetry into explained incidents — then backs
> that bet with unusually disciplined engineering everywhere except the one
> component it keeps closed.

---

## 9. Revision 1 scorecard

| Rev 1 claim | Reality |
|---|---|
| `vcs.repository.url.full` is the source join key | ❌ Unused; repo selection is token scoring |
| Single custom ingest service | ❌ Proxy + upstream OTel Collector |
| Four metric tables | ❌ Five (`exp_histogram`) |
| `autoresolved_noise` is active | ❌ Legacy, no longer written |
| Incident page may use SSE/WebSocket | ❌ 3 s gated polling |
| Next.js frontend | ❌ Vite + React SPA |
| ClickHouse storage | ✅ Confirmed, incl. engines/sort keys |
| Plaintext token never leaves the machine | ✅ Confirmed |
| Issues store denormalised samples | ✅ `issues.last_sample jsonb` |
| Server-side tenancy injection | ✅ Confirmed, plus anti-spoof strip |
| Constrained DSLs, safe for LLMs | ✅ Confirmed, stronger than assumed |
| Grouping is a cost lever | ✅ Confirmed |
| Error-triggered blind spot | ✅ Confirmed structurally |

Roughly half the structural inferences were right; every *mechanism* guess about
how source linking worked was wrong. The lesson for reverse-engineering: API
contracts reliably reveal **data models**, and reliably mislead about
**provenance**.
