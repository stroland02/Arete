# Areté Account Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub-OAuth-as-login with a real Areté account — sign up / sign in with email + password *and* Continue with Google — leaving GitHub for the Connections page (deferred).

**Architecture:** Next.js 16 + Auth.js v5 (next-auth beta) in `packages/dashboard`, Prisma via `@arete/db`. Add `User`/`Account` models; split the Auth.js config into an edge-safe `auth.config.ts` (used by the `proxy.ts` middleware gate) and a full Node `auth.ts` (Credentials `authorize` + Google + db + bcryptjs). New `/signup` page, reworked `/login`.

**Tech Stack:** TypeScript, Next.js 16 (Turbopack), Auth.js v5 (`next-auth@5.0.0-beta.31`), Prisma 7 (`@arete/db`), `bcryptjs`, vitest (node env, `renderToStaticMarkup` for component render tests).

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-12-arete-account-auth-design.md` — the binding source of truth.
- **Auth providers after this work:** exactly `Credentials` (email+password) + `Google`. GitHub is removed as a *login* provider (the `packages/webhook` Areté GitHub App is unrelated and untouched).
- **Session strategy:** JWT (mandatory for Credentials). `session.installations` is set to `[]` this build — GitHub→account linking is a later spec.
- **Edge safety:** `proxy.ts` must import only `auth.config.ts` (no Prisma, no bcryptjs, no `authorize`). db/bcrypt live only in `auth.ts` + server actions + the `/api/auth` route.
- **Password hashing:** `bcryptjs`, cost factor ≥ 10. Never log passwords; never send `passwordHash` to the client.
- **Login errors** are generic ("invalid email or password" — no user enumeration). **Signup** may say "an account with this email already exists".
- **Public routes** (no auth): `/`, `/login`, `/signup`, `/api/auth`, static assets. Everything else gated.
- **Tests** run in vitest `node` env; component render assertions use `renderToStaticMarkup` from `react-dom/server` (see `EmptyState.test.tsx`) — do NOT add React Testing Library.
- **Gates:** `pnpm --filter @arete/dashboard test` and `pnpm --filter @arete/db build` must stay green.
- **DB prerequisite:** a Postgres reachable via `packages/db`'s `DATABASE_URL` must be running for the migration (docker `infra-postgres-1` is up on `localhost:5432`, user/pass/db = `arete`).

---

### Task 1: Add `User` + `Account` Prisma models and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create (generated): `packages/db/prisma/migrations/<timestamp>_add_user_account/migration.sql`

**Interfaces:**
- Produces: Prisma `User { id, email, name?, image?, passwordHash?, emailVerified?, createdAt, updatedAt, accounts }` and `Account { id, userId, provider, providerAccountId, user }`, exported from `@arete/db`'s generated client for later tasks.

- [ ] **Step 1: Add the models to `schema.prisma`**

Append after the existing models (do not modify existing models):

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  passwordHash  String?
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]
}

model Account {
  id                String @id @default(cuid())
  userId            String
  provider          String
  providerAccountId String
  user              User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}
```

- [ ] **Step 2: Validate the schema**

Run (from `packages/db`): `pnpm exec prisma validate`
Expected: "The schema at prisma\schema.prisma is valid 🚀"

- [ ] **Step 3: Create and apply the migration**

Run (from `packages/db`): `pnpm exec prisma migrate dev --name add_user_account`
Expected: a new `migrations/<timestamp>_add_user_account/migration.sql` creating `User` and `Account` tables; "Your database is now in sync with your schema."
If the DB is unreachable, fall back to `pnpm exec prisma migrate dev --name add_user_account --create-only` and report that it still needs applying — do NOT hand-write the SQL.

- [ ] **Step 4: Regenerate the client and build the package**

