# SuperLog Integration Analysis — Adopt / Adapt / Skip

**Date:** 2026-07-15 · **Author:** Engineer-1 (SuperLog Study) · **Baseline:** `origin/main`
**Deliverable for:** Project-Manager · **Status:** proposal (docs-lane); code items handed off as specs

---

## 0. What this is

A page-by-page study of the **SuperLog** product — its full public documentation
(Quickstart, Self-Hosting, Incidents, Agent Runs, Projects/Orgs, Telemetry/OTLP,
GitHub/Slack/Linear/AWS integrations, Dashboards, Alerts, Source Maps, Issue
Filters, Agent Memory, MCP Server + Tools, Ingest Keys, Agent Settings, Webhooks,
Management/Auth/Projects/API-Keys/Telemetry-Read API) plus the ~78 UI screenshots
under `docs/design-references/superlog-*/` — turned into an **adopt / adapt / skip**
decision for Areté, grounded in Areté's **actual** data model (verified against the
code, not self-reported).

It complements `docs/design-references/README.md` (a screenshot index with
backend-reality notes). Where that file annotates *pictures*, this file decides
*data models and behaviours* now that we have SuperLog's written docs, and lists
the concrete, low-risk **clear wins**.

**Method:** screenshots described page-by-page by four parallel readers; SuperLog
docs read in full; Areté's schema and agent internals verified by a repo sweep
(file:line evidence in §2). No claim below rests on a screenshot alone.

---

## 1. TL;DR

SuperLog is, almost exactly, **the product Areté's proposal describes as Phase 2/3**
(telemetry → incident → AI investigation → fix PR → human-in-the-loop), shipped as
an OTLP-native observability product. Areté's wedge is the *other* entry point to
the same OODA loop: **PR → multi-agent review → proposed fix → HITL approve**.

Because the loops rhyme, Areté has **already converged** on several SuperLog
primitives without copying them — `AgentMemory` (identical `kind` taxonomy),
`ApprovalPrompt` (the HITL fix-approval record), tenant `Installation` with
`planTier`/`subscriptionStatus`. That means the high-value moves are **not** "build
observability" — they're **finishing and hardening the loop Areté already has**,
using SuperLog's battle-tested schemas as the reference.

**Top decisions:**

| Rank | Item | Verdict | Why it's a clear win |
|---|---|---|---|
| 1 | **Outbound webhooks** (`review.created` / `review.updated` + `change.kind`, HMAC-signed, retried) | **ADOPT** | Areté has **zero** outbound webhooks today; SuperLog's design is directly transposable and unblocks Slack/PagerDuty/any relay without building each integration. Spec written: `docs/superpowers/specs/2026-07-15-outbound-webhooks-design.md`. |
| 2 | **Confidence scoring on findings** (`rootCause.confidence` 0–10 + `high/med/low`, "treat <4 as hypotheses") | **ADAPT** | Areté findings carry *no* confidence; the verify/drop pipeline already computes the signal, it's just not surfaced. Cheap, high-trust UX. |
| 3 | **Agent-Settings automerge policy** (`never` / `when_checks_pass` / `immediately` + method + base branch) | **ADAPT** | This is exactly the missing behaviour spec for Areté's **unfinished `approval-exec` worker** (residual #1). Adopt the config model wholesale. |
| 4 | **Finish `AgentMemory` write-back + explicit project context** | **ADAPT** | Areté already has the `AgentMemory` model and injects `project_memories`, but the write tool is a stub. SuperLog's lifecycle (dedupe-first, archive, 8k project-context-first) is the finishing spec. |
| 5 | **Issue-filter clause model** (include/exclude, excludes win, preview-before-save) | **ADAPT** | A clean model for review-*scope* control (paths/globs) to replace/augment `.arete.yml custom_rules`. |
| 6 | **PR URL + resolution vocabulary on `Review`/`ReviewComment`** | **ADAPT** | Small schema add; enables the "PR tab" back-link and honest resolve/noise reasons. |
| — | OTLP ingest, telemetry store, raw explorer, custom dashboards/widgets, alerts, source maps, AWS/service-map, ingest-key/project REST provisioning, coding-agent SDK install | **SKIP (now)** | Each implies a queryable telemetry store or a different product surface Areté deliberately deferred (proposal Phase 3). Not gaps — scope. |
| — | Slack / Linear outbound, Areté-as-MCP-server | **DEFER** | Reference-grade designs; unlocked *for free* once item #1 (outbound webhooks) exists. |

