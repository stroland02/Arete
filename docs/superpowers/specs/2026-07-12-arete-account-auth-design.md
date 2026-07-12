# Areté Account Auth — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pending spec review
**Branch:** `feat/arete-account-auth` (off `origin/main` @ `2f0ad95`)

## Context

The user's intended front door is: a public marketing landing page → **sign
up / sign in to an Areté account** → land in the app; GitHub is connected
*later*, as an integration on the Connections page, not as the login itself.

During design we discovered that **the landing page is already built and
merged** (`origin/main` @ `2f0ad95` — `feat(dashboard): add public marketing
landing page, move dashboard to /overview`). It ships:

- `src/app/page.tsx` — public marketing landing at `/` (`MarketingNav`,
  `LandingHero`, `HowItWorks`, `ConnectorStrip`, `PricingSection`, `FinalCta`,
  `MarketingFooter`). Signed-in visitors are redirected to `/overview`.
- The dashboard moved from `/` to `/overview` under the `(dashboard)` route
  group; `proxy.ts` + `lib/auth.ts`'s `authorized()` leave `/`, `/login`,
  and `/api/auth` public and gate everything else.

**Therefore the only remaining gap — and the whole scope of this spec — is
the authentication model.** Login is still **GitHub OAuth only**
(`lib/auth.ts` uses `next-auth/providers/github`; `login/page.tsx` is a single
"Sign in with GitHub" button). There is **no** email+password, **no** Google,
**no** `/signup` page, and **no** `User` table in `@arete/db` (models today:
`Installation`, `TelemetryConnection`, `Repository`, `Review`,
`ReviewComment`).

## Goal

Replace GitHub-OAuth-as-login with a real **Areté account**: sign up / sign in
with **email + password** *and* **Continue with Google**. Remove GitHub as a
login method. Identity becomes an Areté `User` record, decoupled from GitHub.

## Out of Scope (explicit — next spec)

- **GitHub-App-install → Areté-account linking** (which GitHub org's data a
  user sees). That needs a `User ↔ Installation` schema addition plus
  webhook/OAuth-callback rewiring. It is its own focused build.
- Consequence for THIS build: a freshly signed-up account has **zero**
  authorized installations, so `getDashboardViewModel` returns
  `hasAccess: false` and the existing top-level `EmptyState` renders with a
  "connect a repository" prompt. This is the correct, honest interim state.
- Email verification flow, password reset, and rate limiting are deferred
  (noted under Future Work); the schema leaves room for them.

## Architecture

### 1. Data model (`@arete/db`) — new Prisma migration

Add a `User` model and an `Account` model (for the Google OAuth link),
following the Auth.js data-model shape so the standard Prisma adapter *could*
be adopted later without a rename:

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  passwordHash  String?   // null for OAuth-only (Google) users
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  provider          String  // "google"
  providerAccountId String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}
