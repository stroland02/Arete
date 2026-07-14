import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptCredentials } from './telemetry-credentials';
import { decryptGithubToken } from './github-credentials';

const TEST_KEY = '6b9ffdda0d7c8f979797ee8e487a834a0a98695d62c249c1727f5a5f5d84be17';

describe('decryptGithubToken', () => {
  const original = process.env.TELEMETRY_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TELEMETRY_ENCRYPTION_KEY = TEST_KEY;
  });
  afterEach(() => {
    process.env.TELEMETRY_ENCRYPTION_KEY = original;
  });

  it('round-trips a token through encryptCredentials -> decryptGithubToken', () => {
    const encrypted = encryptCredentials({ accessToken: 'gho_abc123' });
    expect(decryptGithubToken(encrypted)).toBe('gho_abc123');
  });

  it('throws on a tampered auth tag (detects ciphertext tampering)', () => {
    const encrypted = encryptCredentials({ accessToken: 'gho_abc123' });
    const [ivHex, authTagHex, cipherHex] = encrypted.split(':');
    const tamperedByte = ((parseInt(authTagHex.slice(0, 2), 16) ^ 0xff) & 0xff)
      .toString(16)
      .padStart(2, '0');
    const tamperedAuthTag = tamperedByte + authTagHex.slice(2);
    const tampered = `${ivHex}:${tamperedAuthTag}:${cipherHex}`;
    expect(() => decryptGithubToken(tampered)).toThrow();
  });

  it('throws a clear configuration error when TELEMETRY_ENCRYPTION_KEY is unset', () => {
    const encrypted = encryptCredentials({ accessToken: 'gho_abc123' });
    delete process.env.TELEMETRY_ENCRYPTION_KEY;
    expect(() => decryptGithubToken(encrypted)).toThrow(
      'Configuration error: TELEMETRY_ENCRYPTION_KEY is required'
    );
  });
});
