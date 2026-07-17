import { describe, it, expect, beforeEach, vi } from 'vitest';

// AUTH_SECRET must exist before the ./auth module graph loads (its top-level
// NextAuth() runs at import; static imports are hoisted above test bodies).
vi.hoisted(() => {
  process.env.AUTH_SECRET = 'a'.repeat(64);
});

// The jwt callback reads a module-singleton db + these helpers; mock them so
// the real GitHub API / DB / crypto are never touched. shouldRefreshInstallations
// (installation-cache) is left REAL and driven via installationsFetchedAt.
vi.mock('./db', () => ({ db: { account: { findFirst: vi.fn() } } }));
vi.mock('./github-credentials', () => ({ decryptGithubToken: vi.fn() }));
vi.mock('./github', () => ({ fetchAuthorizedGithubLogins: vi.fn() }));
vi.mock('./installations', () => ({
  getAuthorizedInstallations: vi.fn(),
  getStoredInstallations: vi.fn(),
  persistInstallationAccess: vi.fn(),
}));

import { db } from './db';
import { decryptGithubToken } from './github-credentials';
import { fetchAuthorizedGithubLogins } from './github';
import {
  getAuthorizedInstallations,
  getStoredInstallations,
  persistInstallationAccess,
  type AuthorizedInstallation,
} from './installations';
import { authJwtCallback, authSessionCallback } from './auth';

const findFirst = vi.mocked(db.account.findFirst as (args: unknown) => Promise<unknown>);
const decrypt = vi.mocked(decryptGithubToken);
const fetchLogins = vi.mocked(fetchAuthorizedGithubLogins);
const lookup = vi.mocked(getAuthorizedInstallations);
const stored = vi.mocked(getStoredInstallations);
const persist = vi.mocked(persistInstallationAccess);

const INST_ACME: AuthorizedInstallation = { id: 'inst-acme', provider: 'github', owner: 'acme', externalId: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tok = (over: Record<string, unknown> = {}): any => ({ sub: 'user-1', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {}); // fail-closed paths log; keep output quiet
  // Default: no durable rows yet, so the existing tests exercise the live path.
  stored.mockResolvedValue([]);
});

describe('authJwtCallback — linked user', () => {
  it('resolves to the real authorized installations and stamps the fetch time', async () => {
    findFirst.mockResolvedValue({ githubAccessTokenEncrypted: 'enc' });
    decrypt.mockReturnValue('gh-token');
    fetchLogins.mockResolvedValue(['acme']);
    lookup.mockResolvedValue([INST_ACME]);

    const token = await authJwtCallback({ token: tok() });

    expect(token.installations).toEqual([INST_ACME]);
    expect(typeof token.installationsFetchedAt).toBe('number');
  });

  it('passes EXACTLY the authorized logins to the lookup — never widens (tenancy)', async () => {
    findFirst.mockResolvedValue({ githubAccessTokenEncrypted: 'enc' });
    decrypt.mockReturnValue('gh-token');
    // The user administers only acme; globex must never enter the lookup.
    fetchLogins.mockResolvedValue(['acme']);
    lookup.mockResolvedValue([INST_ACME]);

    await authJwtCallback({ token: tok() });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(db, ['acme']);
  });

  it('copies user.id onto token.sub', async () => {
    findFirst.mockResolvedValue(null);
    const token = await authJwtCallback({ token: tok({ sub: undefined }), user: { id: 'user-9' } });
    expect(token.sub).toBe('user-9');
  });
});

describe('authJwtCallback — durable stored rows (connection-reset fix)', () => {
  it('prefers the durable stored rows and never touches the GitHub API when they exist', async () => {
    stored.mockResolvedValue([INST_ACME]);

    const token = await authJwtCallback({ token: tok() });

    expect(token.installations).toEqual([INST_ACME]);
    // The whole point: no live derivation, so a GitHub outage can't drop them.
    expect(findFirst).not.toHaveBeenCalled();
    expect(fetchLogins).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(typeof token.installationsFetchedAt).toBe('number');
  });

  it('write-through: after a successful live derivation (no stored rows yet) it persists the mapping', async () => {
    stored.mockResolvedValue([]); // un-backfilled user
    findFirst.mockResolvedValue({ githubAccessTokenEncrypted: 'enc' });
    decrypt.mockReturnValue('gh-token');
    fetchLogins.mockResolvedValue(['acme']);
    lookup.mockResolvedValue([INST_ACME]);

    const token = await authJwtCallback({ token: tok() });

    expect(token.installations).toEqual([INST_ACME]);
    expect(persist).toHaveBeenCalledWith(db, 'user-1', [INST_ACME]);
  });

  it('does not write-through when the live derivation itself fails (never persists a bad/empty mapping over a throw)', async () => {
    stored.mockResolvedValue([]);
    findFirst.mockResolvedValue({ githubAccessTokenEncrypted: 'enc' });
    decrypt.mockReturnValue('gh-token');
    fetchLogins.mockRejectedValue(new Error('GitHub 503'));

    await authJwtCallback({ token: tok({ installations: [INST_ACME] }) });

    expect(persist).not.toHaveBeenCalled();
  });
});

