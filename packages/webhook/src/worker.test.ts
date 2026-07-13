import { describe, it, expect } from 'vitest'
import { buildCloneContext } from './worker.js'

describe('buildCloneContext', () => {
  it('builds an https clone URL and carries the installation token/id', () => {
    const result = buildCloneContext('acme/api', 42, 'ghs_abc123')
    expect(result).toEqual({
      cloneUrl: 'https://github.com/acme/api.git',
      installationToken: 'ghs_abc123',
      installationId: 42,
    })
  })
})
