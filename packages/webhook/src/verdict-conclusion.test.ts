import { describe, it, expect } from 'vitest'
import { reviewConclusion } from './verdict-conclusion.js'

describe('reviewConclusion', () => {
  it('maps blocked -> action_required', () => {
    expect(reviewConclusion({ verdict: 'blocked', risk_level: 'critical' })).toBe('action_required')
  })

  it('maps review-required -> action_required', () => {
    expect(reviewConclusion({ verdict: 'review-required', risk_level: 'high' })).toBe('action_required')
  })

  it('maps comment -> success (advisory, non-blocking)', () => {
    expect(reviewConclusion({ verdict: 'comment', risk_level: 'medium' })).toBe('success')
  })

  it('maps pass -> success', () => {
    expect(reviewConclusion({ verdict: 'pass', risk_level: 'low' })).toBe('success')
  })

  it('BUG FIX: a failed review (verdict blocked, risk_level low) is action_required, not success', () => {
    // Before SP4 surfacing, a total-outage review kept risk_level 'low' and so
    // reported 'success' ("safe to merge") even though nothing was reviewed.
    expect(reviewConclusion({ verdict: 'blocked', risk_level: 'low' })).toBe('action_required')
  })

  it('falls back to risk_level when verdict is absent: high -> action_required', () => {
    expect(reviewConclusion({ risk_level: 'high' })).toBe('action_required')
  })

  it('falls back to risk_level when verdict is absent: low -> success', () => {
    expect(reviewConclusion({ risk_level: 'low' })).toBe('success')
  })
})
