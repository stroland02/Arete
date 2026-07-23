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
| 1.1 | ✅ **DONE** (`1192d37`) **Approve a proposed fix** — resolved per option (a) below | S | Gate lives on the Services work-item panel; no `/agents` URL created |
| 1.2 | ✅ **DONE** (`1192d37`) **Post the approved PR** | S–M | Same panel; the `!realMode` dead branch is bypassed, not revived |
| 1.3 | ✅ **DONE** **Approvals panel** — surface `ApprovalPrompt` so the safety gate is visible | M | Proxy + reject route + rail section; **"reject" turned out not to exist at all** — see below |
| 1.4 | ✅ **DONE** **Silence / un-silence a finding** — the noise loop closed at the human end | M | **Not reachability — a build.** Nothing in the dashboard could write `noiseState` at all; see below |
| 1.5 | **Connect Sentry** — flip `connector-catalog.ts` `status:"planned"` once the integration is approved | S | Connector + tests fully built; UI gate only. **Blocked on Sentry's own approval**, not on us |

**Why first:** every item is already-paid-for capability. 1.1 and 1.2 together restore the product's
headline differentiator.

> ### ⚠️ Stage 1 ↔ Stage 2 conflict — resolve before starting 1.1
>
> `ApproveSolutionButton` lives in `pr-panel.tsx`, the **Agents page's** right pane, and the obvious fix
> for 1.1 is to generate a `/agents?container=<id>` link. But **Stage 2.3 retires `/agents` as a
> destination**, so doing 1.1 that way builds a link Stage 2 immediately has to undo — and worse, it
> deepens the dependency on the page being absorbed.
>
> **Resolution — do 1.1 without naming `/agents`.** Either:
> - **(a) Preferred:** move the approve affordance to where the container already lives — the Services
>   container view, which every other surface already deep-links to via `/services?container=<id>`
>   (`incidents/[id]`, `reviews/[id]`, `agent-rail`, `work-item-panel` all use it). This makes 1.1 a step
>   *toward* Stage 2 rather than against it, and needs no new URL shape.
> - **(b)** If (a) proves too entangled, gate 1.1 behind Stage 2 and start Stage 1 at 1.2.
>
> Do **not** implement 1.1 as a `/agents?container=` link. That was the naive reading, and it is the same
> class of mistake as `73e2040` — building toward a page that the locked decision is removing.
>
> **RESOLVED as (a) in `1192d37`.** Both gates now render on the Services work-item panel, which already
> holds the container. `ApproveSolutionButton` is *imported* from the agents directory, not moved — the
> move is Stage 2's, and mixing a move with a fix makes both unreviewable. No `/agents` URL was created.

#### What 1.1/1.2 turned out to actually be

The audit's shorthand ("one link unlocks the feature") was wrong in a way worth recording, because the
same mistake is available in 1.3 and 1.4. There is no single link: `ServiceReviewRow.id` is a **Review**
id, and its doc comment claiming it "IS the container id" is true only for the SSE stream, which projects
a Review into an in-memory container. `approve`/`send` read the **`IssueContainer` table**, whose rows are
created by the work-item Fix route with generated ids. Wiring a review id into the approve button would
have produced a control that 404s on every review.

The real unit of work was therefore: carry the container's **stored state** to the surface, and let that
state — not the work-item state — decide which gate may be offered. Whoever picks up 1.3/1.4 should
confirm the identity of every id they wire before assuming a link is all that is missing.

#### What 1.3 turned out to actually be

Also not pure wiring. The approve half was reachability as described — the webhook's execute endpoint
is internal-token protected, so the browser needed a session-scoped proxy, which is what
`/api/approvals/[id]/approve` now is. But **"reject" was not a wiring gap, it was a missing capability**:
`executeApproval` has always refused to run a `REJECTED` command, and *nothing in the entire system
could write that status*. The refusal branch was dead code and "no" was not an answer a human could
give. That needed a new route, not a new link.

Verified live on :3002 against deliberately-labelled local rows, since this database has no real
reviews: reject → 200 and the row is durably `REJECTED` with `executedAt` still null; approve → 502
`upstream_unreachable` (the webhook is not running locally) with the row left `PENDING`, so a failed
upstream never silently consumes the decision. A second `ApprovalPrompt` planted under a **different
installation** did not appear on the dev account — tenancy proven, not asserted. All five rows were
removed afterwards by explicit primary key.

#### What 1.4 turned out to actually be

The third and last time the audit's "wiring" shorthand was wrong, and the most clear-cut: **1.4 was
not a reachability item at all.** The roadmap's own note pointed at `queries.ts:765` hardcoding
`noiseState:'OPEN'` as if a filter were the obstacle. It was not. There was no API route, no UI
control, and *no writer of `noiseState` anywhere in the dashboard* — the only writers in the entire
system were `packages/webhook/src/persistence.ts` (machine escalation) and the Python orchestrator.
Nothing was hidden; it did not exist. That `OPEN` filter is not the bug — it is the mechanism that
makes silencing mean something, and it was deliberately left exactly as it is.

