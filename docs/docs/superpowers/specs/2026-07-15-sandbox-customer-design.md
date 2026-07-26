# Sandbox Customer Test Bed — Design + v1 Plan

**Date:** 2026-07-15 · **Owner:** Engineer 3 · **Status:** approved (PM), building v1

## Goal

A self-contained fake customer's world we own, so Kuma can be exercised end-to-end and
the dogfooding UI (`/overview`, agents pages, Sensorium, connectors) renders **real
activity** instead of empty states. All test data is clearly labeled; nothing calls a
real third party.

## Why localhost is empty today

`/overview` (`packages/dashboard/src/app/(dashboard)/overview/page.tsx:40`) gates every
tile on `viewModel.hasAccess`, which comes from `getDashboardViewModel(db, installationIds)`.
`installationIds` resolve from `session.installations`, and those are produced by
`authJwtCallback` → `getAuthorizedInstallations(db, logins)` — i.e. the DB `Installation`
rows whose **`owner`** matches a GitHub login the signed-in user is authorized for.

**Consequence (the load-bearing constraint):** seeding DB rows alone does NOT light up
`/overview`. The sandbox `Installation.owner` must equal a login the seeded dev user is
authorized for. That is why the seed hangs off Fable's `seedDevUser` (chosen approach **b**):
we call it, learn the dev user's owner/login, and stamp the sandbox `Installation.owner`
to match.

## Architecture

Top-level **`sandbox-customer/`** (NOT under `packages/` — additive, collides with no lane):

```
sandbox-customer/
  README.md                     labels everything as test data; documents the 4 defects + v1/v2
  app/                          the fake customer's codebase Kuma reviews
    data/db.ts                  data layer (mock repository + a raw-query helper)
    api/expenses.ts             list/create endpoints  [defect 1: pagination off-by-one]
                                                        [defect 2: SQL string concatenation]
    api/reports.ts              summary aggregation      [defect 4: O(n²) category rollup]
    api/server.ts               wires the routes
    api/__tests__/reports.test.ts                        [defect 3: wall-clock-flaky test]
    web/index.html, web/app.js  tiny frontend
    package.json                minimal; fixture, not wired into CI
  telemetry-fixtures/
    sentry-issues.json          Sentry-style issues referencing the sample app
    posthog-metrics.json        PostHog-style product metrics
  seed/
    seed-sandbox.mjs            standalone seed: buildSandboxSeedData() + seedSandbox(prisma)
    seed-sandbox.test.mjs       node:test — validates seed payload shape with NO database
  driver/
    pr-context.json             a realistic PRContext (the defective diff) — the review subject
    run-review.mjs              POSTs it to the agents /review; honest if infra is absent
```

## Data flow

1. `seedSandbox(prisma)` optionally calls Fable's `seedDevUser` (dynamic import, tolerated
   absent), takes the returned dev owner/login, and idempotently upserts:
   `Installation(owner=<dev login>)` → `Repository` → 2–3 `Review`s → `ReviewComment`
   findings (one per specialist category, incl. a critical) → one `ApprovalPrompt`
   (PENDING) → `TelemetryConnection` + `TelemetrySnapshotRecord` loaded from the fixtures.
2. Dashboard reads it through the normal Prisma queries → tiles, activity, agents strip,
   connectors, Sensorium all show real numbers.
3. `run-review.mjs` feeds `pr-context.json` to the real `ReviewOrchestrator` via
   `POST /review`, printing the verified findings — the repeatable E2E for the gate.

## The four intentional defects (realistic, one lens each)

| # | Kind | Location | What Kuma should catch |
|---|------|----------|------------------------|
| 1 | Real bug | `api/expenses.ts` listExpenses | 1-indexed page but `offset = page*limit` → first page skipped / row dropped |
| 2 | Security | `data/db.ts` rawQuery / `api/expenses.ts` | user input concatenated into SQL → injection |
| 3 | Flaky test | `api/__tests__/reports.test.ts` | assertion bucketed on `new Date()` → fails across midnight/timezones |
| 4 | Perf | `api/reports.ts` summarize | re-filters the full expense list per category → O(n²) |

## Idempotency & honesty

- Seed is upsert-keyed (`Installation` on `[provider, externalId]`, `Review` on
  `[repositoryId, prNumber, headSha]`) — re-running never duplicates.
- No third-party calls: telemetry is static fixtures.
- `run-review.mjs` degrades honestly: if the agents server is down or `ANTHROPIC_API_KEY`
  is unset, it prints the payload and the exact command to run, and exits non-zero — it
  never fabricates a review result.

## Phasing

- **v1 (this plan):** local sample repo + fixtures + seed + local driver. Immediate win —
  localhost shows real Kuma activity. Deferrals stated honestly, not faked.
- **v2 (needs a human):** a real GitHub sandbox repo with the Areté App installed for true
  webhook→review→PR E2E. Requires: creating the repo, installing the App, App/webhook
  secrets. Flagged, not built.

## v1 deferrals a runner must supply (honest, not faked)

1. A running Postgres + `DATABASE_URL` for the seed to write to.
2. Fable's `seedDevUser` present on-branch at integration so `Installation.owner` matches
   the dev session's authorized login (until then the seed falls back to `SANDBOX_OWNER`
   env and `/overview` may gate empty for a non-matching login — documented, not hidden).
3. The agents server up (`/review`) + `ANTHROPIC_API_KEY` for a real LLM review via the driver.

## v1 task list

1. Sample app with the 4 documented defects + minimal frontend + package.json.
2. Telemetry fixtures (Sentry + PostHog shaped).
3. `seed-sandbox.mjs`: pure `buildSandboxSeedData()` + `seedSandbox(prisma)` (idempotent,
   calls `seedDevUser` best-effort) + CLI entry. `seed-sandbox.test.mjs` verifies payload
   shape with no DB.
4. `driver/pr-context.json` + `run-review.mjs` (honest degradation).
5. `README.md` labeling test data + documenting defects, run steps, and v1/v2.
