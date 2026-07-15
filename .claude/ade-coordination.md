# Areté — ADE Multi-Agent Coordination

## Overview

This repo uses **Orca ADE** (Agent Development Environment) with multiple Claude agents working
in parallel across isolated git worktrees. This file defines the coordination rules so agents
never conflict.

## Package Ownership Matrix

Each active agent claims ownership of exactly one package. No agent may modify files outside
its assigned package without declaring a cross-package change in the progress ledger first.

| Package | Path | Owns |
|---|---|---|
| `agents` | `packages/agents/` | Python FastAPI, LangGraph orchestrator, all agent classes, Pydantic models |
| `webhook` | `packages/webhook/` | TypeScript Express server, GitHub/GitLab handlers, review bridge, Stripe |
| `dashboard` | `packages/dashboard/` | Next.js app, all UI components, API routes (Prisma schema now lives in `packages/db`, see `@arete/db`) |
| `infra` | `infra/`, `.github/`, `scripts/` | CI/CD, Docker, Kubernetes, OpenTelemetry collector config |
| `docs` | `docs/`, `.superpowers/` | Plans, proposals, progress ledger, this file |

## Worktree Convention

Each agent branch gets its own worktree under `.worktrees/`:

```bash
# Create a worktree for a new agent branch
git worktree add .worktrees/<feature-slug> -b feat/<feature-slug>

# List active worktrees
git worktree list

# Remove after merge
git worktree remove .worktrees/<feature-slug>
git worktree prune
```

## Branch Naming

```
feat/<package>-<feature>          # e.g. feat/webhook-gitlab-complete
feat/<feature>                    # for cross-package features
fix/<package>-<bug>               # e.g. fix/agents-langgraph-timeout
```

## Auto-Merge Policy

Per user instruction: completed branches auto-merge to main once all tests pass.

The finishing agent must:
1. Run `pnpm --filter @arete/webhook test` (18 tests baseline)
2. Run `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py` (29 tests baseline)
3. Merge if both pass. No PR required in Phase 1.

## Agent Coordination Rules

1. Check this file before starting — confirm your package is not claimed
2. Declare your branch in the progress ledger (`.superpowers/sdd/progress.md`) before writing code
3. Never edit `pnpm-lock.yaml` or `uv.lock` from two worktrees simultaneously
4. Schema changes (`packages/dashboard/prisma/schema.prisma`) require coordination — only one agent at a time
5. `packages/webhook/src/types.ts` is shared — declare cross-package changes in ledger before editing

## Current Active Agents (as of 2026-07-10)

