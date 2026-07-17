import NextAuth from 'next-auth';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { db } from './db';
import { verifyCredentials, upsertGoogleUser } from './users';
import { decryptGithubToken } from './github-credentials';
import { fetchAuthorizedGithubLogins } from './github';
import {
  getAuthorizedInstallations,
  getStoredInstallations,
  persistInstallationAccess,
} from './installations';
import { shouldRefreshInstallations } from './installation-cache';

// Extracted (behavior-preserving) from the inline NextAuth() callbacks so
// they can be unit-tested directly against a fake db/fetch, without
// constructing a live NextAuth() instance or a real DATABASE_URL. See
// docs/superpowers/plans/2026-07-13-github-app-installations.md Task T1.
export async function authJwtCallback({
  token,
  user,
}: {
  token: JWT;
  user?: { id?: string } | null;
}): Promise<JWT> {
  if (user?.id) token.sub = user.id;

  const now = Date.now();
  if (token.sub && shouldRefreshInstallations(token.installationsFetchedAt, now)) {
    try {
      // Prefer the DURABLE stored rows (written at connect time / write-through)
      // so a login no longer depends on the GitHub API round-trip that the
      // connection-reset incident showed to be fragile. Only when a user has no
      // stored rows yet (not backfilled) do we fall back to live derivation —
      // and then we write-through so future logins read the durable rows.
      const stored = await getStoredInstallations(db, token.sub);
      if (stored.length > 0) {
        token.installations = stored;
      } else {
        const link = await db.account.findFirst({
          where: { userId: token.sub, provider: 'github' },
          select: { githubAccessTokenEncrypted: true },
        });
        if (link?.githubAccessTokenEncrypted) {
          const accessToken = decryptGithubToken(link.githubAccessTokenEncrypted);
          const logins = await fetchAuthorizedGithubLogins(accessToken);
          const live = await getAuthorizedInstallations(db, logins);
          token.installations = live;
          // Backfill the durable mapping (reconciles: adds current, prunes stale).
          await persistInstallationAccess(db, token.sub, live);
        } else {
          token.installations = [];
        }
      }
      token.installationsFetchedAt = now;
    } catch (error) {
      // Transient failure (GitHub API, a revoked/expired token, or a DB hiccup):
      // keep serving the last-known-good mapping (or [] on first attempt) rather
      // than failing the whole session — never fail open to "show everything."
      console.error('[auth] failed to refresh authorized installations', error);
      token.installations = token.installations ?? [];
      token.installationsFetchedAt = token.installationsFetchedAt ?? now;
    }
  }

  return token;
}

export async function authSessionCallback({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Promise<Session> {
  if (session.user && token.sub) session.user.id = token.sub;
  session.installations = token.installations ?? [];
  return session;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = typeof creds?.email === 'string' ? creds.email : '';
        const password = typeof creds?.password === 'string' ? creds.password : '';
        if (!email || !password) return null;
        // Real per-user identity: validate against the User row and return its
        // actual id — never a shared placeholder (would collapse all users into
        // one identity → cross-tenant reads).
        const user = await verifyCredentials(db, email, password);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        const email = profile?.email ?? user?.email;
        if (!email) return false;
        // Real per-user identity: upsert the Google account → a real User row
        // and use its actual id, so each Google user is a distinct tenant.
        const dbUser = await upsertGoogleUser(db, {
          email,
          name: user?.name ?? null,
          image: user?.image ?? null,
          providerAccountId: account.providerAccountId,
        });
        user.id = dbUser.id;
      }
      return true;
    },
    jwt: authJwtCallback,
    session: authSessionCallback,
  },
});
