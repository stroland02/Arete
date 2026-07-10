# Areté — Phase 1.5: Stripe Billing Integration

**Goal:** Monetize the Code Review Service by integrating Stripe. Ensure that only organizations with an active subscription (or trial) receive AI code reviews. This fulfills the remaining major backend component of Phase 1.

## Core Functional Gaps Addressed

1. **Monetization Pipeline:** We need to link a GitHub Installation to a Stripe Subscription.
2. **Subscription Enforcement:** The GitHub webhook must verify active subscription status before spinning up the LangChain Orchestrator (to prevent excessive LLM costs on unpaid accounts).
3. **Stripe Webhook Sync:** We need to listen to Stripe events to update our database when subscriptions are created, canceled, or unpaid.

---

## Task 1: Update Prisma Schema

**Files:**
- Modify: `packages/dashboard/prisma/schema.prisma` (and the shared one if `packages/db` exists)

**Implementation:**
Add Stripe-specific fields to the `Installation` model:
- `stripeCustomerId` (String, nullable)
- `stripeSubscriptionId` (String, nullable)
- `subscriptionStatus` (String, default "trialing" or "active")

Run `prisma generate` to update the client.

## Task 2: Stripe Setup & Webhook Handler

**Files:**
- Modify: `packages/webhook/package.json`
- Modify: `packages/webhook/src/server.ts`
- Create: `packages/webhook/src/stripe-handler.ts`

**Implementation:**
- Install `stripe` dependency in the webhook package.
- Add an Express route `POST /stripe-webhook` in `server.ts` that uses `express.raw({ type: 'application/json' })` to verify the Stripe signature.
- Implement `stripe-handler.ts` to process:
  - `checkout.session.completed`: Link `stripeCustomerId` and `stripeSubscriptionId` to the `Installation` (using `client_reference_id` passed during checkout).
  - `customer.subscription.updated`: Update `subscriptionStatus`.
  - `customer.subscription.deleted`: Set `subscriptionStatus` to `canceled`.

## Task 3: Enforce Subscription in Review Pipeline

**Files:**
- Modify: `packages/webhook/src/webhook-handler.ts`

**Implementation:**
- Before calling `runReviewPipeline`, query the `Installation` via Prisma.
- Check `subscriptionStatus`. If it is `canceled` or `past_due`, skip the review and optionally post a PR comment stating "Areté Code Review is paused due to an inactive subscription. Please update your billing info."
- If active or trialing, proceed as normal.

---

This plan connects the final external software service (Stripe) required for our Phase 1 Code Review launch.
