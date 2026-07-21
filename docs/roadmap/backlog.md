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
