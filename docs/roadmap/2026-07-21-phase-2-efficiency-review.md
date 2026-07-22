# Phase 2 efficiency review — data pipeline + model deployment/harness (Tasks 12/13)

**Governing rule:** no change without a prior measurement. Every finding below states what was
measured, on what data, and — where a change was made — the before/after number. Findings with no
attached measurement are filed to `docs/roadmap/backlog.md`, not fixed.

**Environment note (read first):** telemetry is OFF by default in this checkout
(`OTEL_EXPORTER_OTLP_ENDPOINT` unset in `.env`). It was set to `http://localhost:4318` for this
review's measurement runs (now committed in `.env`, gitignored in practice but present in this
workspace's copy) — without it, `initTelemetry()`/`init_observability()` silently no-op and there is
nothing to query. The healing path (`fix_pipeline.py`) was only instrumented in commit `a2c48c7`
(Task 14, same day), so there is effectively **no historical production data** for it. Two kinds of
data back this report:

1. **Synthetic load I generated this session** — clearly marked below. The fix pipeline was
   exercised end-to-end (real `run_fix()`, real git checkout of a small public GitHub repo
   `octocat/Spoon-Knife`, real findings-gate/grounding logic) but using the **local Ollama model
   (`qwen2.5-coder`, 7.6B, already installed and running on this machine)** in place of Anthropic —
   this checkout has no `ANTHROPIC_API_KEY` configured (`LLM_PROVIDER=gemini` with an empty key in
   `.env`). This means: pipeline **mechanics** (span tree, stage timing shape, retry/timeout
   behavior, grounding) are genuinely exercised and trustworthy; **tier-specific** (opus/sonnet/haiku)
   latency, cost, and quality comparisons are **not** obtainable this way, because Ollama shares one
   model across every role (no tiering) and I have no way to call the real Anthropic API in this
   environment. That gap is called out explicitly wherever it matters, rather than papered over with
   estimates.
2. **Synthetic Postgres data I seeded this session** for the read-path measurement (Task 12) — 10
   tenants, 750,000 `ReviewComment` rows — because the real dev database currently holds 0 rows in
   every review-related table. Cleaned up after measurement (see Task 12 §1).

---

## Task 12 — Data pipeline efficiency review

### Finding 1 (FIXED, measured before/after): `ReviewComment` had no secondary index at all

**Measurement.** The live dev Postgres (`docker compose exec postgres`) has 0 rows in `Review`,
`ReviewComment`, `Repository`, `Installation` — nothing to measure against. I seeded synthetic data
to a realistic multi-tenant scale: **10 installations, 200 repositories, 30,000 reviews, 750,000
`ReviewComment` rows**, with the query in every case scoped to one tenant holding ~10% of the total
(`seed-inst-1`: 20 repos / 3,000 reviews / 75,000 comments) — the shape that actually exercises join
selectivity, unlike an unrealistic single-tenant seed.

`\d "ReviewComment"` before any change showed **exactly one index**: the primary key on `id`. No
index on `reviewId` (the column every dashboard read joins through), `severity`, `category`, or
`noiseState` — despite all four being filtered or grouped on on every dashboard page load
(`packages/dashboard/src/lib/queries.ts`).

`EXPLAIN (ANALYZE, BUFFERS)` on the four hottest queries at the 750k-row scale, forcing the
pre-index plan (`SET enable_indexscan = off`) to get a true same-data before/after (not a
before/after that also changes the dataset):

| Query (queries.ts source) | Before (seq scan, forced) | After (`@@index([reviewId])`) | Δ |
|---|---|---|---|
| `criticalBugs` count (`severity='error'`, run **twice** per `getDashboardViewModel`/`getDashboardsViewModel` call) | 77.1 ms | 54.5 ms | **-29%** |
| `commentsByCategory` groupBy (run **twice**, same two view-models) | 86.5 ms | 59.2 ms | **-32%** |
| `getAgentActivity` (order by `createdAt` desc, limit 60) | 86.4 ms | 64.7 ms | **-25%** |
| `getFindingsByPath` (`noiseState='OPEN'`, limit 2000) | 6.2 ms | 2.1 ms | **-66%** |

(Raw `EXPLAIN ANALYZE` output for both passes, plus the seed/cleanup SQL, is reproducible from the
commands in this review; not pasted in full here for length, but every number above was read
directly from `Execution Time:` in the plan output, not estimated.)

