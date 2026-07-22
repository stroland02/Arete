# Areté Backlog

Single prioritized list (spec §8, `2026-07-20-superlog-observability-integration-design.md`).
Phases pull from the top. Anything discovered mid-phase gets **appended here**, not smuggled
into scope. Reprioritize only at phase boundaries or by explicit user decision.

## Now (Phase 0 + Phase 1 — observability integration)

1. Lane A plan: `docs/superpowers/plans/2026-07-20-obs-lane-a-typescript.md` (16 tasks)
2. Lane B plan: `docs/superpowers/plans/2026-07-20-obs-lane-b-python-infra.md` (16 tasks)

## Next (Phase 2 — healing-agent upgrade + alerting; spec at Phase 1 close) — **SHIPPED 2026-07-21**

Closed on `stroland02/obs-phase-2`. Evidence: [`.superpowers/sdd/phase-2-gate-report.md`](../../.superpowers/sdd/phase-2-gate-report.md).
Retrospective: [`2026-07-21-phase-2-retrospective.md`](2026-07-21-phase-2-retrospective.md).

- ~~Findings-first gate + calibrated confidence rubrics in fix-engine tool descriptions~~ — done, but
  **rubrics live in the fix prompt, not tool descriptions**: the fix agent has no tool loop
  (spec §3 "Phase 2 amendments"). Confidence stayed **0–1**, criteria adopted.
- ~~Budgets: runtime cap, wall-clock backstop, human-resume cap, idempotent terminate~~ — done; the
  real hole was that fix drives bypassed the queue entirely. Now BullMQ `fix-drive` at concurrency 2
  + exponential cooldown (5 min → 1 h) at both entry points.
- ~~Dispatch-before-ack for terminal actions~~ — already held; became an **audit + regression tests**.
- ~~Typed memory store~~ — done: real tenant-guarded, size-capped, redacted write-back.
- ~~Alert rules: error-rate AND p95 latency → incidents~~ — done, live end to end.
- **Healing agent consumes own telemetry via internal query surface** — **NOT DONE → Phase 2b below.**
- Phase 1 retro action items — carried into the Phase 2 retrospective.

## Phase 2b (deferred from Phase 2, 2026-07-21)

Ranked. The first item is a live security gap, not an enhancement.

1. **Internal + MCP tokens have no expiry — spec §6 Phase 2 gate 2 is UNMET.**
   `INTERNAL_API_TOKEN` is one static shared secret read from the environment per request
   (`packages/webhook/src/internal-auth.ts:43`): no `exp`, no `iat`, no rotation, no revocation.
   Probed — the middleware authenticates the identical token with the system clock set ten years
   forward, and `tokenMatches(header, token)` takes no clock argument, so expiry is not merely
   absent but **not expressible in the current code path**. A repo-wide grep of
   `rotat|expir|issued_at|iat|exp` across the internal-auth surface returns zero matches.
   Blast radius: it guards every write-and-spend route on both the webhook and agents services, and
   is the credential the agents process presents when writing into a tenant's memory store.
   The **MCP half is worse**: `mcp/manager.py` persists tokens as plaintext JSON in
   `.agents/mcp_servers.json` with no expiry field in the schema and no file-mode hardening, and
   `mcp/auth.py:90` never performs a code exchange — it fabricates `simulated_token_for_<code>`, so
   there is no `expires_in` to store even if the schema had a slot. `mcp/client.py:51` presents the
   value as `Bearer` indefinitely.
   Not a patch: needs a credential-lifecycle design (rotation window, dual-token overlap so a
   rotation cannot break in-flight service-to-service calls, and a decision on whether MCP grows a
   real OAuth exchange or is removed until it does).
   *For contrast, the credential that reaches a customer repo — the GitHub App installation token —
   does expire (~1h, GitHub-enforced) and is minted fresh per fix drive.*
2. **Telemetry-fed investigations** (the one unshipped spec §3 Phase 2 bullet). The healing agent
   should read the incident's own trace/log context. Blocked on an internal query surface: today only
   `getAgentEventsPerMinute` (`queries.ts:781-815`) reaches ClickHouse at all.