**Implemented in this pass (docs lane only):** this analysis, the outbound-webhooks
build spec, a ledger declaration, and a cross-link from the design-references
README. **No code** in `packages/*` was touched — those lanes belong to other
agents this wave; every code item is handed off as a declared spec (§5, §6).

---

## 2. Ground truth — Areté as it actually is (verified)

Everything below is checked against the code so the verdicts don't drift onto a
product Areté isn't. Evidence is file:line.

| Areté reality | Where | Bearing on SuperLog |
|---|---|---|
| `Review` = one PR review: `prNumber` (a **number, not a URL**), `riskLevel` (free string), `overallSummary`, `headSha`, `analysisStatus`. Unique `[repositoryId, prNumber, headSha]`. | `packages/db/prisma/schema.prisma:83-100` | SuperLog's incident ≈ Areté's Review, but Areté has **no stored PR URL, no severity enum, no lifecycle/timeline**. |
| `ReviewComment` = finding: `path`, `line`, `body`, `severity(info\|warning\|error)`, `category`; **noise machine** `noiseState(OPEN\|SILENCED\|UNDER_OBSERVATION\|ESCALATED)`, `escalateOn`, `threshold`, `occurrenceCount`. **No confidence field.** | `schema.prisma:102-119`; `packages/agents/src/arete_agents/models/review.py:21-33` | Areté already has a *noise state machine* richer than SuperLog's — but no per-finding **confidence**, which SuperLog leans on heavily. |
| `ApprovalPrompt` = HITL fix approval: `command`, `reason`, `status(PENDING→APPROVED→REJECTED→EXECUTED)`, `executedAt` (idempotency). | `schema.prisma:121-135` | This is Areté's analog of a fix-PR/agent-run approval — the surface SuperLog's **Agent Settings** page configures. |
| `AgentMemory`: `repositoryId`, **`kind(feedback\|terminology\|infra\|project)`**, `title`, `body`, `status(active)`. | `schema.prisma:137-150` | **Identical taxonomy to SuperLog's Agent Memory.** The model exists; the write-back is stubbed (below). |
| `Installation` (tenant): `subscriptionStatus` **and** `planTier` (both default `trialing`), `usageCount`, stripe ids. | `schema.prisma:23-41` | SuperLog's org/plan model already has a home in Areté. (Note: the README's "planTier never written" caveat — confirm before relying on it.) |
| Agent output `ReviewResult`: `verdict(pass\|comment\|review-required\|blocked)` via a **deterministic risk gate** + `verdict_reason`; drop counters `dropped_count` / `critic_dropped_count` / `citation_dropped_count` / `security_evidence_dropped_count`; `risk_level(low\|med\|high\|critical)`. | `review.py:50-92`; `verdict.py:4-30`; `critic.py:15-26` | The verify/drop machinery that *would* produce a confidence score already exists — it just emits keep/drop, not a graded number. |
| **`approval-exec` queue exists but has NO consumer.** Route `POST /api/approvals/:id/execute` flips status + enqueues; nothing dequeues. Python action tools are simulated stubs; `auto_resolver` is simulated; `memory.py` write-back only logs (doesn't persist to `AgentMemory`). | `server.ts:118-153`, `approval-handler.ts:39-79`, `queue.ts:25,127`, `worker.ts:296`; `tools/actions.py:12-72`, `auto_resolver.py`, `tools/memory.py:14-17` | The loop is **wired to the approval, then stops.** This is where SuperLog's Agent-Settings + Agent-Runs docs are most directly useful. |
| Repo guidance today: `.arete.yml` (`custom_rules`, `telemetry_connectors`, base-branch only) + repo `AGENTS.md`/`CONVENTIONS.md` → `repoConventions`; `project_memories` injected into prompts. | `pr-fetcher.ts:37,49-52,124-143`; `agents/base.py:97-104,159-160` | Areté already does "project context + memory injection" — but as file-derived text, not an explicit editable `project_context` field like SuperLog's. |
| 5 **pull-based** connectors (github-actions, posthog, sentry, stripe, vercel); **no OTLP ingest endpoint** anywhere (deferred by design). | `packages/webhook/src/telemetry/*`; `infra/otel-collector-config.yaml` (standalone, unwired) | Areté *pulls* a per-PR `TelemetrySnapshotRecord`; it does not *ingest/store* a telemetry stream. This is the biggest product-shape difference. |
| **No outbound webhooks.** HMAC is used only for *inbound* verification (Stripe) and internal OAuth-state signing. | `stripe-handler.ts:13-26`; `oauth/oauth-state.ts:1-32` | Clean-slate for the #1 adopt. |

---

## 3. Page-by-page: adopt / adapt / skip

Grouped by SuperLog doc area. Each row: the SuperLog concept, the verdict, and the
Areté-specific rationale. "Owner" names the package a code change would land in
(none are mine; see §5/§6).

### 3.1 Webhooks  — **ADOPT** (the standout)

SuperLog's outbound webhook page is the most directly transposable design in the
whole product. The model:

- **Exactly two events** — `incident.created` (new thread) and `incident.updated`
  (everything else, discriminated by a `change.kind`: `resolved` / `reopened` /
  `merged` / `agent_started` / `agent_completed` / `agent_failed` /
  `agent_awaiting_input`). Collapsing a combinatorial event list into 2 events +
  a discriminator is the key insight.
- **`message.{title, body}`** — pre-rendered, channel-neutral text you can forward
  verbatim to Slack/Telegram/email *without parsing the schema*, alongside the full
  structured payload for richer consumers.
- **Security & delivery**: HMAC-SHA256 `t=<ts>,v1=<hex>` over `<ts>.<body>`,
  verified against the **raw** body, 5-minute replay window; `whsec_` secret shown
  once; 8-attempt exponential backoff (immediate → 30s → 1m → 2m → 5m → 15m → 1h →
  6h); `Superlog-Delivery` UUID stable across retries = idempotency key; per-endpoint
  delivery log + "Send test".

**Areté fit:** Areté has none of this and genuinely needs it — the proposal's Slack
digest, PagerDuty routing, and "notify on review complete" all reduce to *one*
outbound-webhook mechanism. Transpose 1:1 to `review.created` / `review.updated`
with `change.kind ∈ {verdict_ready, approval_requested, approval_executed,
comment_resolved, review_failed}`.
**Owner:** `webhook` (+ `db` for `WebhookEndpoint`/`WebhookDelivery` models).
**Build spec:** `docs/superpowers/specs/2026-07-15-outbound-webhooks-design.md`.

### 3.2 Agent Runs / Agent Settings  — **ADAPT** (finishes residual #1)

| SuperLog concept | Verdict | Areté rationale |
|---|---|---|
| Agent-run **states** `queued/running/awaiting_human/complete/failed`, `resumeCount`, `cumulativeRuntimeMinutes` | **ADAPT** | Areté's `ApprovalPrompt` has only `PENDING/APPROVED/REJECTED/EXECUTED` and no run lifecycle. When the `approval-exec` worker is built, model its states on this. `awaiting_human` maps precisely to Areté's HITL pause. |
| Result shape: `rootCause.{text, confidence 0–10}`, `rootCauseConfidence high/med/low`, `estimatedImpact`, "treat <4 as hypotheses" | **ADAPT** | Areté's `ReviewResult` has `verdict` + drop counters but **no graded confidence**. Add `confidence` to `ReviewComment` (and/or a run-level confidence) derived from the existing critic/citation gates. This is item #2 — high trust-per-effort. |
| **Automerge policy** `automerge_fix_prs(never/when_checks_pass/immediately)` + `automerge_method(squash/merge/rebase)` + `pr_base_branch` | **ADAPT** | The exact config the unbuilt `approval-exec` worker needs. `never` = today's manual approve; `when_checks_pass` = delegate to GitHub auto-merge; `immediately` = the risky fast path. Adopt the enum + per-repo storage. |
| Noise/resolution classifications (`cosmetic_log_only`, `expected_third_party`, `fixed_in_current_code`, …) | **ADAPT (vocab only)** | Areté already has `noiseState` + `Autorecovery` (`auto_resolver.py`, currently simulated). Borrow the *reason codes* as the dismissal/auto-resolve taxonomy so silenced comments carry an honest "why". |
| PR outcome fields `pr.{url, openStatus, baseBranch, validationPassed}` | **ADAPT** | Areté's `Review` stores `prNumber` only — add `prUrl` (and, on the eventual fix PR, `validationPassed`). Enables the back-link the README flagged as missing. |

### 3.3 Agent Memory / Project Context  — **ADAPT** (finish what exists)

| SuperLog concept | Verdict | Areté rationale |
|---|---|---|
| `AgentMemory` kinds `feedback/terminology/infra/project`, 4000-char body, `active/archived`, dedupe-check-before-create | **ADAPT / FINISH** | Areté's model is **identical**; only the write-back is a stub (`memory.py:14-17` logs, never persists). Wire it to the real `AgentMemory` Prisma model. |
| Explicit `project_context` field (8000 chars, injected *first*, `get/set_project_context`) | **ADAPT** | Areté injects `repoConventions` from files. Add a first-class editable `Repository.projectContext` (the Settings screenshot `09-settings-org-agent-guidance.png` shows the exact UX) so guidance isn't only file-derived. |
| Org-wide vs project-scoped guidance split | **ADAPT (later)** | Maps to Installation (org) vs Repository (project). Low priority until multi-repo guidance is asked for. |

### 3.4 Issue Filters  — **ADAPT**

Include/exclude clause buckets (`{key,value}` equality), **excludes always win**,
non-empty include = allowlist, **preview-before-save** against recent events, ≤20
clauses/bucket. **Areté fit:** a clean model for **review scope** — "only review
these paths/services", "never review vendored/generated dirs" — a structured
upgrade over `.arete.yml custom_rules`. The *preview* affordance
(screenshot `11-settings-project-issue-filter.png`) is the reusable UX. **ADAPT.**
**Owner:** `webhook` (pr-fetcher scope) + `dashboard` (settings UI).

### 3.5 Incidents  — **ADAPT (concepts), SKIP (as a new entity)**

Areté's closest concept is `Review`/`ReviewComment`, **not** a production incident,
and there's no telemetry stream to fingerprint. So don't add an `Incident` model.
But three sub-patterns adapt well:

- **Codenames** (`squishy-narwhal`) — cheap, memorable handles for a review/run in
  Slack/PR text. Trivial ADAPT (a two-word generator), pure delight, zero schema
  risk. Good starter task.
- **Lifecycle vocabulary** `open→resolved/autoresolved_noise/merged` — Areté's
  `noiseState` already covers silencing; borrow `resolved`/`merged`/reason-codes
  for comment/review closure honesty.
- **Overview "5 most recent SEV-1/2 in 24h"** — Areté's Overview already surfaces
  recent reviews; the "critical-first, honest empty state" framing
  (`01-overview-sample-data-banner.png`) is a good reference, already partly built.

### 3.6 GitHub / Slack / Linear / AWS integrations

| Area | Verdict | Rationale |
|---|---|---|
| **GitHub App** perms table (Contents R/W, PRs R/W, Issues R/W, Metadata), "never request org-admin", refresh-access flow | **ADOPT (as documentation)** | Areté already has a GitHub App; SuperLog's *minimal-permission table + rationale* is a great template for Areté's own connect docs and a security checkpoint. Doc-only. |
| **Slack** outbound (incident thread, Resolve/Feedback buttons, per-project channel) | **DEFER** | Slack was explicitly scoped out of Areté. Unlocked *for free* as the first consumer of item #1's outbound webhooks — build the webhook first, Slack becomes a thin relay. |
| **Linear** (auto-create ticket from run, PR link-back, `linearTickets[]` in webhook) | **DEFER** | Same: a downstream consumer of outbound webhooks. Reference-grade design; not now. |
| **AWS / Firehose / service map / IAM role-assume** | **SKIP** | Requires cloud-inventory discovery + telemetry ingest Areté doesn't have and hasn't scoped. |

### 3.7 Telemetry / OTLP / Dashboards / Alerts / Source Maps / Management API  — **SKIP (now)**

All of these presuppose a **queryable telemetry store** (ClickHouse) and an
**ingest pipeline** that Areté deliberately deferred (`docs/handoff/...:24`,
proposal Phase 3). Areté pulls a per-PR `TelemetrySnapshotRecord` (latest-only, not
a history table) — it is *not* an observability backend.

| Area | Verdict | Note |
|---|---|---|
| OTLP ingest (`/v1/traces\|logs\|metrics`), ingest keys `sl_public_`, 402 quota, Firehose | **SKIP** | No ingest endpoint exists; adding one changes what Areté is. Phase-3 territory. |
| Telemetry-Read REST + raw explorer (facets, histograms) | **SKIP** | No stored events to read. |
| Dashboards / widget builder / template variables (5 widget types, 12-col grid, MCP-managed) | **SKIP** | Areté is fixed-page; a user-configurable BI surface is the proposal's far-future "Master Grid", not a clear win. |
| Alerts (threshold on logs/traces/metrics, episodes) | **SKIP** | No telemetry-eval engine; nothing to threshold. |
| Source-map upload/symbolication | **SKIP** | Only relevant if Areté ingests prod JS stack traces. |
| Management API: project provisioning + ingest-key minting (`sl_management_`) | **SKIP** | Areté's "project" is a GitHub `Installation`/`Repository` provisioned by App install, not a REST-created project with ingest keys. The *idea* of a management REST API for Areté resources is a possible later item, but not this. |

### 3.8 MCP  — **DEFER (interesting inversion)**

SuperLog **exposes itself as an MCP server** so a dev's Cursor/Claude can pull
incident context (`query_logs`, `search_incidents`, `get_incident`, …). Areté is
today an MCP *client*. The genuinely novel ADAPT: **expose Areté review findings via
an Areté MCP server** — "what did Areté flag on this PR, and why" available inside
the coding agent that's fixing it. This closes Areté's loop back into the editor and
is a differentiated Phase-2 feature. Bigger effort (auth model, PAT/OAuth, tool
surface) → **DEFER**, but flagged as high-upside. The token model
(PAT `superlog_pat_`, telemetry-only scope, OAuth protected-resource metadata) is a
ready reference when we get there.

### 3.9 Onboarding / Connect flow  — mostly **already built / SKIP**

The connect-your-data picker, per-provider detail, OAuth consent, "you're
connected" states are **already ported** into Areté's Connections page (README §
"Connections page (built)"). The **coding-agent install** (`npx skills add
superloglabs/skills`, write-only `sl_public_` key) implies an **instrumentation
SDK Areté doesn't have** — **SKIP** (do not imply a product surface that doesn't
exist; the README already warns against this). Reusable honest patterns worth
keeping: the sample-data banner, the "waiting for first event" activation state, and
the integration-gated empty state ("No AWS account connected yet") — all cheap,
already partially present.

