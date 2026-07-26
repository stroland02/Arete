# Agents page = per-agent chat; Synthesizer lives on Services

**Date:** 2026-07-13
**Branch:** `Agent-page-chat-is-for-agents`
**Status:** Design — approved decisions captured; pending final spec review.

## Problem

The `/agents` page currently shows a **Synthesizer** console in the center — a
clearly-labeled scripted replay of the review workflow with a disabled chat
input. That conflates two different things the product does, and has been a
recurring source of confusion:

- The **Synthesizer** coordinates the review workflow and verifies findings —
  an account/issue-level narrative. That belongs where the workflow is watched.
- The **six specialist agents** each do their own work in the background. A
  user who wants to see *what a specific agent is doing* — its findings, its
  reasoning — or to *talk to that agent to adjust code/structure*, has nowhere
  to do that today.

## Goal

Reorganize the two pages by audience:

- **`/agents` — "talk to your specialists."** Selecting an agent in the rail
  opens **that agent's own conversation/activity** in the center: its real
  findings from recent reviews (the honest "what it's doing in the background")
  plus a live composer to talk to it. Replaces the Synthesizer console here.
- **`/services` — "the Synthesizer runs the workflow."** The Synthesizer
  console stays here as its canonical home (it is already issue-scoped and
  correct under the new model). No structural change.

This is deliberately a **focused** change: nearly all new work is the Agents
page center pane + one new query + one thin chat route. Services is left
essentially as-is.

## Non-goals

- No live "agent is running right now" event stream (deferred — needs run
  telemetry surfaced from the Python agents; explicitly out of scope).
- No changes to the review pipeline, the agents' review logic, or the DB schema.
- No new persistence for chat threads in this pass (stateless replies; thread
  persistence is a later follow-up).
- No redesign of the Services page beyond confirming it owns the Synthesizer.

## House constraints (must hold)

- **Anti-fabrication.** Never show a fake "live" model or invented data. Every
  number comes from real, tenant-scoped review data. When the model isn't
  reachable, the composer is visibly disabled with a **truthful** label — never
  a canned reply.
- **Reuse over new infra.** The live-chat backend already exists; wire to it
  rather than standing up a parallel one.
- **Tenant isolation.** Every read/route scopes through the session's
  authorized installations — the client never supplies the tenant.

## What already exists (grounding)

- `packages/dashboard/src/components/dashboard/agents/agents-workspace.tsx` —
  3-pane workspace: `AgentRail` (left) · `SynthesizerConsole` (center) ·
  `PrPanel` (right). Clicking a rail row calls **both** `onSelect` and
  `onConfigure` (force-opens the config drawer).
- `agent-catalog.ts` — the six `AGENTS`; each `id` is the exact `category`
  string written onto every `ReviewComment` (`security`, `performance`,
  `quality`, `test_coverage`, `deployment_safety`, `business_logic`).
- `packages/db/prisma/schema.prisma` — `ReviewComment` persists `path`, `line`,
  `body` (the finding rationale), `severity`, `category`, `createdAt`, linked to
  a `Review` (`prNumber`, `riskLevel`, `overallSummary`, `repository`). This is
  the real per-agent data. **No diff hunk and no separate reasoning trace are
  stored** — the transcript is the agent's posted findings, nothing invented.
- `packages/dashboard/src/lib/queries.ts` — every query scopes through
  `repository: { installationId: { in: installationIds } }`. New queries follow
  this exact pattern.
- `packages/agents/src/arete_agents/server.py` — FastAPI service exposing
  `POST /chat` → `ChatAgent.reply(context)`; **fails fast without
  `ANTHROPIC_API_KEY`**.
- `packages/agents/src/arete_agents/agents/chat.py` — `ChatAgent`; already
  escapes untrusted metadata via `escape_for_prompt` against prompt injection.
- `packages/webhook/src/chat-handler.ts` — reference caller: `POST ${baseUrl}/chat`
  with a timeout, where `baseUrl` is `PYTHON_SERVICE_URL`
  (`packages/webhook/src/config.ts`, default `http://127.0.0.1:8000`).

## Design

### A. Information architecture

| Page | Center pane before | Center pane after |
|---|---|---|
| `/agents` | `SynthesizerConsole` (scripted) | **`AgentConversation`** (real per-agent activity + live composer) |
| `/services` | Synthesizer (issue-scoped) | **Unchanged** — canonical Synthesizer home |

### B. Agents page center pane — `AgentConversation`

New client component replacing `SynthesizerConsole` in `agents-workspace.tsx`.
Same glass/token styling. Three stacked zones:

1. **Header** — agent label · model-tier badge · real status line
   (`Analyzed · N findings` / `Idle`) · a **Configure** gear that opens the
   existing `AgentConfigDrawer`.