3. **Give the fix pipeline a tool loop.** `fix_pipeline.py` makes one direct LLM call for a JSON
   blob; tool-calling exists only on the review side. Until then, rubrics necessarily live in the
   prompt, and spec §3's "tool descriptions ARE the prompt" cannot apply to healing.
4. **Webhook-side fix failures are uncounted.** `no_repo` / `no_model` terminate before Python is
   reached, so they never appear in `arete.fix.*` — a fix drive dying before dispatch is invisible in
   the counters.
5. **Memory row cap is check-then-create with no transaction, and nothing ever archives.** Two
   concurrent writes can both pass the cap check; and since no path sets `status='archived'`, a repo
   is permanently frozen at 20 memories once it fills.
6. **Prose credentials still reach sinks** (`password: hunter2`) — no secret shape, and the key
   blocklist binds to object keys, not words in a string. Catching it needs an amendment to the
   frozen §5 pattern set with real false-positive risk on ordinary prose. The URL-embedded half of
   this finding is already closed.
7. **A second Prometheus rules file will need a compose/config edit.** `rule_files` deliberately
   names the one file rather than globbing, because a glob also matches the `promtool` test file,
   whose schema makes Prometheus reject the entire config.
8. ~~**`pipeline.integration.test.ts` is still flaky**~~ **RESOLVED (two
   distinct vectors, fixed separately).** The suite had TWO independent flake
   vectors, not one — an earlier version of this entry claimed only the first
   was ever present and declared the suite immune; the pre-`main` verification
   pass falsified that by reproducing the second.
   - **Vector 1 — mock order-dependence (fixed `515b30a`).** `vi.doMock` +
     `vi.resetModules()` leaked mocks across tests. Fixed by having buildApp own
     the doMock registry. Phase 4 added an `afterEach` assertion for both
     buildApp-managed mocks (`review-bridge.js`,
     `telemetry/fetch-telemetry-context.js`) that guards teardown symmetry — it
     verifies the unconditional `vi.doUnmock` calls directly above it actually
     leave both modules un-mocked, catching those `doUnmock` calls being
     silently weakened or removed. (It does NOT guard "a future test mocking
     outside buildApp"; the unconditional doUnmock calls already neutralize that
     on their own.)
   - **Vector 2 — starvation timeout leaking a `fetch` (fixed pre-`main`).**
     Each test re-transpiles the real server+worker graph via dynamic `import()`
     after `resetModules()`. When the whole monorepo suite runs at once, that
     CPU contention pushed the async-handoff test past vitest's default 5s
     `testTimeout`; the timeout ABORTS the test while its `processReviewJob()`
     continuation keeps running, which then leaks a `fetch` into the next test
     (observed: "fetch called 2 times, expected 1"). CI (isolated per-package
     job) never hit it; the local all-suites-at-once run did. Fixed with a
     file-scoped `vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })` —
     the work is fully synchronous mocks (no real Redis/BullMQ/network), so a
     larger budget removes the starvation flake without masking any real hang,
     and the scope keeps unit suites on their fast-fail default.

   The test is hermetic (mocks Redis/Postgres/fetch/GitHub; the webhook CI job
   needs no services). Phase 0's "fix or quarantine" criterion is **met** for
   both vectors. Left struck-through rather than deleted: an entry asserting a
   live flake that no longer exists misstates shipped reality.
9. **Running containers drift from compose on security-relevant settings.** The Alertmanager
   container was serving `0.0.0.0:9093` for hours after `docker-compose.yml` had been changed to
   `127.0.0.1:9093` (the C1 remediation) — a container does not re-read its port mapping on restart,
   it must be recreated. Third stale-infrastructure incident of the project. Worth a
   `docker compose up -d` precondition on any verification that claims to test infra config.

## Later (Phase 3 — tenant telemetry platform; spec at Phase 2 close)

- Two-tier ingest edge (auth/quota/admission → collector → ClickHouse)
- Strip-then-stamp tenancy + denormalized tenant id
- Deterministic fingerprint grouping before LLM grouping
- Rollups + arrival-ordered candidate cursor
- Background telemetry poller + snapshot history
- Per-tenant retention/deletion; prompt-content capture consent model

