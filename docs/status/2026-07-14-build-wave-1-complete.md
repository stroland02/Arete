# Areté — Development Progress: Build Wave 1 Complete

**Date:** 2026-07-14 · **Baseline:** `origin/main` @ `1455f55` · **Prepared by:** Project-Manager session

This is the current-state reference for the **next** set of agents. It supersedes
`docs/handoff/2026-07-14-agent-wrap-up-and-fresh-start.md` (that doc's task list is
now all done — keep it only for historical context on how the branches were reconciled).

---

## 1. Where we are

- **Shippable Code-Review v1: ~97%** — every v1 feature is now on `main` and verified.
  The only gaps are two follow-on wires (below), not missing surfaces.
- **Full 3-phase vision: ~62%** — Phase 1 (Code Review) essentially complete; Phase 2
  (Monitoring/telemetry) infra now landed but not yet surfaced end-to-end; Phase 3
  (full OODA platform) not started.
- **Quality moat SP1–SP6: ~95%**, all merged.

---

## 2. What shipped on `main` this wave (verified, not self-reported)

| Area | Commit(s) | Verified by |
|---|---|---|
| SSRF net-guard (new `packages/net-guard`) | `8ae82bb` | 71 tests incl. adversarial private/loopback/metadata-IP rejection |
| Stale webhook test fix (dual-lane signature) | `1725646` | webhook suite green |
| Auth cross-tenant leak fix (real security bug) | `f4b9c88` | 13 auth tests |
| Webhook PR-backfill on install | `8f3b8ce` | 215 webhook tests |
| **approvals-execute made real** (idempotent DB transition → `EXECUTED`, enqueues to `approval-exec` queue) | `7a41d28` | 233 webhook tests; driven via supertest through the real route |
| **Stripe tiers enforced** (Starter 500 / Pro 2000 / Enterprise ∞ / free 50) | `7a41d28` | 14 billing tests |
| OTel spans on LangGraph agents (layered onto shipped orchestrator) | `c37fb60` | 279 pytest pass |
| ClickHouse schemas + analytics query layer | `c37fb60` | topology 19 tests, dashboard build green |
| Agent Run Explorer UI (fed by real review findings; honest-empty otherwise) | `c37fb60` | dashboard tsc + build |
| **Marble & Ink UI landed** (chosen UI: real Synthesizer, `/services`, empty states) | `1b6dfe5` | dashboard tsc + full `next build`, 18 routes |
| Localhost cleanup (13 dead orphaned components pruned) | `1b6dfe5` | grep-clean, landing page verified over HTTP |

**Live on `main`:** 6-agent review pipeline, PR summary + inline comments, conversational
thread, GitHub App + GitLab, Stripe gate **with real tiers**, one-click approve → real
execute, full Marble dashboard, all 5 telemetry connectors + OAuth, Master Grid.

---

## 3. Branch reconciliation — done, zero loss

All legacy branches are accounted for. Net wanted work (Marble UI, Phase-2 infra, SSRF,
backend features) is on `main`, integrated by cherry-pick/rebase (never a stale merge).
Everything else was superseded/duplicate and retires with zero loss. The "ahead" branches
still visible in `git worktree list` are patch-identity artifacts of conflict-resolved
rebases — their **content is on main** (confirmed via `git cherry`). Safe to prune worktrees.

---

## 4. Residuals — the real next candidates for the new project

All honest gaps, none fabricated as done. Ordered by value to a sellable v1:

1. **`approval-exec` worker + Python resume** *(highest value)* — approvals durably enqueue,
   but nothing dequeues yet: the Python-side "apply command / resume paused LangGraph run"
   is unwired (`packages/agents/.../tools/actions.py request_infrastructure_approval` still
   returns a simulated string). This is what turns "approval recorded" into "fix applied."
2. **Stripe self-serve upgrade UI** — the gate exposes tier/limit/remaining; needs a real
   Stripe Checkout-session endpoint + a Settings upgrade button (no fake one was built).
3. **Wire ClickHouse analytics to a UI surface** — `getAgentEventsPerMinute()` exists but
   feeds no component; needs the `clickhouse` compose service running to return rows.
4. **Live-browser QA of the dashboard** — the landing page was verified over HTTP, but the
   authenticated routes (`/overview`, `/services`, `/agents`) were only build-verified.
   Drive them behind login before calling the UI done.

---

## 5. How to run localhost (single source of truth)

Serve **only** from the `main` checkout so stale worktree servers can't overlap again:

```
git -C <main-checkout> pull --ff-only        # ensure origin/main
pnpm install                                  # links net-guard/topology, rebuilds @arete/db
rm -rf packages/dashboard/.next               # clear stale build cache
pnpm --filter @arete/dashboard dev            # one server, default :3000
```

Do **not** run dev servers from feature-branch worktrees — that was the cause of the
duplicate/junk-card landing page (a worktree pinned to pre-cleanup code).

---

## 6. Disciplines to carry forward

Fetch fresh `origin/main` before building (it moves). Cherry-pick/rebase, never merge a
stale branch. Claim one surface per agent (`git branch -a` first). **Verify by driving the
real flow, not just a green test** — this wave's junk-card bug passed every build and was
only caught in the browser. No fabricated data; honest empty states. Log unexplained
anomalies instead of symptom-fixing.
