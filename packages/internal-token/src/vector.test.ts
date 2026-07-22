import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach } from 'vitest'
import { mintInternalToken, verifyInternalToken } from './index.js'

// Cross-language contract: docs/superpowers/fixtures/internal-token-vector.json
// is also consumed by the Python verifier (Task 4). Loaded via fs (rather
// than a static JSON import) so it can live outside this package's rootDir
// without upsetting tsc. If this test ever needs a different expected token
// string, the wire format has changed and the fixture + Python side must be
// updated together.

const fixturePath = fileURLToPath(
  new URL('../../../docs/superpowers/fixtures/internal-token-vector.json', import.meta.url),
)
const vector = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  input: { keys: Record<string, string>; activeKid: string; iss: string; iat: number; exp: number }
  token: string
  verify: { acceptsAtNow: number; expiredAtNow: number }
}

beforeEach(() => {
  process.env.INTERNAL_TOKEN_SIGNING_KEYS = JSON.stringify(vector.input.keys)
  process.env.INTERNAL_TOKEN_ACTIVE_KID = vector.input.activeKid
})

describe('internal-token cross-language vector', () => {
  it('mintInternalToken reproduces the exact fixture token for fixed inputs', async () => {
    const token = await mintInternalToken(vector.input.iss as 'arete-webhook', { now: vector.input.iat })
    expect(token).toBe(vector.token)
  })

  it('verifyInternalToken accepts the fixture token before expiry', async () => {
    const result = await verifyInternalToken(`Bearer ${vector.token}`, { now: vector.verify.acceptsAtNow })
    expect(result).toEqual({ ok: true, iss: vector.input.iss, kid: vector.input.activeKid })
  })

  it('verifyInternalToken reports expired for the fixture token past its exp', async () => {
    const result = await verifyInternalToken(`Bearer ${vector.token}`, { now: vector.verify.expiredAtNow })
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })
})
