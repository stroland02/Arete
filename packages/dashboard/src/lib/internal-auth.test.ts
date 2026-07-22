import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { internalAuthHeaders } from './internal-auth';
import { verifyInternalToken } from '@arete/internal-token';

const KEYS = JSON.stringify({ k1: 'a'.repeat(48) });

beforeEach(() => {
  process.env.INTERNAL_TOKEN_SIGNING_KEYS = KEYS;
  process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1';
});

afterEach(() => {
  delete process.env.INTERNAL_TOKEN_SIGNING_KEYS;
  delete process.env.INTERNAL_TOKEN_ACTIVE_KID;
});

describe('internalAuthHeaders', () => {
  it('returns a bearer Authorization header carrying a signed dashboard token that the shared verifier accepts', async () => {
    const headers = await internalAuthHeaders();
    expect(Object.keys(headers)).toEqual(['authorization']);
    const match = /^Bearer (.+)$/.exec(headers.authorization);
    expect(match).not.toBeNull();

    const result = await verifyInternalToken(headers.authorization);
    expect(result).toMatchObject({ ok: true, iss: 'arete-dashboard' });
  });

  it('returns no headers when the keyset is unconfigured (fail-closed elsewhere, not us)', async () => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS;
    expect(await internalAuthHeaders()).toEqual({});
  });
});
