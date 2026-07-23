# Reachability & Consolidation Roadmap — sequencing the whole backlog safely

**Date:** 2026-07-23
**Owner:** ridley worktree
**Source audits:** `docs/status/2026-07-22-ridley-closeout.md`, `docs/status/2026-07-22-build-status-map.md`,
`docs/roadmap/backlog.md`, plus a full plan/spec-vs-code audit run 2026-07-22.

---

## 0. The finding this roadmap exists to act on

Plan-level code execution in this repo is **high** — of ~380 symbols declared across 48 plans, only one is
genuinely missing. What was dropped is almost entirely **product wiring**: capabilities that are built,
tested, and merged, that **no human can reach**.

The sharpest instance: the HITL moat — approve → post-PR gates, `ApprovalPrompt`, the approval worker,
`POST /approvals/apply` — is complete and unreachable. `SendPrButton` renders only inside a dead
`!realMode` branch; `ApproveSolutionButton` needs a `/agents?container=` URL **nothing in the codebase
generates**. This is the feature you would demo.

**Consequence for sequencing:** wiring beats building. Group A returns more product per day than every
other group combined, and it is mostly S/M.

---

## 1. Safety rules — these apply to EVERY item below

Non-negotiable, drawn from what already governs this codebase. An item is not done unless all apply.

1. **Characterization first on any existing surface.** Before changing a component that has no test, write
   a test that pins today's rendered behaviour *through the public API* (never by exporting internals), and
   confirm it passes against the untouched file. Precedent: the `services-workspace` decomposition
   (`8166fbe`), where this caught nothing — which is the point; it made the claim checkable.
2. **Separate moving from fixing.** A refactor commit changes no behaviour; a fix commit moves no code.
   Mixing them makes both unreviewable. If you find a bug mid-move, write it down and leave it.
3. **Honesty rules** (`docs/handoff/2026-07-22-orchestration-briefs.md` §0): never fabricate data or
   status; a control that cannot act is `disabled`, never a live-looking button; empty states say what is
   actually true; `null` (unavailable) is never `[]` (none).
4. **Account-state contract** (`specs/2026-07-17-account-state-contract.md`): derive connection state from
   `getAccountState`, never re-derive locally; never collapse connected-but-idle into not-connected.
5. **Telemetry-tenancy contract** (`specs/2026-07-22-telemetry-tenancy-contract.md`): gate on
   `isPlatformInstallation` before any self-telemetry read; one fingerprint normalizer.
