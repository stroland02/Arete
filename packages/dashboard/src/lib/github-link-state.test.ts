import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('GitHub link state token', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(64));
  });

  it('round-trips userId through sign/verify', async () => {
    const { signGithubLinkState, verifyGithubLinkState } = await import('./github-link-state');
    const token = signGithubLinkState('user-123');
    const result = verifyGithubLinkState(token);
    expect(result).toEqual({ userId: 'user-123' });
  });

  it('rejects a tampered token', async () => {
    const { signGithubLinkState, verifyGithubLinkState } = await import('./github-link-state');
    const token = signGithubLinkState('user-123');
    // Flip an interior character, not the last one: the token's decoded
    // length is not a multiple of 3, so the final base64url char carries
    // only 2 significant bits — swapping it is a decode no-op some of the
    // time. An interior char is always fully significant.
    const tampered = token.slice(0, 10) + (token[10] === 'a' ? 'b' : 'a') + token.slice(11);
    expect(verifyGithubLinkState(tampered)).toBeNull();
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'));
    const { signGithubLinkState, verifyGithubLinkState } = await import('./github-link-state');
    const token = signGithubLinkState('user-123');
    vi.setSystemTime(new Date('2026-07-11T00:11:00Z')); // past the 10-minute TTL
    expect(verifyGithubLinkState(token)).toBeNull();
    vi.useRealTimers();
  });

  it('rejects malformed input without throwing', async () => {
    const { verifyGithubLinkState } = await import('./github-link-state');
    expect(verifyGithubLinkState('not-a-real-token')).toBeNull();
    expect(verifyGithubLinkState('')).toBeNull();
  });
});
