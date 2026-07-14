import NextAuth from 'next-auth';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { db } from './db';
import { verifyCredentials, upsertGoogleUser } from './users';
import { decryptGithubToken } from './github-credentials';
import { fetchAuthorizedGithubLogins } from './github';
import { getAuthorizedInstallations } from './installations';
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
      const link = await db.account.findFirst({
        where: { userId: token.sub, provider: 'github' },
        select: { githubAccessTokenEncrypted: true },
      });
      if (link?.githubAccessTokenEncrypted) {
        const accessToken = decryptGithubToken(link.githubAccessTokenEncrypted);
        const logins = await fetchAuthorizedGithubLogins(accessToken);
        token.installations = await getAuthorizedInstallations(db, logins);
      } else {
        token.installations = [];
      }
      token.installationsFetchedAt = now;
    } catch (error) {
      // Transient GitHub API failure or a revoked/expired token: keep
      // serving the last-known-good mapping (or [] on first attempt)
      // rather than failing the whole session — never fail open to
      // "show everything."
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
        return { id: "dummy-user-id", email };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        const email = profile?.email ?? user?.email;
        if (!email) return false;
        user.id = "dummy-user-id";
      }
      return true;
    },
    jwt: authJwtCallback,
    session: authSessionCallback,
  },
});