---

## 4. Where SuperLog is a *cautionary* reference

Two SuperLog behaviours Areté should **not** copy:

1. **`automerge_fix_prs: immediately`** — merging a fix PR before CI runs. SuperLog
   itself flags this as dangerous. Areté's HITL/verdict moat (SP4) is a selling
   point; keep `never`/`when_checks_pass` as the only defaults and treat
   `immediately` as opt-in-with-warning if ever built.
2. **Per-span/log/metric metered billing** (investigation credits, `$/M spans`) —
   Areté prices **per review**. Don't import SuperLog's usage-meter UI
   (`08-settings-org-billing.png`); Areté's Settings billing card is intentionally
   simpler (plan status + reviews-used vs. free tier) and honest about it.

---

## 5. Clear-wins backlog (prioritized, with lanes)

Ordered by value-per-risk. **None are in my (`docs`) lane**, so each is handed off
as a declared item, not silently edited — per `.claude/ade-coordination.md` (claim
one surface; declare cross-package changes in the ledger first). Item 1 has a
full build spec; the rest are scoped here.

| # | Win | Verdict | Owner lane(s) | Effort | Notes / entry point |
|---|---|---|---|---|---|
| 1 | **Outbound webhooks** (`review.*` + `change.kind`, HMAC, retry, delivery log) | ADOPT | `webhook` + `db` | M | **Spec ready** → `.../specs/2026-07-15-outbound-webhooks-design.md`. Unblocks Slack/Linear/PagerDuty as thin relays. |
| 2 | **Finding confidence score** (0–10 + high/med/low, "<4 = hypothesis") | ADAPT | `agents` + `db` + `dashboard` | S–M | Derive from existing critic/citation gates (`critic.py`, `review.py`). Add `ReviewComment.confidence`; render as a badge (SuperLog `05-incident-detail-findings.png`). |
| 3 | **`approval-exec` worker behaviour = Agent-Settings model** | ADAPT | `webhook` (worker) + `agents` | M–L | Residual #1. Adopt `automerge_fix_prs`/`method`/`pr_base_branch` enums (per-`Repository`) as the worker's contract. Consumer for the existing idle `approval-exec` queue. |
| 4 | **Finish `AgentMemory` write-back + `Repository.projectContext`** | ADAPT | `agents` (`memory.py`) + `db` + `webhook` | S–M | Model exists; only the persist step is stubbed. Add explicit 8k project-context field + get/set. |
| 5 | **Issue-filter clause model for review scope** (+ preview) | ADAPT | `webhook` (scope) + `dashboard` | M | Structured include/exclude over `.arete.yml custom_rules`; excludes win; preview before save. |
| 6 | **`Review.prUrl` + resolve/noise reason codes** | ADAPT | `db` + `agents` + `dashboard` | S | Enables PR back-link (README-flagged gap) and honest closure reasons. |
| 7 | **Incident codenames** for reviews/runs | ADAPT | `agents` or `webhook` | XS | Two-word generator; pure polish; safe starter task. |
| 8 | **GitHub-App minimal-permission doc + Slack-as-relay design** | ADOPT (docs) | `docs` | XS | Doc-only; can be done in my lane if PM wants it folded in. |

