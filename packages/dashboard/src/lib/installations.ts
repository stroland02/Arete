import type { PrismaClient } from '@arete/db';

/** Minimal shape of an authorized Installation row, as exposed to the session. */
export interface AuthorizedInstallation {
  id: string;
  provider: string;
  owner: string;
  externalId: number;
}

/** Narrow slice of the Prisma client this module depends on, so tests can pass a fake. */
export interface InstallationLookupDb {
  installation: {
    findMany: (args: {
      where: { provider: 'github'; owner: { in: string[]; mode: 'insensitive' } };
      select: { id: true; provider: true; owner: true; externalId: true };
    }) => Promise<AuthorizedInstallation[]>;
  };
}

/**
 * Resolves which Installation rows a logged-in GitHub user is authorized to
 * see: the Installation.owner (an org login, or the user's own login for a
 * personal-account install) must match one of the logins the caller has
 * admin rights over.
 *
 * `logins` should already be filtered to accounts the user administers
 * (their own personal login, plus orgs where their membership role is
 * 'admin' — see lib/github.ts). This function does no further authorization
 * logic; it is a pure, testable Prisma lookup so the tenancy-scoping
 * property can be verified directly without hitting the GitHub API.
 */
export async function getAuthorizedInstallations(
  db: InstallationLookupDb | PrismaClient,
  logins: string[]
): Promise<AuthorizedInstallation[]> {
  if (logins.length === 0) return [];
  return (db as InstallationLookupDb).installation.findMany({
    where: { provider: 'github', owner: { in: logins, mode: 'insensitive' } },
    select: { id: true, provider: true, owner: true, externalId: true },
  });
}
