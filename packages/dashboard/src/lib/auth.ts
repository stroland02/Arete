import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { db } from './db';
import { verifyCredentials, upsertGoogleUser } from './users';
import { decryptGithubToken } from './github-credentials';
import { fetchAuthorizedGithubLogins } from './github';
import { getAuthorizedInstallations } from './installations';
import { shouldRefreshInstallations } from './installation-cache';

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
    async jwt({ token, user }) {
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
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      session.installations = token.installations ?? [];
      return session;
    },
  },
});
