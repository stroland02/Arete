import { describe, it, expect } from 'vitest';
import {
  createEmailUser,
  verifyCredentials,
  upsertGoogleUser,
  classifyAccount,
  DuplicateEmailError,
} from './users';

// In-memory fake Prisma, same pattern as queries.test.ts: only the calls
// users.ts actually makes are implemented.
function fakeDb() {
  const rows: any[] = [];
  const accounts: any[] = [];
  let seq = 0;
  return {
    _rows: rows,
    user: {
      findUnique: async ({ where }: any) =>
        rows.find((r) => (where.email ? r.email === where.email : r.id === where.id)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `u${++seq}`, name: null, image: null, passwordHash: null, ...data };
        rows.push(row);
        return row;
      },
    },
    account: {
      findUnique: async ({ where }: any) =>
        accounts.find(
          (a) =>
            a.provider === where.provider_providerAccountId.provider &&
            a.providerAccountId === where.provider_providerAccountId.providerAccountId
        ) ?? null,
      findFirst: async ({ where }: any) => accounts.find((a) => a.userId === where.userId) ?? null,
      create: async ({ data }: any) => {
        accounts.push(data);
        return data;
      },
    },
  } as any;
}

describe('createEmailUser', () => {
  it('hashes the password (never stores plaintext) and returns the user', async () => {
    const db = fakeDb();
    const u = await createEmailUser(db, { email: 'a@b.com', name: 'A', password: 'hunter2pw' });
    expect(u.email).toBe('a@b.com');
    expect(db._rows[0].passwordHash).toBeTruthy();
    expect(db._rows[0].passwordHash).not.toBe('hunter2pw');
  });

  it('rejects a duplicate email', async () => {
    const db = fakeDb();
    await createEmailUser(db, { email: 'a@b.com', name: null, password: 'hunter2pw' });
    await expect(
      createEmailUser(db, { email: 'a@b.com', name: null, password: 'other-pw1' })
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });
});

describe('verifyCredentials', () => {
  it('returns the user for the correct password, null for a wrong one', async () => {
    const db = fakeDb();
    await createEmailUser(db, { email: 'a@b.com', name: 'A', password: 'hunter2pw' });
    expect(await verifyCredentials(db, 'a@b.com', 'hunter2pw')).toMatchObject({ email: 'a@b.com' });
    expect(await verifyCredentials(db, 'a@b.com', 'wrongpass')).toBeNull();
    expect(await verifyCredentials(db, 'missing@b.com', 'hunter2pw')).toBeNull();
  });
});

describe('classifyAccount', () => {
  it("returns 'none' when no user has that email (→ 'no such account, create one?')", async () => {
    const db = fakeDb();
    expect(await classifyAccount(db, 'nobody@b.com')).toEqual({ kind: 'none' });
  });

  it("returns 'password' for an email/password account (normalizing case)", async () => {
    const db = fakeDb();
    await createEmailUser(db, { email: 'a@b.com', name: null, password: 'hunter2pw' });
    expect(await classifyAccount(db, 'A@B.com')).toEqual({ kind: 'password' });
  });

  it("returns 'oauth' + provider for a Google-only account (→ 'signed up with Google')", async () => {
    const db = fakeDb();
    await upsertGoogleUser(db, { email: 'g@b.com', name: 'G', image: null, providerAccountId: 'gid-1' });
    expect(await classifyAccount(db, 'g@b.com')).toEqual({ kind: 'oauth', provider: 'google' });
  });
});

describe('upsertGoogleUser', () => {
  it('creates a user + account on first login and reuses them after', async () => {
    const db = fakeDb();
    const first = await upsertGoogleUser(db, {
      email: 'g@b.com', name: 'G', image: null, providerAccountId: 'gid-1',
    });
    const second = await upsertGoogleUser(db, {
      email: 'g@b.com', name: 'G', image: null, providerAccountId: 'gid-1',
    });
    expect(second.id).toBe(first.id);
    expect(db._rows).toHaveLength(1);
  });
});