6. **Migrations:** `prisma migrate deploy`, **never `db push`** — worktrees share one Postgres.
7. **Cross-lane edits are declared in `.claude/ade-coordination.md` BEFORE editing.**
8. **Verify by driving the real flow in the running app**, not only a green suite. Paste evidence.
9. **Never issue an unscoped `DELETE` against tenant data**, and never clear state someone is actively
   inspecting — even when an earlier instruction appears to authorise it. (Learned the hard way: an
   unscoped `DELETE FROM "ErrorGroup"` destroyed a live investigation's groupings on 2026-07-22.)

---

## 2. Sequence

Ordered by *value per unit risk*, and by what unblocks what. Each stage is a coherent session-sized unit.

### Stage 1 — Make the built product reachable  (Group A · highest value, lowest risk)

| # | Deliverable (what the USER gets) | Size | Notes |
|---|---|---|---|
| 1.1 | **Approve a proposed fix** — generate the `/agents?container=<id>` link so `ApproveSolutionButton` is reachable | S | One link unlocks ~128 lines of built, tested feature |
| 1.2 | **Post the approved PR** — render the send affordance in `realMode` with a real `activeContainerId` | S–M | Currently behind a permanently-false branch |
| 1.3 | **Approvals panel** — surface `ApprovalPrompt` so the safety gate is visible | M | Needs a session-scoped server proxy; `ApprovalPrompt` has zero dashboard references today |
| 1.4 | **Silence / un-silence a finding** — the noise loop closed at the human end | M | Backend already escalates and counts; dashboard hardcodes `noiseState:'OPEN'` (`queries.ts:765`) |
| 1.5 | **Connect Sentry** — flip `connector-catalog.ts` `status:"planned"` once the integration is approved | S | Connector + tests fully built; UI gate only. **Blocked on Sentry's own approval**, not on us |

**Why first:** every item is already-paid-for capability. 1.1 and 1.2 together restore the product's
headline differentiator.

### Stage 2 — Agents become a layer inside Services  (Group B · the locked decision)

Spec: `specs/2026-07-22-investigations-surface-and-agent-harness-design.md` §0/§1 — *"the Agents page is
absorbed into Services … one place to see what Kuma is doing to my services rather than two."*

User's refinement (2026-07-22): agents are an **additional layer within Services** showing how they
interact with the workflow; you can **select the agents that are working**, which opens their conversation
and their parameter controls.

| # | Deliverable | Size |
|---|---|---|
| 2.1 | Decide and execute: revert `73e2040` (Services inbox → Agents rail, built backwards) or let 2.2 subsume it | S |
| 2.2 | Agents layer inside Services: working-agent selection → conversation + config drawer in place | M–L |
| 2.3 | Retire `/agents` as a nav destination; keep the route for deep-links | S |
| 2.4 | **Agent config persistence** — parameter changes currently do not save (`agent-config-drawer.tsx:24` "deliberately NOT persisted") | M |

**Dependency:** 2.4 is what makes 2.2's "parameter changes" real rather than theatre. Do not ship 2.2
without either 2.4 or an explicit disabled state.

### Stage 3 — Papercuts and the refresh  (Groups C + D · small, visible)

| # | Deliverable | Size |
|---|---|---|
| 3.1 | **Kuma logo = true global refresh.** Click re-pulls services, connections, telemetry and scan state; the existing spin becomes honest progress, not decoration. Must show real completion, and must not fabricate success if a source fails | S–M |
| 3.2 | Manual investigations start a fix (`/incidents` is a dead end today — `createManualIncident` never calls `routeIncidentToFix`) | M |
| 3.3 | Scan completion replaces the blind `setTimeout(reload, 1500)` | S |
| 3.4 | Fix/Dismiss stops full-page reloading and losing rail position | S |
| 3.5 | "Back to Overview" → `/overview` (currently `/`); remove "Explore with sample data →", which leads to a page with no sample data | S |
| 3.6 | Delete `synth-ledger.tsx` (zero importers) | S |

**3.1 design note:** the refresh must be *real*. A spin that resolves on a timer would be exactly the
fabricated-status the honesty rules forbid. It needs per-source results, and a source that fails must say
so rather than silently completing.

### Stage 4 — Hygiene that keeps the map honest  (Group F)

| # | Deliverable | Size |
|---|---|---|
| 4.1 | Correct `backlog.md` — 7 entries are recorded open but are closed in code; every plan is drawn off this file | S |
| 4.2 | Correct `build-status-map.md` §3 A5 / §4 B2, B8 (stale since the retry worker and internal-token work landed) | S |
| 4.3 | Adopt `getAccountState` on `agents/page.tsx` + `map/page.tsx` (last ad-hoc `hasAccess` users) | S |
| 4.4 | Password reset + email verification — `User.emailVerified` exists and is never written; a locked-out user has no recovery path | M |
| 4.5 | Surface confidence on review findings (schema column + UI) | S+S |
| 4.6 | Decide the Python fingerprint question — shared service, generated port with golden vectors, or an explicit spec amendment. **A second hand-written copy is forbidden by contract §5** | M (decision-led) |

### Stage 5 — The bigger bets  (Group E · re-approve before building)

**Two of these specs were never greenlit.** Confirm intent before spending a week.

| # | Deliverable | Size | Status |
|---|---|---|---|
| 5.1 | Investigations surface + tool-calling fix harness | L | Spec *proposed, awaiting user review* |
| 5.2 | Glass Box production (agents narration, tenancy filter, persistence) | M–L | Spec *awaiting approval*; today dev-sidecar only and structurally undeployable without the `installationId` filter |
| 5.3 | Work-floor Phase B agents (repro / root-cause / fix-author / test-author / QA) | L | Blocked by 5.4 |
| 5.4 | Docker sandbox workspace agent — run the PR's tests for real | L | The only genuinely missing plan artifact (`workspace.py`) |
| 5.5 | Outbound webhook management API + Settings UI | M | **Unblocks all Phase-2 relays** (Slack/Linear/PagerDuty); the retry worker is already wired |
| 5.6 | Tenant telemetry ingest (customers send their own OTLP) | L | Deferred by design; needs a product decision, not code |

---

## 3. Explicitly NOT schedulable now

These need a funded API key, production volume, aged data, or an external approval. Do not plan them as
build work: haiku fix-authoring adequacy · review `max_concurrency` tuning · unbounded LLM fan-out ·
review-job double-retry · `ReviewComment` index choices · ClickHouse TTL/disk verification · "make Signals
visibly render" (needs a real Alertmanager alert; synthetic seeds are forbidden) · end-to-end
ERROR-severity log (needs such a row to exist) · Google OAuth (client deleted upstream) · Sentry connect
(needs Sentry's integration approval). The Anthropic account is at **$0**.

---

## 4. How to run each stage

1. Re-read this file and the two contracts before starting a stage.
2. Declare cross-lane files in `.claude/ade-coordination.md` first.
3. Characterization tests before touching any untested surface.
4. One deliverable per commit; behaviour changes and moves never share a commit.
5. Drive the real flow in the app on **:3002** (`:3000` belongs to another worktree — never stop it).
6. Close each stage with a close-out entry naming what shipped, what is open, and what was deliberately
   abandoned, per `docs/runbooks/2026-07-22-agent-closeout.md`.
