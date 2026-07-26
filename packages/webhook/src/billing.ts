// Billing enforcement for the review pipeline.
//
// The proposal (docs/proposal/TYME-platform-proposal.md, "Free tier") is
// explicit: "First 50 PRs free — enough for a team to experience full value
// before paying. No credit card required." This is a usage-count-based free
// tier, NOT a time-based trial — there is deliberately no expiry date here.
//
// Two Installation fields drive the gate:
//   - `subscriptionStatus`: written by stripe-handler.ts — 'active' on
//     checkout, and mirrors Stripe's subscription.status on
//     subscription.updated/deleted (canceled/past_due => blocked outright).
//   - `planTier`: the purchased tier name ("starter"/"pro"/"enterprise"),
//     recorded by stripe-handler.ts from the Stripe price on checkout. Until a
//     paid checkout records it, it stays at its "trialing" default.
//
// Every paid tier now carries a monthly review limit (below): a Starter plan
// is not unlimited. An `active` subscription whose `planTier` we don't yet
// recognise (legacy checkouts before tiers were recorded) is grandfathered to
// unlimited so enforcement never retroactively blocks an existing paying
// customer.

/** Number of free reviews per installation before payment is required. */
export const FREE_TIER_REVIEW_LIMIT = 50

/**
 * Monthly review limit per paid tier. `null` means unlimited (Enterprise).
 * These are the enforced caps — keep them in sync with the pricing page /
 * Stripe products. Values are deliberately named constants (not magic numbers)
 * so pricing changes are a one-line edit reviewed here.
 */
export const STARTER_MONTHLY_REVIEW_LIMIT = 500
export const PRO_MONTHLY_REVIEW_LIMIT = 2_000

/** Canonical tier identifiers. `trialing` is the un-paid free tier. */
export type PlanTier = 'trialing' | 'starter' | 'pro' | 'enterprise'

/** Effective monthly review limit for a resolved tier; `null` = unlimited. */
export const TIER_REVIEW_LIMITS: Record<PlanTier, number | null> = {
  trialing: FREE_TIER_REVIEW_LIMIT,
  starter: STARTER_MONTHLY_REVIEW_LIMIT,
  pro: PRO_MONTHLY_REVIEW_LIMIT,
  enterprise: null,
}

/** Message posted when the Stripe subscription lapsed (canceled/past_due). */
export const SUBSCRIPTION_INACTIVE_MESSAGE =
  'Areté Code Review is paused due to an inactive subscription.'

/** Message posted when the free tier is exhausted. There is no self-serve
 * pricing page yet, so this deliberately avoids hardcoding a checkout URL. */
export const FREE_TIER_EXHAUSTED_MESSAGE =
  `You've used your ${FREE_TIER_REVIEW_LIMIT} free Areté reviews — upgrade to keep Areté reviewing your PRs. ` +
  'Please contact your admin (or the Areté team) to upgrade your plan.'

/** Message posted when a PAID tier's monthly review limit is reached. */
export function tierLimitReachedMessage(tier: PlanTier, limit: number): string {
  return (
    `You've reached your ${tier} plan limit of ${limit} Areté reviews this billing period. ` +
    'Upgrade to a higher tier to keep Areté reviewing your PRs, or contact the Areté team.'
  )
}

export interface BillingInstallation {
  subscriptionStatus: string
  usageCount: number
  /** Purchased tier name; optional/undefined for legacy or un-persisted rows. */
  planTier?: string | null
}

/** Resolved tier context, surfaced on every gate result so a UI can render
 *  the plan, its cap, and how many reviews remain. */
export interface BillingTierInfo {
  tier: PlanTier
  /** Monthly review cap; `null` = unlimited. */
  limit: number | null
  /** Reviews left this period; `null` = unlimited. Never negative. */
  remaining: number | null
  usageCount: number
}

export type BillingGateResult =
  | { allowed: true; tier: BillingTierInfo }
  | {
      allowed: false
      reason: 'subscription_inactive' | 'free_tier_exhausted' | 'tier_limit_reached'
      message: string
      tier: BillingTierInfo
    }

const KNOWN_PAID_TIERS: PlanTier[] = ['starter', 'pro', 'enterprise']

/**
 * Resolves the tier that actually governs this installation right now.
 *
 * - No active paid subscription => the free `trialing` tier (50 reviews),
 *   regardless of what `planTier` says.
 * - Active subscription with a recognised paid `planTier` => that tier.
 * - Active subscription with an unrecognised/absent `planTier` (legacy checkout
 *   predating tier recording) => `enterprise` (unlimited) so an existing paying
 *   customer is never retroactively capped.
 */
export function resolvePlanTier(installation: BillingInstallation): PlanTier {
  const active = installation.subscriptionStatus === 'active'
  if (!active) return 'trialing'
  const tier = installation.planTier as PlanTier | undefined | null
  if (tier && KNOWN_PAID_TIERS.includes(tier)) return tier
  return 'enterprise'
}

function tierInfo(tier: PlanTier, usageCount: number): BillingTierInfo {
  const limit = TIER_REVIEW_LIMITS[tier]
  const remaining = limit === null ? null : Math.max(0, limit - usageCount)
  return { tier, limit, remaining, usageCount }
}

/**
 * Decides whether an installation may run another (LLM-cost-bearing) review.
 *
 * Must be evaluated BEFORE enqueueing a review job / calling the Python
 * pipeline — the whole point is not to spend LLM cost on a review the
 * customer will not receive.
 *
 * A `null` installation (a repo we have never persisted a review for) is
 * allowed: its effective usage count is 0 on the free tier.
 *
 * The returned `tier` is always populated (allowed or blocked) so callers /
 * dashboards can render "Pro plan · 1,340 of 2,000 reviews used".
 */
export function evaluateBillingGate(
  installation: BillingInstallation | null | undefined
): BillingGateResult {
  if (!installation) {
    return { allowed: true, tier: tierInfo('trialing', 0) }
  }

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
      tier: tierInfo('trialing', installation.usageCount),
    }
  }

  const tier = resolvePlanTier(installation)
  const info = tierInfo(tier, installation.usageCount)

  // Unlimited tier (Enterprise / grandfathered active) — never capped.
  if (info.limit === null) {
    return { allowed: true, tier: info }
  }

  if (installation.usageCount >= info.limit) {
    if (tier === 'trialing') {
      return {
        allowed: false,
        reason: 'free_tier_exhausted',
        message: FREE_TIER_EXHAUSTED_MESSAGE,
        tier: info,
      }
    }
    return {
      allowed: false,
      reason: 'tier_limit_reached',
      message: tierLimitReachedMessage(tier, info.limit),
      tier: info,
    }
  }

  return { allowed: true, tier: info }
}
