# Design: Areté Outbound Webhooks (adopted from SuperLog)

**Date:** 2026-07-15 · **Author:** Engineer-1 (SuperLog Study) · **Status:** spec / ready-to-build
**Source of the pattern:** SuperLog Webhooks doc (see `docs/research/superlog-integration-analysis.md` §3.1)
**Owner lanes to execute:** `webhook` (delivery + signing + routes) and `db` (2 models). **Declare in `.superpowers/sdd/progress.md` before coding — this crosses `webhook` + `db`.**

---

## 1. Why

Areté has **no** way to notify an external system when a review happens. Every
downstream integration the proposal wants (Slack digest, PagerDuty, "review
complete" hooks, a customer's own tooling) currently has to be built bespoke.
SuperLog solves this with **one** outbound-webhook mechanism that every relay sits
behind. This spec transposes that proven design to Areté's `Review` model.

**Verified current state:** no outbound POST to customer endpoints exists; HMAC is
used only for *inbound* Stripe verification (`stripe-handler.ts:13-26`) and internal
OAuth-state signing (`oauth/oauth-state.ts`). Clean slate.

## 2. The model (2 events + a discriminator)

Mirror SuperLog exactly — the elegance is collapsing a combinatorial event list into
**two** events plus a `change.kind`:

| Event | Fires when | Relay as |
|---|---|---|
| `review.created` | A new `Review` row is created (analysis started/completed). | New message / thread keyed on `review.id`. |
| `review.updated` | Anything else on that review — discriminated by `change.kind`. | Reply in the thread. |

`change.kind` (Areté-specific, replacing SuperLog's incident kinds):

| `change.kind` | Trigger in Areté | Adds |
|---|---|---|
| `verdict_ready` | `ReviewResult.verdict` computed (`verdict.py`). | `verdict`, `verdict_reason`, `risk_level`. |
| `approval_requested` | An `ApprovalPrompt` created (`status=PENDING`). | `approval{id, command, reason}`. |
| `approval_executed` | `ApprovalPrompt` → `EXECUTED` (`approval-handler.ts`). | `approval{id, executedAt}`. |
| `comment_resolved` | `ReviewComment.noiseState` → `SILENCED`/resolved. | `comment{id, path, line, reason}`. |
| `review_failed` | `analysisStatus="failed"`. | `failureReason`. |

Every payload also carries a **pre-rendered `message.{title, body}`** so the simplest
consumer forwards it verbatim without parsing the schema (SuperLog's single most
useful field).

## 3. Data model (`packages/db/prisma/schema.prisma`)

Two new models. Scope to `Installation` (tenant), matching Areté's tenancy.

```prisma
model WebhookEndpoint {
  id             String   @id @default(cuid())
  installationId String
  url            String                          // https only, validated by ssrf-guard
  secret         String                          // "whsec_"-prefixed; shown once at create
  events         String[]                        // ["review.created","review.updated"]; both default
  enabled        Boolean  @default(true)
  createdAt      DateTime @default(now())
  installation   Installation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  deliveries     WebhookDelivery[]
  @@index([installationId])
}

model WebhookDelivery {
  id          String   @id @default(uuid())      // == the Arete-Delivery header; stable across retries
  endpointId  String
  event       String                             // review.created | review.updated
  payload     Json
  status      String   @default("pending")       // pending | delivered | failed
  attempts    Int      @default(0)
  lastCode    Int?
  lastError   String?
  nextAttempt DateTime?
  createdAt   DateTime @default(now())
  endpoint    WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  @@index([endpointId, status])
}
```

Add `webhookEndpoints WebhookEndpoint[]` to `Installation`. **Schema change =
coordinate first** (`schema.prisma` is the shared hot file; only one agent at a time).

## 4. Signing (reuse Areté's crypto conventions)

Header `Arete-Signature: t=<unix-ts>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<rawBody>")`.
This is the same construction as SuperLog and as Areté's existing
`oauth/oauth-state.ts` HMAC — put the signer next to it or in a small
`webhook/src/outbound/signature.ts`. Receivers verify against the **raw** body and
reject `|now - t| > 300s` (replay window). Include a copy-paste TS verifier in the
customer docs (SuperLog ships one; reuse it verbatim with header renamed).

Other headers: `Arete-Event`, `Arete-Delivery` (the `WebhookDelivery.id`),
`User-Agent: Arete-Webhooks/1.0`.

## 5. Delivery semantics

- POST `application/json`, **10s timeout**.
- Non-2xx / timeout / connection error → retry with SuperLog's backoff:
  **immediate → 30s → 1m → 2m → 5m → 15m → 1h → 6h** (8 attempts, ~8h), then `failed`.
- Retries reuse the **same** `Arete-Delivery` UUID (idempotency key for the receiver).
- Run delivery on a **BullMQ queue + worker**, exactly like the existing review queue
  (`queue.ts` / `worker.ts`). This is also the pattern the idle `approval-exec` queue
  needs — building it here de-risks residual #1.
- **SSRF:** validate `url` on create *and* before each send with the existing
  `telemetry/ssrf-guard.ts` (net-guard) — customer-supplied URLs are the same threat
  surface the SSRF work already hardened. Non-negotiable.

## 6. Routes (`packages/webhook/src/server.ts`, tenant-scoped)

```
POST   /api/webhooks/endpoints           create (returns whsec_ secret ONCE)
GET    /api/webhooks/endpoints           list (never returns secret)
PATCH  /api/webhooks/endpoints/:id       enable/disable, rotate secret, change events
DELETE /api/webhooks/endpoints/:id
POST   /api/webhooks/endpoints/:id/test  fire a stub {event, test:true, message} — transport check only
GET    /api/webhooks/endpoints/:id/deliveries   delivery log (status, code, nextAttempt, error)
```

All scoped by `Installation` via the existing auth/tenancy middleware — reuse it, do
not hand-roll (the cross-tenant leak fixed in `f4b9c88` is the cautionary tale).

## 7. Emission points

Emit by enqueuing a `WebhookDelivery` at the moments in §2 — all already exist:
`review-bridge` (on `Review`/`ReviewResult` persist), `approval-handler.ts`
(request + execute). Add a thin `emitWebhook(installationId, event, change, review)`
helper that renders `message.{title,body}` and fans out to that installation's
enabled endpoints subscribed to the event.

## 8. Tests (match existing vitest baselines)

- Signature: known-vector HMAC; tampered body fails; >5-min timestamp rejected.
- Delivery: 2xx→delivered; 500→retry with backoff schedule; 8 fails→failed; same UUID across retries.
- Idempotency: redeliver = new UUID (documented, like SuperLog).
- Tenancy: endpoint of installation A never receives installation B's review (adversarial, like the auth suite).
- SSRF: internal/loopback/metadata-IP URL rejected at create and at send (reuse net-guard adversarial cases).

## 9. Explicitly out of scope (do not gold-plate)

Per-event filtering beyond the 2 events; UI to manage endpoints (dashboard lane, later);
Slack/Linear formatting (those become *consumers* of this, built separately). Ship the
mechanism; let integrations sit behind it.

## 10. Handoff

This spec is complete enough to execute directly. Whoever picks it up: (1) add a row
to `.superpowers/sdd/progress.md` claiming `webhook`+`db`; (2) do the `schema.prisma`
change under coordination; (3) follow §3–§8. Estimated M (a few focused sessions).
The payoff is disproportionate: it is the single unlock for the entire outbound-
notification half of the proposal.
