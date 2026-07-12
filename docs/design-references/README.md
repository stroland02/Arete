# Design References Index

Screenshots of other products (mainly SuperLog) used as direct UI/UX reference
while building Areté's connector and dashboard experience, gathered across two
parallel agent sessions and merged into one index. **Read this file before
building or changing any dashboard page** — it tells you what's already real
in this codebase, what has a backend but no UI yet, and what's speculative
work you should not build without checking with the team first.

Companion specs: `docs/superpowers/specs/2026-07-10-telemetry-connectors-design.md`
(connectors), `docs/superpowers/specs/2026-07-11-dashboard-ui-port-design.md`
(auth/tenancy), `docs/proposal/TYME-platform-proposal.md` (full product
vision — "Master Grid").

---

## ⚠️ Status as of 2026-07-12 — read this first

Two things changed since the batches below were first annotated:

1. **The Phase 1 dashboard pages are now built.** Connections
   (`packages/dashboard/src/app/(dashboard)/connections/`), Review Detail
   (`.../reviews/[id]/page.tsx`), Review History (`.../history/page.tsx`),
   and Settings (`.../settings/page.tsx`) all exist and read real Prisma data
   (`packages/dashboard/src/lib/queries.ts`). Where a section below says
   "no UI exists yet," that describes the state *when the reference batch was
   gathered*, not the current state — check the codebase, not this file, for
   final confirmation.
2. **Known unresolved gap:** the OAuth callback
   (`packages/webhook/src/oauth/oauth-callback-handler.ts`) redirects to
   `/settings/connections?connected=<provider>` on success. The Connections
   page that was actually built lives at `/connections` (not
   `/settings/connections`). Nobody has reconciled this yet — either the
   dashboard route needs to move under `/settings/connections`, or the
   backend redirect needs to change. Flag this to whoever picks up OAuth
   wiring next; don't silently "fix" it by guessing which side is right.

Other real backend caveats that still apply:
- No real Vercel/PostHog OAuth app is registered yet — those `authorize`/
  `callback` routes will 500 until real client IDs/secrets are configured
  (see `.env.example`).
- `Installation.planTier` exists in the schema but is **never written
  anywhere** — `Installation.subscriptionStatus === 'active'` is the only
  authoritative "has an active paid plan" signal. Don't build or reintroduce
  UI that reads `planTier` expecting it to reflect a real purchased tier.

---

## Reference batch: `superlog-connect-flow/` — Connections page (built)

Two screenshot sets were gathered independently, with different filenames —
both kept, neither overwrote the other:
- `01-connect-your-data-list.png`, `02-connect-aws.png`,
  `03-connect-cloudflare.png`, `04-connect-vercel.png`,
  `05-install-code-agent.png` — the list pattern (icon, name, one-line
  description, chevron) and per-provider detail screen (trust note,
  requirement disclosure, waiting-state CTA).
- `01-loading-state.png` through `11-install-via-coding-agent.png` — a fuller
  walkthrough: the multi-source picker, per-provider OAuth consent screens,
  a Vercel Marketplace "add integration" screen, permissions/scopes, and the
  "you're connected" success state.

**What this maps to in Areté:**

| UI concept | Backend status | Notes |
|---|---|---|
| "Connect your data" picker (multi-source list) | ✅ Built | `/connections` list page, reading a static catalog at `packages/dashboard/src/lib/connector-catalog.ts` (the honest source of truth for the 5 real connectors: GitHub Actions, PostHog, Sentry, Vercel, Stripe). |
| Per-provider detail screen | ✅ Built | `/connections/[id]`, with trust note, requirement disclosure, and an intentionally-disabled connect CTA (`title="Connections aren't wired to a live backend yet"`) — no `TelemetryConnection` UI-side wiring exists yet, so it does not pretend to be connected. |
| Per-provider OAuth "Connect X" button + redirect | ✅ Real, backend-only | `GET /oauth/:provider/authorize` and `/oauth/:provider/callback` exist and work (generic OAuth engine, `packages/webhook/src/oauth/`), wired for `vercel` and `posthog`. See the redirect-target gap flagged above. |
| API-key paste (Render-style "paste a key") | ✅ Real, backend-only | 5 API-key connectors exist (`packages/webhook/src/telemetry/*-connector.ts`). No UI to paste a key exists yet; a `TelemetryConnection` row must currently be created by hand/script. |
| "I'm hosted elsewhere" → coding-agent install (`npx skills add ...`) | ❌ Speculative, no backend | Do not build — implies an SDK/instrumentation product Areté doesn't have. |
| "You're connected" success state | ⚠️ Partial | See the redirect-target gap above — the landing page the callback redirects to doesn't match the page that was built. |

