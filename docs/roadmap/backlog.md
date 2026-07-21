# Areté Backlog

Single prioritized list (spec §8, `2026-07-20-superlog-observability-integration-design.md`).
Phases pull from the top. Anything discovered mid-phase gets **appended here**, not smuggled
into scope. Reprioritize only at phase boundaries or by explicit user decision.

## Now (Phase 0 + Phase 1 — observability integration)

1. Lane A plan: `docs/superpowers/plans/2026-07-20-obs-lane-a-typescript.md` (16 tasks)
2. Lane B plan: `docs/superpowers/plans/2026-07-20-obs-lane-b-python-infra.md` (16 tasks)

## Next (Phase 2 — healing-agent upgrade + alerting; spec at Phase 1 close)

- Findings-first gate + calibrated confidence rubrics in fix-engine tool descriptions
- Budgets: runtime cap, wall-clock backstop, human-resume cap, idempotent terminate
- Dispatch-before-ack for terminal actions (PR creation, resolution)
- Typed memory store (feedback | terminology | infra | project)
- Alert rules: error-rate AND p95 latency on `arete.review.duration` → incidents
- Healing agent consumes own telemetry via internal query surface
- Phase 1 retro action items (added at retro)

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
- **`scrubSinkText` does not catch prose-shaped credentials.** The canonical
  pattern set (`packages/telemetry/src/redaction.ts`) matches secret *shapes*
  (`sk-*`, `gh?_*`, `Bearer …`, key-ish URL query params) and — via
  `scrubSinkValue` — blocklisted object KEYS. A memory body containing
  `password: hunter2` as free text has neither: no secret shape, and `password`
  is a word in a string rather than a key in an object. Verified stored verbatim
  after the redaction fix landed. Fixing this means amending the frozen §5
  pattern set (a spec amendment, and one with real false-positive risk on prose
  — "the password field is required" would be mangled), which is why it was not
  done under a review-fix mandate. Applies to every sink equally, not just this
  one.
- ~~**`GET /context-map/graph/{installation_id}` and `/context-map/ui-url/{id}`
  on the agents service remain unauthenticated.**~~ **CLOSED in `4fd64e8`** —
  both GETs are now behind the same fail-closed internal bearer as the POST
  surface (401 unauthenticated, 503 unconfigured), verified by an adversarial
  re-review that enumerated the live route table and probed every route. Left
  here struck through rather than deleted because it was filed and fixed within
  the same phase: an entry asserting a live cross-tenant leak that no longer
  exists misstates the security posture of shipped code, which is the same
  hazard as a report claiming a hole is closed when it is not.
