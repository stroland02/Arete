// Billing enforcement for the review pipeline.
//
// The proposal (docs/proposal/TYME-platform-proposal.md, "Free tier") is
// explicit: "First 50 PRs free — enough for a team to experience full value
// before paying. No credit card required." This is a usage-count-based free
// tier, NOT a time-based trial — there is deliberately no expiry date here.
//
// Which field is authoritative? Installation carries both `subscriptionStatus`
// and `planTier` (both default "trialing"). Only `subscriptionStatus` is ever
// written by business logic: stripe-handler.ts sets it to 'active' on
// checkout.session.completed and mirrors Stripe's subscription.status on
// customer.subscription.updated/deleted. `planTier` is never written anywhere
// (it exists only in the schema and test fixtures), so it is currently
// redundant — it should eventually hold the purchased tier name
// ("starter"/"pro"/"enterprise") once checkout records it, but until then the
// gate keys off `subscriptionStatus === 'active'` as the single source of
// truth for "this installation has an active paid subscription".
//
// Paid plans (Starter/Pro/Enterprise) are priced per-dev/month with no PR
// caps in the proposal's pricing table, so the 50-review ceiling applies ONLY
// to installations without an active paid subscription.

/** Number of free reviews per installation before payment is required. */
export const FREE_TIER_REVIEW_LIMIT = 50

/** Message posted when the Stripe subscription lapsed (canceled/past_due). */
export const SUBSCRIPTION_INACTIVE_MESSAGE =
  'Areté Code Review is paused due to an inactive subscription.'

/** Message posted when the free tier is exhausted. There is no self-serve
 * pricing page yet, so this deliberately avoids hardcoding a checkout URL. */
export const FREE_TIER_EXHAUSTED_MESSAGE =
  `You've used your ${FREE_TIER_REVIEW_LIMIT} free Areté reviews — upgrade to keep Areté reviewing your PRs. ` +
  'Please contact your admin (or the Areté team) to upgrade your plan.'

export interface BillingInstallation {
  subscriptionStatus: string
  usageCount: number
}

export type BillingGateResult =
  | { allowed: true }
  | {
      allowed: false
      reason: 'subscription_inactive' | 'free_tier_exhausted'
      message: string
    }

/**
 * Decides whether an installation may run another (LLM-cost-bearing) review.
 *
 * Must be evaluated BEFORE enqueueing a review job / calling the Python
 * pipeline — the whole point is not to spend LLM cost on a review the
 * customer will not receive.
 *
 * A `null` installation (a repo we have never persisted a review for) is
 * allowed: its effective usage count is 0.
 */
export function evaluateBillingGate(
  installation: BillingInstallation | null | undefined
): BillingGateResult {
  if (!installation) return { allowed: true }

  // A previously-paying customer whose subscription lapsed is blocked
  // outright, regardless of usage count.
  if (
    installation.subscriptionStatus === 'canceled' ||
    installation.subscriptionStatus === 'past_due'
  ) {
    return {
      allowed: false,
      reason: 'subscription_inactive',
      message: SUBSCRIPTION_INACTIVE_MESSAGE,
    }
  }

  // Free tier: no active paid subscription AND the 50 free reviews are used.
  const hasActivePaidSubscription = installation.subscriptionStatus === 'active'
  if (!hasActivePaidSubscription && installation.usageCount >= FREE_TIER_REVIEW_LIMIT) {
    return {
      allowed: false,
      reason: 'free_tier_exhausted',
      message: FREE_TIER_EXHAUSTED_MESSAGE,
    }
  }

  return { allowed: true }
}
