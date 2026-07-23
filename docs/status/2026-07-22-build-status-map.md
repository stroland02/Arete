# Build Status Map — what's real, what's sample, what's not wired

**Date:** 2026-07-22 · **Branch:** `stroland02/setup-live-website-dev` (merged `origin/main` `463179e`)
**Method:** two parallel audits — every interactive control in `packages/dashboard`
classified against its handler/API route, and every backend capability checked for a UI
caller. Evidence is `file:line`. Nothing here rests on a screenshot.

**Readiness vocabulary** (matches `components/ui/readiness-badge.tsx`):

| Level | Meaning |
|---|---|
| **Live** | Wired to real data and real actions |
| **Preview** | Renders, but on scripted sample data |
| **Partial** | Real, but a meaningful part of the flow is stubbed |
| **Soon** | Not orchestrated yet; controls inert by design |

---

## 1. Per-surface status

| Surface | Status | What's real | What isn't |
|---|---|---|---|
| `/connections/ai-models` | **Live** | Connect/reconnect, set-active, disconnect + remove key, Ollama auto-detect and streamed auto-pull, real diagnostics | — |
| `/history` | **Live** | Risk tabs (server-filtered), review rows, pagination, honest empty state | — |
| `/incidents` | **Live** | Open/Resolved/Noise/All tabs, real incident rows, New investigation dialog creates a real `Incident` | — |
| `/incidents/[id]` | **Live** | Mark/unmark noise, View fix run, scrubbed payload tables, **a manual investigation now routes to a fix** (Stage 3.2, `98562e8`) | Routing obeys the shared critical+firing policy, so a `warning` investigation deliberately does not start one |
| `/settings` | **Live** | Connect GitHub OAuth, workspace links, real billing usage | No self-serve upgrade — stated honestly, no fake button |
| `/overview` | **Partial** | Stat tiles, Sensorium map, setup checklist from real DB facts, preset tabs, time range | 2 checklist sub-steps marked Coming soon; telemetry "planned" connectors inert |
| `/agents` | **Partial** | Agent chat is genuinely live (402/503 surfaced honestly), findings from real data | **All** config controls still unsaved (roadmap 2.4). Approve-solution is no longer unreachable — the gate moved to the Services work-item panel in `1192d37` |
| `/services` | **Partial** | Rail, SSE synthesizer console, StatusBoard, **real** scan status (Stage 3.3), Fix it / Dismiss without losing rail position (3.4), **both HITL gates: approve then post** (`1192d37`), infrastructure-approval queue (`a21f956`) | Send honestly 503s locally (`STAGING_SERVICE_URL` unset); the send route still does not advance its work item `staged → posted` (recorded, unfixed) |
| `/connections/[id]` | **Partial** | Stripe key form; PostHog + Vercel OAuth | Every other connector disabled |
| Topbar | **Soon** | Breadcrumb only | Search/⌘K and Notifications both disabled — zero working controls |
| Glass Box dock | **Live (dev only)** | SSE feed, provenance banner, auto-refresh | Inert in production by design (`if (!url) return null`) |

---

## 2. Controls that misrepresented themselves — fixed 2026-07-22

Both shipped in authenticated chrome; corrected in commit `93c5db4`:

1. **"Request changes" / "Copy patch"** (`services-workspace.tsx:1013-1018`) had no
   `onClick`, no `disabled`, and full hover styling. They looked completely live and did
   nothing. Now disabled with explanatory titles and a Coming-soon badge.
2. **The sidebar Kuma logo** ran `handleSimulateLoad` — a fake 3-second data-pipeline
   spinner with `title="Click to simulate data pipeline loading!"` (`sidebar.tsx:56-72`),
   a demo artifact in the product. Removed; the logo still reflects *real* global loading.

### Still misleading — not yet fixed

| Issue | Location | Why it matters |
|---|---|---|
**All seven below are now FIXED** (Stage 1 + Stage 3, 2026-07-23). Kept with their original
diagnosis because the diagnosis is the useful part — and because two of them were misdiagnosed here
as "just add a link", which is recorded in the roadmap's post-mortems.