```

- Generated via `prisma migrate dev --name add_user_account` in
  `packages/db`, then `pnpm --filter @arete/db build` to regenerate the
  client. `Review`/`Installation`/etc. are untouched.
- No `Session`/`VerificationToken` tables now — we stay on **JWT sessions**
  (Credentials providers require JWT strategy), so DB sessions aren't needed.

### 2. Auth config (`lib/auth.ts`) — reworked

- **Providers:** `Credentials` (email+password) + `Google`. Drop `GitHub`.
- **Session strategy:** JWT (unchanged; mandatory for Credentials).
- **Password hashing:** `bcryptjs` (pure-JS, no native build — safe on
  Windows and any runtime). Hash on signup, `compare` in `authorize`.
- **Credentials `authorize({ email, password })`:** look up `User` by email
  via `@arete/db`; if found and `passwordHash` verifies, return
  `{ id, email, name, image }`; else return `null` (generic failure — never
  reveal whether the email exists).
- **Google:** on first Google sign-in, upsert a `User` by email (unifying a
  Google login with any existing email account on the same address) and an
  `Account` row; subsequent logins match on `(provider, providerAccountId)`.
  Handled in the `signIn`/`jwt` callbacks.
- **JWT/session callbacks:** put the `User.id` and email on the token;
  `session.user` derives from it. **`session.installations` is set to `[]`**
  for now (no GitHub link yet) — the `installations` refresh logic that
  called the GitHub API is removed along with the GitHub provider.
- **Edge-safety risk (must address in the plan):** `proxy.ts` runs the
  Auth.js middleware, which must stay edge-runtime-safe. `bcryptjs`, the
  Prisma client, and the Credentials `authorize` are Node-only. The standard
  Auth.js v5 remedy is to **split config**: a light `auth.config.ts` (only
  the `authorized` callback + provider *shells*) imported by `proxy.ts`, and
  the full `auth.ts` (adapters, `authorize`, bcrypt, db) imported by server
  code and the `/api/auth` route. The plan must implement this split rather
  than importing db/bcrypt into the middleware path.

### 3. Routes & pages

- **`/login`** (reworked): email + password form (server action calling
  `signIn('credentials', ...)`), plus a "Continue with Google" button
  (`signIn('google', { redirectTo: '/overview' })`). Inline error on bad
  credentials. Reuse the existing `glass-panel` / gradient styling already in
  the current login page. Link to `/signup`.
- **`/signup`** (new, public): name (optional) + email + password form.
  Server action: validate, reject duplicate email, hash with bcryptjs, create
  `User`, then `signIn('credentials', ...)` to establish the session and
  redirect to `/overview`. Plus the same "Continue with Google" button. Link
  to `/login`.
- **`proxy.ts` / `authorized()`:** add `/signup` to the public set
  (`pathname.startsWith('/signup')`) alongside `/`, `/login`, `/api/auth`.
- Post-auth redirect target stays `/overview`.

### 4. What stays unchanged

Landing page and all `(dashboard)` pages, `queries.ts` tenancy scoping,
`resolveSelectedInstallationIds`, the `hasAccess:false` → `EmptyState` path,
`InstallationSwitcher`/`SignOutButton` (they read `session` / call
`signOut()` — provider-agnostic). `.env.example` gains
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and drops the GitHub-OAuth login
vars from the *dashboard* section (the Areté **GitHub App** webhook vars in
`packages/webhook` are unrelated and untouched).

## Error Handling

- Signup: empty/invalid email → inline field error; weak password (min
  length, e.g. 8) → inline error; duplicate email → "an account with this
  email already exists" (this is safe to reveal on the *signup* form, unlike
  login).
- Login: any failure → single generic "invalid email or password" message.
- Google callback failure → redirect back to `/login?error=oauth` with a
  friendly banner.
- Never log raw passwords; never return the `passwordHash` to the client.

## Testing (vitest, existing convention)

- **`lib/auth`/user helpers:** a fake-Prisma unit test proving
  create-user-hashes-password, lookup-by-email, verify-correct-password
  succeeds, verify-wrong-password fails, duplicate-email rejected. Mirrors
  the in-memory fake-Prisma pattern in `queries.test.ts`.
- **`proxy.test.ts`:** extend to assert `/signup` is public and a random
  gated path (e.g. `/overview`) still requires a session.
- **Render tests:** `/login` renders email/password fields + Google button +
  link to signup; `/signup` renders its fields + Google button + link to
  login (React Testing Library, as `EmptyState.test.tsx` does).
- Full gate: `pnpm --filter @arete/dashboard test` and
  `pnpm --filter @arete/db build` stay green.

## Security Notes

- bcryptjs cost factor ≥ 10.
- Generic login errors (no user-enumeration via login).
- `AUTH_SECRET` required in every environment (a gitignored dev value is set
  locally for review; real secret via env in deploy).
- Password reset, email verification, and login rate-limiting are Future Work
  — the `emailVerified` column and JWT strategy already accommodate them.

## Future Work (after this + the GitHub-linking spec)

- GitHub-App-install → `User` linking (the deferred spec) to populate
  `session.installations` and light up real dashboard data per account.
- Email verification + password reset (needs an email sender, e.g. Resend).
- Login rate limiting / lockout.