## Typed debt (ratchets — flip back to `error` once paid)

- `packages/webhook`: `@typescript-eslint/no-explicit-any` is `off` (Octokit boundary casts,
  per config comment) — unlike dashboard's `warn`. Revisit when the Octokit types allow it.
- `packages/agents`: ruff `line-length = 120` (was default 88 with 212 violations — the
  codebase never followed it). All other rules enforced at 0 errors. Tighten only if the
  team adopts a formatter.
- **Descoped from Phase 0** (final-review finding, 2026-07-21): spec §3's "coverage reporting
  turned on, thresholds advisory" was dropped between the two lane plans with no owner.
  Rescheduled here: enable vitest/pytest coverage reporting (advisory only) in Phase 1.

- `packages/dashboard`: 51 `@typescript-eslint/no-explicit-any` (mostly test files plus
  `src/lib/queries.ts`). To be held at `warn` in `packages/dashboard/eslint.config.mjs` so CI
  can be green; the genuine-bug-class rules (`react-hooks/*`, `@next/next/*`) stay at `error`.
- `packages/webhook`: 78 `no-console` held at `warn` in `packages/webhook/eslint.config.mjs`.
  Phase 1 Lane A Task 13 migrates them to pino and flips the rule to `error`.

## Discovered / unscheduled

- SSE endpoint (`sse-handler.ts`): no auth/tenant scoping, CORS `*` — flagged during Lane A
  planning; needs a hardening item before any non-local deployment.
- Existing rollup TTLs (ClickHouse migration 006) were 30d vs spec's 90d — corrected by
  Lane B Task 9; confirm disk budget once real volume is visible (spec §10).
- Ruff E402/F401 may already be red on `packages/agents` CI lint — cleared by Lane B Task 6.

## From Phase 1 final whole-branch review (2026-07-21)

Triaged by the final reviewer as non-blocking; the two blockers it found (URL-attribute
leak, missing CI gate) were fixed on the phase branch before merge.

**Observability coverage gaps**
- `review-pr-heavy` queue has a producer (`webhook-handler.ts:114`, `backfill.ts:86` route
  PRs with >50 changed files) but **no consumer** — `worker.ts:311` only starts a Worker on
  the fast queue. Those reviews never run and their traces dead-end. Pre-existing, not
  introduced by Phase 1, but it undercuts "one real PR review traced end-to-end" — use a
  small PR for that exit criterion until this is fixed.
- Span-name convention drift (Python lane): `orchestrator.py:393,456` emit
  `agent_review:{name}` / `synthesize_reviews` with `pr_number`/`agent_name` attributes
  instead of spec §5's `agent.review` (attr `agent.role`) / `review.synthesize`. No
  `llm.generate` span exists; LLM spans carry gen_ai semconv names from the contrib
  instrumentations. Either rename the spans or amend §5 to match reality — and keep
  `debug-from-telemetry` in sync (its recipes were corrected on the phase branch).
- `processGitHubCheckRun` (`worker.ts:153-186`) emits only a `review.run` root with no child
  spans, so the CI-diagnosis path is observably thinner than the PR-review path.
- `arete.agent.duration` has a histogram View registered in both lanes (`init.ts:64`,
  `observability.py:152`) and is documented in the skill, but no instrument ever records it.
  Either record it or drop the convention.
- Webhook `/health` is not excluded from tracing (the agents' `/health` is,
  `server.py:52`). A 5s probe will dominate webhook span volume.
- CI smoke-boots `dist/otel.js` + `dist/index.js` (`ci.yml:91`) but never
  `dist/otel-worker.js` — the worker boot path that owns `service.name=arete-worker` and the
  review span tree is unsmoked.

**Operational / infra**
- `otel-collector-config.yaml` commits plaintext `superlog/superlog` ClickHouse credentials.
  Fine for local compose; must not survive into any deploy path.
- Prometheus `instance` label derives from `service.instance.id`, which both lanes randomize
  per process (`resource.ts:17-18`, `observability.py:188` = `uuid4()`), so every restart
  mints a new time series. Not a §5 dimension violation (all `arete.*` dims are closed sets)
  but it is unbounded label growth.