Built: `POST /api/findings/[id]/noise` (the dashboard's only `noiseState` writer),
`FindingNoiseControl`, and the review detail page's use of both. 16 new tests.

**The boundary that shaped the design:** a human may assert only `OPEN` and `SILENCED`.
`UNDER_OBSERVATION` and `ESCALATED` are derived by the escalation machine from a recurrence count
across pull requests, so a button asserting one would be claiming an observation that never
happened. They render as read-only labels. Silencing also *does* something rather than setting a
flag: a silenced finding drops out of the copy-for-agent prompt, and already dropped out of the code
map via that `OPEN` filter. The UI says plainly what it cannot reach — a comment already posted to
GitHub stays posted, because `comment-poster.ts` filtered at post time, which has passed.

**Known limitation, recorded not fixed:** restoring returns a finding to `OPEN`, never to whatever
machine state preceded the silence — that prior state is stored nowhere, and inventing one would be
fabricated status. Consequence: an `ESCALATED` finding that is silenced and later restored sits at
`OPEN` with its `occurrenceCount` intact, and the escalation loop only increments rows that are
`UNDER_OBSERVATION`, so it re-escalates only when the agents next emit it as observed. Fixing this
properly needs either a new column (Engineer A's lane) or a change to the escalation loop (the
webhook lane) — both out of scope for a dashboard change.

Verified live on :3002 against three labelled findings (`OPEN`, `ESCALATED`, `UNDER_OBSERVATION`)
plus a fourth under a **different installation**. Silencing the escalated one → 200, durably
`SILENCED`, `occurrenceCount` still 4 and its threshold intact; the restore round-trip returned it
to `OPEN` with that history untouched. The cross-tenant finding answered **404 `not_found`,
byte-identical to a finding id that never existed**, and its row stayed `OPEN`. Asking directly for
`ESCALATED` → 400 `invalid_state`. All six planted rows were deleted afterwards by explicit primary
key; counts returned to the pre-verification baseline.

**A real bug the live drive caught:** `getReviewDetail` included comments with no `orderBy`, so
Postgres returned heap order and *any* update reshuffled the whole findings list under the reader.
Invisible until the UI could write. Fixed in the same commit with an explicit
`orderBy: [{createdAt}, {id}]`, and re-verified: the order is now stable across a silence.

#### Recorded while doing Stage 1 — not fixed, deliberately

- **`lib/trends.ts` buckets by LOCAL calendar day while the ClickHouse window is UTC.** A trend chart is
  off by one for any viewer whose timezone crosses midnight relative to UTC. Fixing it shifts every chart
  in the product, so it needs its own change and its own verification. (Surfaced because `errors.test.ts`
  had been failing for the whole 00:00–12:00Z half of every day; that flake *was* fixed, in `26fc554`.)
- **The send route does not advance the work item to `posted`.** `approve` moves `fixing → staged`, but
  after a successful send the container becomes `posted` while its work item stays `staged`. Not visible
  in this environment (`STAGING_SERVICE_URL` is unset, so send honestly 503s), and it belongs with 1.3.

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
| 3.1 | ✅ **DONE** (`98562e8`) **Kuma logo = true global refresh** — `router.refresh()`, spin is the transition's real pending flag | S–M |
| 3.2 | ✅ **DONE** (`98562e8`) **Manual investigations start a fix** — thin webhook route + honest `unavailable`/`declined` reporting | M |
| 3.3 | ✅ **DONE** (`e0a3f65`) **Scan completion** — watches the real `ScanRun`, bounded at 90s with an honest "stopped watching" | S |
| 3.4 | ✅ **DONE** (`e0a3f65`) **Fix/Dismiss** — `router.refresh()` keeps rail selection + scroll | S |
| 3.5 | ✅ **DONE** (`e0a3f65`) **Dead links** — `/overview`; sample-data link reworded, not left broken | S |
| 3.6 | ✅ **DONE** (`e0a3f65`) **Deleted `synth-ledger.tsx`** — superseded by the 1.1/1.2 gate | S |

**3.1 design note:** the refresh must be *real*. A spin that resolves on a timer would be exactly the
fabricated-status the honesty rules forbid. It needs per-source results, and a source that fails must say
so rather than silently completing.

> **How 3.1 was actually built.** Not a per-source fan-out but `router.refresh()`, which re-runs the
> current route's server components against the live DB — it re-executes whatever data reads that page
> actually declares, so the refresh is global by construction and cannot drift as pages change. "Real
> completion" is the `useTransition` pending flag (true until the new server render commits), and "no
> fabricated success" falls out for free: a failing source renders its own error/empty state on
> re-render, so the control never claims a success the data does not support — and, deliberately, never
> claims a failure it did not observe either.
>
> **How 3.2 was actually built.** `routeIncidentToFix` was reachable only from the Alertmanager
> receiver; the fix was one internal-token webhook route (`POST /incidents/:id/route`) transporting the
> existing function, NOT a dashboard reimplementation — reimplementing it would have forked its
> critical+firing policy and its P2002/already-routed handling. The dashboard reports the router's own
> verdict and treats an unreachable webhook as `unavailable` (distinct from a decline), never throwing,
> because the incident is already durably created. The critical+firing policy was left intact: a manual
> `warning` does not start a fix, and changing that stays the webhook lane's decision.
>
> **A dev-workflow bug fixed alongside Stage 3** (`fac7140`): `next build` and `next dev` both default
> to `.next`, so every verification build this session clobbered the running dev server's manifests —
> the app appeared to revert to an older version. `NEXT_DIST_DIR` now isolates verify builds; the dir is
> throwaway and must be `rm -rf`'d after (lint is config-protected). Documented in
> `packages/dashboard/AGENTS.md`.

### Stage 4 — Hygiene that keeps the map honest  (Group F)

| # | Deliverable | Size |
|---|---|---|
| 4.1 | ✅ **DONE** Correct `backlog.md` — struck through with evidence, not deleted | S |
| 4.2 | ✅ **DONE** Correct `build-status-map.md` — §2 (all 7), §3 A1/A5, §4 B1/B4/B8, and 3 surface rows | S |
| 4.3 | ✅ **DONE** Adopt `getAccountState` on `agents/page.tsx` — and it was a real bug, not just tidying | S |
| 4.4 | ⏸ **NOT DONE — needs a decision + infrastructure.** Password reset + email verification | M |
| 4.5 | ⏸ **NOT DONE — needs a shared-Postgres migration in another lane.** Confidence on review findings | S+S |
| 4.6 | ✅ **RESOLVED — the question is moot.** See below | M (decision-led) |

#### What Stage 4 turned out to be

**4.1/4.2 — the docs were staler than the roadmap said, partly because of this session.** Verified
each claim against code before touching it, and struck through rather than deleted:
- `review-pr-heavy` **closed** — `worker.ts:419 startReviewWorkers()` returns `{fast, heavy}` and
  `:422` starts the heavy consumer; the code comment at `:411` records the gap it fixed.
- Internal-token expiry **closed for the internal token** — `internal-token/src/mint.ts:15` mints
  `{iss, aud, iat, exp}` (120s TTL) and `internal-auth.ts:54` verifies it. The backlog's specific
  claim that expiry was "not expressible in the current code path" is now false. **The MCP half is
  still open and is still the worse half** — left in full.
- A5 outbound retry worker **closed** — `worker.ts:451` calls `startOutboundRetryWorker()`.
- B1 (manual investigations), B4 (noise machine) and all seven §2 items closed **by this session's
  own work**, which is exactly why the map needed correcting before it misled the next reader.

**4.3 was not cosmetic.** `agents/page.tsx` computed `modelConnected` with an inline
`db.modelConnection.count({ where: { installationId: { in: ... } } })`. `getAccountState` also counts
**pending user-scoped** connections (`userId, installationId: null`) — a model connected before the
first repo. The ad-hoc count missed those, so the page could show "connect a model" to someone who
already had one. Adopting the single resolver fixed a real wrong answer, which is the argument for
the contract in the first place.

**4.6 is moot: there is no Python fingerprint implementation at all.** The item exists to prevent a
second hand-written copy (contract §5). A search of `packages/agents` for `fingerprint` across every
`.py` file returns **zero matches** — there is nothing to port, nothing to keep in sync, and no
divergence risk today. The TypeScript side is already unified on one normalizer
(`@arete/telemetry/fingerprint`); `webhook/src/fingerprint.ts` and the dashboard's
`error-fingerprint.ts` both delegate to `fingerprintScoped`, and that file documents why two honest
wrappers remain (an error is scoped by *service*, a comment by *category*). **The decision to make
is therefore not "how do we port it" but "nothing, until Python needs a fingerprint" —** at which
point the contract already forbids the hand-written copy and the choice becomes shared-service vs
generated-port. Recorded rather than designed, because designing now would be building for a
requirement that does not exist.

#### Why 4.4 and 4.5 are deliberately not done

Both leave the dashboard lane, and neither is blocked on effort:

- **4.5 (confidence on findings)** needs a new column on `ReviewComment` — `packages/db`, which the
  coordination ledger assigns to another engineer, on a Postgres **shared by every worktree**. Safety
  rule 6 permits `migrate deploy`, but shipping a schema change mid-session without that lane's
  agreement is precisely what rule 7's declare-first exists to prevent. The dashboard half (render a
  `%` on each finding) is ~20 minutes once the column exists.
- **4.4 (password reset + email verification)** needs an email-sending capability the repo does not
  currently have, plus a token-lifecycle design (single-use, expiring, revocable on password change).
  `User.emailVerified` exists and is never written. This is a genuine M-sized auth feature, not
  hygiene, and it deserves its own review rather than being folded into a hygiene sweep.

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
