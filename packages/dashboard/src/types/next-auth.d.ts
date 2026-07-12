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
