# Multi-Agent Operating Model — four lanes, one mainline, continuous verification

**Date:** 2026-07-23 · **Owner:** `ridley` · **Status:** operational, followed by the autonomous loop

Four agents are working this repo in parallel against **one shared Postgres** and **one mainline**.
That is the whole reason this document exists: parallelism has already cost us a feature built twice
(`8c99d75` vs `98562e8`), a coordination ledger that forked between worktrees, and a browser tab that
appeared to "revert" because four dev servers were fighting over one port. None of those were coding
mistakes. They were coordination mistakes, and coordination is what this file fixes.

Practices are adopted from `superpowers` and `ECC` (installed locally), plus `mattpocock/skills` and
`kunchenguid/no-mistakes`. Where a skill already exists, this file **points at it** rather than
restating it — a second copy of a practice drifts exactly like a second copy of code.

> **Deliberately not adopted:** `system_prompts_leaks`. Building our workflow on leaked proprietary
> prompts is not something this project will do, and it contributes nothing the four repos above
> don't cover legitimately.

---

## 1. Lane ownership — who owns what, and what they must not touch

From `.claude/ade-coordination.md`. **One package per agent** is the standing rule; anything else is
declared *before* editing.

| Lane / worktree | Port | Owns | Must not touch |
|---|---|---|---|
| `ridley` | **3002** | `packages/dashboard` product surfaces; cross-lane only by declaration | build-tracker schema, `feature-readiness.ts` structure |
| `pyrosome` | **3004** | build-tracker contract + schema (`src/lib/build-tracker/*`) — **owns the contract** | dashboard product surfaces |
| `nautilus` | *assign* | build-status seed + catalogue transcription | the schema (deferred to `pyrosome`) |
| `Project-Manager` | *assign* | `feature-readiness.ts` / build-status editor | dashboard product surfaces |

**Port pinning is mandatory.** `"dev": "next dev"` pins nothing — Next defaults to 3000 and
auto-increments, so with four worktrees the port a browser tab lands on is decided by startup order.
`ridley` is pinned (`next dev -p 3002`). **Every lane must pin its own**, or a tab silently shows
another lane's branch and looks like work vanishing.

---

## 2. Agent Kanban — the card schema (ECC `team-agent-orchestration`)

Every work item is a card. A card without `acceptance` and `mergeGate` is not ready to assign.

```json
{
  "id": "ridley-014",
  "title": "Scan cannot complete against a local model",
  "owner": "ridley",
  "state": "running",
  "branch": "stroland02/overview-revamp",
  "acceptance": ["a >5min scan persists findings", "no run reports failed while agents still work"],
  "evidence": ["tests", "screenshot", "ScanRun row"],
  "mergeGate": "green gates + live drive on :3002"
}
```

States: `backlog → ready → running → review → blocked → merged → archived`.
The live queue is **`packages/dashboard/data/build-tracker.json`** (85 items). Do not start a second
list; append there. Current shape: **17 `next`, 15 `blocked`, 39 `someday`, 13 `shipped`,
1 `needs-decision`**.

---

## 3. Merge gates — nothing reaches mainline ungated (`no-mistakes`)

Sequential; each stage passes or raises a **finding**:

```
review → test → docs → lint → push → PR → CI
```

Findings are tiered, and the tiering is the important part:

- **Auto-fix** (mechanical): formatting, lint autofix, generated files, a stale doc line the code
  disproves. Agent fixes and proceeds.
- **Ask-user** (intent-changing): anything that changes product behaviour, a policy question, a
  schema migration on the shared DB, or a cross-lane deletion. **Escalate — never resolve silently.**

The manual-investigation duplication is the worked example: two valid implementations, where "which
severity may auto-start a fix" is an *intent* question. It was escalated, not merge-resolved.