**Bottom line:** the OAuth/API-key mechanism is real and tested (172 webhook
tests); the picker/detail UI is now built too. The main remaining gap is the
redirect-target mismatch, plus registering real OAuth apps for Vercel/PostHog.

## Reference batch: `superlog-product/` — Review detail page (built) + future Master Grid

SuperLog's actual product UI (Overview, Issues, Alerts, Explore). The most
valuable pattern here — **the incident detail page** — is now ported into
Areté as the **Review Detail page**
(`packages/dashboard/src/app/(dashboard)/reviews/[id]/page.tsx`), reading a
tenant-scoped `getReviewDetail` query. `ActivityList` rows link to it for real.

Ported so far: metadata sidebar (status, repo, PR #, finding count,
reviewed-at) + a Summary panel + a Findings list (path:line, category,
severity — reusing existing colors, not a new palette).

**Not yet ported — real opportunities for future work:**
- `04-incident-detail-activity.png` — an **Activity tab** (a timeline: "Issue
  detected 25d ago" → trace/error badge → occurrence count). Areté has no
  event-timeline model yet (only one `createdAt` per Review) — needs new
  data, not just UI.
- `05-incident-detail-findings.png` — an AI finding with a confidence badge
  ("RECOVERY DETECTED · HIGH CONFIDENCE") + "Dismiss/Confirm resolution"
  actions. Areté's `overallSummary` is a single text blob, not
  discrete confidence-scored findings with actions — a real backend change.
- `06-incident-detail-pr-tab.png` — a **PR tab**. Areté's "PR" *is* the
  review itself (the review posts as PR comments); `Review` has no stored PR
  URL today — a link back to the GitHub/GitLab PR would need a small schema
  addition.
- Bottom-of-page chat/"start an investigation" box — matches the
  `ARCH_VISUALIZATION_HANDOFF.md` note that `overallSummary` will eventually
  carry Mermaid diagrams; a conversational follow-up UI is a natural later fit.

Other pages in this folder are **Phase 2/3 "Master Grid" territory** (see the
proposal's Master Grid section), not current scope:
- `01-overview-sample-data-banner.png` — "You're exploring sample data.
  Connect your own app →" — a good, honest pattern worth reusing if Overview
  is ever shown with obviously-fake demo data.
- `02-install-superlog-agent-prompt.png`, `03-deploy-waiting-for-event.png` —
  the "paste into your coding agent, then wait for the first event"
  onboarding loop. Same pattern as the Connections "hosted elsewhere" idea.
- `07-alerts-empty-state.png`, `08-alert-builder.png` — a full alerting-rule
  builder. See `superlog-alerting/` below — no backend, do not build.
- `09-explore-logs.png`, `10-explore-traces.png`, `11-explore-metrics.png` —
  a raw telemetry explorer. See `superlog-raw-telemetry-explorer/` below.
- `12-explore-resources.png` — "No AWS account connected yet." — same honest
  not-connected pattern as Connections; reusable for a future cloud-resource
  inventory feature.

## Reference batch: `superlog-widgets-and-settings/` — Settings page (built) + future custom dashboards

Two independently-gathered screenshot sets live here, numbered similarly but
different content — read the per-image note, they're not interchangeable.

**Settings reference (this is what the built Settings page draws from):**
- `05-settings-project-general.png`, `19-settings-project-general-2.png` —
  Project-level settings: name, slug, a free-text "context" field prepended
  to agent runs (Areté equivalent: could hold repo-specific review guidance).
- `06-settings-org-general.png` — Org name/slug + "create another
  organization" — relevant once Settings needs multi-org management (Areté
  already supports a user belonging to multiple installations via
  `AuthorizedInstallation[]`).
- `07-settings-org-members.png` — invite-by-email + role picker + members
  list. No team/member-invite model exists yet — UI-only reference.
- `08-settings-org-billing.png` — current plan card + usage meters + current
  bill. **Built**: the Settings page's Billing card reads real
  `subscriptionStatus`/usage data via `getInstallationBilling`
  (`packages/webhook/src/billing.ts`, `packages/dashboard/src/lib/queries.ts`).
  No self-serve upgrade/checkout exists — the built page says so honestly
  instead of showing a dead button.
- `09-settings-org-agent-guidance.png` — free-text "guidance prepended to
  every agent run." Areté's `.arete.yml` serves a similar purpose — good
  reference for a future in-app editor instead of raw YAML file edits.
- `10-settings-project-integrations.png` — per-integration cards, each with a
  one-line "why this matters" + Connect button + status dot. Same honest
  pattern as Connections — if Settings ever needs its own integrations
  sub-section, reuse this card style.
- `11-settings-project-issue-filter.png` — include/exclude tag filters with
  an explicit "how these combine" rules callout. Good reference for
  explaining any future rules-based review-scope config.
- `12-settings-project-install-mcp.png`, `13-settings-project-mcp-tokens.png`
  — MCP server connection instructions + PAT management. Not applicable
  today (Areté is an MCP *client*, not a server others connect to).
- `14-org-switcher.png` — command-palette-style org switcher. Reusable for
  `InstallationSwitcher` if it ever needs to scale past a simple `<select>`.

**Also present:** `01-arete-branded-dashboard-mockup.png` (an Areté-branded
concept mockup showing metric tiles, an "Agents at work" graph, a
"Comments by Category" chart, and a connector-cards row — this shaped what
the built Overview and Connections pages look like) and
`02-`/`03-superlog-overview-incidents-servicemap*.png` (SuperLog's actual
"Active Critical Incidents" panel + "Service map" — **speculative, no
backend**: Areté has `Review`/`ReviewComment`, not an incident/alerting
concept, and no inventory-discovery capability anywhere; do not build these).

**Widget builder reference (Phase 2/3 "Master Grid" — not current scope):**
- `01-add-widget-chart-source.png`/`02-add-widget-chart-type-options.png`
  (and the `-2` duplicates) — a widget editor: pick source, group-by,
  filters, chart type, formatting, live preview.
- `03-add-widget-table.png` (and `-2`) — same editor, Table variant.
- `04-add-widget-note-markdown.png` (and `-2`) — same editor, freeform
  Markdown "Note" widget.

Maps to the proposal's Phase 2 **Master Grid dashboard** — not needed for
Phase 1's fixed Overview/Connections/Review-detail/History/Settings pages.
Don't build a generic widget system speculatively.

## Reference batch: `superlog-review-detail/` — superseded by the built Review Detail page

Header (title, service, environment, priority, status), an Activity tab
(trace/error timeline), a Findings tab, a PR tab. This is the same subject as
`superlog-product/`'s incident-detail screenshots above, gathered
independently — see that section for current build status. Confirms the same
per-element mapping:

| Element | Backend status |
|---|---|
| Title/summary header | ✅ Real — `Review.overallSummary`, `Review.riskLevel` — and now rendered in the built Review Detail page |
| Activity/timeline tab | ⚠️ Partial — `ReviewComment.createdAt` exists per comment, but there's no "Issue detected"/"Recovery detected" lifecycle event model, only a flat comment list |
| Findings tab | ✅ Real and built — `ReviewComment[]`, rendered as the Findings list |
| PR tab | ⚠️ N/A as shown — Areté's "PR" *is* the review itself; a link back to the GitHub/GitLab PR URL isn't currently stored on `Review` — would need a small schema addition |

## Reference batch: `superlog-billing-settings/` — superseded by the built Settings page

Org-level billing settings: current plan, usage bars, current bill estimate.
`packages/webhook/src/stripe-handler.ts` and `billing.ts` keep
`subscriptionStatus`/usage data real and current; the built Settings page's
Billing card reads exactly that (simplified to plan status + reviews-used vs.
the 50-review free tier — no per-resource usage bars, since Areté prices
per-review, not per-span/log/metric-point like SuperLog).

## Reference batch: `superlog-settings-integrations/`

Mixed batch: general project settings (name/slug/context — mostly not
applicable to Areté's model), a per-project "Integrations" card grid, an
"Install MCP server" page, and an org switcher. The **Integrations card
grid** is the same underlying concept as `superlog-connect-flow/` — same
backend-reality notes apply. The **MCP server install** page and **org
switcher** don't map to anything in Areté's product today (Areté doesn't
expose an MCP server to its own customers, and multi-org switching isn't a
modeled concept — `Installation` is 1:1 with a GitHub/GitLab install) — treat
as non-applicable reference, not a build target.

## Reference batch: `superlog-alerting/` — speculative, no backend

Empty "Alerts" page with a "+ new alert" CTA. **Do not build this.** No
alert-rule data model, no notification-delivery mechanism (Slack was
explicitly scoped out as a future, structurally-different outbound connector,
not built), no evaluation engine to trigger an alert from. Phase 2/3 territory.

## Reference batch: `superlog-raw-telemetry-explorer/` — speculative, no backend

A generic log/trace/metric explorer (facets, severity filters, a raw events
table). Areté has no equivalent: the 5 telemetry connectors fetch a small,
purpose-built summary (`TelemetrySnapshot`) for one PR's review, not a
queryable raw event store. Do not build without an ingestion/storage/query
layer discussion first.

## Reference batch: `superlog-widget-builder/` — speculative, no backend

Dashboard list/creation UI, an "add widget" modal, a "new variable" modal for
dashboard filters. A full user-configurable-dashboard product surface. Areté's
dashboard is currently fixed pages with fixed queries — no concept of a
user-created dashboard, saved widget, or variable exists. The most
speculative batch here; do not build any part of it without a real
design/data-model discussion, since it implies a materially different
product (self-serve BI tool) than what's built.

---

## What's already built (backend, tested) — safe to build UI against today

- **5 telemetry connectors**, API-key auth: GitHub Actions, PostHog, Sentry,
  Vercel, Stripe (`packages/webhook/src/telemetry/`)
- **Generic OAuth engine**: authorize → callback → encrypted token storage →
  transparent refresh (`packages/webhook/src/oauth/`) — routes exist, real
  provider app registration still pending
- **Stripe billing enforcement**: 50-review free tier, gated before every
  review runs (`packages/webhook/src/billing.ts`)
- **Dashboard metrics, Connections, Review Detail, Review History, Settings**
  (`packages/dashboard`) — all real Prisma queries, tenant-scoped via
  NextAuth + `Installation`

## Known gaps

- The OAuth callback redirect target vs. the built Connections route path —
  see the ⚠️ status note at the top of this file
- No real Vercel/PostHog OAuth app registered yet (routes will 500 until
  configured)
- No UI to paste an API key for the 4 API-key connectors — a
  `TelemetryConnection` row must currently be created by hand/script

## Speculative — do not build without a backend/data-model discussion first

- **Alerting / notification rules** (`superlog-alerting/`) — no backend
- **Raw telemetry explorer** (`superlog-raw-telemetry-explorer/`) — no
  queryable event store
- **Widget builder / user-configurable dashboards**
  (`superlog-widget-builder/`) — no concept of a saved dashboard, widget, or
  variable; implies a different product than what's built
- **Incidents as a first-class concept** — Areté's closest concept is
  `Review`/`ReviewComment` (PR-review findings), not production incidents
- **Auto-discovered service map** — no inventory-discovery capability
  anywhere
- **Coding-agent-based install/instrumentation** — implies an SDK product
  Areté doesn't have

---

*Last updated: 2026-07-12, merging two independently-gathered reference
batches (one focused on what got built, one focused on backend-reality
annotations) into one index. If you're reading this significantly later,
verify the "real"/"built" claims above against current `main` — this file
describes a snapshot, not a live status.*
