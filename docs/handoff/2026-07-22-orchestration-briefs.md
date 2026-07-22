# Orchestration Briefs — PM + two engineers

**Date:** 2026-07-22 · **Coordinator:** PM agent (pyrosome worktree)
**Baseline:** `origin/main` @ `ec4473f` · **PR open:** #6 (build status + dev fixes)

Copy the relevant section verbatim into each agent's session. Section 0 is context
everyone needs; sections 1–3 are the individual briefs.

---

## 0. Shared context — read first (all agents)

**What Kuma is.** An AI code-review service that reviews every pull request with six
specialist agents, verifies each finding against the real diff, and proposes
human-approved fixes. The wedge product is live; the platform ambitions (telemetry,
proactive improvement) are deliberately deferred.

**Where the code is.** One repo, several git worktrees under
`C:\Users\strol\orca\workspaces\Arete\`. `origin/main` @ `ec4473f` is the trunk and is
what the dogfood server serves.

**Three hard environment rules — violating these has already cost hours:**

1. **`localhost:3002` (worktree `ridley`) is the dogfood server. Do not stop it, restart
   it, or take its port.** The product owner tests there.
2. **Every worktree shares one Postgres.** `prisma db push --accept-data-loss` syncs the
   shared DB *down* to your schema and silently drops other people's columns. It dropped
   `ModelConnection.userId` three times in one day and 500'd two checkouts. **Use
   `prisma migrate deploy`.** Schema changes need a committed migration, never a push.
3. **Claim one package.** `agents` / `webhook` / `dashboard` / `infra` / `docs`. Declare
   cross-package changes to the PM before starting. This is the existing rule in
   `.claude/ade-coordination.md`; the collisions all came from ignoring it.

**Communication protocol.** You do not talk to the other engineers directly. Report to
the PM, who resolves conflicts and sequences work. In every report, state:

- what you **completed**, with evidence (test output, a driven flow — not "should work");
- what you **changed outside your package**, if anything;
- what you are **blocked on**;
- anything you **discovered that contradicts the plan** — this is the most valuable thing
  you can report, and it is never unwelcome.

**Honesty rules (non-negotiable — they are the product's differentiator).** Never
fabricate data, status, or a passing result. Empty states must say what is actually true.
A control that cannot act must be `disabled` — never a live-looking button with no
handler. If you cannot verify something, say so.

**Definition of done.** Tests pass and you ran them; `tsc --noEmit` clean; you drove the
real flow in the app, not just the test; no fabricated data; a small, honest commit.

---

## 1. Brief — PM agent (coordinator)

You are the project manager. You do not implement features. Your jobs:

1. **Hold the plan.** Source of truth: `docs/status/2026-07-22-build-status-map.md`
   (what's real vs stubbed) and `docs/roadmap/2026-07-15-superlog-phased-roadmap.md`
   (phases). The roadmap is **stale** — three items it lists as unstarted are done
   (approval-exec consumer, memory write-back, review-heavy queue consumer). Correct it
   before planning off it.
2. **Sequence work and prevent collisions.** Assign each engineer one package. Before
   approving a task, check it does not touch another's files. `services-workspace.tsx`
   (1,289 lines) is the highest-collision file in the repo — serialize any work on it.
3. **Relay.** Engineers report to you; pass on only what the other needs.
4. **Verify before believing.** When an engineer reports done, check the evidence.
   "Tests pass" without output is not evidence.
5. **Keep the dogfood server alive.** 3002 stays up. If it needs new code, coordinate a
   deliberate restart with the product owner — never unilaterally.
6. **Escalate to the human** for destructive actions, scope changes, anything needing
   credentials, and the two known blockers below.

**Known blockers requiring the human:**
- Anthropic account is at $0 — agent work runs on local Ollama until credits are added.
- The Google OAuth client no longer exists in Google Cloud Console; email/password login
  (`dev@arete.local` / `devpassword`) is the working path.

---

## 2. Brief — Engineer A (SUPERLOG / backend architecture)

**You own:** `packages/webhook`, `packages/agents`, `packages/db`, `infra`.
**You do not touch:** `packages/dashboard` — that is Engineer B's. Anything you need
surfaced in the UI, hand to the PM as a contract, not a component.

**Context.** You built the SUPERLOG observability phases 0–4, now merged to `main`:
`@arete/telemetry`, OTel spans across TS and Python, redaction with a CI gate,
Alertmanager → incident → healing, credential and MCP hardening. That substrate works.

**The problem now: five complete capabilities have no way in, and one is losing data.**
In this order:

1. **Start the outbound-webhook retry worker.** `retry-worker.ts:45` defines
   `startRetryWorker` and **nothing calls it**. A failed delivery records `nextAttempt`
   and is never retried — silent data loss. Start it in `worker.ts` beside
   `startApprovalWorker()`. Roughly a one-line fix; it closes the last unmet Phase-1 exit
   criterion and unblocks every Phase-2 relay. **Do this first.**
2. **Mount tenant-scoped webhook endpoint management.** `server.ts:408-414` deliberately
   left `POST/GET /api/webhooks/endpoints` unmounted pending session-scoped auth. Define
   the contract so Engineer B can build the Settings UI; you own the server side.
3. **Give manual investigations a way to start a fix.** The alert path
   (`receiver.ts` → `routeIncidentToFix`) creates a WorkItem, container and fix drive.
   The UI path (`lib/incidents.ts:211` `createManualIncident`) writes an `Incident` and
   never routes it — so a hand-opened investigation is a dead end. Expose an action the
   dashboard can call. Preserve the human approve → send gate; nothing here may merge or
   post autonomously.
4. **`INTERNAL_API_TOKEN` has no expiry**, and expiry is *not expressible* in the current
   code path. It guards every internal route the dashboard will need to proxy. Fix this
   **before** those proxies exist, or the defect gets baked in.
5. **`SecurityAssessor` fabricates results.** `skills/security.py:12` returns *simulated*
   findings string-matched off the skill filename — the last live fabrication in
   `packages/agents`. Either make it real or make it refuse; it must never reach the UI
   as-is. Tell the PM which you chose.

**Also yours, lower priority:** `AgentMemory` has no archive path, so a repository freezes
permanently at 20 memories.

**Report to the PM** after each item, with test output.

---

## 3. Brief — Engineer B (dashboard / UI, dogfood host)

**You own:** `packages/dashboard`.
**You do not touch:** `packages/webhook`, `packages/agents`, or the `packages/db` schema.
Need an endpoint or column? Request it from the PM; Engineer A builds it.

**You also host the dogfood server on `localhost:3002`.** Keep it running; restart only
in coordination with the product owner.

**Design direction.** The product owner's reference is SuperLog's incident UI. The
measured lesson from studying that codebase (Apache-2.0; a read-only clone sits at
`workspaces/Arete/superlog-reference`, never committed): **it barely animates** — it
imports `motion` in exactly one file. Its quality comes from editorial information
architecture and restraint, not choreography. **Keep the Marble & Ink cream palette** —
decided explicitly; do not adopt the reference's dark theme.

**Priorities:**

1. **Finish the readiness-badge pass.** PR #6 adds a shared `ReadinessBadge`
   (live / preview / partial / soon), a `/build-status` page, and fixes two controls that
   lied. Still unbadged: `pr-panel.tsx` "not synced yet" sections and the telemetry
   "Not yet available" cards. Keep `lib/feature-readiness.ts` accurate as work lands — it
   is the product owner's management view.
2. **Make unreachable things reachable** (as Engineer A lands each contract): a pending
   **approvals panel** on review detail — the human-in-the-loop gate is the product's
   headline safety feature and is currently invisible; a **webhook endpoints + deliveries**
   surface in Settings; an **agent memory** view with archive.
3. **Fix the reachability bugs.** `SendPrButton` (128 real lines) can never render with a
   real container — it is only mounted where `containerId` is hardcoded `null`.
   `ApproveSolutionButton` needs `/agents?container=`, a URL nothing in the app generates.
   Both are fully-built features nobody can use.
4. **Replace blind reloads.** Scan uses `setTimeout(reload, 1500)` unconnected to
   completion; Fix/Dismiss use `window.location.reload()`, losing rail state and stream
   position.
5. **Then the Incidents transcript**, per
   `docs/superpowers/specs/2026-07-22-investigations-surface-and-agent-harness-design.md`.
   This depends on Engineer A's event contract — **do not start before that lands**, or
   you will build against a JSON blob and rebuild later.

**Decomposition warning.** `services-workspace.tsx` is **1,289 lines** and mixes real data
with embedded sample data. Extract before adding to it, and tell the PM first — it is the
repo's highest-collision file.

**Report to the PM** with a screenshot or a driven flow, not just green tests.
