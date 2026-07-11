import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('credentials encryption', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64)) // 32 bytes hex
  })

  it('round-trips a credential object through encrypt/decrypt', async () => {
    const { encryptCredentials, decryptCredentials } = await import('./credentials.js')
    const original = { apiKey: 'phc_super_secret_key_12345' }
    const ciphertext = encryptCredentials(original)
    expect(ciphertext).not.toContain('phc_super_secret_key_12345')
    const decrypted = decryptCredentials<typeof original>(ciphertext)
    expect(decrypted).toEqual(original)
  })

  it('produces different ciphertext for the same input on repeated calls (random IV)', async () => {
    const { encryptCredentials } = await import('./credentials.js')
    const a = encryptCredentials({ apiKey: 'x' })
    const b = encryptCredentials({ apiKey: 'x' })
    expect(a).not.toBe(b)
  })

  it('throws a clear error when TELEMETRY_ENCRYPTION_KEY is missing', async () => {
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', '')
    const { encryptCredentials } = await import('./credentials.js')
    expect(() => encryptCredentials({ apiKey: 'x' })).toThrow(/TELEMETRY_ENCRYPTION_KEY/)
  })
})
