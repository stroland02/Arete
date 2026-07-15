# SuperLog → Areté: Phased Development Roadmap

**Date:** 2026-07-15 · **Author:** Engineer-1 (SuperLog Study) · **Status:** planning / living document
**Companion:** `docs/research/superlog-integration-analysis.md` (page-by-page adopt/adapt/skip)
**Build spec (Phase 1 #1):** `docs/superpowers/specs/2026-07-15-outbound-webhooks-design.md`

---

## 0. How to read this

This roadmap turns the SuperLog study into a sequenced, secure, professionally-manageable
build plan. Every SuperLog documentation page you provided is accounted for — either scheduled
into a phase or explicitly parked with a reason (see the **Traceability Matrix** in §7, which is
the completeness check: one row per page).

**North star (unchanged):** Areté already *is* SuperLog's loop entered from the PR side. SuperLog
enters the same telemetry→incident→AI-fix→PR loop from the observability side. So this is not
"bolt on an observability product" — it is **finish the loop Areté already has**, then **open it
to integrations**, and only *later* (and optionally) **grow the telemetry-ingestion half**.

**Sequencing principle:** each phase is independently shippable and strictly enables the next.
Value/effort decreases and infrastructure cost increases as you descend. Stop at any phase
boundary and you still have a coherent product.

---

## 1. Phase map at a glance

| Phase | Theme | Depends on | Infra added | Risk | Status |
|---|---|---|---|---|---|
| **P1** | **Finish the review→action loop** | none (uses today's stack) | none new | Low | **In progress** |
| **P2** | **Integration relays** (Slack, Linear, PagerDuty, generic) | P1 outbound webhooks | none new | Low–Med | Not started |
| **P3** | **Read/management API + MCP surface** | P1, P2 | API-key store | Med | Not started |
| **P4** | **Telemetry ingestion platform** (OTLP, store, dashboards, alerts, incidents) | P1–P3 | ClickHouse/OTel, ingest keys | High | Deferred (by design) |
| **P5** | **Self-host + enterprise packaging** | P1–P4 | packaging/infra | Med | Deferred |

Cross-cutting **Security & Governance** rules (§8) apply to every phase and are part of "done,"
not a later hardening pass.

---

## 2. Phase 1 — Finish the review→action loop

**Goal:** close the residual gaps so a review can *act* and *learn*, and can *notify* the outside
world. All of this fits today's Postgres + BullMQ + LangGraph stack — no new infrastructure.

| # | Capability | SuperLog source | Strategy | State today | Security notes |
|---|---|---|---|---|---|
| 1.1 | **Outbound webhooks** (`review.*` + `change.kind`, HMAC-signed, retried) | Webhooks | **ADOPT** | Mechanism **built** (signing, backoff, delivery over net-guard SSRF guard, store, dispatch, routes; migration written, not applied). Remaining: apply migration, Prisma store, wire into `server.ts`, retry worker, emission points. | HMAC per-endpoint secret; secret shown once, never logged; SSRF-guarded delivery; tenant-scoped. |
| 1.2 | **Finding confidence score** (0–10 + high/med/low) | Agent Runs / Settings | **ADAPT** | Signal exists in critic/citation gates; not surfaced. | No new data egress; display-only. |
| 1.3 | **`approval-exec` worker** using Agent-Settings automerge model | Agent Settings | **ADAPT** | Queue exists, **no consumer**. Finishes residual #1. | **Do NOT adopt `automerge: immediately`** (merges before CI) — keep `never` / `when_checks_pass` only. HITL is the moat. |
| 1.4 | **AgentMemory write-back** + `Repository.projectContext` | Agent Memory | **ADAPT** | Taxonomy already identical; `memory.py` write is a **stub**. | Memory is tenant-scoped; never store secrets/PII in memory rows. |
| 1.5 | **Issue-filter clause model** for review scope | Issue Filters | **ADAPT** | Not present. | Server-side filtering; no client-trust of scope. |
| 1.6 | **`Review.prUrl` + resolve/noise reason codes** | Incidents (concepts) | **ADAPT** | `prNumber` only; noiseState machine exists. | None material. |

**Phase 1 exit criteria (DoD):**
- Outbound webhooks fully wired: register endpoint (HTTP) → real review event → signed delivery →
  **Postgres delivery row** with status → scheduled retry fires from a worker. Migration applied
  in a real DB env. (Transport, signing, retry, registration, in-memory recording are already
  proven live; the Postgres/worker/emission wiring is what remains.)
- Each of 1.2–1.6 lands behind its owning lane with tests green and the coordination ledger updated.

**Effort:** 1.1 = M (mostly done), 1.2/1.6 = S, 1.3/1.4/1.5 = M each. Parallelizable across lanes.

---

## 3. Phase 2 — Integration relays

**Goal:** everything downstream becomes a *thin consumer of Phase 1 webhooks*. No bespoke
per-integration plumbing — each relay just subscribes and formats.

| # | Capability | SuperLog source | Strategy | Notes |
|---|---|---|---|---|
| 2.1 | **Slack relay** | Slack Integration | **DEFER→now-enabled** | Consumes `review.*`; forwards `message.{title,body}` verbatim; threads on `review.id`. |
| 2.2 | **Linear relay** | Linear Integration | **DEFER→now-enabled** | Creates/updates a Linear issue per review or per `approval_requested`. |
| 2.3 | **PagerDuty / generic webhook relay** | Webhooks | **ADOPT** | Customer's own endpoint; the signed webhook *is* the integration. |
| 2.4 | **GitHub integration deepening** | GitHub Integration | **ADOPT-docs** | Mostly built; document the check-run/status contract; align with webhook events. |

**Security:** outbound OAuth tokens for Slack/Linear encrypted at rest (reuse
`telemetry/credentials.ts` AES-256-GCM); relays run as isolated consumers so a relay compromise
can't reach the review pipeline. Each relay validates the inbound Areté signature (the copy-paste
verifier from the webhooks spec).

**Exit criteria:** a review verdict appears in Slack and Linear driven **only** by a subscribed
webhook (no pipeline code changed to add a relay). **Effort:** S–M per relay.

---

## 4. Phase 3 — Read / management API + MCP surface

**Goal:** let external tools and agents *query* Areté and *manage* configuration programmatically.
This is where SuperLog's Management API maps in — but inverted where it makes sense.

| # | Capability | SuperLog source | Strategy | Notes |
|---|---|---|---|---|
| 3.1 | **API-key auth + key management** | Authentication, API Keys | **ADAPT** | Scoped, hashed-at-rest keys; per-installation; rotation + revoke. Foundation for everything else in P3. |
| 3.2 | **Projects/Orgs REST** | Projects API, Projects/Orgs | **ADAPT** | Read/list installations, repositories, reviews. Tenant-scoped. |
| 3.3 | **Review read API** | Telemetry Read (analog) | **ADAPT** | Query reviews/verdicts/findings — the Areté analog of "telemetry read." |
| 3.4 | **Areté-as-MCP-server** (the inversion) | MCP Server, MCP Overview, MCP Tools | **DEFER→P3** | Expose *review* tools (get_review, list_findings, request_approval) over MCP so coding agents pull Areté's judgment. More valuable than Areté consuming SuperLog's MCP. |
| 3.5 | **Ingest-key/OTLP-endpoint provisioning REST** | Ingest Keys, OTLP Ingest Endpoints | **SKIP until P4** | Only meaningful once telemetry ingestion exists (P4). Park. |

**Security:** API keys hashed (never stored plaintext), scoped to least privilege, per-key rate
limits; MCP tools enforce the same tenant scoping as the dashboard; audit log for management
mutations. **Effort:** 3.1 = M, 3.2/3.3 = M, 3.4 = L, 3.5 = deferred.

---

## 5. Phase 4 — Telemetry ingestion platform *(deferred by design)*

**Goal:** the big one — the observability half of SuperLog. **Correctly deferred**: every item
here presupposes a queryable telemetry store Areté intentionally does not yet run (see the
proposal's Phase-2 OTel+ClickHouse path). Scope, not gaps.

| # | Capability | SuperLog source | Strategy | Gate to start |
|---|---|---|---|---|
| 4.1 | **OTLP ingest endpoint + ingest keys** | Telemetry/OTLP ingest, Ingest Keys, OTLP Ingest Endpoints | **SKIP-until-demand** | Real customer telemetry demand + infra budget. |
| 4.2 | **Telemetry store** (ClickHouse/OTel collector) | Telemetry/OTLP ingest | **SKIP-until-demand** | Same. Note existing `packages/db/clickhouse` scaffold. |
| 4.3 | **Incidents entity** | Incidents | **ADAPT-concepts / SKIP-entity** | Needs a telemetry signal to open an incident from. |
| 4.4 | **Dashboards / widgets** | Dashboards | **SKIP** | Needs 4.2. (Dashboard UI is Engineer-2/dashboard lane anyway.) |
| 4.5 | **Alerts** | Alerts | **SKIP** | Needs 4.2 + a rules engine. |
| 4.6 | **Source maps** | Source Maps | **SKIP** | Needs 4.1 (stack-trace symbolication on ingest). |
| 4.7 | **AWS integration / service map** | AWS Integration | **SKIP** | Needs 4.2 + cloud-resource graph. |
| 4.8 | **Agent Runs surface** | Agent Runs | **ADAPT-partial** | The run *concept* maps to a review; a full run explorer needs 4.x telemetry context. |

**Do NOT adopt:** per-span metered billing (cuts against Areté's per-review pricing). **Security
(when built):** ingest keys write-only + scoped; tenant isolation in the telemetry store;
PII scrubbing on ingest; source-map upload authenticated. **Effort:** XL program, multi-quarter.

---

## 6. Phase 5 — Self-host & enterprise packaging *(deferred)*

| Capability | SuperLog source | Strategy | Notes |
|---|---|---|---|
| Self-hosting story | Self-Hosting | **SKIP-until-demand** | Revisit once P1–P3 stabilize and an enterprise buyer needs on-prem. |
| Quickstart / onboarding | Quickstart | **MOSTLY-BUILT / SKIP** | Areté's Connect flow already covers first-run; borrow doc structure only. |
| Org/project provisioning UX | Projects/Orgs | **ADAPT (P3 API first)** | UI follows the P3 REST surface. |

---

## 7. Traceability Matrix — every pasted page accounted for

*Completeness check: one row per SuperLog page you provided. "Phase —" means intentionally parked.*

### Product documentation
| SuperLog page | Strategy | Phase | One-line rationale |
|---|---|---|---|
| Overview | context | — | Framing; confirms Areté = same loop, PR-side. |
| Quickstart | mostly-built / skip | P5 | Connect flow already covers first-run. |
| Self-Hosting | skip-until-demand | P5 | No on-prem buyer yet. |
| Incidents | adapt-concepts / skip-entity | P1.6 / P4.3 | Reason-codes now; entity needs telemetry. |
| Agent Runs | adapt-partial | P1.2 / P4.8 | Confidence now; run explorer needs telemetry. |
| Projects/Orgs | adapt | P3.2 / P5 | REST first, UX later. |
| Telemetry / OTLP ingest | skip-until-demand | P4.1–4.2 | Presupposes a telemetry store. |
| GitHub Integration | adopt-docs | P2.4 | Mostly built; document the contract. |
| Slack Integration | defer→enabled | P2.1 | Thin webhook consumer. |
| Linear Integration | defer→enabled | P2.2 | Thin webhook consumer. |
| AWS Integration | skip | P4.7 | Needs telemetry + resource graph. |
| Dashboards | skip | P4.4 | Needs telemetry store; dashboard lane owns UI. |
| Alerts | skip | P4.5 | Needs telemetry + rules engine. |
| Source Maps | skip | P4.6 | Needs ingest symbolication. |
| Issue Filters | adapt | P1.5 | Server-side review-scope filters. |
| Agent Memory | adapt | P1.4 | Taxonomy already identical; finish write-back. |
| MCP Server | defer→invert | P3.4 | Expose Areté-as-MCP-server. |
| Ingest Keys | skip-until-P4 | P4.1 / P3.5 | Only meaningful with ingestion. |
| Agent Settings | adapt | P1.3 | Automerge model (minus `immediately`). |
| Webhooks | **adopt** | **P1.1** | The unlock for all of P2. Spec built. |

### Management API reference
| SuperLog page | Strategy | Phase | One-line rationale |
|---|---|---|---|
| Overview | context | P3 | Frames the management surface. |
| Authentication | adapt | P3.1 | Scoped, hashed API keys. |
| Projects API | adapt | P3.2 | Tenant-scoped read/list. |
| API Keys | adapt | P3.1 | Key lifecycle: issue/rotate/revoke. |
| Telemetry Read | adapt→"Review Read" | P3.3 | Query reviews/findings, the Areté analog. |
| OTLP Ingest Endpoints | skip-until-P4 | P4.1 / P3.5 | Needs ingestion. |
| MCP Overview | defer→invert | P3.4 | Areté-as-server model. |
| MCP Tools | defer→invert | P3.4 | Define *review* tools, not consume SuperLog's. |

---

## 8. Cross-cutting: Security & Governance (applies to every phase)

1. **Secrets:** per-resource secrets/keys are random, hashed or encrypted at rest (AES-256-GCM via
   `telemetry/credentials.ts`), shown once, never logged, never returned by list/get.
2. **Egress (webhooks/relays):** always through `@arete/net-guard` — SSRF default-deny, IP-pinned,
   redirects never followed. Validated at registration *and* on every send.
3. **Signing:** every outbound payload HMAC-signed (`t=…,v1=…`), receivers verify raw body + reject
   stale timestamps. Ship the copy-paste verifier in customer docs.
4. **Tenancy:** every read/write scoped by `Installation`; adversarial cross-tenant tests are part
   of DoD (the cross-tenant leak fixed in `f4b9c88` is the cautionary tale).
5. **HITL preserved:** never adopt auto-actions that bypass human approval or CI (`automerge:
   immediately`, auto-apply without approval). The approval gate is the product moat.
6. **No fabrication:** anything not verifiable in-sandbox (needs a live DB, real OAuth, deployed
   env) is called out explicitly with the exact command a human must run.

## 9. Cross-cutting: How we manage the build (process)

- **Ledger first:** every phase item declares its lane(s) in `.claude/ade-coordination.md` before
  code (schema = single writer per wave, coordination rule 4).
- **Spec per non-trivial item:** design doc under `docs/superpowers/specs/` before implementation
  (P1.1 is the template).
- **TDD + real verification:** red→green, and drive the real flow (not just unit tests) before
  "done." Green units alone are not done.
- **Status contract each update:** scope-confirmed → progress → blockers → done+verification, to PM.
- **Small honest commits:** each compiles and its tests pass; commit messages say what & why.

---

## 10. Recommended immediate sequence

1. **Finish P1.1 outbound webhooks** (apply migration in a DB env, Prisma store, wire router +
   retry worker + emission points) — the single unlock for all of Phase 2. *In progress.*
2. **P1.3 `approval-exec` worker** — finishes a known residual and reuses the webhook delivery/retry
   pattern.
3. **P1.2 confidence score** — cheap trust win.
4. Then open **Phase 2** relays (Slack first) now that webhooks exist.

Everything below Phase 2 waits on a real telemetry-demand + infra decision — do not pull Phase 4
forward without it.
