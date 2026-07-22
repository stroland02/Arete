import { describe, it, expect } from 'vitest'
import { fingerprintScoped, fingerprintError } from '@arete/telemetry/fingerprint'
import { fingerprintComment } from './fingerprint.js'

describe('fingerprintComment', () => {
  it('normalizes dynamic variables to produce the same fingerprint', () => {
    const commentA = 'Missing auth check on route /api/users/123/profile with ID 550e8400-e29b-41d4-a716-446655440000.'
    const commentB = 'Missing auth check on route /api/users/999/profile with ID 123e4567-e89b-12d3-a456-426614174000.'
    
    const hashA = fingerprintComment(commentA, 'Security')
    const hashB = fingerprintComment(commentB, 'Security')
    
    expect(hashA).toBe(hashB)
    expect(hashA.length).toBe(16)
  })

  it('produces different fingerprints for different categories', () => {
    const comment = 'Missing auth check'
    const hashA = fingerprintComment(comment, 'Security')
    const hashB = fingerprintComment(comment, 'Performance')

    expect(hashA).not.toBe(hashB)
  })

  // Pinned against the pre-delegation implementation (the rule list that used
  // to live in this file). Proves the move to @arete/telemetry/fingerprint
  // changed no output, so every fingerprint already written to ErrorGroup /
  // ReviewComment still matches what this function now returns.
  it('still returns the same digest the inlined implementation returned', () => {
    expect(fingerprintComment('Missing auth check', 'Security')).toBe('0d6fcf34ccd03860')
  })

  it('is the shared primitive, with the category as the scope', () => {
    expect(fingerprintComment('Missing auth check', 'Security')).toBe(
      fingerprintScoped('Security', 'Missing auth check')
    )
  })
})

describe('one normalizer across the lanes (telemetry-tenancy contract §5)', () => {
  // The comment lane and the error lane are the SAME hash under different
  // domain vocabulary — asserted rather than merely documented, so a change to
  // either wrapper that forked the algorithm fails here.
  it('fingerprintComment(body, category) === fingerprintError(category, body)', () => {
    const text = 'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed after 3 tries'
    expect(fingerprintComment(text, 'arete-worker')).toBe(fingerprintError('arete-worker', text))
  })

  // The same frozen literal the dashboard's read-time test and the telemetry
  // emit-time test assert independently.
  it('agrees with the frozen cross-surface golden value', () => {
    expect(
      fingerprintError(
        'arete-worker',
        'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed at 2026-07-21T21:01:31Z after 3 tries'
      )
    ).toBe('59cd230950082264')
  })
})
