import { describe, it, expect } from 'vitest'
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
})