2. **Activity transcript** — the selected agent's **real findings** from recent
   reviews, grouped by PR. Each finding row: `path:line` · severity pill · the
   finding `body`. Honest empty state when the agent has zero findings
   (e.g. *"Security hasn't flagged anything in its lane yet — that's a real
   result too"*). Data only; nothing implies a live run.
3. **Composer** — real chat input. On submit, `POST /api/agents/[id]/chat`.
   - **Model live:** renders the returned reply in a conversation thread
     (client-side, in-memory for this pass).
   - **Model not reachable:** input disabled, truthful caption
     (e.g. *"Live chat activates when the agents service is running"*), and any
     submit attempt surfaces the route's `503` message. No fabricated reply.

### C. Rail interaction fix (decouple select from configure)

Today a rail row click does `onSelect` + `onConfigure`. Since selecting now
drives the center conversation, force-opening the drawer on every click is
wrong. Change `AgentRail` so:

- **Row click** → `onSelect` only (drives the conversation pane).
- **A dedicated gear affordance** (row-level and/or in the pane header) →
  `onConfigure` (opens `AgentConfigDrawer`).

`AgentsWorkspace` keeps owning `selectedAgentId` and `configAgentId`
independently (already does).

### D. New query — `getAgentActivity`

In `queries.ts`, mirroring the existing choke-point pattern:

```ts
export interface AgentActivityFinding {
  reviewId: string;
  prNumber: number;
  repositoryFullName: string;
  createdAt: Date;
  category: string;   // agent id
  path: string;
  line: number;
  body: string;
  severity: string;
}

// Recent findings across the caller's authorized installations, for all six
// categories (the workspace slices by selected agent client-side). Scoped via
// review: { repository: { installationId: { in: installationIds } } }.
export async function getAgentActivity(
  db: PrismaClient,
  installationIds: string[],
  limitPerAgent?: number,
): Promise<AgentActivityFinding[]>
```

`/agents/page.tsx` calls it alongside the existing view-model and passes the
result into `AgentsWorkspace`. Empty list ⇒ honest idle state (no `hasAccess`
⇒ no query, same as today).

### E. Chat route — `POST /api/agents/[id]/chat`

New Next.js route handler in the dashboard. Server-only. Steps:

1. `auth()` → if no session, `401`.
2. Validate `[id]` is one of the six catalog ids → else `400`.
3. Resolve authorized installations from the session (never trust the client).
4. Read request body: the user's message + a finding reference (optional) the
   message is about. Re-fetch that finding **server-side, scoped to the
   session's installations** (never trust a client-supplied finding body).
5. Build the context and `POST ${PYTHON_SERVICE_URL}/chat` (mirror
   `chat-handler.ts`: timeout + error handling).
   - The existing `ChatAgent.reply` context shape is PR-comment-reply oriented.
     Map the agent-conversation context onto it (`bot_comment` = the finding
     body, `file_path`/`diff_hunk` = the finding's `path:line`, `user_reply` =
     the user's message), **or** extend `ChatAgent` with a small
     agent-conversation branch. Either way, one persona source of truth stays in
     Python. (Exact mapping pinned in the implementation plan.)
6. On upstream failure/unavailability (including missing key ⇒ service down),
   return `503` with a truthful message the composer renders as its gated state.
7. Return the reply JSON to the client.

Data flow:

```
browser (composer)
  → POST /api/agents/:id/chat   (Next route: auth + agent-id validation + tenant scope)
      → POST $PYTHON_SERVICE_URL/chat   (FastAPI: model + key + escape_for_prompt)
      → reply
  → rendered in the conversation thread
(model/service down ⇒ 503 ⇒ composer shows honest disabled state)
```

### F. Security / data-security

- **Tenancy:** `getAgentActivity` and the finding re-fetch in the route both go
  through `repository: { installationId: { in } }`; a finding outside the
  caller's installations is unreachable.
- **AuthN/Z:** route rejects unauthenticated (`401`) and unknown agent ids
  (`400`).
- **Prompt injection:** finding bodies and the user message cross into the
  model as *data*; the FastAPI `ChatAgent` already applies `escape_for_prompt`
  to untrusted fields — reused unchanged.
- **Secrets/SSRF:** `PYTHON_SERVICE_URL` and `ANTHROPIC_API_KEY` are server-only
  and never reach the browser; the route calls a fixed configured base URL, not
  a client-supplied one.
- **No fabrication:** the gated `503` path guarantees the UI never shows an
  invented reply when the model is unavailable.

## Testing

- `getAgentActivity` — tenant-scoping test (a review in another installation
  never appears); shape/ordering test. Mirror `queries.test.ts` patterns.
- `AgentConversation` — renders real findings for the selected agent; honest
  empty state at zero findings; composer disabled state when the route reports
  unavailable. (React Testing Library, behavior-first.)
- Chat route — `401` unauthenticated; `400` unknown agent id; `503` when the
  upstream is unreachable; happy-path proxies to the upstream and returns its
  reply (upstream mocked, mirroring `chat-handler.test.ts`).
- Rail — row click selects without opening the drawer; gear opens the drawer.

## Rollout / honesty posture

Ships fully with the composer honestly gated. It **flips to live automatically**
the moment the agents service is running with a valid `ANTHROPIC_API_KEY` — no
code change, no fabricated intermediate state. Consistent with the existing
"live chat coming soon" posture, but now backed by a real endpoint.

## Open items for the implementation plan

- Exact `ChatAgent` context mapping vs. a dedicated agent-conversation branch.
- Whether the composer sends a specific selected finding or free-form (default:
  free-form, with the agent's recent findings as background context).
- Model-availability probe: rely on the `503` from a real call, or add a cheap
  health check. (Default: rely on the real call's `503` — no extra endpoint.)
