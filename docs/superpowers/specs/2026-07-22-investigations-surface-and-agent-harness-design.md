# Investigations Surface & Agent Harness — Design

**Date:** 2026-07-22
**Status:** proposed (awaiting user review)
**Reference:** `github.com/superloglabs/superlog` (Apache-2.0, cloned read-only to
`C:\Users\strol\orca\workspaces\Arete\superlog-reference` — outside this repo, never committed)

---

## 0. What this is

Two changes that are really one change:

1. **A tool-calling investigation harness** — our fix pipeline currently makes a single
   LLM call and parses a JSON blob. It becomes a bounded tool loop with a published tool
   surface and calibrated rubrics.
2. **An Investigations surface** — a list and a detail view whose timeline is a *pure
   projection of the harness's event stream*.

They ship together because the UI is a function of the event contract. Building the UI
first against today's JSON blob means building it twice.

Alongside: **the Agents page is absorbed into Services** (user decision), so there is one
place to see "what is Kuma doing to my services" rather than two.

---

## 1. Decisions locked with the user (2026-07-22)

| Decision | Choice |
|---|---|
| Product surface | Keep the agents work, **embed Agents into Services**; add a new **Investigations** page |
| Theme | **Keep Marble & Ink cream.** Do *not* adopt the reference's dark palette |
| Sequencing | **Contract first**, then harness and UI together as one vertical slice |
| Reference use | Study the Apache-2.0 repo for *structure and interaction*; write our own code |

---

## 2. What the reference actually teaches (and what it doesn't)

The user's reference screenshots read as premium. The measured cause is **not** animation.

- The SuperLog web app imports `motion` in **exactly one file** (a tooltip). Everything
  else is ~167 Tailwind `transition-`/`animate-` utilities — hover and fade.
- Its quality comes from **editorial information architecture**: the incident feed is
  `buildActivityFeed(events)`, a pure function from a raw agent event log to a curated
  timeline. It *drops* `agent.thinking`, hides the raw system prompt (with a comment
  explaining why), hides `submit_agent_run_result`, pairs each tool call with its result
  via `toolUseId`, and promotes telemetry results into inline charts/tables.
- Its second lever is **calibrated honesty**: confidence rubrics and evidence format are
  specified *in the tool descriptions*, because in a tool-calling agent the tool
  descriptions are the prompt.

**Design consequence:** the deliverable is a well-specified event contract and a
disciplined projection of it. Motion is a finishing pass measured in dozens of lines, not
the substance.

**Deliberately not copied:** the dark palette, per-span metered billing,
`automerge: immediately`.

---

## 3. Architecture

```
Alertmanager ─┐
PR review ────┼─→ Incident ──→ InvestigationRun ──→ InvestigationEvent[] (append-only)
Work-item ────┤                     │                        │
Manual "New" ─┘                     │                        ▼
                                    │              buildActivityFeed(events)
                                    ▼                        │
                            outcome tools                    ▼
                    (report_findings, ask_human,     Investigations UI
                     propose_pr, resolve_incident,     (list + detail)
                     report_external_cause)
```

### 3.1 What already exists (verified on `origin/main`)

The backend is further along than the UI. Confirmed present:

- **`Incident` model** — `fingerprint` (idempotency key), `alertName`, `severity`,
  `status` (firing/resolved), `summary`, `payload`, `startsAt`, `resolvedAt`,
  **`noisedAt`** (human noise triage, orthogonal to status), **`source`
  (`"alert" | "manual"`)** — that second enum value already anticipates a
  *New investigation* button — and `workItemId`.
- **Alertmanager receiver** (`packages/webhook/src/alerting/receiver.ts`) and
  **incident→WorkItem routing** (`alerting/incident.ts`) with race-safe idempotency via a
  DB unique constraint; HITL preserved (it opens a fix run; it can never merge or post).
- **`IssueContainer`** state machine (`detecting → fanning_out → ready`) and an SSE
  stream at `/api/containers/[id]/stream` with `init`/`step`/`done`, consumed by a pure
  tested reducer (`use-synth-stream.ts` + `synth-stream-model.ts`).