Run (from repo root): `pnpm --filter @arete/db build`
Expected: `prisma generate` + `tsc` succeed; `User`/`Account` appear under `packages/db/src/generated/prisma/models/`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/generated
git commit -m "feat(db): add User and Account models for Areté account auth"
```

---

### Task 2: User data-access + password helpers (`lib/users.ts`)

**Files:**
- Create: `packages/dashboard/src/lib/users.ts`
- Test: `packages/dashboard/src/lib/users.test.ts`
- Modify: `packages/dashboard/package.json` (add `bcryptjs`, `@types/bcryptjs`)

**Interfaces:**
- Consumes: `@arete/db` `PrismaClient`, `User` (from Task 1).
- Produces:
  - `createEmailUser(db, { email, name, password }): Promise<PublicUser>` — throws `DuplicateEmailError` if the email exists.
  - `verifyCredentials(db, email, password): Promise<PublicUser | null>` — null on no-user or bad password.
  - `upsertGoogleUser(db, { email, name, image, providerAccountId }): Promise<PublicUser>`.
  - `interface PublicUser { id: string; email: string; name: string | null; image: string | null }`.
  - `class DuplicateEmailError extends Error`.

- [ ] **Step 1: Add dependencies**

Run (from `packages/dashboard`): `pnpm add bcryptjs && pnpm add -D @types/bcryptjs`
Expected: both appear in `package.json`.

- [ ] **Step 2: Write the failing test**

`packages/dashboard/src/lib/users.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  createEmailUser,
  verifyCredentials,
  upsertGoogleUser,
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `packages/dashboard`): `pnpm test -- users`
Expected: FAIL — `Cannot find module './users'`.

- [ ] **Step 4: Implement `lib/users.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `packages/dashboard`): `pnpm test -- users`
Expected: PASS (5 assertions).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/lib/users.ts packages/dashboard/src/lib/users.test.ts packages/dashboard/package.json
git commit -m "feat(dashboard): user data-access + bcrypt password helpers"
```

---

### Task 3: Split Auth.js config — edge-safe gate + Credentials/Google

**Files:**
- Create: `packages/dashboard/src/lib/auth.config.ts`
- Modify: `packages/dashboard/src/lib/auth.ts`
- Modify: `packages/dashboard/src/proxy.ts`
- Modify: `packages/dashboard/src/types/next-auth.d.ts`
- Test: `packages/dashboard/src/proxy.test.ts` (extend existing)

**Interfaces:**
- Consumes: `lib/users.ts` (`verifyCredentials`, `upsertGoogleUser`), `@arete/db` `db`.
- Produces: `auth`, `signIn`, `signOut`, `handlers` from `auth.ts`; `authConfig` (edge-safe) from `auth.config.ts`; `session.user.id` typed.

- [ ] **Step 1: Extend `proxy.test.ts` (failing)**

Read the existing `proxy.test.ts` first (it tests the `authorized` callback). Add cases proving `/signup` is public and `/overview` is gated. If the test imports the callback from `auth.ts`, update it to import from `auth.config.ts` (where `authorized` now lives). Example additions:

```ts
it('leaves /signup public', () => {
  expect(isAuthorized({ pathname: '/signup', user: null })).toBe(true);
});
it('gates /overview when signed out', () => {
  expect(isAuthorized({ pathname: '/overview', user: null })).toBe(false);
});
```

(Match the existing test's helper shape — reuse whatever `isAuthorized`/harness the current file already defines; do not invent a new one if one exists.)

- [ ] **Step 2: Run to verify it fails**

Run (from `packages/dashboard`): `pnpm test -- proxy`
Expected: FAIL (new assertions and/or import path).

- [ ] **Step 3: Create edge-safe `lib/auth.config.ts`**

```ts
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

// Edge-safe config used by proxy.ts (middleware). NO Prisma, NO bcryptjs,
// NO Credentials.authorize here — only the gate callback, pages, session
// strategy, and edge-safe OAuth provider shells. The full config (with the
// Credentials authorize that touches the db) lives in auth.ts.
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname === '/' ||
        pathname.startsWith('/login') ||
        pathname.startsWith('/signup') ||
        pathname.startsWith('/api/auth');
      if (isPublic) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Step 4: Rework `lib/auth.ts`**

Replace the GitHub provider and the GitHub-installations jwt logic. Full new file:

```ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { db } from './db';
import { verifyCredentials, upsertGoogleUser } from './users';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = typeof creds?.email === 'string' ? creds.email : '';
        const password = typeof creds?.password === 'string' ? creds.password : '';
        if (!email || !password) return null;
        return await verifyCredentials(db, email, password);
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        const email = profile?.email ?? user?.email;
        if (!email) return false;
        const appUser = await upsertGoogleUser(db, {
          email,
          name: (profile?.name as string) ?? null,
          image: (profile?.picture as string) ?? null,
          providerAccountId: account.providerAccountId,
        });
        // Stash the app user id so the jwt callback can pick it up.
        user.id = appUser.id;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      // GitHub→account linking is a later spec; no installations yet.
      session.installations = [];
      return session;
    },
  },
});
```

- [ ] **Step 5: Point `proxy.ts` at the edge-safe config**

```ts
import NextAuth from 'next-auth';
import { authConfig } from './lib/auth.config';

