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
| `/incidents/[id]` | **Partial** | Mark/unmark noise, View fix run, scrubbed payload tables | A **manual** investigation can't be driven — no "start fix" action (§4 B1) |
| `/settings` | **Live** | Connect GitHub OAuth, workspace links, real billing usage | No self-serve upgrade — stated honestly, no fake button |
| `/overview` | **Partial** | Stat tiles, Sensorium map, setup checklist from real DB facts, preset tabs, time range | 2 checklist sub-steps marked Coming soon; telemetry "planned" connectors inert |
| `/agents` | **Partial** | Agent chat is genuinely live (402/503 surfaced honestly), findings from real data | **All** config controls unsaved; Approve-solution effectively unreachable (§2) |
| `/services` | **Partial** | Rail, SSE synthesizer console, StatusBoard, Scan, Fix it, Dismiss | Entire PR-send workflow stubbed or unreachable (§2) |
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
| **`SendPrButton` is unreachable** | `send-pr-button.tsx` (128 lines), only call site `services-workspace.tsx:1001` | Rendered only when `!realMode`, where `containerId` is hardcoded `null` → always falls through to the disabled shell. A fully-built `POST /api/containers/[id]/send` can never fire from the app. |
| **`ApproveSolutionButton` effectively unreachable** | `pr-panel.tsx:122-133` | Needs `/agents?container=<id>`; **no link in the codebase generates that URL** (only `/services?container=`). Reachable only by hand-typed URL. |
| **Scan uses a blind timer** | `services-workspace.tsx:1076` | `setTimeout(reload, 1500)` is unconnected to scan completion — a slower scan reloads into stale state. |
| **Fix/Dismiss full-page reload** | `services-workspace.tsx:1183` | `window.location.reload()` is the only feedback; loses rail expansion, selection, stream position. |
| **`synth-ledger.tsx` is dead code** | exported, imported by nothing | — |
| **"Back to Overview" → `/`** | `reviews/[id]/page.tsx:96` | Points at the marketing root, not `/overview`. |
| **"Explore with sample data →"** | `connections/[id]/page.tsx:129-131` | Links to `/overview`, which never shows sample data. Stale copy. |

---

## 3. Built in the backend, no UI at all

Complete, tested capabilities a human simply cannot reach.

| # | Capability | Evidence | Where the UI belongs |
|---|---|---|---|
| A1 | **`ApprovalPrompt` — the HITL approval gate** | Model `schema.prisma:336-350`; handler → queue → `startApprovalWorker` (`worker.ts:439`) → agents `/approvals/apply`. **Zero** dashboard references. | `reviews/[id]` approvals panel + a session-scoped proxy route |
| A2 | **Outbound webhooks** (`WebhookEndpoint`/`WebhookDelivery`) | Signing, backoff, SSRF-guarded delivery, Prisma store, real emission on every review (`persistence.ts:239-256`). Management API **deliberately unmounted** (`server.ts:408-414`). | Settings → Webhooks + deliveries table |
| A3 | **`AgentMemory`** | Write path real (`memory-write.ts:104,248`), read-back into review context. Zero dashboard references. **Functional dead-end:** cap is 20 rows and nothing ever sets `status='archived'` — a repo freezes at 20 memories with no eviction. | Repository settings → "What Kuma has learned", with archive |
| A4 | **`/metrics/stream` SSE — self-described "dark wire"** | `agent-metrics.ts:4`, mounted `server.ts:428`. No dashboard consumer. | Overview live-throughput tile (needs a server-side proxy; internal token) |
| A5 | **Outbound retry worker never started** | `retry-worker.ts:45` `startRetryWorker` has **no caller**. | `worker.ts`, beside `startApprovalWorker()` |

**A5 is a correctness bug, not just a gap:** a failed delivery writes `nextAttempt` to
Postgres and is never retried. It is the last unmet Phase-1 exit criterion.

---

## 4. Partially wired — needs finishing

| # | Item | Gap |
|---|---|---|
| B1 | **Manual investigations dead-end** | The alert path (`receiver.ts` → `routeIncidentToFix`) creates WorkItem + container + fix drive. The UI path (`createManualIncident`) writes an `Incident` and **never calls `routeIncidentToFix`**. A hand-opened investigation can only be marked noise. |
| B2 | **OTel/ClickHouse is 95% dark** | Exactly one metric reaches the UI (`getAgentEventsPerMinute`). No trace view, no span drill-down, no log search, no Jaeger deep-link. Blocks telemetry-fed investigations. |
| B3 | **Confidence unsurfaced on reviews** | Real and rendered on scan/fix (0–1 → %), but `ReviewComment` has **no confidence column**, so PR findings show none. |
| B4 | **Noise state machine invisible** | `noiseState`/`escalateOn`/`threshold`/`occurrenceCount` + inline escalation all exist; the dashboard only *filters* on `OPEN`. No human can silence or un-silence a finding. |
| B5 | **`TelemetrySnapshotRecord` is "as of last review"** | Not a history table; no background poller. The Grid can show arbitrarily stale data with no indication beyond `fetchedAt`. |
| B6 | **MCP is consume-only, CLI-only** | No dashboard surface to add/list MCP servers. Tokens persist as plaintext JSON in `.agents/mcp_servers.json`. |
| B7 | **`SecurityAssessor` returns fabricated results** | `skills/security.py:12` — "returns **simulated** results", string-matched off the skill filename. The one live fabrication left in `packages/agents`. **Must not be surfaced in UI as-is.** |
| B8 | **`INTERNAL_API_TOKEN` has no expiry** | One static shared secret, no rotation/revocation — and expiry is *not expressible* in the current code path. Guards every route A1/A4 would need a proxy for. **Resolve before adding those proxies.** |

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

---

## Where these ids now live (added 2026-07-22)

Every id above (A1–A5, B1–B8, C1–C6) is now carried as a `ref` on a row in
`packages/dashboard/src/lib/feature-readiness.ts`, which the product renders at `/build-status`.
That file is the master list; this document remains the evidence behind it.

Two notes recorded rather than silently applied:

- §6's staleness warning is honoured by marking affected rows `needsVerification` — the original
  claims are left unedited so a human resolves them with evidence.
- The "Discovered / unscheduled" SSE hardening item in `docs/roadmap/backlog.md` was re-checked and
  is **already fixed** (`packages/webhook/src/sse-handler.ts:14-16` now requires the internal token
  and sets no wildcard CORS header), so it was deliberately not added as an open row.