- **Full dark *and* light token sets** in `globals.css`; the app is cream because
  `app/layout.tsx` hard-codes `data-theme="light"`. We keep cream — no change.

**The gap is precisely:** no append-only agent event log, no tool loop in the fix
pipeline, and no Investigations UI.

### 3.2 Unit A — The contract (`packages/db`, shared types)

New model, append-only, never updated in place:

```prisma
model InvestigationEvent {
  id                String   @id @default(uuid())
  installationId    String   // tenancy scope on every read
  investigationId   String   // FK-by-id, no relation traversal
  seq               Int      // monotonic per investigation; the sort key
  kind              String   // closed vocabulary, see below
  summary           String?  // human-facing text
  detail            Json?    // toolUse / toolResult / origin / mcpError
  providerEventId   String?  // pairs tool_use <-> tool_result
  createdAt         DateTime @default(now())

  @@unique([investigationId, seq])
  @@index([installationId, investigationId])
}
```

**Event kind vocabulary** (closed set, versioned):

| Kind | Rendered as |
|---|---|
| `agent.message` | prose node |
| `agent.tool_use` | tool node (paired with its result) |
| `agent.tool_result` | folded into its `tool_use` node |
| `agent.thinking` | **stored, never rendered** — debugging signal, not feed content |
| `lifecycle.*` | rail marker (queued, started, resolved) |
| `issue_joined` | evidence card |
| `human_reply` | human node |
| `session.error` | error node (the one `session.*` that is not noise) |

**Tool surface** (descriptions carry the rubrics — they are the prompt):

| Tool | Terminal | Rule |
|---|---|---|
| `report_findings` | no — repeatable | Overwrites provided fields, preserves omitted. **Required before any terminal tool.** |
| `ask_human` | yes → `awaiting_human` | Never fabricate a question to dodge a harder outcome you have evidence for |
| `propose_pr` | yes → `awaiting_events` | Branch must match `^kuma/`. **Not for noise** — a patch that only quiets a signal is the wrong outcome |
| `resolve_incident` | yes → `complete` | Classifies every linked issue atomically |
| `report_external_cause` | yes → `awaiting_events` | Parks on an established external cause; leaves the incident open |

**Confidence is 0–1, not the reference's 0–10.** Deliberate divergence: five consumers
already use 0–1 (`StatusReport`, `AgentStatus`, `FixItem`, `WorkItem.confidence`,
`escalationTier()`) and the UI renders `confidence * 100`. Per the obs Phase 2 amendment
we adopt the *criteria* (the load-bearing half) on the existing scale:

> ≥0.9 — verbatim quote from a file read this run **and** an observed/reproduced failure
> 0.7–0.9 — quote-backed, reproduction inferred
> 0.4–0.7 — code path identified, mechanism is hypothesis
> ≤0.3 — speculative (prefer `ask_human`)

Confidence is **clamped, not rejected** (models overshoot); missing defaults to 0.5.

Evidence format is mandated: a bold `path:line` header followed by a fenced block with a
language tag, quoting the file verbatim. This is what makes findings verifiable rather
than merely plausible.

### 3.3 Unit B — The harness (`packages/agents`)

`fix_pipeline.py` today calls the LLM once and parses JSON. It becomes a bounded tool
loop, reusing the review path's existing tool-calling machinery (`agents/base.py`) rather
than inventing a second one.

- **Findings-first gate** — terminal tools reject with a model-readable error until
  `report_findings` has been called.
- **Dispatch-before-ack** — the server-side effect executes and validates *before* the
  model receives a success ack; on failure the call is rejected and the turn stays alive
  so the model retries only the failed entry. An audit found approve/send/apply already
  correct here; we add regression tests pinning the ordering rather than rewriting.
- **Validation errors are written for the model**, not the developer — e.g.
  "`branchName` must start with `kuma/`" returns as a correctable tool error.
- **Budgets** reuse what exists: the 280 s wall-clock cap, `FIX_QUEUE_CONCURRENCY = 2` on
  BullMQ, exponential cooldown (5 min → 1 h). Time parked in `awaiting_human` is excluded
  from the wall clock — the reference documents a production incident caused by reaping a
  run the moment it resumed.