- ClickHouse DDL: `events_per_minute` and `issue_activity_daily` lack
  `ttl_only_drop_parts = 1` (`single-node-otel.sql:550-551`), so their expiry does row
  rewrites while every other table drops parts. Separately, `otel_traces_recent`/`_summary`
  declare an inline 30d TTL at `:476`/`:510` that `:548`/`:549` overrides to 90d — end state
  is correct, the file just reads as contradictory.
- Cheap hardening: add `"engines": { "node": ">=20.6" }` to `packages/telemetry/package.json`
  (the `node:module` `register` import hard-fails below that; CI runs Node 22).

**CI encoding nits (pre-existing, consistent, no regression)**
- `ci.yml` matrix uses space-delimited command encoding; `pnpm/action-setup` is unpinned;
  root `test:ts` uses `--if-present`.

**Open question for the PR body**
- Spec §6 gate 4 (egress compliance): nothing on the branch routes exporter egress through
  `@arete/net-guard`. Either the gate is satisfied because exporters only talk to a loopback
  collector — state that explicitly — or it is unmet and needs an owner.

**Agent memory sink (Phase 2 Task 8 — from fix round 1 of the adversarial review, 2026-07-21)**

Everything blocking was fixed in that round. These are the reviewer-verified
leftovers, kept here with their evidence rather than fixed, because each needs
a design decision or a schema change rather than a patch:

- **Row cap is check-then-create, with no transaction and no DB constraint.**
  `memory-write.ts` counts active rows and then creates, so N concurrent writes
  for one repo can all observe `count == 19` and all insert — a repo can exceed
  `MAX_MEMORIES_PER_REPO` (20). Not exploitable for unbounded growth (each racer
  still inserts exactly one row, so the overshoot is bounded by concurrency),
  but the cap is advisory rather than enforced. Correct fix is a serializable
  transaction or a DB-level constraint/trigger, not a wider read.
- **No eviction path: nothing in the repo ever sets `status='archived'`.** The
  read cap (`fetchProjectMemories`, 20 most recent) and the write cap are the
  same number, so once a repo reaches 20 ACTIVE rows every subsequent write
  returns `cap_exceeded` forever and the memory set is frozen at whatever it
  first learned. `status` exists and is honoured by both the count and the read,
  so the mechanism is there — what is missing is the policy (age out? evict
  least-recently-cited? let a human archive from the dashboard?) and a surface
  to apply it.
- ~~**`scrubSinkText`'s query-string stripping only fired when the ENTIRE
  value was a bare URL.**~~ **CLOSED in `d0f4e1b`** — `URL_LIKE`
  was anchored `^…\S+$`, so `see https://x.io/a?password=topsecret for
  details` and `[link](https://x.io/a?password=topsecret)` both sailed
  through unscrubbed even though the bare-URL case (`stripUrlQuery` applied
  to a whole-string URL) already worked — and prose-with-an-embedded-URL is
  the dominant shape for both alert summaries and memory bodies. Fixed by
  matching URL substrings anywhere in the string (bounded by whitespace/
  markdown/quote delimiters) instead of requiring the whole trimmed value to
  be a URL. This needed no spec amendment: it applies the existing
  `stripUrlQuery` primitive more broadly, it does not add a new pattern to
  the frozen §5 set. Left here struck through rather than deleted, mirroring
  the context-map entry below. This entry used to also cover prose
  credentials with no URL at all (`password: hunter2`) — that genuinely
  amendment-gated remainder is split out below so this entry no longer
  misstates it as needing one.
- **`scrubText`/`scrubSinkText` do not catch prose-shaped credentials that
  have no secret *shape* and no URL to strip a query string from.** A memory
  body containing `password: hunter2` as free text matches neither a
  `SECRET_VALUE_PATTERNS` shape (`sk-*`, `gh?_*`, `Bearer …`, key-ish URL
  query params) nor a blocklisted object KEY (`password` here is a word
  inside a string, not a key), and there is no URL substring for the
  query-stripping fix above to act on. Verified stored verbatim. Fixing this
  DOES mean amending the frozen §5 pattern set (a spec amendment, and one
  with real false-positive risk on prose — "the password field is required"
  would be mangled), which is why it was not done under a review-fix
  mandate. Applies to every sink equally, not just this one.
