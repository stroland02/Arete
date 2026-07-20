import { describe, it, expect, vi, afterEach } from 'vitest';
import { internalAuthHeaders } from './internal-auth';

afterEach(() => vi.unstubAllEnvs());

describe('internalAuthHeaders', () => {
  it('returns a bearer Authorization header when INTERNAL_API_TOKEN is set', () => {
    vi.stubEnv('INTERNAL_API_TOKEN', 's3cret');
    expect(internalAuthHeaders()).toEqual({ authorization: 'Bearer s3cret' });
  });

  it('returns no headers when the token is unset (webhook fails closed, not us)', () => {
    vi.stubEnv('INTERNAL_API_TOKEN', '');
    expect(internalAuthHeaders()).toEqual({});
  });
});
