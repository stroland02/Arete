import { createDecipheriv } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptCredentials, decryptCredentials } from './telemetry-credentials';

const TEST_KEY = '6b9ffdda0d7c8f979797ee8e487a834a0a98695d62c249c1727f5a5f5d84be17';

// Mirrors webhook's decryptCredentials exactly (packages/webhook/src/telemetry/credentials.ts)
// — used here ONLY to prove the two are byte-format-compatible, not as a
// dashboard-side decrypt capability (dashboard never decrypts a credential
// back, only writes one).
function decryptLikeWebhook<T>(ciphertext: string): T {
  const key = Buffer.from(TEST_KEY, 'hex');
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

describe('encryptCredentials', () => {
  const original = process.env.TELEMETRY_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TELEMETRY_ENCRYPTION_KEY = TEST_KEY;
  });
  afterEach(() => {
    process.env.TELEMETRY_ENCRYPTION_KEY = original;
  });

  it('produces ciphertext webhook\'s decryptCredentials format can read back byte-for-byte', () => {
    const ciphertext = encryptCredentials({ secretKey: 'rk_test_12345' });

    expect(ciphertext.split(':')).toHaveLength(3);
    const decrypted = decryptLikeWebhook<{ secretKey: string }>(ciphertext);
    expect(decrypted).toEqual({ secretKey: 'rk_test_12345' });
  });

  it('never produces the same ciphertext twice for the same plaintext (random IV per call)', () => {
    const a = encryptCredentials({ secretKey: 'rk_test_12345' });
    const b = encryptCredentials({ secretKey: 'rk_test_12345' });
    expect(a).not.toBe(b);
  });

  it('throws a clear configuration error when TELEMETRY_ENCRYPTION_KEY is unset', () => {
    delete process.env.TELEMETRY_ENCRYPTION_KEY;
    expect(() => encryptCredentials({ secretKey: 'rk_test_12345' })).toThrow(
      'Configuration error: TELEMETRY_ENCRYPTION_KEY is required'
    );
  });
});

describe('decryptCredentials', () => {
  const original = process.env.TELEMETRY_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TELEMETRY_ENCRYPTION_KEY = TEST_KEY;
  });
  afterEach(() => {
    process.env.TELEMETRY_ENCRYPTION_KEY = original;
  });

  it('round-trips an encrypted credential back to the original object', () => {
    const secret = { apiKey: 'sk-ant-abc123', extra: 'v' };
    expect(decryptCredentials<typeof secret>(encryptCredentials(secret))).toEqual(secret);
  });

  it('reads back exactly what encryptCredentials wrote (used to build the chat llm block)', () => {
    const ciphertext = encryptCredentials({ apiKey: 'rk_test_12345' });
    expect(decryptCredentials<{ apiKey: string }>(ciphertext).apiKey).toBe('rk_test_12345');
  });

  it('throws when TELEMETRY_ENCRYPTION_KEY is unset', () => {
    const ciphertext = encryptCredentials({ apiKey: 'x' });
    delete process.env.TELEMETRY_ENCRYPTION_KEY;
    expect(() => decryptCredentials(ciphertext)).toThrow(
      'Configuration error: TELEMETRY_ENCRYPTION_KEY is required'
    );
  });
});
