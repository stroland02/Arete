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

/** Narrow slice of the Prisma client the durable-access helpers depend on. */
export interface InstallationAccessDb {
  installationAccess: {
    findMany: (args: {
      where: { userId: string };
      select: { installation: { select: { id: true; provider: true; owner: true; externalId: true } } };
    }) => Promise<Array<{ installation: AuthorizedInstallation }>>;
    upsert: (args: {
      where: { userId_installationId: { userId: string; installationId: string } };
      create: { userId: string; installationId: string };
      update: Record<string, never>;
    }) => Promise<unknown>;
    deleteMany: (args: {
      where: { userId: string; installationId: { notIn: string[] } };
    }) => Promise<{ count: number }>;
  };
}

/**
 * The DURABLE authorization source: the InstallationAccess rows persisted for a
 * user at connect time (and write-through on a successful live derivation). The
 * login read-path prefers this over re-deriving from the GitHub API, so a
 * transient API failure or a reset token no longer drops a tenant's
 * installations (the connection-reset incident). Scoped by userId.
 */
export async function getStoredInstallations(
  db: InstallationAccessDb | PrismaClient,
  userId: string
): Promise<AuthorizedInstallation[]> {
  const rows = await (db as InstallationAccessDb).installationAccess.findMany({
    where: { userId },
    select: { installation: { select: { id: true, provider: true, owner: true, externalId: true } } },
  });
  return rows.map((r) => r.installation);
}

/**
 * Persist the authoritative user→installation mapping durably: upsert a row for
 * each currently-authorized installation and prune any the user no longer has
 * (reconcile), so a revocation seen during a successful live derivation is
 * reflected in the stored set. Idempotent; safe to call on every successful
 * derivation and at connect time.
 */
export async function persistInstallationAccess(
  db: InstallationAccessDb | PrismaClient,
  userId: string,
  installations: AuthorizedInstallation[]
): Promise<void> {
  const access = (db as InstallationAccessDb).installationAccess;
  const ids = installations.map((i) => i.id);
  for (const installation of installations) {
    await access.upsert({
      where: { userId_installationId: { userId, installationId: installation.id } },
      create: { userId, installationId: installation.id },
      update: {},
    });
  }
  // Prune rows this user is no longer authorized for (empty list → prune all).
  await access.deleteMany({ where: { userId, installationId: { notIn: ids } } });
}