describe('authJwtCallback — unlinked user', () => {
  it('resolves to [] without decrypting or calling GitHub, no crash', async () => {
    findFirst.mockResolvedValue(null); // no github Account row

    const token = await authJwtCallback({ token: tok() });

    expect(token.installations).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
    expect(fetchLogins).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('authJwtCallback — fails CLOSED (never fails open to "show everything")', () => {
  it('keeps last-known-good installations when the GitHub API call throws', async () => {
    findFirst.mockResolvedValue({ githubAccessTokenEncrypted: 'enc' });
    decrypt.mockReturnValue('gh-token');
    fetchLogins.mockRejectedValue(new Error('GitHub 503'));

    // token already carries a prior mapping (fetchedAt undefined forces a refresh attempt).
    const token = await authJwtCallback({ token: tok({ installations: [INST_ACME] }) });

    expect(token.installations).toEqual([INST_ACME]); // preserved, not wiped, not widened
  });

  it('falls back to [] on the FIRST attempt when the GitHub API throws (no prior mapping)', async () => {
    findFirst.mockResolvedValue({ githubAccessTokenEncrypted: 'enc' });
    decrypt.mockReturnValue('gh-token');
    fetchLogins.mockRejectedValue(new Error('boom'));

    const token = await authJwtCallback({ token: tok() });

    expect(token.installations).toEqual([]);
  });

  it('falls back to [] (not a thrown session) when token decryption fails', async () => {
    findFirst.mockResolvedValue({ githubAccessTokenEncrypted: 'enc' });
    decrypt.mockImplementation(() => {
      throw new Error('bad key / revoked token');
    });

    const token = await authJwtCallback({ token: tok() });

    expect(token.installations).toEqual([]);
    expect(fetchLogins).not.toHaveBeenCalled();
  });

  it('never throws out of the callback even on an unexpected db failure', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    await expect(authJwtCallback({ token: tok() })).resolves.toBeDefined();
  });
});

describe('authJwtCallback — TTL cache', () => {
  it('does NOT refetch while the cached mapping is fresh', async () => {
    const token = await authJwtCallback({
      token: tok({ installations: [INST_ACME], installationsFetchedAt: Date.now() }),
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(fetchLogins).not.toHaveBeenCalled();
    expect(token.installations).toEqual([INST_ACME]);
  });
});

describe('authSessionCallback', () => {
  it('copies the token installations + sub onto the session', async () => {
    const session = await authSessionCallback({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session: { user: {} } as any,
      token: tok({ installations: [INST_ACME] }),
    });
    expect(session.installations).toEqual([INST_ACME]);
    expect(session.user.id).toBe('user-1');
  });

  it('defaults installations to [] when the token has none', async () => {
    const session = await authSessionCallback({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session: { user: {} } as any,
      token: tok(),
    });
    expect(session.installations).toEqual([]);
  });
});

describe('authJwtCallback — per-user tenancy (no shared-identity leak)', () => {
  const INST_GLOBEX: AuthorizedInstallation = { id: 'inst-globex', provider: 'github', owner: 'globex', externalId: 2 };

  it("resolves installations by the token's OWN userId — user A never inherits user B's", async () => {
    // db keyed by userId: each user has their own linked github account. This is
    // the invariant the dummy-user-id leak violated (all users → one identity).
    findFirst.mockImplementation(async (args: unknown) => {
      const userId = (args as { where: { userId: string } }).where.userId;
      if (userId === 'user-A') return { githubAccessTokenEncrypted: 'enc-A' };
      if (userId === 'user-B') return { githubAccessTokenEncrypted: 'enc-B' };
      return null;
    });
    decrypt.mockImplementation((enc: string) => (enc === 'enc-A' ? 'tok-A' : 'tok-B'));
    fetchLogins.mockImplementation(async (t: string) => (t === 'tok-A' ? ['acme'] : ['globex']));
    lookup.mockImplementation(async (_db, logins: string[]) =>
      logins.includes('acme') ? [INST_ACME] : [INST_GLOBEX],
    );

    const a = await authJwtCallback({ token: tok({ sub: 'user-A' }) });
    const b = await authJwtCallback({ token: tok({ sub: 'user-B' }) });

    expect(a.installations).toEqual([INST_ACME]);
    expect(b.installations).toEqual([INST_GLOBEX]);
    // The leak invariant: neither session inherits the other's installations.
    expect(a.installations).not.toContainEqual(INST_GLOBEX);
    expect(b.installations).not.toContainEqual(INST_ACME);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-A', provider: 'github' } }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-B', provider: 'github' } }),
    );
  });

  it('an unknown/unlinked userId resolves to [] (no fallback to another user)', async () => {
    findFirst.mockResolvedValue(null);
    const stranger = await authJwtCallback({ token: tok({ sub: 'user-Z' }) });
    expect(stranger.installations).toEqual([]);
  });
});
