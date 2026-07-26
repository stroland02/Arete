# Glass Box — Live Dogfooding Cockpit (Design)

**Date:** 2026-07-15 · **Baseline:** `origin/main` @ `096d88c` · **Status:** DESIGN — awaiting human approval before any feature-depth build
**Branch:** `feat/glass-box-cockpit` (this doc only; no production code changed)

---

## 0. What this is

**Glass Box** turns the local Areté instance into a transparent cockpit for its own construction.
While the engineer fleet builds Areté, the running localhost dashboard shows — through the
Synthesizer's voice — *everything that is happening*: which agents/strategies ran, which
LangGraph nodes fired, what code reviews concluded, which queues processed what, and — the
live-monitor half — the moment an engineer's commit/branch lands, the UI refreshes itself and
the Synthesizer announces it in chat.

This is the fractal from the north-star doc made literal: the Synthesizer is the
PM-of-workflows; Glass Box is the PM's *status contract rendered as product UI*. Nothing is a
black box; every background action becomes a narrated, timestamped, typed event.

Design principle throughout: **design the seam, not a framework** (YAGNI). Everything below is
additive; no existing service's behavior changes in v1.

---

## 1. What already exists (the seams we build on — inventory, verified in code)

| Piece | Where | Why it matters for Glass Box |
|---|---|---|
| **SSE transcript stream** (proven pattern) | `packages/dashboard/src/app/api/containers/[id]/stream/route.ts` — emits `init` / `step` / `done` SSE events | The exact transport + event-envelope convention to clone for the live feed |
| **EventSource → reducer client hook** | `packages/dashboard/src/components/dashboard/agents/synthesizer/use-synth-stream.ts` + pure `synth-stream-model.ts` | The client pattern: thin EventSource adapter, all logic in a tested pure reducer |
| **SynthStep narration vocabulary** | `packages/dashboard/src/lib/issue-pipeline/types.ts` (`SynthStep { kind, text, detail, at }`) | Glass Box narration items are a sibling of this shape — same renderers can be reused |
| **Synthesizer console UI** | `components/dashboard/agents/synthesizer-console.tsx` + `synthesizer/*` (transcript, ledger, phase, agents-rail) | The chat surface the narrator speaks in |
| **BullMQ queues on Redis** | `packages/webhook/src/queue.ts` — `review-pr`, `review-pr-heavy`, `approval-exec` | BullMQ writes job lifecycle events to **Redis streams already**; `QueueEvents` consumes them with zero producer changes |
| **OTel spans on LangGraph** | `packages/agents/src/arete_agents/orchestrator.py` (`tracer.start_as_current_span`, per-agent + synthesis spans) | Node-transition ground truth already instrumented |
| **ClickHouse pulse** | `packages/dashboard/src/lib/queries.ts` `getAgentEventsPerMinute()` (reads `superlog.events_per_minute` MV) | Historical/aggregate lane; Glass Box is its real-time complement |
| **Sensorium view-model** | `packages/dashboard/src/lib/sensorium.ts` (+ `context-map-client.ts`, `sensors.ts`, `@arete/topology` codeGraphProvider) | The map that should visibly update when work lands; already fail-soft + honest-empty |
| **FastAPI agents service** | `packages/agents/src/arete_agents/server.py` (`/review`, `/chat`, `/context-map/*`) | Where a Python-side emitter would live (later phase, Eng3's lane) |
| **Local infra** | `infra/docker-compose.yml` — postgres, redis, clickhouse (healthchecked) | Redis is already in every dev loop → the event spine costs zero new services |
| **Outbound webhooks (in flight)** | Eng1's `packages/webhook/src/outbound/` (WebhookEndpoint/WebhookDelivery) | Long-term: Glass Box can become an *internal subscriber* of the same emission points — adapt, don't duplicate |

Key insight: **the repo already ships a working SSE + reducer + narration-step pipeline** for a
single review's transcript. Glass Box generalizes that proven seam from "replay one stored
review" to "live feed of everything," rather than inventing a second pattern.

---

## 2. Research — practices for a live multi-service local dev loop

### 2.1 Running the full stack locally (Next.js + Express + FastAPI + infra)

Three viable models, in increasing containerization:

1. **Infra in Docker, apps native** (current de-facto model: `pnpm infra:up` + per-service dev
   commands). Native processes keep each runtime's own hot reload at full speed: Next.js Fast
   Refresh for the dashboard, `tsx watch`/nodemon for Express, `uvicorn --reload` for FastAPI.
   Docker containers "were not originally meant to facilitate the sort of immediate-feedback
   development workflows web developers expect" ([DEV: TS monorepo with Compose Watch + Turborepo](https://dev.to/moofoo/typescript-monorepo-development-using-docker-compose-watch-turborepo-and-pnpm-3hep)).
2. **Everything in Compose with `docker compose watch`** — Compose Watch syncs/rebuilds on file
   change and pairs with Turborepo/pnpm for shared-package builds ([same source](https://dev.to/moofoo/typescript-monorepo-development-using-docker-compose-watch-turborepo-and-pnpm-3hep));
   Turborepo documents `turbo prune --docker` for lean per-service images ([turborepo.dev/docs/guides/tools/docker](https://turborepo.dev/docs/guides/tools/docker)).
   Best for environment parity, worst for feedback latency on Windows (bind-mount + pnpm
   virtual-store friction this repo already fought — see the `.npmrc` `virtual-store-dir-max-length` note in the ledger).
3. **A process orchestrator over native processes** (`concurrently`, turbo `dev` tasks, PM2) —
   one command, one merged log stream, still native-speed HMR.

**Recommendation for Areté local dev:** keep model 1, add a thin model-3 convenience: a root
`pnpm dev:all` that runs `infra:up` then the three dev servers via `concurrently` with
prefixed, colored logs. No Turborepo adoption this wave (YAGNI — 3 services don't need a task
graph; revisit if the package count grows). Compose Watch stays the documented *option* for
parity testing, not the daily loop.

### 2.2 The "stale worktree dev server" footgun (this repo's own lesson)

Build Wave 1's junk-card bug came from a dev server running out of a stale feature-branch
worktree while the user believed they were looking at `main`
(`docs/status/2026-07-14-build-wave-1-complete.md` §5). Practices to keep it dead:

- **One serving checkout, declared.** Only the `main` checkout serves localhost; worktrees are
  for editing, never `next dev`.
- **Provenance made visible, not remembered.** Glass Box bakes this in: the dev event stream's
  hello event carries `{ repoRoot, branch, sha }` of the *serving* process, and the feed
  renders it. A stale server self-identifies on screen instead of silently lying.
- **Cache hygiene:** `rm -rf packages/dashboard/.next` after branch moves (already documented);
  a single canonical port (3000) so a second server collides loudly instead of shadowing.

### 2.3 Streaming background/agent activity to the UI: SSE over WebSockets

For one-directional feeds (notifications, logs, dashboards, activity feeds), SSE is the
consistently recommended transport: plain long-lived HTTP (proxies/load balancers/devtools all
understand it), built-in auto-reconnect with `Last-Event-ID`, no protocol upgrade
([websocket.org comparison](https://websocket.org/comparisons/sse/),
[freeCodeCamp: SSE vs WebSockets](https://www.freecodecamp.org/news/server-sent-events-vs-websockets/),
[koder.ai: live dashboards](https://koder.ai/blog/websockets-vs-sse-live-dashboards)).
WebSockets earn their complexity only for bidirectional interaction. Glass Box narration is
strictly server→client (the existing `/chat` POST already covers user→Synthesizer), so **SSE —
the pattern the containers stream route already uses — is correct**. No socket server, no new
infra.

### 2.4 Where the events come from — established mechanisms per source

- **Queue/job lifecycle:** BullMQ's `QueueEvents` class is implemented on **Redis streams**, so
  events are delivered reliably across disconnections (unlike pub/sub), and covers
  `active/progress/completed/failed/stalled/...` without touching producers or workers
  ([docs.bullmq.io/guide/events](https://docs.bullmq.io/guide/events)). BullMQ also supports an
  OTel telemetry hook (`bullmq-otel`) if we later want spans instead of events.
- **LangGraph node transitions:** LangGraph's streaming API is designed exactly for this —
  `stream_mode="updates"` yields one event per node completion ("each node completion becomes a
  progress tick"), `custom` lets a node push status strings, and `astream_events` exposes every
  internal event for deep observability dashboards
  ([LangChain docs: Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)).
- **Git/file watching:** chokidar is the de-facto Node watcher (VS Code, webpack, PM2, ~30M
  repos) ([github.com/paulmillr/chokidar](https://github.com/paulmillr/chokidar)). Watching
  `.git/HEAD`, `.git/refs/heads/**`, and `.git/packed-refs` detects checkouts, commits, and
  fetched branch updates; enrich with `git log -1` on change. (Same technique VS Code's git
  extension uses to keep its UI in sync.)

### 2.5 Precedents for "glass box" agent UX

The direction is industry-validated: GitHub Copilot's coding agent added **session streaming**
so users watch the agent's steps live ([GitHub changelog, 2026-07-02](https://github.blog/changelog/2026-07-02-copilot-agent-session-streaming-is-now-in-public-preview/))
and earlier added expandable sub-agent activity views ([changelog 2026-03-19](https://github.blog/changelog/2026-03-19-more-visibility-into-copilot-coding-agent-sessions/)).
Microsoft's Agent Framework formalizes this as an **event-based UI protocol (AG-UI)** — typed
events for "agent started / called a tool / produced text / errored" streamed to the UI — plus
explicit "glass-box observability" over planner metadata
([Agent Framework deep dive](https://devblogs.microsoft.com/agent-framework/the-golden-triangle-of-agentic-development-with-microsoft-agent-framework-ag-ui-devui-opentelemetry-deep-dive/),
[Building agent UIs with AG-UI](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-interactive-agent-uis-with-ag-ui-and-microsoft-agent-framework/4488249)).
The load-bearing lesson from all of them: **a small, typed, uniform event vocabulary** that
every producer maps into — not free-text logs. That is exactly the `SynthStep` discipline this
repo already has; Glass Box extends it.

---

## 3. Architecture — the Glass Box event spine

```
 PRODUCERS                          SPINE                         CONSUMER
 ─────────                          ─────                         ────────
 BullMQ job lifecycle ──(already in Redis streams)──┐
 git watcher (dev-only, chokidar) ──XADD──►  Redis Stream   ──►  Next.js SSE route      ──►  useGlassBoxStream()
 agents service (later: glassbox.py XADD) ─►  glassbox:events     /api/glassbox/stream        ├─► GlassBoxFeed (narration)
 webhook emit points (later, Eng1 lane) ──►  (MAXLEN ~1000)       (auth-gated, XREAD BLOCK)   └─► LiveMonitor (router.refresh)
```

### 3.1 Why a Redis Stream

- Redis is already running in every dev loop (`infra/docker-compose.yml`) — **zero new services**.
- BullMQ's own events are Redis streams; we adopt the same primitive for our events, so the
  QueueEvents bridge and our stream share one mental model and one connection.
- Streams (vs pub/sub) give replay-on-reconnect: the SSE route resumes from `Last-Event-ID`
  (the stream entry id), so a dropped browser tab doesn't lose narration.
- `XADD ... MAXLEN ~1000` caps memory; Glass Box is a live feed, not an archive (ClickHouse
  remains the archive lane — later phase).

### 3.2 The event envelope (the one contract everything maps into)

```ts
// packages/dashboard/src/lib/glassbox/types.ts  (net-new, additive)
export type GlassBoxSource = "git" | "queue" | "agent" | "review" | "build" | "system";

export interface GlassBoxEvent {
  id: string;            // Redis stream entry id — doubles as SSE Last-Event-ID
  at: string;            // ISO timestamp
  source: GlassBoxSource;
  kind: string;          // e.g. "git.commit" | "git.branch_updated" | "queue.review.active"
                         //      "queue.review.completed" | "agent.node.start" | "agent.node.end"
                         //      "review.finding.kept" | "system.hello"
  title: string;         // one-line, already human-readable ("Engineer 1 pushed 3 commits to stroland02/Engineer-1")
  detail?: string;       // expandable body (commit subjects, span attrs, drop reason…)
  refs?: {               // typed hooks for UI actions — all optional
    branch?: string; sha?: string; files?: string[];
    jobId?: string; queue?: string;
    reviewId?: string; agentId?: string; node?: string;
  };
  severity?: "info" | "success" | "warn" | "error";
}
```

Rules: producers translate *at the edge* into this envelope (no raw payload leaks); `title`
must be human-readable without the UI knowing the source; `refs` is what makes events
actionable (deep-link to a review, highlight a Sensorium node by file path).

### 3.3 Producers

**v1 — zero-touch or dev-only (no production service modified):**

1. **QueueEvents bridge.** A single module instantiates `new QueueEvents("review-pr" | "review-pr-heavy" | "approval-exec")`
   against the same `REDIS_URL` and maps `active/completed/failed/progress` →
   `queue.*` GlassBoxEvents. It's a *reader* of streams BullMQ already writes — webhook's code,
   including the outbound-tests lane currently in flight, is untouched. It lives inside the
   dev watcher process (below), not inside packages/webhook.
2. **Git watcher (the live monitor's sensor).** `scripts/dev/glassbox-watch.mjs`, dev-only,
   started by `pnpm dev:glassbox`. chokidar on `.git/HEAD`, `.git/refs/heads/**`,
   `.git/packed-refs` of the serving checkout; debounce ~300ms; on change, `git log -1
   --format=%H%x1f%an%x1f%s <ref>` + `git diff --name-only HEAD@{1}..HEAD` (best-effort) →
   `git.commit` / `git.branch_updated` events with `refs.files` so the UI can flash the
   touched Sensorium nodes. Emits `system.hello { repoRoot, branch, sha }` on start — the
   anti-stale-worktree provenance banner (§2.2).

**v2+ — additive emit points inside services (owned by their lane engineers):**

3. **Agents service emitter.** `packages/agents/src/arete_agents/glassbox.py` (new, ~40 lines):
   `emit(kind, title, detail, refs)` doing a fire-and-forget `XADD` via redis-py, no-op when
   `GLASSBOX_REDIS_URL` is unset (prod-safe default OFF). Called from the exact places
   `orchestrator.py` already opens OTel spans (per-agent start/end, synthesis, critic drops) —
   or, cleaner when the orchestrator moves to streamed execution, from LangGraph
   `stream_mode="updates"`/`custom` (§2.4). One import + a handful of one-line calls; the
   OTel spans stay authoritative for ClickHouse, the emitter is the real-time mirror.
4. **Webhook emit points.** Same shape in TS (`emitGlassBox()` no-op without env var) at review
   dispatch / comment-posted / approval-executed. **Deliberately deferred**: this lane has a
   failing-test fix in flight, and Eng1's outbound-webhook emission points are landing — when
   those stabilize, Glass Box should register as an *internal subscriber* of the same emission
   architecture rather than adding a parallel one. Decision deferred to that lane's owner.

### 3.4 Consumer — the SSE route

`packages/dashboard/src/app/api/glassbox/stream/route.ts` (net-new), cloned from the proven
containers stream route:

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`, auth-gated exactly like
  `/api/containers/[id]/stream` (session required; 401 otherwise).
- Opens ioredis, `XREAD BLOCK` on `glassbox:events` starting at `Last-Event-ID` header (or `$`),
  forwards each entry as `event: gbx\ndata: <GlassBoxEvent JSON>\n\n`, heartbeat comment every
  15s so proxies don't idle-close; cleans up the Redis connection on `request.signal` abort.
- **Honest empty:** if Redis is unreachable, emit one `system.offline` event and close — the
  feed renders "live monitor offline", never fabricates activity.
- Tenancy: in local dogfooding this is single-tenant. Before any hosted deploy, events must
  carry `installationId` and the route must filter to the session's installations — flagged as
  an explicit gate in the plan (§6), not hand-waved.

---

## 4. The Synthesizer narrator

### 4.1 Narration = pure function over typed events (v1: templates, not LLM)

```ts
// packages/dashboard/src/lib/glassbox/narrate.ts (net-new, pure, unit-testable)
export function narrate(e: GlassBoxEvent): NarrationItem; // NarrationItem ≈ SynthStep shape
```

Deterministic templates per `kind`, written in the Synthesizer's voice:

- `git.commit` → "**Engineer 1** landed `fix: retry worker backoff` on `stroland02/Engineer-1` (3 files). I'm refreshing the map."
- `queue.review.active` → "A review job just went active on the fast lane — the six specialists are picking up PR #42."
- `agent.node.end` (security, kept 2) → "Security finished: 2 findings kept, 1 dropped by the Critic (unverifiable against the diff)."
- `system.hello` → "Cockpit online — serving `main` @ `096d88c` from the main checkout."

Why templates first: narration must be **instant, free, and honest** — an LLM pass adds
latency, cost, and a fabrication surface for what is fundamentally structured data. An LLM
"composer" that batches N events into a paragraph in Kuma's voice is a v3 polish item behind
the same `narrate()` seam (swap the implementation, not the interface).

### 4.2 Where it renders

- **`GlassBoxFeed`** (net-new client component): a narration lane rendered with the *existing*
  transcript visual language (`synth-transcript.tsx` step rows / ledger chips), mounted in the
  agents workspace beside the Synthesizer console — the chat window itself and `use-synth-stream`
  are untouched. Items with `refs.reviewId` deep-link to `/reviews/[id]`; `refs.files` items
  highlight matching Sensorium nodes on hover.
- **`useGlassBoxStream()`** (net-new hook): a clone of `useSynthStream`'s
  EventSource→pure-reducer pattern (§1) with a ring buffer (last ~200 items) and
  `connected | offline` state for the honest-empty banner.
- The existing chat stays the interactive channel; the feed is the ambient channel. (Same
  split Copilot/AG-UI landed on: typed activity events beside the conversation, §2.5.)

---

## 5. The live monitor — work lands → UI updates → Synthesizer announces

Flow, end to end (all pieces from §3):

1. Engineer's work lands — a commit/branch update reaches the serving checkout (local commit,
   `git fetch`, or PM's integration merge).
2. `glassbox-watch.mjs` sees `.git/refs` change → emits `git.commit` with branch/sha/files.
3. SSE route pushes it to every open dashboard tab.
4. **`LiveMonitor`** (net-new, tiny client component mounted in the dashboard layout):
   - dispatches the narration item to the feed ("Engineer 1 landed …"), and
   - calls Next.js `router.refresh()` — App Router re-runs the server components
     (`getDashboardViewModel`, `getSensoriumViewModel`) **without losing client state**, so
     `/overview`'s metrics and the Sensorium map re-render against fresh data agentically —
     no manual reload ([Next.js docs: `useRouter().refresh`](https://nextjs.org/docs/app/api-reference/functions/use-router)).
   - Debounced (one refresh per burst of events, ~2s) so a rebase storm doesn't thrash the UI.
5. Code-level hot reload stays each runtime's job (Fast Refresh / tsx watch / uvicorn reload —
   §2.1); the monitor covers the *git/data* layer those tools don't see: it makes landed work
   visible even when the changed files aren't part of the dashboard bundle at all
   (agents-service or webhook changes still produce an announcement + data refresh).

Honesty rules: if the watcher isn't running, the feed shows "live monitor offline" (no
pretend liveness). The `system.hello` provenance line permanently shows *which checkout and
sha* is being served — the stale-worktree footgun becomes visible instead of latent.

---

## 6. Phased plan, ownership, and lanes

### Phase 0 — this branch (done)
This design doc. No code.

### Phase 1 — "cockpit v1" (one engineer-wave, dashboard lane + dev scripts)

Net-new files only; zero edits to webhook/agents production code:

| # | Deliverable | Files (all additive) | Reuses |
|---|---|---|---|
| 1 | Event types + narration | `packages/dashboard/src/lib/glassbox/{types,narrate}.ts` + unit tests | SynthStep vocabulary |
| 2 | SSE route | `packages/dashboard/src/app/api/glassbox/stream/route.ts` | containers-stream pattern, auth, ioredis (via a small server-only redis client util) |
| 3 | Client hook + feed + monitor | `.../glassbox/use-glassbox-stream.ts`, `components/dashboard/glassbox-feed.tsx`, `live-monitor.tsx` | useSynthStream reducer pattern, synth-transcript visuals, `router.refresh()` |
| 4 | Dev watcher + QueueEvents bridge | `scripts/dev/glassbox-watch.mjs` (chokidar + ioredis + BullMQ QueueEvents) | BullMQ streams already emitted by `review-pr`/`approval-exec` |
| 5 | One-command dev loop | root `package.json`: `dev:all` (concurrently: infra:up → dashboard/webhook/agents/watcher), `dev:glassbox` | existing per-service dev scripts |

**Lane/ownership:** items 1–3 are `packages/dashboard` (currently unclaimed — Eng2 moved to
`packages/orchestration`; assign to the next free engineer as their sole surface). Items 4–5
are `scripts/` + root manifest = **infra lane**; same engineer may take them but must declare
the root-`package.json` touch in the ledger (shared file). **Nothing in this phase touches
`packages/webhook` or `packages/agents`** — explicitly compatible with Eng1's outbound-test
fix in flight and Eng3's `server.py` additive route.

**Gate (per §1.5 of the workflow spec):** full matrix + drive the real flow — make a commit in
the serving checkout with the stack running and watch: feed narrates it, `/overview` refreshes,
provenance banner correct. Kill Redis and verify the honest-offline state.

### Phase 2 — agents-side narration (Eng3's lane, after P1.3)

- `glassbox.py` emitter (no-op without env), one-line calls at the existing OTel span sites in
  `orchestrator.py`; optional move to LangGraph `stream_mode="updates"` when the orchestrator
  streams. Adds `agent.node.*` and `review.finding.*` kinds → the narrator now tells the
  *methodology* story live ("dispatching six specialists… Critic dropped 1 unverifiable…").
- Coordinate in the ledger: `packages/agents` is Eng3's package this wave.

### Phase 3 — webhook emission + persistence + polish (separate wave, decide then)

- Webhook emit points **or** Glass Box as an internal subscriber of Eng1's outbound-webhook
  emission architecture (preferred if it fits — one emission system, two audiences). Eng1's lane.
- Persist GlassBoxEvents to ClickHouse (`superlog` schema) for replayable history; the pulse MV
  (`getAgentEventsPerMinute`) becomes the aggregate view of the same stream.
- LLM narration composer behind `narrate()` (Synthesizer voice, batched), Sensorium
  "healing-in-progress" pulses driven directly by `agent.node.*` events, `installationId`
  tenancy filtering — **required before any non-local deploy**.

### Explicitly NOT in scope (YAGNI)
- No WebSocket server, no socket.io, no new broker (Redis stream only).
- No generic plugin/event framework — one envelope, listed kinds, extended by PR.
- No Turborepo migration; no docker-compose watch dev loop (documented alternative only).
- No changes to the frozen marketing landing page; no restyle of the design system.

---

## 7. Risks & open questions (for the human)

1. **Windows + chokidar on `.git`:** ref updates on Windows are atomic renames; chokidar
   handles this but the watcher must also watch `packed-refs` (post-`git gc` refs move there).
   Mitigation is in the design; needs real-flow verification at the gate.
2. **SSE through Next dev server:** route handlers stream fine in `next dev`, but confirm the
   15s heartbeat keeps the connection alive through any local proxy setup.
3. **Who claims the dashboard lane for Phase 1?** Eng2 has moved to orchestration; Phase 1 is
   sized for one engineer. PM to assign.
4. **Phase 3 emission unification** (webhook emit points vs internal outbound-webhook
   subscriber) is deliberately left open until Eng1's P1.1/P1.3 architecture settles.

---

## 9. Implementation notes & deviations (Phase 1 as built, 2026-07-15)

Phase 1 was built additively on `feat/glass-box-cockpit` (rebased onto `integration` so
Sensorium + the webhook models are present). Deviations from §3, each a deliberate, more
lane-safe choice, logged here as the repo's discipline requires:

1. **SSE is served by a dev-only sidecar, not a Next.js `/api/glassbox/stream` route.**
   Reading Redis/BullMQ and shelling to `git` from inside the Next dashboard would add a
   runtime dependency (`ioredis`) + `pnpm-lock` churn for a dev-only cockpit — and those libs
   aren't hoisted to the dashboard under strict pnpm. Instead **all** infra-touching code lives
   in `scripts/dev/glassbox-watch.mjs` (Node builtins + optional dynamic `bullmq` import), which
   serves SSE at `http://localhost:4517/glassbox/stream` (CORS-open to `:3000`). The dashboard
   change is now *purely presentational* — a hook + a dock component — with **zero new deps, no
   server route, no Redis import**. This maximizes the "additive + isolated, don't destabilize
   the dashboard" guardrail. The event envelope (`GlassBoxEvent`) still lives in the dashboard so
   `narrate()` stays unit-tested there.
2. **Git watcher polls `git rev-parse` (1.5s) instead of chokidar on `.git`.** Zero new
   dependency, and more robust on Windows than watching `.git/refs`/`packed-refs` renames. It
   catches commits, checkouts, and fetched updates. chokidar remains the documented alternative.
3. **The SSE spine is an in-memory ring buffer in the sidecar, not a Redis stream (yet).** For
   local single-user dogfooding the sidecar is the single producer + server, so a ring buffer
   (with `Last-Event-ID` replay) is sufficient and simpler. The BullMQ bridge still *reads*
   Redis streams (that's how BullMQ events work); it just doesn't re-persist Glass Box events to
   Redis. Promoting to a durable Redis stream is deferred to the multi-process/hosted phase.
4. **Inert-by-default in production.** `GlassBoxDock` renders `null` unless
   `NEXT_PUBLIC_GLASSBOX_URL` is set (only local `.env.local` sets it), so prod never mounts the
   feed. The BullMQ bridge is off unless `REDIS_URL`/`GLASSBOX_REDIS_URL` is present.
5. **Local DB is synced with `prisma db push`, not `migrate deploy`.** The `integration` tree
   has a migration-history defect (no create-migration for `ApprovalPrompt`/`AgentMemory`; only
   an `ALTER`). `db push` syncs the DB to `schema.prisma` and touches no committed files —
   staying out of the `@arete/db` owner's lane, who will author the missing create-migrations.

**Files added (all additive, dashboard-lane + dev-scripts):**
- `packages/dashboard/src/lib/glassbox/{types.ts, narrate.ts, narrate.test.ts}` (pure core, 7 tests)
- `packages/dashboard/src/components/dashboard/glassbox/{use-glassbox-stream.ts, glassbox-dock.tsx}`
- one additive mount in `packages/dashboard/src/app/(dashboard)/layout.tsx`
- `scripts/dev/{glassbox-watch.mjs, dev-all.mjs}`, `packages/dashboard/scripts/seed-dev-user.mjs`
- root `package.json` dev scripts; `docs/runbooks/2026-07-15-local-dev-loop.md`

**Verified:** dashboard `build` compiles clean (18 routes); `test` 175 passed (168 baseline + 7
new); sidecar serves the real `system.hello` provenance frame over SSE; localhost sign-in →
`/overview` = 200 driven end-to-end.

---

## 10. Live Preview service (design-only — later phase, present for approval)

**Goal.** A one-click **"Live Preview"** entry on the Services surface: the user picks it,
fills a small config form (repo path, which packages to run, ports), and Areté **bootstraps +
runs the local stack and auto-opens a localhost tab** — so while fixing a PR they watch the fix
reflected in their own running UI/UX and verify it. This is literally the productized form of
the `dev-all.mjs` bootstrap built in Phase 1 — **reuse it, don't rebuild it**.

### 10.1 The honest constraint (stated up front, no black box)

A hosted web dashboard **cannot** spawn Docker/pnpm or open a localhost server on the user's
machine by itself — browsers sandbox that away, and rightly so. Any design that pretends
otherwise is dishonest. So Live Preview is **two tiers**, and the UI always tells the user which
tier is active and what is running where.

### 10.2 Tier 1 — LOCAL/DEV companion (the MVP, achievable now, for our own dogfooding)

- The "companion" is the **`dev-all.mjs` bootstrap** already built, wrapped as a tiny local
  responder. In pure local dev the dashboard and companion are the same machine, so the
  dashboard's Live Preview card can deep-link to / trigger `pnpm dev:all` (or the user runs it)
  and then **auto-opens `http://localhost:3000`**.
- **Run flow (fully automatic — the user's ask, no manual steps):**
  1. **Ensure Docker** — if `docker info` fails, **auto-start Docker Desktop**. On Windows:
     launch `"C:\Program Files\Docker\Docker\Docker Desktop.exe"` (detached), then poll
     `docker info`/`docker ps` until ready (implemented in `dev-all.mjs ensureDocker()`).
  2. `infra:up` → wait for Postgres healthy.
  3. Sync schema (`prisma db push`, until the migrate defect is fixed → then `migrate deploy`).
  4. Start the dashboard dev server + Glass Box sidecar (prefixed logs).
  5. **Auto-open** `http://localhost:3000`.
- The Glass Box live monitor (Phase 1) then keeps that tab in sync as fixes land.

### 10.3 Tier 2 — SHIPPED SaaS (later)

Same UX, but the hosted dashboard talks to a **downloadable local companion** (an Areté CLI /
menubar daemon) over a **loopback-only** port. Trust/security model (must be designed before
building):
- Companion binds **`127.0.0.1` only** — never `0.0.0.0`; never reachable off-box.
- Browser↔companion is **authenticated** (a per-install token the user pastes once, or an
  OS-keychain-backed pairing), so a random web page can't drive it.
- The companion runs a **fixed, declarative recipe** (bootstrap steps above), **never arbitrary
  commands from the server** — the server sends a *service id + typed config*, not a shell
  string. This is the same "fixed recipe, typed config" discipline as the telemetry connectors.
- The UI shows exactly what will run before it runs (glass-box).

### 10.4 Modeled as a real "service" (consistent with the existing catalog)

Match `packages/dashboard/src/lib/connector-catalog.ts` (`ConnectorDef`: `id, name, category,
tagline, authKind, authSummary, trustNote, requirement, status`). Live Preview is a
`LivePreviewServiceDef` in the same spirit, plus the run-specific bits a connector doesn't need:

```ts
interface LivePreviewServiceDef {
  id: "live-preview";
  name: "Live Preview";
  category: "Local dev loop";
  tagline: "Boot the stack locally and watch your fix land in the running app.";
  tier: "local-companion" | "saas-companion";       // which transport is active
  config: {                                          // "whatever requirements it needs"
    repoPath: string;
    packages: Array<"dashboard" | "webhook" | "agents">;  // which to run
    ports: { dashboard: number; webhook?: number; agents?: number };
    autoStartDocker: boolean;
  };
  status: "available" | "planned";
}
```

Actions on the card, mirroring a connector's connect/status: **Run** (kick the bootstrap),
**Status** (Docker up? infra healthy? servers ready? — surfaced from the same health polls
`dev-all.mjs` already does), and **Open** (focus/auto-open the localhost tab). The Glass Box
provenance banner (§5) shows which checkout/sha the preview is actually serving.

### 10.5 Open questions (for approval)

- **Companion transport for Tier 2** — local CLI daemon vs menubar app vs a `npx arete preview`
  responder; how the browser discovers its loopback port.
- **Which packages the preview runs by default** — dashboard-only is the safe default (webhook
  refuses to boot without `GITHUB_APP_ID`; agents needs a Python env). Config lets the user opt
  webhook/agents in.
- **Security review of Tier 2** before any build — the loopback-auth + fixed-recipe model above
  is the proposal, not yet vetted.
- **Where the service lives** — a new isolated `packages/companion` (or `scripts/`) for the
  runner; the card + config form are dashboard-lane. No edits to `packages/webhook`/`agents`.

**Phasing:** Phase 1 (this branch) stays as delivered. Live Preview is **Phase 3+**, built ON
the `dev-all.mjs` bootstrap. Design-only here — present for approval before building.

---

## 8. Sources

- [WebSocket.org — WebSocket vs SSE comparison](https://websocket.org/comparisons/sse/)
- [freeCodeCamp — SSE vs WebSockets: choosing a real-time protocol](https://www.freecodecamp.org/news/server-sent-events-vs-websockets/)
- [koder.ai — WebSockets vs SSE for live dashboards](https://koder.ai/blog/websockets-vs-sse-live-dashboards)
- [BullMQ docs — Events (QueueEvents on Redis streams, delivery guarantees)](https://docs.bullmq.io/guide/events)
- [LangChain docs — LangGraph Streaming (updates/custom/messages modes, astream_events)](https://docs.langchain.com/oss/python/langgraph/streaming)
- [chokidar — cross-platform file watching](https://github.com/paulmillr/chokidar)
- [Turborepo — Docker guide (`turbo prune --docker`)](https://turborepo.dev/docs/guides/tools/docker)
- [DEV — TypeScript monorepo dev with Docker Compose Watch, Turborepo, pnpm](https://dev.to/moofoo/typescript-monorepo-development-using-docker-compose-watch-turborepo-and-pnpm-3hep)
- [GitHub Changelog — Copilot agent session streaming (public preview)](https://github.blog/changelog/2026-07-02-copilot-agent-session-streaming-is-now-in-public-preview/)
- [GitHub Changelog — more visibility into Copilot coding agent sessions](https://github.blog/changelog/2026-03-19-more-visibility-into-copilot-coding-agent-sessions/)
- [Microsoft Agent Framework — AG-UI, DevUI & OpenTelemetry deep dive (glass-box observability)](https://devblogs.microsoft.com/agent-framework/the-golden-triangle-of-agentic-development-with-microsoft-agent-framework-ag-ui-devui-opentelemetry-deep-dive/)
- [Microsoft — Building interactive agent UIs with AG-UI](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-interactive-agent-uis-with-ag-ui-and-microsoft-agent-framework/4488249)
- [Next.js docs — `useRouter().refresh` (re-run server components without losing client state)](https://nextjs.org/docs/app/api-reference/functions/use-router)
