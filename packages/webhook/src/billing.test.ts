import { describe, it, expect } from 'vitest'
import {
  evaluateBillingGate,
  resolvePlanTier,
  FREE_TIER_REVIEW_LIMIT,
  STARTER_MONTHLY_REVIEW_LIMIT,
  PRO_MONTHLY_REVIEW_LIMIT,
} from './billing.js'

describe('evaluateBillingGate', () => {
  it('allows an unknown installation (no row yet — zero usage) on the free tier', () => {
    const gate = evaluateBillingGate(null)
    expect(gate.allowed).toBe(true)
    expect(gate.tier).toEqual({
      tier: 'trialing',
      limit: FREE_TIER_REVIEW_LIMIT,
      remaining: FREE_TIER_REVIEW_LIMIT,
      usageCount: 0,
    })
  })

  it('allows a trialing installation under the free-tier limit and reports remaining', () => {
    const gate = evaluateBillingGate({ subscriptionStatus: 'trialing', usageCount: FREE_TIER_REVIEW_LIMIT - 1 })
    expect(gate.allowed).toBe(true)
    expect(gate.tier.remaining).toBe(1)
    expect(gate.tier.tier).toBe('trialing')
  })

  it('blocks a trialing installation at the free-tier limit with the upgrade message', () => {
    const gate = evaluateBillingGate({ subscriptionStatus: 'trialing', usageCount: FREE_TIER_REVIEW_LIMIT })
    expect(gate).toMatchObject({ allowed: false, reason: 'free_tier_exhausted' })
    if (!gate.allowed) expect(gate.message).toContain('50 free')
    expect(gate.tier.remaining).toBe(0)
  })

  it('grandfathers an active subscription with no recorded tier to unlimited (legacy checkout)', () => {
    const gate = evaluateBillingGate({ subscriptionStatus: 'active', usageCount: 10_000 })
    expect(gate.allowed).toBe(true)
    expect(gate.tier).toMatchObject({ tier: 'enterprise', limit: null, remaining: null })
  })

  it('blocks canceled and past_due subscriptions regardless of usage count', () => {
    for (const status of ['canceled', 'past_due']) {
      const gate = evaluateBillingGate({ subscriptionStatus: status, usageCount: 0 })
      expect(gate).toMatchObject({ allowed: false, reason: 'subscription_inactive' })
    }
  })

  // --- Paid tier enforcement -------------------------------------------------

  it('allows an active Starter subscription under its limit and reports remaining', () => {
    const gate = evaluateBillingGate({
      subscriptionStatus: 'active',
      planTier: 'starter',
      usageCount: STARTER_MONTHLY_REVIEW_LIMIT - 10,
    })
    expect(gate.allowed).toBe(true)
    expect(gate.tier).toMatchObject({ tier: 'starter', limit: STARTER_MONTHLY_REVIEW_LIMIT, remaining: 10 })
  })

  it('blocks an active Starter subscription at its monthly limit with a tier-limit message', () => {
    const gate = evaluateBillingGate({
      subscriptionStatus: 'active',
      planTier: 'starter',
      usageCount: STARTER_MONTHLY_REVIEW_LIMIT,
    })
    expect(gate).toMatchObject({ allowed: false, reason: 'tier_limit_reached' })
    if (!gate.allowed) {
      expect(gate.message).toContain('starter')
      expect(gate.message).toContain(String(STARTER_MONTHLY_REVIEW_LIMIT))
    }
    expect(gate.tier.remaining).toBe(0)
  })

  it('allows an active Pro subscription past the Starter cap (higher tier, higher limit)', () => {
    const gate = evaluateBillingGate({
      subscriptionStatus: 'active',
      planTier: 'pro',
      usageCount: STARTER_MONTHLY_REVIEW_LIMIT + 1,
    })
    expect(gate.allowed).toBe(true)
    expect(gate.tier).toMatchObject({ tier: 'pro', limit: PRO_MONTHLY_REVIEW_LIMIT })
  })

  it('blocks an active Pro subscription at its monthly limit', () => {
    const gate = evaluateBillingGate({
      subscriptionStatus: 'active',
      planTier: 'pro',
      usageCount: PRO_MONTHLY_REVIEW_LIMIT,
    })
    expect(gate).toMatchObject({ allowed: false, reason: 'tier_limit_reached' })
  })

  it('treats an Enterprise subscription as unlimited', () => {
    const gate = evaluateBillingGate({
      subscriptionStatus: 'active',
      planTier: 'enterprise',
      usageCount: 1_000_000,
    })
    expect(gate.allowed).toBe(true)
    expect(gate.tier).toMatchObject({ tier: 'enterprise', limit: null, remaining: null })
  })

  it('ignores planTier when the subscription is not active (free tier governs)', () => {
    // A trialing row that somehow carries a paid planTier is still gated by the
    // free-tier limit — you only get a paid tier's limit with an active sub.
    const gate = evaluateBillingGate({
      subscriptionStatus: 'trialing',
      planTier: 'pro',
      usageCount: FREE_TIER_REVIEW_LIMIT,
    })
    expect(gate).toMatchObject({ allowed: false, reason: 'free_tier_exhausted' })
    expect(gate.tier.tier).toBe('trialing')
  })
})

describe('resolvePlanTier', () => {
  it('resolves a recognised active paid tier', () => {
    expect(resolvePlanTier({ subscriptionStatus: 'active', planTier: 'starter', usageCount: 0 })).toBe('starter')
    expect(resolvePlanTier({ subscriptionStatus: 'active', planTier: 'pro', usageCount: 0 })).toBe('pro')
    expect(resolvePlanTier({ subscriptionStatus: 'active', planTier: 'enterprise', usageCount: 0 })).toBe('enterprise')
  })

  it('resolves any non-active subscription to the free trialing tier', () => {
    expect(resolvePlanTier({ subscriptionStatus: 'trialing', usageCount: 0 })).toBe('trialing')
    expect(resolvePlanTier({ subscriptionStatus: 'past_due', planTier: 'pro', usageCount: 0 })).toBe('trialing')
  })

  it('grandfathers an active subscription with an unknown tier to enterprise', () => {
    expect(resolvePlanTier({ subscriptionStatus: 'active', usageCount: 0 })).toBe('enterprise')
    expect(resolvePlanTier({ subscriptionStatus: 'active', planTier: 'mystery', usageCount: 0 })).toBe('enterprise')
  })
})