**Shared-Postgres rule:** `prisma migrate deploy`, never `db push --accept-data-loss`. Pushing an
older schema silently drops columns other worktrees need — this already cost
`ModelConnection.userId` on 2026-07-22.

---

## 4. The continuous loop — what every autonomous tick does

Ordered so the cheap checks fail fast. Skills in brackets are invoked, not re-explained.

1. **Ingest other lanes.** `git fetch`; if `main` moved, merge it. Conflicts in *docs* union;
   conflicts in *code* follow §3 tiering. [superpowers `resolving-merge-conflicts` discipline]
2. **Rebuild what changed.** `pnpm install` when any `package.json` moved — a stale install is what
   produced the `@clickhouse/client` build error, not a code fault. `pnpm --filter @arete/db build`
   when `packages/db` changed.
3. **Restart localhost on merged code** and confirm four services answer: dashboard `:3002`,
   webhook `:3001`, agents `:8000`, plus Postgres/Redis/ClickHouse in Docker.
4. **Internal gate:** `tsc --noEmit` (filter to `src/` — `.next/dev/types` is generated noise),
   full vitest, `lint`. [ECC `verification-loop`]
5. **Frontend gate — visual + interaction**, not just HTTP 200. Drive real journeys on `:3002` via
   the chrome-devtools MCP and assert on rendered content. [ECC `browser-qa`, `e2e-testing`]
   **Read-only by default**; a mutating journey requires seeded rows removed afterwards **by explicit
   primary key**, never an unscoped `DELETE`.
6. **Advance one card**, TDD where behaviour changes: failing test first.
   [superpowers `test-driven-development`, mattpocock `tdd` / `diagnosing-bugs`]
7. **Record evidence on the card**, push, and update the tracker.

**Escalate instead of guessing** when: an ask-user finding appears, two lanes have built the same
thing, or a fix needs another lane's package.

### The smoke journey (step 5) — assert content, not status codes

| Route | Must render | Catches |
|---|---|---|
| `/overview` | code-map nodes + setup card | agents service down, graph unindexed |
| `/services` | rail, scan status line, triage counts | scan/telemetry regressions |
| `/incidents` | tabs + New investigation dialog | fix-dispatch regressions |
| `/build-status` | tracker rows | tracker/schema drift |
| `/map` | file nodes, **not** "building your code map" | broken indexing |

A 200 that renders an empty state is a **failure** of this gate, not a pass. That distinction is the
entire point — the app looked "fine" for hours while every data surface was empty.

---

## 5. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | **Local stack provably healthy** | Four services up; smoke journey green; a scan completes and persists findings |
| M2 | **One mainline** | `setup-live-website-dev` (20 commits) merged; no lane >10 commits behind |
| M3 | **Agents absorbed into Services** | roadmap 2.2/2.3 shipped behind characterization tests |
| M4 | **Config is real** | `AgentConfig` model + persistence (2.4 / 4.5 — needs the db lane) |
| M5 | **Security debt closed** | MCP credential half + prose-shaped-credential leak (both `critical`) |

**M1 is currently blocked by one defect:** a scan cannot complete against a local model — the
webhook's `fetch` hits undici's 300 s `headersTimeout` while the agents service is still working, and
the completed work is discarded. Recorded in `docs/roadmap/backlog.md`. Fix shape: enqueue/ack like
`/fix/trigger`, so a slow run is *slow*, not *failed*.

---

## 6. Standing honesty rules (unchanged, restated because they bind the loop too)

- Never fabricate data or status. A control that cannot act is `disabled`, never a live-looking button.
- `null` (unavailable) is never `[]` (none).
- Verify by driving the real flow and pasting evidence — a green suite alone is not evidence.
  *(This file's own author once cited a single `?_rsc=` request as proof a poller worked; it was the
  one and only tick of a poller that had already stopped. Evidence must be the thing you claim, not
  something adjacent to it.)*
- Never issue an unscoped `DELETE` against tenant data, and never clear state someone is inspecting.