**Why this matters more than the raw percentages suggest:** these four queries are not independent —
`getDashboardViewModel` and `getDashboardsViewModel` between them run the `severity='error'` count
**four times** (current + prior-week, ×2 view-models) and the category groupBy **twice** per single
page load, all via `Promise.all` (so wall-clock is bounded by the slowest one, but total DB-side work
scales with the count). Every one of those was a full sequential scan of the entire `ReviewComment`
table on every page view, for every tenant, scaling with **global** row count (all tenants combined),
not the requesting tenant's own slice. That is the actual growth risk: a single busy tenant's data
volume degrades every other tenant's dashboard load time, because the missing index means table size,
not query selectivity, sets the cost floor.

**Change made:** `packages/db/prisma/schema.prisma` — added `@@index([reviewId])` to `ReviewComment`.
Migration `packages/db/prisma/migrations/20260721202437_add_review_comment_review_id_index/migration.sql`:

```sql
CREATE INDEX "ReviewComment_reviewId_idx" ON "ReviewComment"("reviewId");
```

I did **not** also add indexes on `severity`, `category`, or `noiseState` individually — I have not
isolated their standalone contribution from the join-index's, and adding un-isolated indexes on a
governing-rule-constrained pass would be exactly the "change I have not measured" the rule forbids.
Filed to backlog with this session's numbers attached, for someone to isolate and measure before
adding.

**What would detect a regression:** none needed for a pure additive index — it changes the query
planner's available paths, not query semantics or results. The existing webhook/dashboard test
suites (which exercise these query functions) continue to pass unchanged; I did not modify any query
shape.

### Finding 2 (measured, no code change): `getTrendSeries` / `getDashboardsViewModel`'s unbounded review-row fetch is not currently a problem, but its risk is different from the capped queries

`getTrendSeries` and `getDashboardsViewModel` both fetch **every** `Review.createdAt` for a tenant's
history with no `take` limit, to bucket client-side. At the seeded scale (30,000 reviews total, 3,000
for the target tenant) this ran in **0.9-6ms** — not currently a bottleneck, and `Review` already has
a serviceable index (`repositoryId, createdAt`). The real risk here isn't Postgres query time (which
scales fine off the existing index) — it's that the row count returned to the Node process is
unbounded by design, so a multi-year-old installation with tens of thousands of reviews eventually
pays a serialization/marshaling cost in the app layer that this measurement, at today's data volumes,
cannot yet show. No fix applied (nothing measured to justify one); filed to backlog with this
measurement attached as the baseline for whoever revisits it once real tenant history exists.

### Finding 3 (measured, no change needed): `getFindingsByPath`'s 2000-row cap and `getAgentActivity`'s 60-row cap are both already the right shape

Both caps bound the *rows returned*, and (per Finding 1) once the join has a real index behind it,
both execute in single-digit milliseconds even at 750k rows. No evidence either cap needs to change.

### Finding 4 (non-finding, honest): ClickHouse write path and TTLs