| Issue | Original location | Why it mattered → resolution |
|---|---|---|
| ~~**`SendPrButton` is unreachable**~~ | `send-pr-button.tsx`, call site `services-workspace.tsx:1001` | Rendered only when `!realMode`, where `containerId` is hardcoded `null` → always the disabled shell. **Fixed `1192d37`:** gate 2 moved to the Services work-item panel, which already holds the real container; the dead `!realMode` branch was bypassed, not revived. |
| ~~**`ApproveSolutionButton` effectively unreachable**~~ | `pr-panel.tsx:122-133` | Believed to need `/agents?container=<id>`, a URL nothing generates. **That diagnosis was wrong:** `ServiceReviewRow.id` is a *Review* id while approve/send read the `IssueContainer` table, so the link would have 404'd. **Fixed `1192d37`** by carrying the container's stored state to the panel instead. |
| ~~**Scan uses a blind timer**~~ | `services-workspace.tsx:1076` | `setTimeout(reload, 1500)` unconnected to completion. **Fixed `e0a3f65`:** watches the real `ScanRun` via `scanIdentity(status, finishedAt)`, bounded at 90s with an honest "stopped watching". |
| ~~**Fix/Dismiss full-page reload**~~ | `services-workspace.tsx:1183` | Lost rail expansion, selection, stream position. **Fixed `e0a3f65`:** `router.refresh()`, with the spinner recomposed from a transition so it cannot stick. |
| ~~**`synth-ledger.tsx` is dead code**~~ | exported, imported by nothing | **Deleted `e0a3f65`** — superseded, not merely unused: its spec'd "Ready for your approval" card was never wired, and that gate shipped on the Services panel. |
| ~~**"Back to Overview" → `/`**~~ | `reviews/[id]/page.tsx:96` | Pointed at the marketing root. **Fixed `e0a3f65`.** |
| ~~**"Explore with sample data →"**~~ | `connections/[id]/page.tsx:129-131` | Promised sample data `/overview` does not have. **Fixed `e0a3f65`** — reworded, keeping the escape hatch and dropping the false promise. |

---

## 3. Built in the backend, no UI at all

Complete, tested capabilities a human simply cannot reach.

| # | Capability | Evidence | Where the UI belongs |
|---|---|---|---|
| A1 | **`ApprovalPrompt` — the HITL approval gate** | Model `schema.prisma:336-350`; handler → queue → `startApprovalWorker` (`worker.ts:439`) → agents `/approvals/apply`. **Zero** dashboard references. | `reviews/[id]` approvals panel + a session-scoped proxy route |
| A2 | **Outbound webhooks** (`WebhookEndpoint`/`WebhookDelivery`) | Signing, backoff, SSRF-guarded delivery, Prisma store, real emission on every review (`persistence.ts:239-256`). Management API **deliberately unmounted** (`server.ts:408-414`). | Settings → Webhooks + deliveries table |
| A3 | **`AgentMemory`** | Write path real (`memory-write.ts:104,248`), read-back into review context. Zero dashboard references. **Functional dead-end:** cap is 20 rows and nothing ever sets `status='archived'` — a repo freezes at 20 memories with no eviction. | Repository settings → "What Kuma has learned", with archive |
| A4 | **`/metrics/stream` SSE — self-described "dark wire"** | `agent-metrics.ts:4`, mounted `server.ts:428`. No dashboard consumer. | Overview live-throughput tile (needs a server-side proxy; internal token) |
| A5 | ~~**Outbound retry worker never started**~~ **CLOSED** | `worker.ts:18` imports and `worker.ts:451` calls `startOutboundRetryWorker()`; `outbound/retry-worker.wiring.test.ts` is a regression guard for exactly this defect ("existed, was correct, and was never called by anything"). | Done — wired in `worker.ts` as prescribed |

**A5 was a correctness bug, not just a gap** — a failed delivery wrote `nextAttempt` to Postgres and
was never retried. **Resolved** (verified 2026-07-23, Stage 4.2); the Phase-1 exit criterion it
blocked is met. A1 is also now closed — see the approvals rail (`a21f956`), which added both the
session-scoped proxy this table asked for *and* a reject route, since nothing in the system could
ever write `REJECTED`.

---

## 4. Partially wired — needs finishing

