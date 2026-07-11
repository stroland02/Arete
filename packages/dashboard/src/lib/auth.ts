import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { db } from './db';
import { fetchAuthorizedGithubLogins } from './github';
import { getAuthorizedInstallations, type AuthorizedInstallation } from './installations';
import { shouldRefreshInstallations } from './installation-cache';

// next-auth's JWT type is `Record<string, unknown> & DefaultJWT`, so custom
// claims read back out as `unknown` unless narrowed. Declaration-merging
// `declare module "next-auth/jwt"` doesn't reliably flow through this
// beta's `export * from "@auth/core/jwt"` re-export chain, so we narrow
// explicitly at the one call site that needs it instead.
interface AppJWT {
  accessToken?: string;
  installations?: AuthorizedInstallation[];
  installationsFetchedAt?: number;
}

/**
 * Dashboard authentication: GitHub OAuth App login (a SEPARATE app from the
 * Areté GitHub App used for webhooks/PR access — this one only identifies
 * the logged-in human).
 *
 * Session strategy: JWT, not database sessions. Database sessions would
 * require Auth.js's own User/Account/Session/VerificationToken tables, and
 * this task is explicitly forbidden from touching packages/db's schema —
 * so JWT is the only viable strategy here, not just the simpler one.
 * Tradeoff: the user -> authorized-installations mapping is baked into the
 * JWT at sign-in and periodically refreshed (see installation-cache.ts)
 * rather than re-derived on every request, trading a few minutes of
 * staleness for not hitting the GitHub API on every page load.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Explicit env var names per the task spec (GITHUB_OAUTH_CLIENT_ID/SECRET)
  // rather than NextAuth's auto-inferred AUTH_GITHUB_ID/SECRET, to keep the
  // naming unambiguous about which OAuth app this is (dashboard login, not
  // the Areté GitHub App used for webhooks).
  providers: [
    GitHub({
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    // Drives proxy.ts (Next 16's renamed middleware): return false to
    // redirect to `pages.signIn`. /login and the NextAuth API routes
    // themselves must stay public or sign-in becomes impossible.
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic = pathname.startsWith('/login') || pathname.startsWith('/api/auth');
      if (isPublic) return true;
      return !!auth?.user;
    },
    async jwt({ token, account }) {
      const appToken = token as typeof token & AppJWT;

      if (account?.access_token) {
        appToken.accessToken = account.access_token;
      }

      const now = Date.now();
      if (
        appToken.accessToken &&
        shouldRefreshInstallations(appToken.installationsFetchedAt, now)
      ) {
        try {
          const logins = await fetchAuthorizedGithubLogins(appToken.accessToken);
          appToken.installations = await getAuthorizedInstallations(db, logins);
          appToken.installationsFetchedAt = now;
        } catch (error) {
          // Transient GitHub API failure: keep serving the last-known-good
          // mapping (or an empty one on first sign-in) rather than failing
          // the whole session. Retried on the next refresh window.
          console.error('[auth] failed to refresh authorized installations', error);
          appToken.installations = appToken.installations ?? [];
          appToken.installationsFetchedAt = appToken.installationsFetchedAt ?? now;
        }
      }

      return appToken;
    },
    async session({ session, token }) {
      session.installations = (token as typeof token & AppJWT).installations ?? [];
      return session;
    },
  },
});