- **`terminate` must be idempotent**; memory writes are tenant-guarded and return null on
  org/project mismatch.

Every tool call and result appends an `InvestigationEvent`. **The event log is written by
the harness, not reconstructed by the UI.**

### 3.4 Unit C — The UI (`packages/dashboard`)

**Routes:** `/investigations` (list) and `/investigations/[id]` (detail).

**The projection is a pure function**, unit tested without React:

```ts
buildActivityFeed(events: InvestigationEvent[], opts): FeedItem[]
```

It pairs `tool_use` with `tool_result` by `providerEventId`, drops `agent.thinking` and
`span.*`/`session.*` noise, promotes `ask_human` into a terminal question node, and
projects the triggering issue as the first entry *without writing a fictional lifecycle
row*.

**Detail layout** (reference proportions, our cream palette): left metadata sidebar
(title, severity, status, service, environment, first/last detection, duration, linked
errors, investigation state) with `Copy agent prompt` / `Give feedback`; main pane with
**Activity** and **Findings** tabs; pinned reply composer at the bottom.

**Reuse, don't rebuild.** Three partial timelines already exist and are the seeds:
`IssueSynthesizerConsole`'s marker-glyph replay, `StatusBoardLive`, and
`reviews/[id]/page.tsx` (already commented "SuperLog incident-detail pattern"). The
reducer-over-SSE in `use-synth-stream.ts` is the cleanest foundation for the live feed.

**Services absorbs Agents.** `services-workspace.tsx` is already **1,289 lines** and
mixes real data with embedded `SAMPLE_SERVICES`/`SAMPLE_ISSUES` scripted demo state.
Embedding the agents workspace as-is would produce an unmaintainable file. This move is
therefore explicitly a **decomposition**: extract the sample-data preview mode, the
work-item inbox, the work-item panel, and the service list into separate modules first,
then mount the agent rail + agent detail as a pane in the decomposed shell. This is the
"improve the code you are working in" tax, and it is in scope.

---

## 4. Visual and motion direction

**Palette unchanged.** Marble & Ink cream stays. We adopt the reference's *discipline*,
not its colors:

- **Elevation via surface lightness, not shadow** — `--color-surface-{0,1,2}` already
  does this.
- **Hairline borders at low alpha** — applied via `--color-border-subtle` consistently
  rather than ad hoc.
- **One accent, used scarcely** — cobalt for focus rings, active nav, at most one primary
  CTA per section. Bronze stays wordmark-only.
- **Monospace tabular metadata** — trace ids, durations, timestamps in JetBrains Mono at
  11–12 px with `font-variant-numeric: tabular-nums` so streaming counters don't jitter.
- **Timeline rail** — 1 px line with status nodes, completed portion in accent. The
  reference measures the rail so it terminates at the last node instead of dangling past
  it; copy that detail.

**Motion budget — deliberately small.** Justified animation only:

1. **Step insertion** — `AnimatePresence initial={false}` with `layout` on siblings.
   `initial={false}` is essential; without it the entire backlog animates on mount/resume.
2. **Skeleton → content** cross-fade rather than pop.
3. **Active-segment sheen** on the running timeline node — reads as "working" better than
   a spinner.
4. **Rail fill** via `scaleY` with `transform-origin: top` (compositor-only).

Rules: animate at **semantic boundaries** (tool start, step complete), never per token —
deltas arrive at 20–100/s and a layout animation per delta destroys the frame budget.
Restrict animated properties to `transform` and `opacity`. Stagger 30–50 ms capped at the
first N items (40 steps at 50 ms is two seconds of nothing). Gate on
`prefers-reduced-motion` — the existing `MotionConfig reducedMotion="user"` in
`page-reveal.tsx` should wrap the new surface.

Springs: UI/layout `{stiffness: 400, damping: 40}`; entrances `{300, 25}`; large panels
`{200, 30}`; micro-interactions duration-based at 120–160 ms ease-out.

**Dependency change:** `framer-motion` is deprecated and renamed. Migrate to `motion`
(import `motion/react`) — identical API at the same 12.42.2 version, so it is an import
rewrite across the 19 files using it. Adopt `LazyMotion` + `m` so the shell is ~4.6 kb
with `domMax` loaded async instead of the current 34 kb eager bundle.