---

## 6. What I did / did not do this pass (honesty ledger)

**Did (all in the `docs` lane I own):**
- This analysis (`docs/research/superlog-integration-analysis.md`).
- The #1 build-ready spec (`docs/superpowers/specs/2026-07-15-outbound-webhooks-design.md`).
- Declared the work in `.superpowers/sdd/progress.md` (created the ledger; it was
  referenced by `.claude/ade-coordination.md` but never instantiated).
- Cross-linked this analysis from `docs/design-references/README.md`.

**Deliberately did NOT do:**
- Any edit under `packages/dashboard`, `server.py`, or `context_map/` — **guardrail**.
- Any edit to `packages/webhook`, `packages/agents`, or `packages/db` — those are
  **other agents' lanes this wave**. Reaching into them mid-wave is exactly the
  collision the coordination rules forbid ("claim one surface per agent";
  "declare cross-package changes in the ledger first"). Items 1–7 are therefore
  **specs/handoffs**, not code, and are ready for the owning lane to execute.

**One thing to verify before building item 5/6:** the README's caveat that
`Installation.planTier` is "never written" — the schema *has* the column
(`schema.prisma:33`); confirm whether anything writes it before wiring UI to it.

---

## 7. Appendix — SuperLog doc pages mapped to verdicts

| SuperLog doc page | Verdict | § |
|---|---|---|
| Webhooks | **ADOPT** | 3.1 |
| Agent Runs · Agent Settings | ADAPT | 3.2 |
| Agent Memory | ADAPT/finish | 3.3 |
| Issue Filters | ADAPT | 3.4 |
| Incidents | ADAPT (concepts) / SKIP (entity) | 3.5 |
| GitHub Integration | ADOPT (as docs) | 3.6 |
| Slack · Linear | DEFER | 3.6 |
| AWS Integration | SKIP | 3.6 |
| Telemetry/OTLP · Ingest Keys · OTLP Ingest API | SKIP | 3.7 |
| Dashboards · Widget builder | SKIP | 3.7 |
| Alerts | SKIP | 3.7 |
| Source Maps | SKIP | 3.7 |
| Management API · Auth · Projects API · API Keys · Telemetry-Read | SKIP | 3.7 |
| MCP Server · MCP Tools | DEFER (invert: Areté-as-server) | 3.8 |
| Quickstart · Self-Hosting · Connect flow · Projects/Orgs | mostly built / SKIP | 3.9 |
| Billing / metered usage | cautionary — do not copy | 4 |

*Screenshot batches (`docs/design-references/superlog-*`) were read page-by-page as
part of this study; their per-screen UX notes fold into the sections above and the
existing `docs/design-references/README.md` index.*
