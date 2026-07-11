import { describe, it, expect } from 'vitest';
import { shouldRefreshInstallations, INSTALLATION_CACHE_TTL_MS } from './installation-cache';

describe('shouldRefreshInstallations', () => {
  it('is true when there is no prior fetch (first sign-in)', () => {
    expect(shouldRefreshInstallations(undefined, Date.now())).toBe(true);
  });

  it('is false when the cache is fresh (well within the TTL)', () => {
    const now = 1_000_000;
    const fetchedAt = now - 1000; // 1 second ago
    expect(shouldRefreshInstallations(fetchedAt, now)).toBe(false);
  });

  it('is false exactly at the TTL boundary (not yet stale)', () => {
    const now = 1_000_000;
    const fetchedAt = now - INSTALLATION_CACHE_TTL_MS;
    expect(shouldRefreshInstallations(fetchedAt, now)).toBe(false);
  });

  it('is true once the cache exceeds the TTL', () => {
    const now = 1_000_000;
    const fetchedAt = now - INSTALLATION_CACHE_TTL_MS - 1;
    expect(shouldRefreshInstallations(fetchedAt, now)).toBe(true);
  });

  it('honors a custom TTL override', () => {
    const now = 1_000_000;
    const fetchedAt = now - 100;
    expect(shouldRefreshInstallations(fetchedAt, now, 50)).toBe(true);
    expect(shouldRefreshInstallations(fetchedAt, now, 200)).toBe(false);
  });
});
