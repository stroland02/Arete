#!/usr/bin/env node
/**
 * Dev-only seed: create a real email/password login so you can sign in to the
 * local dashboard immediately (no OAuth needed). This is NOT fabricated product
 * data — it is a genuine User row with a bcrypt-hashed password, created through
 * the same path as /signup (packages/dashboard/src/lib/users.ts createEmailUser).
 *
 * Lives under packages/dashboard/scripts/ (not scripts/dev/) on purpose: Node
 * ESM resolves the bare imports below (@arete/db, @prisma/adapter-pg, bcryptjs)
 * from THIS file's location, and only the dashboard package has them linked.
 *
 * It deliberately seeds NO Installation/Repository/Review. In this app a user's
 * visible tenant data is resolved from a *linked GitHub account's* real logins
 * matched against Installation.owner (lib/installations.ts + the auth JWT
 * callback). There is no honest way to fake that offline, so a fresh local login
 * correctly sees /overview in its empty state. To populate it, link GitHub via
 * the Connections page against real installations — never seed fake tenants.
 *
 * Usage (from repo root, after `pnpm infra:up` + schema sync):
 *   pnpm dev:seed
 *   DEV_EMAIL=me@local DEV_PASSWORD=hunter2 pnpm dev:seed
 */
import { PrismaClient } from '@arete/db';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

// Load the dashboard's local env if present (Node 20.6+/24). Falls back to the
// compose URL, matching packages/db/prisma.config.ts, so it works with no env.
try {
  process.loadEnvFile(new URL('../.env.local', import.meta.url));
} catch {
  /* no .env.local — rely on process env / fallback */
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://arete:arete@localhost:5432/arete';
const email = (process.env.DEV_EMAIL ?? 'dev@arete.local').trim().toLowerCase();
const password = process.env.DEV_PASSWORD ?? 'devpassword';
const name = process.env.DEV_NAME ?? 'Dev User';

const db = new PrismaClient({ adapter: new PrismaPg(DATABASE_URL) });

try {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] user already exists: ${email} (id ${existing.id}) — nothing to do.`);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.user.create({ data: { email, name, passwordHash } });
    console.log(`[seed] created dev login: ${email} / ${password}  (id ${user.id})`);
  }
  console.log('[seed] sign in at http://localhost:3000/login');
  console.log('[seed] /overview shows honest empty states until a GitHub');
  console.log('[seed] installation is linked via the Connections page.');
} catch (err) {
  console.error('[seed] FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
