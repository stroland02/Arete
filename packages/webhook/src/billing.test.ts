import { describe, it, expect } from 'vitest'
import { evaluateBillingGate, FREE_TIER_REVIEW_LIMIT } from './billing.js'

describe('evaluateBillingGate', () => {
  it('allows an unknown installation (no row yet — zero usage)', () => {
    expect(evaluateBillingGate(null)).toEqual({ allowed: true })
  })

  it('allows a trialing installation under the free-tier limit', () => {
    const gate = evaluateBillingGate({ subscriptionStatus: 'trialing', usageCount: FREE_TIER_REVIEW_LIMIT - 1 })
    expect(gate.allowed).toBe(true)
  })

  it('blocks a trialing installation at the free-tier limit with the upgrade message', () => {
    const gate = evaluateBillingGate({ subscriptionStatus: 'trialing', usageCount: FREE_TIER_REVIEW_LIMIT })
    expect(gate).toMatchObject({ allowed: false, reason: 'free_tier_exhausted' })
    if (!gate.allowed) expect(gate.message).toContain('50 free')
  })

  it('allows an active paid subscription regardless of usage count (no PR cap on paid tiers)', () => {
    const gate = evaluateBillingGate({ subscriptionStatus: 'active', usageCount: 10_000 })
    expect(gate.allowed).toBe(true)
  })

  it('blocks canceled and past_due subscriptions regardless of usage count', () => {
    for (const status of ['canceled', 'past_due']) {
      const gate = evaluateBillingGate({ subscriptionStatus: status, usageCount: 0 })
      expect(gate).toMatchObject({ allowed: false, reason: 'subscription_inactive' })
    }
  })
})