// Middleware gate runs ONLY the edge-safe config (no db/bcrypt). See
// lib/auth.config.ts.
export const { auth: proxy } = NextAuth(authConfig);

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 6: Update `types/next-auth.d.ts`**

Add `id` to `Session.user` and drop the GitHub-specific JWT fields (keep `installations` on Session as `[]`):

```ts
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
```

(Remove the `next-auth/jwt` and `@auth/core/jwt` `accessToken`/`installations` augmentations — they were only for the GitHub flow.)

- [ ] **Step 7: Run tests + typecheck**

Run (from `packages/dashboard`): `pnpm test -- proxy` → PASS.
Run: `pnpm exec tsc --noEmit` → no errors in changed files (`auth.ts`, `auth.config.ts`, `proxy.ts`, `next-auth.d.ts`).

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/lib/auth.config.ts packages/dashboard/src/lib/auth.ts packages/dashboard/src/proxy.ts packages/dashboard/src/types/next-auth.d.ts packages/dashboard/src/proxy.test.ts
git commit -m "feat(dashboard): split Auth.js config; Credentials + Google, drop GitHub login"
```

---

### Task 4: `/signup` page + reworked `/login` page

**Files:**
- Modify: `packages/dashboard/src/app/login/page.tsx`
- Create: `packages/dashboard/src/app/login/login-form.tsx`
- Create: `packages/dashboard/src/app/login/actions.ts`
- Create: `packages/dashboard/src/app/signup/page.tsx`
- Create: `packages/dashboard/src/app/signup/signup-form.tsx`
- Create: `packages/dashboard/src/app/signup/actions.ts`
- Test: `packages/dashboard/src/app/signup/signup-form.test.tsx`, `packages/dashboard/src/app/login/login-form.test.tsx`

**Interfaces:**
- Consumes: `signIn` from `lib/auth`, `createEmailUser`/`DuplicateEmailError` from `lib/users`, `db` from `lib/db`.

- [ ] **Step 1: Write failing render tests**

Render the presentational form via `renderToStaticMarkup`, asserting the essential fields exist. `signup-form.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignupForm } from './signup-form';

describe('SignupForm', () => {
  it('renders email, password, and Google option', () => {
    const html = renderToStaticMarkup(<SignupForm />);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html.toLowerCase()).toContain('google');
    expect(html).toContain('/login'); // link to sign-in
  });
});
```

Mirror for `LoginForm` (email, password, Google, link to `/signup`).

- [ ] **Step 2: Run to verify failure**

Run (from `packages/dashboard`): `pnpm test -- form`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the login + google server actions** (`app/login/actions.ts`)

```ts
'use server';
import { signIn } from '@/lib/auth';

export async function loginWithPassword(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await signIn('credentials', { email, password, redirectTo: '/overview' });
  } catch (err) {
    // next-auth throws a redirect on success; only real auth errors fall here.
    if (err instanceof Error && err.name === 'CredentialsSignin') {
      return { error: 'Invalid email or password.' };
    }
    throw err;
  }
  return { error: null };
}

export async function googleSignIn() {
  await signIn('google', { redirectTo: '/overview' });
}
```

- [ ] **Step 4: Implement the signup server action** (`app/signup/actions.ts`)

```ts
'use server';
import { signIn } from '@/lib/auth';
import { db } from '@/lib/db';
import { createEmailUser, DuplicateEmailError } from '@/lib/users';

