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

  it('throws when the ciphertext has been tampered with (GCM auth tag mismatch)', async () => {
    const { encryptCredentials, decryptCredentials } = await import('./credentials.js')
    const ciphertext = encryptCredentials({ apiKey: 'phc_tamper_target' })
    const [iv, authTag, encrypted] = ciphertext.split(':')
    // Flip one hex digit in the encrypted segment. GCM's auth tag covers the
    // ciphertext, so ANY single-character change here is guaranteed to fail
    // authentication in decipher.final(). The flip is unambiguous: the new
    // character always differs from the original.
    const flipped = encrypted[0] === '0' ? '1' : '0'
    const tampered = `${iv}:${authTag}:${flipped}${encrypted.slice(1)}`
    expect(tampered).not.toBe(ciphertext)
    // Assert on the OpenSSL auth-failure message so this test can only pass on
    // a genuine tag mismatch — not an incidental JSON.parse error on garbage
    // plaintext (which is what a permissive catch around final() would yield).
    expect(() => decryptCredentials(tampered)).toThrow(/authenticate/)
  })

  it('throws a clear error when TELEMETRY_ENCRYPTION_KEY is missing', async () => {
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', '')
    const { encryptCredentials } = await import('./credentials.js')
    expect(() => encryptCredentials({ apiKey: 'x' })).toThrow(/TELEMETRY_ENCRYPTION_KEY/)
  })
})
