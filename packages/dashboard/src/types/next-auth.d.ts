import type { AuthorizedInstallation } from '../lib/installations';

declare module 'next-auth' {
  interface Session {
    installations: AuthorizedInstallation[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    installations?: AuthorizedInstallation[];
    installationsFetchedAt?: number;
  }
}

// next-auth's jwt callback param type is re-exported from @auth/core/jwt;
// augmenting only 'next-auth/jwt' above doesn't merge into that underlying
// declaration, so callbacks.jwt's `token` still type-checks against the
// un-augmented interface without this.
declare module '@auth/core/jwt' {
  interface JWT {
    accessToken?: string;
    installations?: AuthorizedInstallation[];
    installationsFetchedAt?: number;
  }
}
