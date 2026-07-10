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
| `dashboard` | `packages/dashboard/` | Next.js app, Prisma schema, all UI components, API routes |
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
| `feat/dashboard-real-metrics` | `dashboard` | Real computed metrics, per-agent breakdown | Dispatched |
| `main` | `docs` | ADE setup, coordination | Done |

## Test Baselines (must not regress)

| Suite | Command | Baseline |
|---|---|---|
| Webhook (vitest) | `pnpm --filter @arete/webhook test` | 18 passed |
| Agents (pytest) | `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py` | 29 passed |
| Dashboard (next build) | `pnpm --filter @arete/dashboard build` | 0 errors |
