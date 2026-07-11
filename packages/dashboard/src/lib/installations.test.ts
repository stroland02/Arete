import { describe, it, expect } from 'vitest';
import { getAuthorizedInstallations, type AuthorizedInstallation } from './installations';

function fakeDb(rows: AuthorizedInstallation[]) {
  return {
    installation: {
      findMany: async ({ where }: any) => {
        const logins: string[] = where.owner.in;
        return rows.filter(
          (r) =>
            r.provider === where.provider &&
            logins.some((l) => l.toLowerCase() === r.owner.toLowerCase())
        );
      },
    },
  };
}

describe('getAuthorizedInstallations', () => {
  const acme: AuthorizedInstallation = { id: 'inst-acme', provider: 'github', owner: 'acme', externalId: 1 };
  const globex: AuthorizedInstallation = { id: 'inst-globex', provider: 'github', owner: 'globex', externalId: 2 };

  it('returns installations whose owner matches one of the given logins', async () => {
    const db = fakeDb([acme, globex]);
    const result = await getAuthorizedInstallations(db, ['acme']);
    expect(result).toEqual([acme]);
  });

  it('matches owner case-insensitively', async () => {
    const db = fakeDb([acme]);
    const result = await getAuthorizedInstallations(db, ['ACME']);
    expect(result).toEqual([acme]);
  });

  it('returns multiple installations when the user administers multiple orgs', async () => {
    const db = fakeDb([acme, globex]);
    const result = await getAuthorizedInstallations(db, ['acme', 'globex']);
    expect(result).toHaveLength(2);
  });

  it('returns an empty array without querying the db when logins is empty', async () => {
    let called = false;
    const db = {
      installation: {
        findMany: async () => {
          called = true;
          return [];
        },
      },
    };
    const result = await getAuthorizedInstallations(db, []);
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('does not return installations the user has no matching login for', async () => {
    const db = fakeDb([acme, globex]);
    const result = await getAuthorizedInstallations(db, ['someone-else']);
    expect(result).toEqual([]);
  });
});