**Not adopted now:** React `<ViewTransition>` (Canary/experimental — will not be
load-bearing), CSS scroll-driven animations (not Baseline; Firefox still flagged), and a
charting library (charts stay hand-rolled SVG, consistent with today).

**Under evaluation, not committed:** Vercel **AI Elements** (`npx ai-elements@latest`,
vendored via the shadcn registry) ships exactly the interaction logic needed — `Tool`
with four states (`input-streaming`/`input-available`/`output-available`/`output-error`,
auto-expanding on terminal states), `ChainOfThought` (`complete`/`active`/`pending`),
`Reasoning` (auto-opens while streaming, auto-closes on completion), `Task`,
`InlineCitation` (hover card carrying the supporting quote), `Shimmer`. Because the
registry vendors source into our repo we can take the logic and discard the skin.
**Decision deferred to the implementation plan** — it wants shadcn/ui initialized and
Tailwind in CSS-variables mode, whereas we hand-roll six primitives today.

---

## 5. Data flow, streaming, error handling

**Live updates:** SSE, extending the existing `/api/containers/[id]/stream` pattern
rather than inventing a transport. SSE is correct here — unidirectional, survives the
Route Handler model, free auto-reconnect and `Last-Event-ID`.

**Resume on reload:** because `seq` is monotonic and the log append-only, a reconnect
replays from the client's last `seq` — resumability without adopting the AI SDK's
Redis-backed `resumable-stream` package. **Critical semantics:** a client disconnect (tab
close, refresh, navigate away) must **never** cancel the underlying investigation; the
run continues on BullMQ and the client rejoins. This is the most common way resumable
agent UIs break.

**Error handling, honestly:**

- Provider errors keep the existing contract — 402 with a classified actionable message
  (`credit_balance`, `invalid_api_key`, `rate_limit`, …); 503 when the agents service is
  down. Never fabricate a reply.
- A failed tool call renders as an error node with its validation message — visible, not
  swallowed.
- An investigation producing no findings ends honestly (`report_external_cause` or a
  failed state), never a fabricated root cause.
- Empty states state what is true ("No open investigations"); never sample data in the
  product workspace.

---

## 6. Testing

- **`buildActivityFeed` is pure** → table-driven unit tests over synthetic event arrays:
  pairing, noise filtering, thinking exclusion, out-of-order `seq`, missing tool result,
  duplicate `providerEventId`.
- **Harness:** findings-first gate rejects terminal tools; dispatch-before-ack ordering
  pinned by regression test; rubric clamping (out-of-range, missing → 0.5); idempotent
  `terminate`; tenant guard returns null cross-tenant.
- **Idempotency:** repeat Alertmanager delivery opens exactly one investigation.
- **UI:** detail renders each node type; reduced-motion path asserted; honest empty and
  error states.
- Repo discipline: verify by driving the real flow, not only a green suite.

---

## 7. Risks and open questions

1. **Coordination.** Two other sessions are active on UI cleanup and roadmap phases. The
   `services-workspace.tsx` decomposition will collide unless the lane is declared in the
   ledger first. This branch also lacks the obs work — it must merge `origin/main`
   (`463179e`) before starting, since `Incident` and the alert receiver live there.
2. **Licensing.** The reference is Apache-2.0. Study structure and interaction; write our
   own implementation. Do not copy source verbatim; the clone lives outside the repo and
   is never committed.
3. **Model cost.** A tool loop makes many more LLM calls than one JSON call. Budgets and
   fast-tier model choice are load-bearing, not optional. The Anthropic account is at $0
   — this needs credits or local Ollama to exercise.
4. **Open question:** should PR reviews also become investigations, or stay separate? The
   user chose "Investigations page" over "unify as Work items", so **separate** for now —
   but the event contract is general enough to absorb reviews later without a schema
   change.

---

## 8. Out of scope

OTLP tenant ingest, dashboards/widget builder, alert-rule builder UI, Slack/Linear
relays, the dark-theme flip, `automerge: immediately`, per-span metered billing.
