import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@arete/db';

const BCRYPT_COST = 10;

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An account with email ${email} already exists`);
    this.name = 'DuplicateEmailError';
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export async function createEmailUser(
  db: PrismaClient,
  input: { email: string; name: string | null; password: string }
): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new DuplicateEmailError(email);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await db.user.create({
    data: { email, name: input.name, passwordHash },
  });
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}

export async function verifyCredentials(
  db: PrismaClient,
  email: string,
  password: string
): Promise<PublicUser | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.passwordHash) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}

export async function upsertGoogleUser(
  db: PrismaClient,
  input: { email: string; name: string | null; image: string | null; providerAccountId: string }
): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const link = await db.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'google',
        providerAccountId: input.providerAccountId,
      },
    },
  });
  if (link) {
    const user = await db.user.findUnique({ where: { id: link.userId } });
    if (user) return { id: user.id, email: user.email, name: user.name, image: user.image };
  }
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    user = await db.user.create({ data: { email, name: input.name, image: input.image } });
  }
  await db.account.create({
    data: { userId: user.id, provider: 'google', providerAccountId: input.providerAccountId },
  });
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}