Reviewed `infra/otel-collector-config.yaml` (memory_limiter at 80%/25% spike, first in every
pipeline; `redaction` + `transform` OTTL passes; `batch: {}` using the collector's stock defaults) and
`packages/db/clickhouse/RETENTION.md` / `migrations/008_full_retention_ttls.sql` (raw signals 30d,
rollups 90d, `ttl_only_drop_parts = 1` so expiry drops whole parts rather than rewriting rows). The
configuration is internally consistent and matches the documented policy.

**I cannot observe TTL reclamation actually happening** in this environment — every row in
`otel_traces`/`otel_logs`/`otel_metrics_*` in this dev ClickHouse is at most a few hours old (this
session's synthetic load plus whatever earlier phases generated), nowhere near the 30-day raw
retention window. This is an honest gap, not a pass: the DDL says the TTL will fire, but nothing here
proves it does. No change made; no measurement exists to justify one either way.

### Finding 5 (measured via synthetic load): fix-drive latency is dominated by the LLM calls, not the queue's concurrency cap — confirms the plan's own hypothesis

I ran the real `fix_pipeline.run_fix()` end-to-end 9 times against a real (small, public)
GitHub repo, via local Ollama (see environment note above). Per-stage span timing, queried from
ClickHouse (`otel_traces`, `SpanName LIKE 'fix.%'`), aggregated across the runs:

| Span | count | avg | p95 |
|---|---|---|---|
| `fix.run` (root) | 10 | 2774.6 ms | 5439.7 ms |
| `fix.author` (LLM call — patch authoring) | 10 | 2176.9 ms | 4782.7 ms |
| `fix.checkout` (git clone/pull) | 10 | 492.8 ms | 841.2 ms |
| `fix.verify` (LLM call — auto_resolver verification) | 4 | 256.5 ms | 374.2 ms |
| `fix.evidence` (local file read) | 10 | 1.5 ms | 7.2 ms |
| `fix.findings` (mechanical grounding check) | 10 | 0.1 ms | 0.6 ms |

`fix.author` alone is **~78% of `fix.run`'s average duration**; `fix.author` + `fix.verify` (the two
LLM round trips) together account for essentially all of it once checkout is cached (checkout only
does a full clone on the very first run — 492.8ms average includes that cold case; steady-state
pulls are faster). Grounding and evidence-reading are noise (sub-2ms). Three of the nine runs (a
deliberately fixable accessibility issue — a Spoon-Knife `<img alt="">`) completed the full
author→ground→verify→fixed path in 3.95-4.38s wall time each; the other six correctly declined
(no real issue in a README) after a single fast `fix.author` call.

**Conclusion on `FIX_QUEUE_CONCURRENCY=2`:** the data supports the plan's own stated hypothesis. A
single fix drive's latency floor is set by two sequential LLM round trips, not by anything the queue
controls. Raising or lowering the concurrency cap changes how many drives run *simultaneously*; it
does not touch the ~2.4s (local model) / almost-certainly-longer (real Anthropic, network + larger
model) per-drive floor. With `WorkItem` currently at 1 row in this environment, there is no evidence
of queue backlog to justify raising it, and no evidence low concurrency is starving throughput. **No
change made to `FIX_QUEUE_CONCURRENCY`.**

**Caveat on real-world numbers:** these are local-model latencies (small 7.6B model, no network
round trip to a hosted API). Real Anthropic tiers will be slower in absolute terms, especially opus.
The *shape* of the finding (LLM calls dominate; checkout/grounding/evidence are noise) is
architecture-level and provider-independent; the *magnitude* is not directly portable to production
tiers without a real API key in this environment.

### Finding 6 (source-grounded, NOT measured — filed to backlog): review-side concurrency is not what `REVIEW_QUEUE_CONCURRENCY=5` suggests

Reading `packages/agents/src/arete_agents/orchestrator.py:353-381`: a review's primary path builds a
LangGraph `StateGraph` and fans out via `Send` — **one node execution per (file, agent) pair**, for
every file in the PR times every configured review agent (up to 6). `graph.invoke({"pr": pr})` is
called with no `max_concurrency` config, so this fan-out is architecturally unbounded by anything in
this codebase. The (documented, fallback-only) LangGraph-failure path at `orchestrator.py:675` makes
the same shape explicit with a literal `ThreadPoolExecutor(max_workers=min(len(tasks), 12))`.

That means `REVIEW_QUEUE_CONCURRENCY=5` bounds how many **review jobs** run at once on the worker —
it does **not** bound concurrent **LLM calls**. A PR touching 20 files reviewed by 6 agents is ~120
concurrent LLM calls for that ONE review; five such reviews running concurrently (the queue's own
cap) is up to ~600 simultaneous provider calls. I have not measured this live — doing so honestly
would need either a real large PR and a real Anthropic key (neither available here) or instrumenting
and counting concurrent `gen_ai.*` spans in a production trace once real review volume exists. Filed
to backlog with this source-grounded reasoning; the actual bottleneck for review throughput is far
more likely to be the provider's own concurrent-request/rate limit than the `5` on the BullMQ queue.

### Finding 7 (source-grounded, NOT measured — filed to backlog): review-job retries duplicate work the per-call retry already covers; fix-job retries do not

`packages/webhook/src/worker.ts:94-113` — `processGitHubPullRequest` wraps `runReviewPipeline` in a
`try { ... } catch (err) { ...update check run...; throw err }`. The re-thrown error propagates out of
the BullMQ job processor, and `enqueueReviewJob` submits with `DEFAULT_JOB_OPTIONS` (`attempts: 3`,
`packages/webhook/src/queue.ts:152-157`) — so **any** review failure that survives each agent's own
`with_retry(stop_after_attempt=2)` (`agents/base.py:191`) causes BullMQ to re-run the **entire**
multi-file, multi-agent review from scratch, up to 3 total attempts. That is retry-of-a-retry: a
transient failure in one agent call, on one file, restarts every agent's call on every file.

Contrast with the fix path: `packages/webhook/src/fix/trigger.ts:167-168` documents (and the code
enforces) that `driveFix` **never throws** — every failure path resolves to `fix_failed` and returns
normally, so the queue's own `attempts: 3` for `fix-drive` jobs (`queue.ts:171-179`, confirmed by its
own comment) only ever fires on a genuine infra exception before `driveFix`'s own error handling
engages. The two queues built from the *same* `DEFAULT_JOB_OPTIONS` have materially different retry
semantics because of how each job handler treats a business failure vs. an infra failure — the fix
path got this right in Task 5/6; the review path's older `throw` predates that pattern.