- ~~**`GET /context-map/graph/{installation_id}` and `/context-map/ui-url/{id}`
  on the agents service remain unauthenticated.**~~ **CLOSED in `4fd64e8`** —
  both GETs are now behind the same fail-closed internal bearer as the POST
  surface (401 unauthenticated, 503 unconfigured), verified by an adversarial
  re-review that enumerated the live route table and probed every route. Left
  here struck through rather than deleted because it was filed and fixed within
  the same phase: an entry asserting a live cross-tenant leak that no longer
  exists misstates the security posture of shipped code, which is the same
  hazard as a report claiming a hole is closed when it is not.

**Data pipeline + model harness efficiency (Phase 2 Tasks 12/13, 2026-07-21 —
full report at `docs/roadmap/2026-07-21-phase-2-efficiency-review.md`)**

Only one change was measured-and-justified this pass (`ReviewComment.reviewId`
index, landed). Everything below was found but deliberately NOT fixed, because
fixing it would have meant changing something without a measurement to justify
it — each carries the evidence gathered so a later pass can measure and decide
rather than guess.

- **`ReviewComment` may still be missing indexes on `severity`, `category`, and
  `noiseState`.** The `reviewId` index (landed) cut 25-66% off the four hottest
  dashboard queries at a synthetic 750k-row/10-tenant scale, but that number is
  the join-index's contribution entangled with whatever these per-column
  filters/groupBys would add on their own — not isolated. Measure each
  individually (`EXPLAIN ANALYZE` with/without a trial index, same dataset)
  before adding any of them.
- **`getTrendSeries`/`getDashboardsViewModel`'s review-row fetch has no `take`
  limit** (`packages/dashboard/src/lib/queries.ts`) — fetches every
  `Review.createdAt` a tenant has ever produced to bucket client-side. Fast
  today (0.9-6ms at 30k seeded reviews, backed by `Review`'s existing
  `(repositoryId, createdAt)` index) — the risk isn't Postgres query time, it's
  unbounded row-count serialization into the Node process for an
  installation with years of history. No fix without a measurement at that
  scale, which doesn't exist yet.
- **Review job retries duplicate the per-agent retry.**
  `packages/webhook/src/worker.ts:94-113`'s `processGitHubPullRequest` re-throws
  any `runReviewPipeline` failure, and `enqueueReviewJob`'s
  `DEFAULT_JOB_OPTIONS` (`attempts: 3`, `queue.ts:152-157`) then re-runs the
  **entire** multi-file, multi-agent review from scratch — on top of each
  agent's own `with_retry(stop_after_attempt=2)` (`agents/base.py:191`). The
  fix-drive queue does NOT have this problem: `driveFix` never throws on a
  business failure (`fix/trigger.ts:167-168`), so its `attempts: 3` only fires
  on a genuine infra exception. Not measured live (needs a real induced
  transient provider failure mid-review to count actual duplicated API calls).
  Likely fix, once measured: distinguish "some agents failed, review still
  produced a partial result" (already resilient, should not retry the job)
  from "the whole pipeline crashed for an infra reason" (should retry).
