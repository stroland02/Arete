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

/** How an email is already registered — the honest input to login/signup UX. */
export type AccountKind = 'none' | 'password' | 'oauth';

export interface AccountClassification {
  kind: AccountKind;
  /** For 'oauth': the provider the email is registered through (e.g. 'google'). */
  provider?: string;
}

/**
 * Classify how an email is registered, so the auth surface can tell the user
 * the TRUTH instead of a blanket "invalid email or password":
 *  - none     → no user row; login offers "no such account — create one?"
 *  - password → an email/password account exists (login: wrong password;
 *               signup: "already exists, sign in")
 *  - oauth    → the email exists with no password — it signed up via an OAuth
 *               provider (e.g. "this email signed up with Google")
 *
 * Pure DB lookups, no bcrypt: on the login path this only runs AFTER auth has
 * already failed, so the password is never re-checked here. It deliberately
 * reveals account existence — the product ruling is that an honest "no such
 * account" beats a confusing empty tenant that reads as data loss, and that a
 * user must never silently create a second tenant over an existing email.
 */
export async function classifyAccount(
  db: PrismaClient,
  email: string
): Promise<AccountClassification> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } });
  if (!user) return { kind: 'none' };
  if (user.passwordHash) return { kind: 'password' };
  const account = await db.account.findFirst({
    where: { userId: user.id },
    select: { provider: true },
  });
  return account?.provider ? { kind: 'oauth', provider: account.provider } : { kind: 'oauth' };
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
