import { describe, it, expect, vi } from 'vitest';
import {
  getStoredInstallations,
  persistInstallationAccess,
  type InstallationAccessDb,
} from './installations';

function fakeDb() {
  const accessFindMany = vi.fn();
  const accessUpsert = vi.fn().mockResolvedValue({});
  const accessDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const db: InstallationAccessDb = {
    installationAccess: {
      findMany: accessFindMany,
      upsert: accessUpsert,
      deleteMany: accessDeleteMany,
    },
  };
  return { db, accessFindMany, accessUpsert, accessDeleteMany };
}

describe('getStoredInstallations', () => {
  it('reads the durable InstallationAccess rows for the user and projects them to AuthorizedInstallation', async () => {
    const { db, accessFindMany } = fakeDb();
    accessFindMany.mockResolvedValue([
      { installation: { id: 'inst_1', provider: 'github', owner: 'acme', externalId: 111 } },
      { installation: { id: 'inst_2', provider: 'github', owner: 'me', externalId: 222 } },
    ]);

    const result = await getStoredInstallations(db, 'user_1');

    // scoped by the session user id
    expect(accessFindMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      select: { installation: { select: { id: true, provider: true, owner: true, externalId: true } } },
    });
    expect(result).toEqual([
      { id: 'inst_1', provider: 'github', owner: 'acme', externalId: 111 },
      { id: 'inst_2', provider: 'github', owner: 'me', externalId: 222 },
    ]);
  });

  it('returns [] when the user has no stored access rows', async () => {
    const { db, accessFindMany } = fakeDb();
    accessFindMany.mockResolvedValue([]);
    expect(await getStoredInstallations(db, 'user_1')).toEqual([]);
  });
});

describe('persistInstallationAccess', () => {
  it('upserts a durable row per installation (scoped by userId+installationId) and prunes rows no longer authorized', async () => {
    const { db, accessUpsert, accessDeleteMany } = fakeDb();

    await persistInstallationAccess(db, 'user_1', [
      { id: 'inst_1', provider: 'github', owner: 'acme', externalId: 111 },
      { id: 'inst_2', provider: 'github', owner: 'me', externalId: 222 },
    ]);

    expect(accessUpsert).toHaveBeenCalledTimes(2);
    expect(accessUpsert).toHaveBeenCalledWith({
      where: { userId_installationId: { userId: 'user_1', installationId: 'inst_1' } },
      create: { userId: 'user_1', installationId: 'inst_1' },
      update: {},
    });
    // reconcile: anything not in the current set is pruned for this user
    expect(accessDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', installationId: { notIn: ['inst_1', 'inst_2'] } },
    });
  });

  it('prunes ALL rows for the user when the authorized set is empty (revoked everywhere)', async () => {
    const { db, accessUpsert, accessDeleteMany } = fakeDb();

    await persistInstallationAccess(db, 'user_1', []);

    expect(accessUpsert).not.toHaveBeenCalled();
    expect(accessDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', installationId: { notIn: [] } },
    });
  });
});
