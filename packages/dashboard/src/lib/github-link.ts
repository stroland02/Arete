import type { PrismaClient } from '@arete/db';
import { signGithubLinkState } from './github-link-state';
import { encryptCredentials } from './telemetry-credentials';

export interface GithubLinkResult {
  accessToken: string;
  login: string;
  githubUserId: number;
}

/** Narrow slice of the Prisma client this module depends on, so tests can pass a fake. */
export interface GithubLinkDb {
  account: {
    findUnique: (args: {
      where: { provider_providerAccountId: { provider: string; providerAccountId: string } };
    }) => Promise<{ id: string; userId: string } | null>;
    findFirst: (args: {
      where: { userId: string; provider: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        userId: string;
        provider: string;
        providerAccountId: string;
        githubAccessTokenEncrypted: string;
      };
    }) => Promise<unknown>;
    update: (args: {
      where: { id: string };
      data: { githubAccessTokenEncrypted: string };
    }) => Promise<unknown>;
  };
}

/**
 * Thrown by linkGithubAccount when the GitHub account being linked is
 * already linked to a DIFFERENT dashboard user. Callers must not swallow
 * this into a generic failure — reassigning a GitHub identity's ownership
 * silently would be a tenancy violation (see plan Task B4).
 */
export class GithubAccountConflictError extends Error {
  constructor(providerAccountId: string) {
    super(`GitHub account ${providerAccountId} is already linked to a different user`);
    this.name = 'GithubAccountConflictError';
  }
}

function githubLinkRedirectUri(): string {
  const base = process.env.GITHUB_LINK_REDIRECT_BASE_URL;
  if (!base) throw new Error('Configuration error: GITHUB_LINK_REDIRECT_BASE_URL is required');
  return `${base}/api/github-link/callback`;
}

/**
 * Builds the GitHub OAuth authorize URL for the "Connect GitHub" flow, using
 * a dedicated GitHub OAuth App (GITHUB_LINK_CLIENT_ID) distinct from both
 * the Areté GitHub App (webhook/PR access) and any dashboard login
 * provider. `read:org` + `read:user` matches the scopes
 * fetchAuthorizedGithubLogins (lib/github.ts) needs to call
 * `/user` and `/user/memberships/orgs`.
 */
export function buildGithubLinkAuthorizeUrl(userId: string): string {
  const clientId = process.env.GITHUB_LINK_CLIENT_ID;
  if (!clientId) throw new Error('Configuration error: GITHUB_LINK_CLIENT_ID is required');
  const state = signGithubLinkState(userId);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', githubLinkRedirectUri());
  url.searchParams.set('scope', 'read:org read:user');
  url.searchParams.set('state', state);
  return url.toString();
}

interface RawTokenResponse {
  access_token?: string;
}

interface GithubUserResponse {
  id?: number;
  login?: string;
}

/**
 * Exchanges a GitHub OAuth `code` for an access token, then identifies the
 * GitHub user it belongs to. Never throws — mirrors exchangeOAuthCode's
 * never-throw contract (packages/webhook/src/oauth/oauth-token-exchange.ts):
 * any failure (bad code, network error, missing token, `/user` failure)
 * resolves to `null` so the callback route can show a clean
 * "connection failed" state instead of crashing.
 */
export async function exchangeGithubLinkCode(code: string): Promise<GithubLinkResult | null> {
  try {
    const clientId = process.env.GITHUB_LINK_CLIENT_ID;
    const clientSecret = process.env.GITHUB_LINK_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: githubLinkRedirectUri(),
      }).toString(),
    });
    if (!tokenRes.ok) return null;
    const raw = (await tokenRes.json()) as RawTokenResponse;
    if (!raw.access_token) return null;
    const accessToken = raw.access_token;

    const meRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!meRes.ok) return null;
    const me = (await meRes.json()) as GithubUserResponse;
    if (!me.id || !me.login) return null;

    return { accessToken, login: me.login, githubUserId: me.id };
  } catch {
    return null;
  }
}

/**
 * Upserts the Account row linking a dashboard user to their GitHub
 * identity, keyed on the existing `@@unique([provider, providerAccountId])`
 * constraint. Sets `userId` on create; on update, if the row already
 * belongs to a DIFFERENT user, throws GithubAccountConflictError instead of
 * silently reassigning ownership.
 */
export async function linkGithubAccount(
  db: GithubLinkDb | PrismaClient,
  input: { userId: string; githubUserId: number; accessToken: string }
): Promise<void> {
  const typedDb = db as GithubLinkDb;
  const providerAccountId = String(input.githubUserId);
  const encrypted = encryptCredentials({ accessToken: input.accessToken });

  const existing = await typedDb.account.findUnique({
    where: { provider_providerAccountId: { provider: 'github', providerAccountId } },
  });

  if (existing) {
    if (existing.userId !== input.userId) {
      throw new GithubAccountConflictError(providerAccountId);
    }
    await typedDb.account.update({
      where: { id: existing.id },
      data: { githubAccessTokenEncrypted: encrypted },
    });
    return;
  }

  await typedDb.account.create({
    data: {
      userId: input.userId,
      provider: 'github',
      providerAccountId,
      githubAccessTokenEncrypted: encrypted,
    },
  });
}

/**
 * Whether the given dashboard user already has a linked GitHub account
 * (an `Account` row with `provider: 'github'`). Used by the Settings page
 * to decide between showing the "Connect GitHub" CTA and a connected
 * state — deliberately does NOT decrypt the stored token or call the
 * GitHub API just to render the page; the connected state's installation
 * list comes from `session.installations` (already resolved by auth.ts's
 * jwt callback), never fabricated here.
 */
export async function isGithubLinked(db: GithubLinkDb | PrismaClient, userId: string): Promise<boolean> {
  const typedDb = db as GithubLinkDb;
  const existing = await typedDb.account.findFirst({
    where: { userId, provider: 'github' },
    select: { id: true },
  });
  return existing !== null;
}