export async function signup(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim() || null;
  const password = String(formData.get('password') ?? '');
  if (!email.includes('@')) return { error: 'Enter a valid email address.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  try {
    await createEmailUser(db, { email, name, password });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return { error: 'An account with this email already exists.' };
    }
    throw err;
  }
  await signIn('credentials', { email, password, redirectTo: '/overview' });
  return { error: null };
}
```

- [ ] **Step 5: Implement `SignupForm` + `LoginForm` client components and their pages**

Create `app/signup/signup-form.tsx` and `app/login/login-form.tsx` as `'use client'` components using `useActionState` against the server actions, reusing the existing `glass-panel` / gradient styling from the current `login/page.tsx`. Each renders: heading, a Google button (a `<form action={googleSignIn}>` submit), a divider, the email+password fields (signup also an optional name field), an inline error area bound to the action state, and a link to the other page. Then make `app/login/page.tsx` and `app/signup/page.tsx` server components that (a) `redirect('/overview')` if already authed (reuse the current login page's `auth()` check) and (b) render the form.

- [ ] **Step 6: Run render tests**

Run (from `packages/dashboard`): `pnpm test -- form`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/app/login packages/dashboard/src/app/signup
git commit -m "feat(dashboard): Areté account /signup + email/password & Google /login"
```

---

### Task 5: Env wiring, cleanup, and full green

**Files:**
- Modify: `.env.example` (repo root; and `packages/dashboard/.env.example` if present)
- Verify: whole dashboard suite + db build

- [ ] **Step 1: Update `.env.example`**

In the dashboard/auth section: add `GOOGLE_CLIENT_ID=` and `GOOGLE_CLIENT_SECRET=`; keep `AUTH_SECRET=`. Mark the old `GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET` (dashboard login) as deprecated/removed with a one-line comment pointing to the future Connections integration. Do NOT touch the `packages/webhook` GitHub App vars.

- [ ] **Step 2: Grep for dangling GitHub-login references**

Run: `grep -rn "providers/github\|GITHUB_OAUTH\|Sign in with GitHub\|signIn('github'" packages/dashboard/src` — expect no remaining login-path references. If `github.ts`/`installations.ts` become entirely unused, leave them in place (the next spec needs them) but ensure nothing in `auth.ts`/`auth.config.ts` imports them.

- [ ] **Step 3: Full dashboard test suite**

Run (from repo root): `pnpm --filter @arete/dashboard test`
Expected: all green (existing suites + new `users`, `proxy`, form tests).

- [ ] **Step 4: DB build + dashboard typecheck**

Run: `pnpm --filter @arete/db build` and `pnpm --filter @arete/dashboard exec tsc --noEmit`
Expected: both succeed.

- [ ] **Step 5: Manual smoke (dev server)**

Start `pnpm --filter @arete/dashboard dev`. Verify: `/signup` renders (200) and creates an account (redirects to `/overview`, which shows the EmptyState since no installation is linked); `/login` renders email/password + Google; a wrong password shows the generic error; `/overview` while signed out → redirect to `/login`. (Google end-to-end needs real `GOOGLE_CLIENT_ID/SECRET`; without them the button is present but the OAuth round-trip won't complete — acceptable for this build.)

- [ ] **Step 6: Commit**

```bash
git add .env.example
git commit -m "chore(dashboard): env + cleanup for Areté account auth; drop GitHub login vars"
```

---

## Self-Review

- **Spec coverage:** User/Account models (Task 1) ✓; email+password + Google providers, edge-split, installations=[] (Tasks 2-3) ✓; /login rework + /signup (Task 4) ✓; public-route `/signup`, generic login error, duplicate-email signup message (Tasks 3-4) ✓; `.env.example` Google vars (Task 5) ✓; GitHub→account linking explicitly deferred (not in any task) ✓.
- **Placeholder scan:** all code steps carry real code; no TBD/TODO.
- **Type consistency:** `PublicUser` shape returned by `verifyCredentials`/`upsertGoogleUser` matches what `authorize`/`signIn` consume; `session.user.id` added in both the callback (Task 3 Step 4) and the type augmentation (Task 3 Step 6).
- **Known risk called out for reviewers:** Auth.js v5 Credentials + Google + JWT + edge middleware is fiddly; the error-name check (`CredentialsSignin`) and the `signIn` throw-on-redirect behavior may need adjustment against the installed beta — the manual smoke (Task 5 Step 5) is the backstop.
