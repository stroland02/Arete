import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { db } from './db';
import { verifyCredentials, upsertGoogleUser } from './users';

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
        return await verifyCredentials(db, email, password);
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        const email = profile?.email ?? user?.email;
        if (!email) return false;
        const appUser = await upsertGoogleUser(db, {
          email,
          name: (profile?.name as string) ?? null,
          image: (profile?.picture as string) ?? null,
          providerAccountId: account.providerAccountId,
        });
        // Stash the app user id so the jwt callback can pick it up.
        user.id = appUser.id;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      // GitHub→account linking is a later spec; no installations yet.
      session.installations = [];
      return session;
    },
  },
});
