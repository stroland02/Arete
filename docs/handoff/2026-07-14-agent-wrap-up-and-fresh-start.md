# Areté — Agent Wrap-Up & Fresh-Start Handoff
**Date:** 2026-07-14 · **Baseline:** `origin/main` (fetch before you start — it moves) · **Prepared by:** Project-Manager session

This document closes out the first multi-agent build wave and gives a **fresh set of agents** a clean, ordered set of assignments to execute from `main`. Read it top-to-bottom before touching anything.

---

## 0. Non-negotiable disciplines (every agent, every task)

1. **Start from fresh `origin/main`.** `git fetch origin` first — main moved 5+ times during the last session. Never assume a local checkout equals `origin/main`.
2. **Cherry-pick / rebase, NEVER merge a stale branch.** Every legacy branch below is 35–351 commits behind; a naive merge reverts thousands of lines of shipped work.
3. **Check `git branch -a` before building any surface.** The last wave produced 3–4 parallel builds of `/agents` because agents couldn't see each other. Claim a surface first.
4. **Verify by driving the real flow, not just a green test.** Several last-wave features passed unit tests but were never confirmed end-to-end. "Done" = observed working.
5. **No fabricated data, ever.** Honest empty states. (House standard.)
6. **Log unexplained anomalies; don't symptom-fix on the critical path.** If a result surprises you, explain it to reproduction-level confidence before moving on.

---

## 1. Current state (what's already shipped on `main`)

- **Product completion:** ~92% to a shippable Code-Review v1; ~60% to the full 3-phase vision.
- **Quality moat SP1–SP6: ~95% complete** — agentic evidence-gathering (SP1), grounding/verification (SP2), repo-conventions + project memory (SP3), risk-tiered HITL verdicts (SP4, surfaced to GitHub Checks), cross-tier benchmark (SP5a/c; SP5b dataset still growing), UX noise controls (SP6). All merged.
- **Live:** 6-agent review pipeline, PR summary + inline comments, conversational thread, Stripe gate, GitLab, GitHub App installations, full dashboard, all 5 telemetry connectors + OAuth engine, static Master Grid.
- **Deferred (correctly):** live OpenTelemetry span emission, ClickHouse — absent from main by design.

---

## 2. Branch reconciliation checklist (do these first, in order)

| Branch | Position vs main | Action | Notes |
|---|---|---|---|
| `feat/marble-ink-foundation` | 31 / 35 | **Cherry-pick clean wins, then joint-reconcile** | Shared branch (marble + Agent-page-chat). Pick isolated wins first: auth Phase-1 fix (cross-tenant leak, 17 tests), webhook on-connect PR backfill, docs. Then reconcile the Synthesizer/`/services` cluster jointly with the already-merged Agent-page-chat work + dashboard-ui-redesign before landing UI commits. |
| `Test03` | 7 / 158 | **Cherry-pick the 6 SHAs; retire the duplicates** | Tested superset (179 tests pass) of the Phase-2 infra: `7c2ef20` ssrf, `1001d0b` topology+clickhouse schemas, `9924e89` run-explorer UI, `53859ef` compose, `2c7a2e6` OTel spans, `0f6e8e3` clickhouse analytics. This is the single source for the infra cluster. |
| `feat/ssrf-net-guard` (Test05) | 1 / 158 | **Retire** — covered by Test03's `7c2ef20` | Same commit. Verify SSRF protection on main with an adversarial test as part of landing it. |
| `feat/topology-ui` (Test06) | 3 / 158 | **Retire** — covered by Test03 | Duplicate of the topology work. |
| `feat/clickhouse-analytics` (Test07) | 5 / 158 | **Retire** — covered by Test03 | Duplicate of the clickhouse/OTel work. |
| `feat/arete-account-auth` (Test02) | 14 / 182 | **Retire** — superseded by Marble | Old-theme originals of features already re-shipped via Marble. Nothing uniquely wanted. |
| `feat/dashboard-ui-redesign` | 24 / 351 | **Retire** — superseded | Lost the merge race to the dashboard port that shipped. Cherry-pick 5 UI primitives only if wanted. |
| `Agent-page-chat-is-for-agents` | 0 / 45 | **Retire (dormant)** | Fully merged; nothing to reconcile. Future UI work goes on Marble, not here. |
| `feat/github-app-installations`, `feat/agent-memory-and-human-loop`, `feat/dashboards-service`, `Landing`, `Test01` | 0 ahead | **Prune worktrees** | Fully merged. |

**Net genuinely-wanted unmerged work = marble's clean wins + Test03's 6 infra SHAs. Everything else retires with zero loss.**

---

## 3. Feature-completion assignments (the unfinished v1 work)

These were assigned last wave but are **not done** — they need real implementation, then verify-by-driving.

| # | Task | Location | Done when |
|---|---|---|---|
| 1 | Make `POST /api/approvals/:id/execute` real | `packages/webhook/src/server.ts:65-72` (currently logs only) | An approval, driven end-to-end, actually resumes the run / applies the fix and updates the DB. |
| 2 | Enforce Stripe pricing tiers + upgrade UI | `packages/webhook/src/billing.ts` (`planTier` is dead; only binary active/50-free gate) | Starter/Pro/Enterprise limits enforced; a customer can self-serve upgrade from Settings. |
| 3 | Verify or land SSRF protection | `packages/webhook/src/telemetry/` (+ Test03 `7c2ef20`) | An adversarial test proves main rejects customer-supplied/internal URLs. Resolves the proposal's SSRF claim. |
| 4 | Land the chosen UI + real approve surface | `feat/marble-ink-foundation` | Marble's wanted work is on main; the one-click-approve UI calls task #1's endpoint and is confirmed working. |
| 5 | Fill or hide `/services` | `packages/dashboard/src/app/(dashboard)/services/page.tsx` | No navigable empty shell. |
| 6 | Fix the one stale webhook test | `packages/webhook/src/webhook-handler.test.ts` | Assertion matches the current `enqueueReviewJob` signature. |
| 7 | **Clean up localhost UI — old layout overlapping new components** | dashboard dev server (Marble is the chosen UI, `:3002`) | Localhost serves only the current Marble layout off fresh `main`; superseded old-theme components (from `arete-account-auth` / `dashboard-ui-redesign`) removed from the tree; `.next` build cache cleared; no old-navy/new-light overlap. **Root cause:** Marble is a shared branch mid-relocating the Synthesizer to `/services`, and retired old-theme components were never pruned — so the running app shows a transitional mix. Rebase Marble on `main`, delete the superseded components, restart the dev server clean. |

**Critical path to a sellable v1:** #1 → #2 → #4, with #3 in parallel. #5/#6/#7 are cleanup — but do #7 early since it's blocking your ability to *see* the real UI while you build.

---

## 4. Fresh-agent kickoff

1. Cut each new agent's worktree from a freshly-fetched `origin/main`.
2. Assign **one surface per agent** (backend user-journey, frontend/approve UI, security/SSRF, infra-from-Test03) and record ownership before anyone builds.
3. Section 2 (reconciliation) runs first and fast — it clears the branch fog. Section 3 (features) is the actual v1 finish line.
4. Keep branches short-lived; integrate early. A branch >30 behind is a liability.

---

*Coordination lane note (from the trunk agent): `packages/dashboard` is the hottest lane on main — rebase often if you touch it. `schema.prisma` changes under everyone — check its current state before writing a new migration.*
