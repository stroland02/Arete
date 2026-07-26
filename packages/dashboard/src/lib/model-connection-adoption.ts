import type { PrismaClient } from '@arete/db';

/**
 * Adoption of PENDING model connections (model = setup step 1).
 *
 * A model connected BEFORE any GitHub App installation persists as a
 * user-scoped ModelConnection row ({ userId, installationId: null }). The
 * moment the user's first installation resolves, these rows are "adopted":
 * installationId is set so the webhook's installation-scoped queries (scan
 * gate, review model resolution) start seeing them. userId is left in place as
 * provenance. Pending rows stay INVISIBLE to the webhook until adopted — that
 * is what keeps the scan gate sound.
 */

/** Narrow slice of the Prisma client this module depends on, so tests can pass a fake. */
export interface ModelConnectionAdoptionDb {
  modelConnection: {
    findMany: (args: {
      where: { userId: string; installationId: null };
      select: { id: true; provider: true };
    }) => Promise<Array<{ id: string; provider: string }>>;
    update: (args: {
      where: { id: string };
      data: { installationId: string };
    }) => Promise<unknown>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
}

/** Prisma P2002 = unique-constraint violation (duck-typed; see webhook/src/alerting/incident.ts). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

/**
 * Adopt the user's pending model connections into `installationId` (an INTERNAL
 * Installation.id). When the installation already has a connection for the same
 * provider (@@unique([installationId, provider]) → P2002), the installation's
 * existing row WINS and the pending row is dropped. Idempotent when there is
 * nothing pending. Returns the number of rows adopted.
 */
export async function adoptPendingModelConnections(
  db: ModelConnectionAdoptionDb | PrismaClient,
  userId: string,
  installationId: string,
): Promise<number> {
  const conn = (db as ModelConnectionAdoptionDb).modelConnection;
  const pending = await conn.findMany({
    where: { userId, installationId: null },
    select: { id: true, provider: true },
  });

  let adopted = 0;
  for (const row of pending) {
    try {
      await conn.update({ where: { id: row.id }, data: { installationId } });
      adopted++;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Installation already has this provider connected — its row wins.
      console.warn(
        `[model-connection-adoption] conflict provider=${row.provider} installation=${installationId} — dropping pending row`,
      );
      await conn.delete({ where: { id: row.id } });
    }
  }

  if (pending.length > 0) {
    console.warn(
      `[model-connection-adoption] adopted=${adopted} user=${userId} installation=${installationId}`,
    );
  }
  return adopted;
}
