import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildGithubLinkAuthorizeUrl,
  exchangeGithubLinkCode,
  linkGithubAccount,
  GithubAccountConflictError,
  type GithubLinkDb,
} from './github-link';
import { verifyGithubLinkState } from './github-link-state';

const ENV = {
  GITHUB_LINK_CLIENT_ID: 'client-id-123',
  GITHUB_LINK_CLIENT_SECRET: 'client-secret-456',
  GITHUB_LINK_REDIRECT_BASE_URL: 'https://dashboard.example.com',
  AUTH_SECRET: 'a'.repeat(64),
  TELEMETRY_ENCRYPTION_KEY: '6b9ffdda0d7c8f979797ee8e487a834a0a98695d62c249c1727f5a5f5d84be17',
};

function fakeDb(initial: Array<{ id: string; userId: string; provider: string; providerAccountId: string }> = []) {
  const rows = [...initial];
  const db: GithubLinkDb = {
    account: {
      findUnique: async ({ where }) => {
        const { provider, providerAccountId } = where.provider_providerAccountId;
        return rows.find((r) => r.provider === provider && r.providerAccountId === providerAccountId) ?? null;
      },
      create: async ({ data }) => {
        rows.push({ id: `acc-${rows.length + 1}`, userId: data.userId, provider: data.provider, providerAccountId: data.providerAccountId });
        return null;
      },
      update: async ({ where }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        return null;
      },
    },
  };
  return { db, rows };
}

describe('buildGithubLinkAuthorizeUrl', () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('embeds a verifiable signed state for the given userId', () => {
    const url = new URL(buildGithubLinkAuthorizeUrl('user-123'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id-123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://dashboard.example.com/api/github-link/callback'
    );
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(verifyGithubLinkState(state!)).toEqual({ userId: 'user-123' });
  });

  it('throws when GITHUB_LINK_CLIENT_ID is unset', () => {
    delete process.env.GITHUB_LINK_CLIENT_ID;
    expect(() => buildGithubLinkAuthorizeUrl('user-123')).toThrow(
      'Configuration error: GITHUB_LINK_CLIENT_ID is required'
    );
  });
});

describe('exchangeGithubLinkCode', () => {
  const original = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    process.env = { ...original };
    global.fetch = originalFetch;
  });

  it('returns accessToken/login/githubUserId on a successful exchange', async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href.includes('login/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'gho_abc123' }), { status: 200 });
      }
      if (href.includes('api.github.com/user')) {
        return new Response(JSON.stringify({ id: 42, login: 'octocat' }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;

    const result = await exchangeGithubLinkCode('good-code');
    expect(result).toEqual({ accessToken: 'gho_abc123', login: 'octocat', githubUserId: 42 });
  });

  it('returns null when the token endpoint responds non-OK', async () => {
    global.fetch = vi.fn(async () => new Response('bad request', { status: 400 })) as unknown as typeof fetch;
    const result = await exchangeGithubLinkCode('bad-code');
    expect(result).toBeNull();
  });

  it('returns null when the token response has no access_token', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    const result = await exchangeGithubLinkCode('weird-code');
    expect(result).toBeNull();
  });

  it('returns null when /user lookup fails after a successful token exchange', async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href.includes('login/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'gho_abc123' }), { status: 200 });
      }
      return new Response('unauthorized', { status: 401 });
    }) as unknown as typeof fetch;

    const result = await exchangeGithubLinkCode('good-code');
    expect(result).toBeNull();
  });

  it('never throws even if fetch itself rejects', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(exchangeGithubLinkCode('any-code')).resolves.toBeNull();
  });
});

describe('linkGithubAccount', () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('creates a new Account row when none exists for that providerAccountId', async () => {
    const { db, rows } = fakeDb();
    await linkGithubAccount(db, { userId: 'user-1', githubUserId: 42, accessToken: 'gho_abc' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'user-1', provider: 'github', providerAccountId: '42' });
  });

  it('updates the token in place on a second call with the SAME userId', async () => {
    const { db, rows } = fakeDb([{ id: 'acc-1', userId: 'user-1', provider: 'github', providerAccountId: '42' }]);
    await linkGithubAccount(db, { userId: 'user-1', githubUserId: 42, accessToken: 'gho_new' });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('user-1');
  });

  it('throws GithubAccountConflictError when the GitHub account is linked to a DIFFERENT user', async () => {
    const { db } = fakeDb([{ id: 'acc-1', userId: 'user-1', provider: 'github', providerAccountId: '42' }]);
    await expect(
      linkGithubAccount(db, { userId: 'user-2', githubUserId: 42, accessToken: 'gho_new' })
    ).rejects.toThrow(GithubAccountConflictError);
  });
});