| # | Item | Gap |
|---|---|---|
| B1 | ~~**Manual investigations dead-end**~~ **CLOSED** (Stage 3.2, `98562e8`) | `createManualIncident` now calls `requestIncidentRouting`, which reaches the SAME `routeIncidentToFix` via a new internal-token webhook route `POST /incidents/:id/route` — a transport, not a reimplementation, so both paths share one policy. A `warning` investigation still does not start a fix: the router opens fixes only for critical+firing, and that policy was deliberately left to the webhook lane. |
| B2 | **OTel/ClickHouse is 95% dark** | Exactly one metric reaches the UI (`getAgentEventsPerMinute`). No trace view, no span drill-down, no log search, no Jaeger deep-link. Blocks telemetry-fed investigations. |
| B3 | **Confidence unsurfaced on reviews** | Real and rendered on scan/fix (0–1 → %), but `ReviewComment` has **no confidence column**, so PR findings show none. |
| B4 | ~~**Noise state machine invisible**~~ **CLOSED** (Stage 1.4, `601784e`) | `POST /api/findings/[id]/noise` + `FindingNoiseControl` on `reviews/[id]`. A human may set only `OPEN`/`SILENCED`; `UNDER_OBSERVATION`/`ESCALATED` stay the escalation machine's and render as read-only labels. The `OPEN` filter was kept — it is the mechanism that makes silencing mean something, not the obstacle. Known limit: restoring returns a finding to `OPEN`, never to a guessed prior machine state. |
| B5 | **`TelemetrySnapshotRecord` is "as of last review"** | Not a history table; no background poller. The Grid can show arbitrarily stale data with no indication beyond `fetchedAt`. |
| B6 | **MCP is consume-only, CLI-only** | No dashboard surface to add/list MCP servers. Tokens persist as plaintext JSON in `.agents/mcp_servers.json`. |
| B7 | **`SecurityAssessor` returns fabricated results** | `skills/security.py:12` — "returns **simulated** results", string-matched off the skill filename. The one live fabrication left in `packages/agents`. **Must not be surfaced in UI as-is.** |
| B8 | ~~**`INTERNAL_API_TOKEN` has no expiry**~~ **CLOSED for the internal token** (verified 2026-07-23) | Now a minted, verified JWT: `packages/internal-token/src/mint.ts:15` issues `{iss, aud: 'arete-internal', iat, exp}` (120s default TTL, `INTERNAL_TOKEN_TTL_SECONDS`); `webhook/src/internal-auth.ts:54` verifies via `verifyInternalToken` — 401 for signature/expired/wrong-audience without distinguishing, 503 when the keyset is unconfigured. The "resolve before adding those proxies" precondition is met, which is what let A1's approval proxy ship. **The MCP token half remains open** (see B6 and backlog Phase-2b item 1). |

---

## 5. Not built — roadmap future

| # | Item | Phase |
|---|---|---|
| C1 | Slack / Linear / PagerDuty relays | P2 — **blocked on A2 + A5** |
| C2 | API-key store + read/management REST | P3.1–3.3 |
| C3 | Issue-filter clause model (review scope) | P1.5 |
| C4 | Areté-as-MCP-server (the inversion) | P3.4 |
| C5 | `Review.prUrl` + resolve/noise reason codes | P1.6 |
| C6 | Telemetry ingestion platform (OTLP, ingest keys, alert rules, service map) | P4 — deliberately deferred |

---

## 6. The roadmap is stale — correct before planning off it

Three items the roadmap still lists as unstarted are **done**:

- **P1.3 `approval-exec` worker** now has a consumer (`worker.ts:439`), contradicting
  roadmap line 61's "no consumer".
- **P1.4 AgentMemory write-back** is real (`memory-write.ts`), not a stub.
- The **`review-pr-heavy` queue's missing consumer** (still open at `backlog.md:149-153`)
  was fixed by `startReviewWorkers` (`worker.ts:403-423`).

Also: every *dashboard* API route has a caller — all 17 verified. The orphan-route
problem is on the **webhook** service (A1, A2, A4).

---

## 7. Suggested order

1. **A5 retry worker** — one line, fixes a silent data-loss bug, unblocks all of Phase 2.
2. **B1 manual-investigation fix action** — makes the Incidents surface drivable.
3. **B8 internal-token expiry** — before building proxies that depend on it.
4. **A1 approvals panel** — surfaces the HITL moat, the product's stated differentiator.
5. **A2 webhook management UI** — then Slack/Linear relays become thin consumers.
