import type { AuthorizedInstallation } from '../lib/installations';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    installations: AuthorizedInstallation[];
  }
}

// next-auth's own `next-auth/jwt` module is a bare `export * from
// "@auth/core/jwt"` re-export (see node_modules/next-auth/jwt.d.ts) — so
// augmenting only "next-auth/jwt" does NOT merge into the `JWT` interface
// the `jwt` callback's `token` param actually type-checks against in this
// beta. Both declarations are required.
declare module 'next-auth/jwt' {
  interface JWT {
    installations?: AuthorizedInstallation[];
    installationsFetchedAt?: number;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    installations?: AuthorizedInstallation[];
    installationsFetchedAt?: number;
  }
}