- **Review's real LLM concurrency is unbounded per review, not bounded by
  `REVIEW_QUEUE_CONCURRENCY=5`.** `orchestrator.py:353-381`'s LangGraph
  `StateGraph` fans out via `Send` — one node per (file × agent) pair, no
  `max_concurrency` on `graph.invoke`. A 20-file PR reviewed by 6 agents is
  ~120 concurrent LLM calls for ONE review; five concurrent reviews (the
  queue's own cap) is up to ~600 simultaneous provider calls. The likely real
  bottleneck for review throughput is the provider's own rate limit, not the
  `5`. Not measured (needs a real large PR + a real API key); measure actual
  concurrent `gen_ai.*` spans per review once production volume exists.
- **Fix-authoring tier for 3 of 6 dimensions (performance, quality,
  test_coverage) is haiku** — deliberate (fix authoring reuses that dimension's
  configured review tier, `fix_pipeline.py:312-313` + `llm/base.py:52-67`), not
  an oversight, but unverified whether haiku is good enough at the harder
  generative task of authoring a complete file replacement (vs. its original
  job of critiquing a diff). No Anthropic key in this environment to measure
  tier-quality difference. Before changing: build a small regression corpus of
  known-fixable issues and measure haiku-vs-sonnet-authored patch pass rate —
  a tier change alters output quality and needs a way to detect a regression.
- **`MAX_TOOL_ROUNDS`/`MAX_PATCH_CHARS` don't gate the fix pipeline at all**
  (they're review-path-only constants; `fix_pipeline.author_patch` has no tool
  loop and never truncates the source diff) — a correction to how those
  budgets get talked about, not a bug. The budgets that DO gate a fix drive
  (`DEFAULT_LLM_TIMEOUT_SECONDS=60`, `DEFAULT_FIX_TIMEOUT_SECONDS=280`,
  `max_tokens=4096`) were never approached in 10 synthetic Ollama-backed runs —
  revisit once real production fix-drive telemetry exists (needs a real
  Anthropic key somewhere real traffic flows).
- **`gen_ai.provider.name` reports `"openai"` for Ollama-backed LangChain
  calls** (confirmed via ClickHouse on this session's synthetic runs) — an
  `opentelemetry-instrumentation-langchain` provider-detection artifact from
  `ChatOllama`'s OpenAI-compatible client shape. Low-impact while production
  traffic is Anthropic-backed, but any deployment that falls back to the local
  Ollama safety net (`deployment_tier="local"`) would misattribute those calls'
  cost/usage in any dashboard grouped by provider.
- **ClickHouse TTLs are configured correctly (30d raw / 90d rollup,
  `ttl_only_drop_parts=1`) but unverified live** — every row in this dev
  ClickHouse is hours old, nowhere near the retention window. Revisit once
  real aged data exists to confirm parts actually drop.

## Deferred from Phase 3 (credential integrity, frontend consumption, harness efficiency)

Each needs a real Anthropic key, real production volume, or a design decision that
Phase 3 deliberately did not make blind — recorded with evidence rather than silently
dropped.

1. **Is haiku adequate to *author* fixes for performance/quality/test_coverage?**
   Fix authoring reuses each dimension's configured *review* tier
   (`fix_pipeline.py:313`, `author_llm = llms.get(req.item.dimension, fallback_llm)`),
   and those three dimensions default to haiku (`config.py:49-51`). Haiku's original
   job is critiquing a diff, not generating a complete file replacement — unverified
   whether it is good enough at the harder generative task. Do NOT change the tier
   blind: needs a real Anthropic key plus a regression corpus of known-fixable issues
   to measure haiku-vs-sonnet-authored patch pass rate before touching the default.
2. ~~**MCP OAuth has no refresh-on-expiry path**~~ **PARTIALLY RESOLVED (Phase 4).**
   Refresh-on-expiry now exists: `MCPManager.get_valid_token` (`mcp/manager.py`) reads
   `expires_at` and, within a 60s skew window, refreshes via a real
   `grant_type=refresh_token` exchange (`exchange_refresh_token`, `mcp/auth.py`), failing
   closed (`MCPTokenRefreshError`) when it can't rather than presenting a stale token; the
   creds file is now written `0o600`. **Still deferred:** RFC 8414 `.well-known` discovery
   and dynamic client registration — carried to "Deferred from Phase 4" below.
3. **Review `max_concurrency` default (N=8) is un-tuned.** Set on the `graph.invoke`
   config in `orchestrator.py`; the right value depends on real provider rate limits
   under real concurrent review load, which needs a real large PR and a real
   Anthropic key to validate — not measured this phase.
4. ~~**`processGitHubCheckRun` has the same shared try/catch double-retry exposure**~~
   **RESOLVED (Phase 4).** The CI-diagnosis path now uses the Task-10 two-block split
   (`packages/webhook/src/worker.ts`): a `runReviewPipeline` failure re-throws (retryable
   crash) while a `postReview` publish-only failure records a degraded check run and
   returns (no full-pipeline retry). Its first tests were added to
   `pipeline.integration.test.ts` (partial-success → resolves; infra-crash → rejects).

## Deferred from Phase 4 (trustworthy CI signal + no-dependency harness hardening)

Phase 4 closed the keyless-test signal debt (conftest mirrors CI's provider env), the
`pipeline.integration.test.ts` flake (already fixed in `515b30a`; hardened + docs
corrected this phase), the `processGitHubCheckRun` retry parity (item 4 above), and MCP
refresh-on-expiry + `0o600` (item 2 above). Carried forward:

1. **MCP RFC 8414 discovery + dynamic client registration** — deliberately not shipped:
   speculative until a real MCP server that hands out no static `token_url` needs it, and
   nothing in this environment validates such a flow (`mcp/auth.py` still synthesizes the
   auth URL from `target`; `client_id` is the hardcoded `arete-client`, `auth.py:12`).
2. **`review.publish` child span is absent on the check_run path** (`worker.ts`) though the
   PR path wraps `postReview` in `withChildSpan('review.publish', …)`. Pre-existing
   asymmetry (not a Phase 4 regression); a one-line parity fix, or a shared
   `runPipelineAndPublish` helper that also DRYs the two-block duplication, would close it.
3. **Phase 3 items 1 (haiku fix-authoring adequacy) and 3 (review N=8 tuning) remain** —
   both still gated on a real Anthropic key + a real large PR to measure.
4. **Unguarded second `checks.update` inside the publish-failure catch, on BOTH worker
   paths** — PR path `worker.ts:134-144` and check_run path `worker.ts:239-249`. If that
   `checks.update` call itself throws (transient GitHub API failure while reporting the
   degraded outcome), the error propagates out of the catch block, so the job re-throws and
   BullMQ retries it despite the pipeline having already produced a usable result — the
   exact double-retry this task's two-block split was meant to prevent, just one call later.
   Pre-existing and mirrored identically on both paths; a proper fix (e.g. wrap that
   `checks.update` in its own try/catch that logs-and-returns) needs to touch the
   already-shipped PR path too, not just check_run.
5. **Redundant config disk read per HTTP MCP server.** `get_mcp_tools_for_agent` calls
   `manager._load_config()` once up front, but for each `http`-transport server then calls
   `manager.get_valid_token(server_name)`, which internally calls `get_server(name)` →
   `_load_config()` again — one extra JSON read of `.agents/mcp_servers.json` per
   authenticated HTTP server per call (`client.py` / `manager.py`). Harmless at current
   scale (small local file, infrequent calls) and avoidable by threading the
   already-loaded `config[server_name]` through, but not fixed blind without a measurement
   showing it matters.
6. **`exchange_refresh_token`/`exchange_code_for_token` only honor `expires_in` when it is
   already a Python `int`/`float`.** A token endpoint that returns `expires_in` as a numeric
   STRING (e.g. `"3600"`, which some OAuth servers do) fails the `isinstance(int, float)`
   check, so `expires_at` is stored as `None` — `get_valid_token` then treats that token as
   never-expiring instead of refreshing it on schedule (`auth.py`). Not exploitable (worst
   case is a stale-but-still-valid-until-the-provider-itself-rejects-it token), but a
   silent behavior downgrade for any provider using string `expires_in`.
7. **`_save_config`'s `mkdir(exist_ok=True)` does not retroactively tighten a pre-existing
   `.agents/` directory mode.** If `.agents/` already exists (e.g. created by an older
   version of this code, or manually) with looser-than-0o700 permissions, `mkdir(mode=0o700,
   exist_ok=True)` is a no-op on the existing directory — only a freshly-created directory
   gets 0o700. The config file itself is still written at 0o600 regardless (Phase 4's F2
   fix), so token contents stay protected either way; this only affects directory-level
   listing/traversal on an upgrade from an older layout.
8. **Token-endpoint error messages embed up to 500 chars of the raw response body**
   (`auth.py`, `TokenExchangeError` construction on a non-2xx token response). A malicious or
   compromised token endpoint could craft a response body that gets reflected verbatim into
   a printed/logged error message — not a credential leak (the body is attacker-controlled,
   not ours), but worth bounding/sanitizing before any error surface here becomes
   user-facing.
