# Design References Index

This directory holds screenshots of other products (mainly SuperLog) used as UI/UX reference while building Areté's connector and dashboard experience. **Read this file before building anything from a reference batch below** — it tells you what's already real in this codebase, what has a backend but no UI yet, and what's speculative work you should not build without checking with the team first.

Other agents working on the dashboard UI (see `.claude/ade-coordination.md`): this file is your map of what backend capability actually exists to build against.

---

## ⚠️ Before you build: sync with main first

As of 2026-07-11, `packages/webhook/` has grown substantially — a full telemetry connector pipeline (5 providers), a generic OAuth engine, and billing enforcement all landed in the same session these references were gathered in. If your branch predates this work, **merge/rebase `main` before wiring any UI to these APIs** — the routes and data shapes described below did not exist a day earlier.

---

## Reference batch: `superlog-connect-flow/`

Screenshots of SuperLog's "Connect your data" flow — the multi-source picker (AWS, Cloudflare, Vercel, Railway, Render, "hosted elsewhere" via coding agent), the individual per-provider OAuth consent screens, and the resulting success state.

**What this maps to in Areté, and what's real:**

| UI concept in the reference | Backend status | Notes |
|---|---|---|
| "Connect your data" picker (multi-source list) | ❌ No UI exists | Backend supports listing/dispatching by provider (`fetchTelemetryContext`), but there is no settings page listing available connectors at all. |
| Per-provider OAuth "Connect X" button + redirect | ✅ Real, backend-only | `GET /oauth/:provider/authorize` and `/oauth/:provider/callback` exist and work (generic OAuth engine, `packages/webhook/src/oauth/`). Currently wired for `vercel` and `posthog` only — **no real Vercel/PostHog OAuth app is registered yet**, so these routes will 500 until that's done (see `.env.example` for the `VERCEL_OAUTH_CLIENT_ID` etc. vars that need real values). |
| API-key paste (Render-style "paste a key") | ✅ Real, backend-only | 5 API-key connectors exist (GitHub Actions, PostHog, Sentry, Vercel, Stripe) — `packages/webhook/src/telemetry/*-connector.ts`. No UI to paste a key exists; a `TelemetryConnection` row must currently be created by hand/script. |
| "I'm hosted elsewhere" → coding-agent install (`npx skills add ...`) | ❌ Speculative, no backend | Nothing like this exists. Do not build — it implies an SDK/instrumentation product Areté doesn't have. |
| "You're connected" success state | ⚠️ Partial | The OAuth callback redirects to `/settings/connections?connected=<provider>` on success — that route/page does not exist yet. The redirect target needs a page built. |

**Bottom line for this batch:** the *mechanism* (OAuth flow, API-key storage, encryption) is real and tested (172 webhook tests). The *picker UI* and *settings page* are 100% unbuilt. This is the highest-value UI to build next, since it directly activates already-working backend.

---

## Reference batch: `superlog-widgets-and-settings/`

Two different things live here — read the per-image note, they're not interchangeable:

### `01-arete-branded-dashboard-mockup.png`
This is a **mockup already branded as Areté** (not a SuperLog screenshot) — it shows a dashboard overview with metric tiles ("5 critical issues caught, 10 pull requests reviewed"), an "Agents at work" orchestration graph, a "Comments by Category" bar chart, and — notably — a row of connector cards for exactly our 5 providers (GitHub Actions, PostHog, Sentry, Vercel, Stripe) each with a "Connect →" link. This is the closest existing reference to what the real Master Grid should look like.

| Widget in the mockup | Backend status |
|---|---|
| Metric tiles (PRs reviewed, critical issues) | ✅ Real — `packages/dashboard` already computes these from Prisma (`getDashboardViewModel`) |
| "Comments by Category" bar chart | ✅ Real — same query layer already groups `ReviewComment` by category |
| "Agents at work" animated orchestration graph | ❌ Decorative only if built as shown — there is no live agent-status feed. A prior dashboard-UI branch built a similar graph as a static/animated SVG with hardcoded nodes, not real-time data. Don't imply live status unless a real signal backs it. |
| Connector "Connect →" cards row | ⚠️ Partial — the 5 connectors are real, but no UI enumerates them or links to a working connect flow yet (see `superlog-connect-flow` notes above). Building this row is legitimate and high-value **once** the connect-flow page exists to link to. |

### `02-` and `03-superlog-overview-incidents-servicemap*.png`
SuperLog's actual product — "Active Critical Incidents" panel and a "Service map" ("map your system" from connected cloud inventory).

| Concept | Backend status |
|---|---|
| "Active Critical Incidents" | ❌ **Speculative — no incident model exists.** Areté has `Review` and `ReviewComment` (PR-review findings), not an incident/alerting concept. Do not build an "incidents" panel; it would have nothing real to show. |
| "Service map" auto-discovered from cloud inventory | ❌ **Speculative — Phase 2/3.** No inventory-discovery capability exists anywhere in this codebase. This is exactly the kind of feature that looks buildable from a screenshot but has zero backing data model. |

**Bottom line for this batch:** the metric-tile and comments-by-category widgets are safe to build now (real data exists). The agent-status graph should stay decorative or be cut. Incidents and service-map are Phase 2/3 concepts with no backend — do not build them from these screenshots without a data-model discussion first.

---

## What's already built (backend, tested) — safe to build UI against today

- **5 telemetry connectors**, API-key auth: GitHub Actions, PostHog, Sentry, Vercel, Stripe (`packages/webhook/src/telemetry/`)
- **Generic OAuth engine**: authorize → callback → encrypted token storage → transparent refresh (`packages/webhook/src/oauth/`) — routes exist, real provider app registration still pending (see warning above)
- **Stripe billing enforcement**: 50-review free tier (usage-count based, not time-based), gated before every review runs (`packages/webhook/src/billing.ts`). The authoritative "has an active paid plan" signal is `Installation.subscriptionStatus === 'active'` — note `Installation.planTier` exists in the schema but is **never written anywhere** yet, so don't build UI that reads `planTier` expecting it to reflect a real purchased tier.
- **Dashboard metrics** (`packages/dashboard`): PR count, critical-bug count, category breakdown, recent activity — all real Prisma queries, tenant-scoped via NextAuth + `Installation`.

## Real but not built (backend exists, zero UI)

- A settings/connections page (OAuth "Connect" buttons + API-key paste forms)
- A billing/plan management page for customers (webhook handling exists; no customer-facing page)
- The `/settings/connections?connected=<provider>` landing page the OAuth callback already redirects to

## Speculative — do not build without a backend/data-model discussion first

- **Alerting / notification rules** — no backend, Slack was explicitly deferred this session as "a different shape" of connector (outbound delivery, not inbound telemetry)
- **Incidents as a first-class concept** — no data model; Areté's closest concept is `Review`/`ReviewComment`, which are PR-review findings, not production incidents
- **Auto-discovered service map** — no inventory-discovery capability anywhere
- **Widget builder / custom dashboard layout** — no data model for user-configurable layouts
- **Coding-agent-based install/instrumentation** — implies an SDK product Areté doesn't have

---

*Last updated: 2026-07-11, alongside the telemetry connector + OAuth engine backend work. If you're reading this significantly later, verify the "real" claims above against current `main` — this file describes a snapshot, not a live status.*