Not measured live (would need to induce a real transient provider failure mid-review and count actual
API calls, which needs either mocking depth or a real provider key beyond this session's scope). Filed
to backlog with the source citations above; the fix, when someone measures the actual duplicated-call
cost, is likely to distinguish "some agents failed, pipeline still produced a partial review" (already
resilient — should not retry the job) from "the whole pipeline crashed for an infra reason" (should
retry), rather than a blanket re-throw.

---

## Task 13 — Model deployment + harness efficiency

### Finding 1 (source-confirmed): the fix/healing path selects its LLM tier deliberately — it reuses the review dimension's own configured tier, it does not "inherit a default"

Traced the call chain: `server.py:279` — `run_fix(req, get_llms_by_role(settings), ...)` for the
non-BYO path. `get_llms_by_role` (`llm/base.py:123-146`) builds one client **per role** using
`role_tiers(settings)` (`llm/base.py:52-67`), which maps each of the six review dimensions
(security/performance/quality/test_coverage/deployment_safety/business_logic) to its own configured
tier (`config.py:44-52`: security/business_logic/deployment_safety/synthesizer default to
**sonnet**; ci/performance/quality/test_coverage/chat default to **haiku**). Inside
`fix_pipeline._drive_fix_stages` (`fix_pipeline.py:312-313`):

```python
fallback_llm = next(iter(llms.values()), None)
author_llm = llms.get(req.item.dimension, fallback_llm)
```

`req.item.dimension` is always one of the six review dimensions (`FixItem.dimension`,
`models/fix.py`), so `author_patch` is authored on **exactly the tier that dimension's review role is
configured to use** — a deliberate reuse of an existing, tuned mapping, not an unconsidered default.
Separately, `auto_resolver.verify_resolved` (called from `fix_pipeline.py:390`) always resolves its
LLM via `llms.get("security")` (`auto_resolver.py:44`) **regardless of the fix's own dimension** — so
verification is consistently the security role's tier (sonnet by default) even when authoring happened
on haiku. This is a sensible split once you trace it (the safety-gate stage gets a stable tier; the
authoring stage gets the dimension's own tier) but it is not documented anywhere as intentional —
worth a comment, not a behavior change.

**Risk worth naming (not measured, no change made):** three of six dimensions —
performance, quality, test_coverage — author their fix on **haiku**, the fastest/cheapest tier,
because that is also their review tier. Authoring a complete, working file replacement is arguably a
harder generative task than critiquing a diff; whether haiku is *good enough* at that harder task is
a quality question this environment cannot answer (no Anthropic key, so no real quality comparison
between tiers is possible here). Filed to backlog: measure haiku-vs-sonnet-authored patch
correctness (e.g., a small regression corpus of known-fixable issues, verified pass rate per tier)
before changing anything — a tier change alters output quality, and this is exactly the kind of
change that needs a way to detect a regression before it ships.

### Finding 2 (source correction to the task brief): two of the four "fix budgets" named in this task's brief don't actually gate the fix pipeline

- `MAX_TOOL_ROUNDS = 5` (`agents/base.py:14`) bounds the **review** path's MCP tool-calling loop
  (`review_file`'s `while True` loop, `agents/base.py:198-212`). `fix_pipeline.author_patch` calls
  `llm.with_retry(stop_after_attempt=2).invoke(messages)` directly — no `bind_tools`, no loop (this
  matches the Phase 2 scope decision recorded at the top of the plan: "the fix agent has no tool
  loop"). **This budget does not apply to fix runs at all.**
- `MAX_PATCH_CHARS = 50_000` (`agents/base.py:13`) truncates the **diff shown to review agents**
  in `_build_user_prompt` (`agents/base.py:82-89`). It is not referenced anywhere in
  `fix_pipeline.py`. **This budget does not apply to fix runs either.**

The budgets that actually gate a fix drive are `DEFAULT_LLM_TIMEOUT_SECONDS = 60` (per LLM call,
`llm/base.py:9`, applied via `build_anthropic_llm`'s `timeout=` to every client `get_llms_by_role`
builds), `DEFAULT_FIX_TIMEOUT_SECONDS = 280` (the whole drive, `fix_pipeline.py:59`), and
`DEFAULT_MAX_TOKENS = 4096` (the author/verify calls' output budget, `llm/base.py:14`).

**Measured against these three:** across the 10 synthetic Ollama runs (Task 12 Finding 5), no call
approached the 60s per-call timeout (max observed `fix.author` was 4.78s p95) and no author response
showed truncation (all 3 successful runs produced valid, parseable JSON with complete file content;
`author_patch`'s own fail-closed parse-error path, which would fire on a truncated response, never
triggered). This is a small sample on a small local model against a tiny test repo — it does **not**
prove 4096 tokens is enough for authoring a complete replacement of a large production file, nor that
60s is enough for a real Anthropic call under production latency. **No change made** — the local
data available cannot distinguish "budget is right" from "budget is generous relative to today's
tiny synthetic case." Filed to backlog: revisit once real production fix-drive telemetry exists
(post this-phase, once an Anthropic key is configured somewhere real traffic flows through).

### Finding 3 (measured, synthetic): real token counts, for what they're worth

ClickHouse `gen_ai.*` span attributes from the synthetic runs: 24 LLM calls captured, avg duration
1897.2ms, avg input tokens ~620, avg output tokens ~72 (`gen_ai.provider.name` reported as `openai`
for these calls — see Finding 4 below, a labeling artifact of running Ollama through
`opentelemetry-instrumentation-langchain`, not a real OpenAI call). These numbers are **not**
representative of production Anthropic token usage (different model, tiny synthetic prompts) — kept
here only as evidence the instrumentation itself works end-to-end (span → `gen_ai.*` attributes →
ClickHouse), which was the actual thing worth confirming this pass.

### Finding 4 (minor, source + measured, filed to backlog): `gen_ai.provider.name` mislabels Ollama calls as `openai`

Every gen_ai span from this session's Ollama-backed synthetic runs carries
`gen_ai.provider.name = "openai"` (confirmed via the ClickHouse query in Finding 3) — an artifact of
how `opentelemetry-instrumentation-langchain` detects provider from `ChatOllama`'s OpenAI-compatible
client shape. Low-impact today (production traffic uses `llm_provider="anthropic"` per `.env`'s
intended configuration, which this instrumentation presumably labels correctly — not verified live,
no Anthropic key here), but real for any deployment that falls back to the local Ollama safety net
(`deployment_tier="local"`, `ollama_unavailable_reason` gate) — those calls' cost/usage metrics would
silently attribute to the wrong provider bucket in any dashboard grouping by `gen_ai.provider.name`.
Filed to backlog rather than fixed here — not part of either task's scope and not something to patch
inside a third-party instrumentation library without more investigation.

---

## Summary of changes made (ranked by measured impact)

1. **`packages/db/prisma/schema.prisma` + migration `20260721202437_add_review_comment_review_id_index`**
   — added `@@index([reviewId])` to `ReviewComment`. Measured 25-66% execution-time reduction across
   the four hottest dashboard read queries at a synthetic 750k-row, 10-tenant scale (Task 12,
   Finding 1). This is the only code/schema change this review makes.

No other change met the bar (a real, attached before/after measurement). Everything else is either a
non-finding (measured and found fine: Findings 2-3 in Task 12, budget measurement in Task 13 Finding
2) or a real, source-grounded risk this environment cannot measure live (Task 12 Findings 4/6/7, Task
13 Findings 1/4) — all filed to `docs/roadmap/backlog.md` with their reasoning and evidence attached,
per the governing rule.

## Concerns for the next reader

- This review's LLM-latency and token-count numbers come from a **local Ollama model standing in for
  Anthropic**, because no `ANTHROPIC_API_KEY` is configured in this checkout. The pipeline-mechanics
  conclusions (LLM calls dominate; checkout/grounding are noise) should transfer; absolute latency,
  cost, and tier-quality numbers should not be treated as production data.
- The two largest unmeasured risks (Task 12 Finding 6: unbounded per-review LLM fan-out; Task 12
  Finding 7: review-job retry duplication) are both real, source-grounded findings that could matter
  more than the index fix once production PR/review volume exists — they were left unmeasured (not
  unfixed) because measuring them honestly needs conditions (a large real PR, a real transient
  provider failure, a real API key) this session did not have.