| Branch | Package | Task | Status |
|---|---|---|---|
| `feat/webhook-gitlab-complete` | `webhook` | Full GitLab MR diff fetch + comment posting | Dispatched |
| `feat/dashboard-real-metrics` | `dashboard` | Real computed metrics, per-agent breakdown | Merged (superseded/rebuilt by auth + @arete/db extraction) |
| `feat/dashboard-ui-port` | `dashboard` | Port the finished design system (tokens, primitives, motion, agent-orchestration graph) onto main's current auth-scoped dashboard (app/(dashboard)/*, getDashboardViewModel, @arete/db). Presentation layer + one new additive query function (getTrendSeries). NOTE: adds a worktree-root `.npmrc` (virtual-store-dir-max-length=60) + `next.config.ts` turbopack.root pin for Windows nested-worktree builds — requires a fresh `pnpm install` after pulling. | **Merged to main at `986987b` (2026-07-12)** — see pre-merge notes below |
| `main` | `docs` | ADE setup, coordination | Done |
| `stroland02/Engineer-1` | `webhook` + `db` (cross-package, declared) | **Outbound webhooks** (SuperLog Study clear win #1): new `WebhookEndpoint`/`WebhookDelivery` models in `@arete/db`; signing + delivery + payload rendering in `packages/webhook/src/outbound/`. Reuses `@arete/net-guard` (SSRF) + oauth-state HMAC convention. **Schema change to `packages/db/prisma/schema.prisma` — coordination rule 4; one agent at a time.** Not touching `context_map/`, `server.py`, `packages/dashboard`, or the frozen marketing page. | In progress (TDD) |
| `feat/approval-exec-worker` | `webhook` + `agents` (read-only HTTP contract) | **P1.3**: BullMQ consumer of the `approval-exec` queue → POST `{approvalId,reviewId,command}` to Eng3's `POST /approvals/apply` (agents FastAPI) via a review-bridge-style fn → resolve on `"applied"`, throw on `"failed"` so `DEFAULT_JOB_OPTIONS` backoff retries. **Does NOT change `ApprovalExecutionJobData` or the transport** (contract owned by PM across both lanes). HTTP call mocked in tests; Eng3 builds `/approvals/apply` in parallel. Off `main` (P1.1 lives on frozen `stroland02/Engineer-1`). | In progress (TDD) |

## ✅ Resolved: `feat/dashboard-ui-redesign` is superseded — do not merge

**Status as of 2026-07-12 (resolved).** `feat/dashboard-ui-redesign`
(24 commits, never pushed, diverges from `main` at `8d730b3`) independently
rebuilt the same design-system ground as `feat/dashboard-ui-port` (its own
tokens, Button/Card/Badge/Skeleton/Tooltip primitives, animated collapsible
sidebar, and its own `agent-orchestration-graph.tsx`). `dashboard-ui-port`
won that race and merged to `main` at `986987b`.

Investigated for reconciliation and found the branch is not just
unreconciled but **critically stale**: `git diff --stat main
feat/dashboard-ui-redesign` shows it's missing ~4,600 lines across 60 files
that `main` has since gained — the entire Connect flow, Master Grid, GitLab
support, account auth (signup/login), the marketing landing page, and the
Review Detail/History/Settings pages. Reconciling it would mean rebuilding
most of the current app on its older foundation, not a component-level
merge. **Decision: treat it as superseded. Do not merge.** The branch is
left as-is in git (not deleted) in case anything in its token/sidebar work
is worth a closer look later, but no future agent should attempt a full
reconciliation.

The 3-way `agent-orchestration-graph.tsx` collision this created is resolved
the same way: `feat/dashboard-ui-redesign`'s version is moot along with the
rest of that branch. The live contenders are `main`'s current SVG graph
(`agent-orchestration-graph.tsx`, real per-agent data, built 2026-07-12) and
`feat/arete-account-auth`'s in-progress **AgentsAtWork** card redesign
(`components/dashboard/agents/*`, spec at
`docs/superpowers/specs/2026-07-12-agents-at-work-redesign-design.md`) —
grounded in real per-agent model tiers (`config.py`) and the Synthesizer's
actual verify/drop logic, explicitly non-fabricated. AgentsAtWork is still
being actively extended (an "Orca-style /agents workspace" page is being
spec'd on top of it as of this writing) — not yet merge-ready, but the clear
direction once it lands.

## Test Baselines (must not regress)

| Suite | Command | Baseline |
|---|---|---|
| Webhook (vitest) | `pnpm --filter @arete/webhook test` | 18 passed |
| Agents (pytest) | `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py` | 29 passed |
| Dashboard (next build) | `pnpm --filter @arete/dashboard build` | 0 errors |
| Dashboard (vitest) | `pnpm --filter @arete/dashboard test` | 23 passed |

## `feat/dashboard-ui-port` pre-merge notes (2026-07-11)

Verification done on this branch:
- `pnpm --filter @arete/dashboard build` → 0 errors; `/` correctly server-rendered on demand (`ƒ`, force-dynamic), proxy middleware active.
- `pnpm --filter @arete/dashboard test` → 23/23 passing, incl. the proxy unauthenticated→/login redirect test and the tenancy-scoping tests (getDashboardViewModel + the new getTrendSeries).
- Every design-system component's data mapping was reviewed field-for-field against the real getDashboardViewModel/getTrendSeries shapes; no `as any`/type-suppression in the page/layout code.

Known / not-yet-done before merge:
- **Lint is red, but was already red on `main`** for the identical reason: the fake-Prisma test helpers use `as any` (a hand-written Prisma fake can't implement the full generated client type), which trips `@typescript-eslint/no-explicit-any`. eslint config is identical to main's with no test-file override. This branch adds +3 instances of that same pre-existing, pervasive pattern (getTrendSeries's test + its repository.findMany fake). Not introduced by this port; "fixing" only the 3 new ones would make them inconsistent with the 8 identical neighbors. Decide at merge whether to address the whole pattern separately (a test-file eslint override or properly-typed fake) — out of scope for a UI port.
- **Authenticated render NOT exercised via live OAuth.** The dashboard page is `force-dynamic` + gated by GitHub OAuth (`auth()`), and no OAuth app / `.env.example` is configured in this environment, so a real logged-in render was not driven. What IS proven: the full page tree compiles against the real data shapes, the unauthenticated→/login redirect works (test), and the login page + auth UI reskin compile and are in the route manifest. A human should do one real signed-in smoke test before merge.
- Given the security-sensitive surface (auth-scoped multi-tenant queries), a human review of the authenticated render is warranted before this touches `main`, despite the nominal auto-merge policy.
