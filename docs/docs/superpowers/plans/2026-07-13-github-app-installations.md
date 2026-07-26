# Wire Real GitHub App Installations Into the Session

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is split into three phases — **BACKEND**, **UI**, **TESTS** — intended for three separate downstream agents. Read the whole document (including Global Constraints and the Key Findings appendix) before starting your phase; later phases depend on exact interfaces the earlier phase produces.

**Goal:** Replace the hard-coded `session.installations = []` stub in `packages/dashboard/src/lib/auth.ts:38` with a real mapping so an authenticated dashboard user's `session.installations` reflects the GitHub App installations they actually administer — unblocking every tenancy-scoped query (`resolveSelectedInstallationIds`, `getDashboardViewModel`, `getReviewDetail`, `getReviewHistory`, `getInstallationBilling`, `getMasterGridSnapshots`, `getDashboardsViewModel`) which today silently return empty/no-access for everyone.

## Context: this was already built once, then intentionally reverted

This is not a greenfield feature. Commit `f47db0b` (`feat(dashboard): add GitHub OAuth login and scope all queries to authorized installations`) implemented this exact wiring using **GitHub OAuth App as the dashboard's login provider**. Commit `77c6e2e` (`feat(dashboard): split Auth.js config; Credentials + Google, drop GitHub login`, driven by `docs/superpowers/plans/2026-07-12-arete-account-auth.md`) deliberately reverted the auth *provider* choice — replacing GitHub-as-login with email/password (Credentials) + Google — while leaving the installation-resolution helper code in place, unused, for "a later spec." `.env.example:120-123` says explicitly: *"GitHub is no longer a dashboard login provider; GitHub linking moves to the Connections page in a future integration."* **This plan is that later spec.** Do not re-add GitHub as a primary sign-in provider — that was already tried and explicitly walked back.

The good news: `getAuthorizedInstallations` (`packages/dashboard/src/lib/installations.ts`), `shouldRefreshInstallations`/`INSTALLATION_CACHE_TTL_MS` (`packages/dashboard/src/lib/installation-cache.ts`), and `fetchAuthorizedGithubLogins` (`packages/dashboard/src/lib/github.ts`) are already written, already unit-tested (`installations.test.ts`, `installation-cache.test.ts`), and already correct for the "match GitHub org/personal-account logins against `Installation.owner`" design. **Reuse them as-is.** The only missing piece is: *how does a Google/Credentials-authenticated dashboard user's GitHub identity get captured in the first place*, now that GitHub isn't the login provider.

## Architecture

**The join mechanism (the actual gap):** Add a "Connect GitHub" flow, separate from NextAuth's provider system entirely, mirroring the pattern `packages/webhook/src/oauth/` already uses for the Vercel/PostHog telemetry connectors (stateless signed CSRF state, code-for-token exchange, encrypted-at-rest storage) — not NextAuth's built-in OAuth machinery. Concretely:

1. A new dashboard route/action lets a signed-in user (already authenticated via Google or Credentials) redirect to GitHub's OAuth authorize endpoint, using a **new, separate GitHub OAuth App** dedicated to this link (not the Areté GitHub App used for webhooks/PR access, and not a `next-auth/providers/github` provider).
2. The callback lands on a plain Next.js route handler (NOT `/api/auth/callback/*`), which can call `auth()` directly to know exactly which dashboard user is linking — no NextAuth "account linking to an already-logged-in session" trickery, no cookie-decoding hacks. This sidesteps the entire class of problems that made reviving GitHub-as-a-NextAuth-provider awkward here.
3. The exchanged GitHub access token is encrypted (AES-256-GCM, same scheme as `telemetry-credentials.ts`) and stored on a new column on the existing `Account` model, keyed to `{ userId, provider: 'github' }`.
4. `auth.ts`'s `jwt` callback, on the existing 5-minute TTL (`installation-cache.ts`, unchanged), loads that stored token, calls the **existing, untouched** `fetchAuthorizedGithubLogins()` → `getAuthorizedInstallations()` pipeline, and caches the result on the JWT exactly like the original (reverted) `f47db0b` design did — just sourcing the access token from the DB instead of from NextAuth's own OAuth callback payload.
5. A user who has never connected GitHub gets `session.installations = []` (same shape as today, now for the right reason: "not linked yet" instead of "not implemented yet").

**Why not just revive `f47db0b` verbatim?** Because the team explicitly pivoted away from GitHub-as-login for real reasons (email/password + Google is the account model now; GitHub becomes an optional secondary link). Re-adding a `GitHub` provider to `next-auth`'s `providers` array would either (a) let GitHub create/sign-in a *new* dashboard account (defeats the point of Credentials/Google being canonical identity), or (b) require linking the GitHub OAuth callback to an *already*-signed-in session, which — without a full NextAuth Adapter (this codebase deliberately has none; see `lib/users.ts`'s hand-rolled `upsertGoogleUser`) — means decoding the session cookie by hand inside the `signIn` callback. That's fragile across `next-auth@5.0.0-beta.31` cookie-naming/secure-prefix behavior and not worth it when the codebase already has a clean, proven, non-NextAuth OAuth pattern sitting right next door in `packages/webhook/src/oauth/`.

**Noted alternative (NOT this plan's scope):** If the Areté GitHub App itself has OAuth ("user-to-server") credentials configured, a user-to-server token could call GitHub's `/user/installations` directly and get *exact* installation IDs — more precise than the owner-login-matching heuristic `installations.ts` uses today (which infers "admin of an org" as a proxy for "authorized"). That would be architecturally superior but depends on GitHub App OAuth config that's an external/webhook-team decision (see Key Findings, item 5) and would obsolete `github.ts`/`installations.ts`'s existing, tested logic. Out of scope here — flagged for a future spec.

## Global Constraints

- **SINGLE-OWNER DB SCHEMA CHANGE:** Phase BACKEND Task 1 modifies `packages/db/prisma/schema.prisma` and creates a new Prisma migration. `packages/db` is explicitly a shared, single-source-of-truth package (see its own header comment) consumed by both `@arete/webhook` and `@arete/dashboard`. **Coordinate before running `prisma migrate dev`** — do not let this collide with any other in-flight migration. If another migration lands first, rebase this one on top; do not hand-edit an already-applied migration's SQL.
- **Do not re-add GitHub as a `next-auth` provider.** No `next-auth/providers/github` import in `auth.ts` or `auth.config.ts`. The Connect-GitHub flow is a plain Next.js route handler + server action, entirely outside NextAuth's OAuth callback machinery.
- **Do not touch `auth.config.ts`'s provider list or its edge-safety guarantee.** It must stay Prisma-free/bcrypt-free (used by `proxy.ts` middleware). The Connect-GitHub route handler and its DB reads/writes belong in Node-runtime code (a `route.ts` under `app/api/`, or a server action), never in `auth.config.ts`.
- **Reuse, do not reimplement:** `getAuthorizedInstallations` (`lib/installations.ts`), `shouldRefreshInstallations`/`INSTALLATION_CACHE_TTL_MS` (`lib/installation-cache.ts`), `fetchAuthorizedGithubLogins` (`lib/github.ts`), `resolveSelectedInstallationIds` and every `get*` query in `lib/queries.ts` are already correct and already tested. None of these files should change in this plan except where explicitly noted.
- **Tenancy invariant (MUST hold, verified in Phase TESTS):** a signed-in user's `session.installations` must contain *only* `Installation` rows whose `owner` matches a GitHub login the user's linked GitHub account controls (their own login, or an org where GitHub reports their role as `admin`) — never another tenant's installation, regardless of how many other tenants' Installation rows exist in the same database.
- **Security invariant:** the GitHub access token must be encrypted at rest (reuse the existing AES-256-GCM scheme). It must never be logged, never sent to the client, and never embedded directly in the session JWT (only the *resolved* `AuthorizedInstallation[]` list is cached in the JWT, as today).
- **Fail-open-to-empty, not fail-open-to-everything:** any GitHub API error (expired/revoked token, rate limit, network failure) during the TTL refresh must degrade to the last-known-good cached list (or `[]` on first attempt), exactly as the original `f47db0b` `jwt` callback did — never to "show all installations."
- **External dependency (flagged, not fixed by this plan):** `Installation` rows are created *lazily* by `packages/webhook/src/persistence.ts persistReview()` (an upsert keyed on `provider_externalId`) the first time a PR review completes for that installation. There is **no** dedicated `installation` / `installation_repositories` GitHub webhook handler in `packages/webhook/src/server.ts` (only `pull_request` and `pull_request_review_comment` are registered). Consequence: a user who installs the GitHub App but has zero PRs reviewed yet will correctly link their GitHub account, but see `session.installations = []` anyway (no `Installation` row exists to match) and land on the `EmptyState` — which reads as "you haven't installed the app" even though they have. This is a pre-existing gap in `packages/webhook`, outside the dashboard's package boundary; note it in the PR description but do not attempt to fix it here (it would require adding an `installation.created` webhook handler in `packages/webhook`, a separate piece of work with its own single-owner coordination).
- **Env vars:** this plan needs a new GitHub OAuth App (Settings → Developer settings → OAuth Apps, *not* the existing GitHub App used for webhooks). New vars: `GITHUB_LINK_CLIENT_ID`, `GITHUB_LINK_CLIENT_SECRET`, `GITHUB_LINK_REDIRECT_BASE_URL` (or reuse `OAUTH_REDIRECT_BASE_URL` — Phase BACKEND Task 2 decides). Reuses the existing `TELEMETRY_ENCRYPTION_KEY` and `AUTH_SECRET`.
- **Gates:** `pnpm --filter @arete/dashboard test` and `pnpm --filter @arete/db build` must stay green after every task.

---

## PHASE BACKEND

Owns: schema/migration, the Connect-GitHub link mechanism, and the `auth.ts` session-callback wiring. Everything downstream (UI, tests) depends on the exact shapes this phase produces — do not change the `AuthorizedInstallation` shape or `session.installations`'s type without updating Phase UI/TESTS' briefs.

### Task B1: Add GitHub token storage to the `Account` model (SINGLE-OWNER MIGRATION)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `Account` model, currently at line ~185)
- Create (generated): `packages/db/prisma/migrations/<timestamp>_add_account_github_token/migration.sql`

**Interfaces:**
- Consumes: existing `Account { id, userId, provider, providerAccountId, user }` (added by migration `20260712200511_add_user_account`).
- Produces: `Account.githubAccessTokenEncrypted String?` — populated only for `provider: 'github'` rows (the existing `provider: 'google'` rows leave it `null`). Reuses the `@@unique([provider, providerAccountId])` constraint already in place — no change to that.

- [ ] **Step 1: ⚠️ COORDINATE before touching `schema.prisma`.** Confirm no other in-flight branch is mid-migration on `packages/db`. This is the single shared schema file for `@arete/webhook` and `@arete/dashboard` both.

- [ ] **Step 2: Add the column**

```prisma
model Account {
  id                          String  @id @default(cuid())
  userId                      String
  provider                    String
  providerAccountId           String
  /// AES-256-GCM `iv:authTag:ciphertext` hex string (same format as
  /// TelemetryConnection.credentials — see lib/telemetry-credentials.ts).
  /// Only ever set for provider: 'github' rows; null for 'google'.
  githubAccessTokenEncrypted  String?
  user                        User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}
```

- [ ] **Step 3:** `pnpm exec prisma validate` (from `packages/db`) → "The schema at prisma\schema.prisma is valid 🚀"
- [ ] **Step 4:** `pnpm exec prisma migrate dev --name add_account_github_token` (from `packages/db`). If the DB is unreachable, use `--create-only` and report it still needs applying — never hand-write the SQL.
- [ ] **Step 5:** `pnpm --filter @arete/db build` → succeeds; `Account.githubAccessTokenEncrypted` appears in the generated client.
- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/generated
git commit -m "feat(db): add Account.githubAccessTokenEncrypted for GitHub installation linking"
```

---

### Task B2: `lib/github-credentials.ts` — decrypt helper (the dashboard currently only encrypts)

**Files:**
- Create: `packages/dashboard/src/lib/github-credentials.ts`
- Test: `packages/dashboard/src/lib/github-credentials.test.ts`

**Interfaces:**
- Produces: `decryptGithubToken(encrypted: string): string` — the missing decrypt half. (`packages/dashboard/src/lib/telemetry-credentials.ts` today only exports `encryptCredentials`, because the dashboard previously only ever *wrote* telemetry credentials for `packages/webhook` to read. This is the first dashboard-side code that needs to *read back* something it encrypted, so the decrypt function is new.)

- [ ] **Step 1: Write the failing test** — round-trip encrypt (via the existing `encryptCredentials`) → decrypt, plus a tamper-detection case (flipped auth tag byte throws).
- [ ] **Step 2:** `pnpm test -- github-credentials` (from `packages/dashboard`) → FAIL, module not found.
- [ ] **Step 3: Implement**, mirroring `telemetry-credentials.ts`'s `aes-256-gcm` / `iv:authTag:ciphertext` hex format exactly, using `createDecipheriv` and the same `TELEMETRY_ENCRYPTION_KEY` env var:

```ts
import { createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export function decryptGithubToken(encrypted: string): string {
  const keyHex = process.env.TELEMETRY_ENCRYPTION_KEY;
  if (!keyHex) throw new Error('Configuration error: TELEMETRY_ENCRYPTION_KEY is required');
  const [ivHex, authTagHex, cipherHex] = encrypted.split(':');
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')).accessToken;
}
```

  (Store `{ accessToken: string }` as the encrypted plaintext shape, matching how `encryptCredentials` takes a plain object.)

- [ ] **Step 4:** `pnpm test -- github-credentials` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/github-credentials.ts packages/dashboard/src/lib/github-credentials.test.ts
git commit -m "feat(dashboard): decrypt helper for stored GitHub link tokens"
```

---

### Task B3: `lib/github-link-state.ts` — signed CSRF state (mirrors `packages/webhook/src/oauth/oauth-state.ts`)

**Files:**
- Create: `packages/dashboard/src/lib/github-link-state.ts`
- Test: `packages/dashboard/src/lib/github-link-state.test.ts`

**Interfaces:**
- Produces: `signGithubLinkState(userId: string): string`, `verifyGithubLinkState(token: string): { userId: string } | null`.

- [ ] **Step 1: Write the failing test** — round-trip sign→verify; tampered payload rejected; expired (>10 min) rejected. Copy the test shape from `packages/webhook/src/oauth/oauth-state.test.ts` if present, adapted for `userId` instead of `installationId`.
- [ ] **Step 2:** `pnpm test -- github-link-state` → FAIL.
- [ ] **Step 3: Implement**, adapting `packages/webhook/src/oauth/oauth-state.ts` byte-for-byte (HMAC-SHA256, `timingSafeEqual`, `payload:signature` base64url, 10-minute TTL) but signing `userId:expiresAt` instead of `installationId:provider:expiresAt`, and keyed off `AUTH_SECRET` (not `TELEMETRY_ENCRYPTION_KEY` — this state is about *session identity*, not credential storage; using a different secret than the encryption key is also good hygiene: a leaked encryption key shouldn't let an attacker forge link-state tokens).
- [ ] **Step 4:** `pnpm test -- github-link-state` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/github-link-state.ts packages/dashboard/src/lib/github-link-state.test.ts
git commit -m "feat(dashboard): signed CSRF state for the GitHub account-link flow"
```

---

### Task B4: `lib/github-link.ts` — authorize URL + token exchange + Account upsert

**Files:**
- Create: `packages/dashboard/src/lib/github-link.ts`
- Test: `packages/dashboard/src/lib/github-link.test.ts`

**Interfaces:**
- Consumes: `signGithubLinkState`/`verifyGithubLinkState` (Task B3), `encryptCredentials` (existing `telemetry-credentials.ts`), `db` (existing `lib/db.ts`), `@arete/db` `PrismaClient`.
- Produces:
  - `buildGithubLinkAuthorizeUrl(userId: string): string`
  - `exchangeGithubLinkCode(code: string): Promise<{ accessToken: string; login: string; githubUserId: number } | null>` — never throws; `null` on any failure (mirrors `exchangeOAuthCode`'s never-throw contract in `packages/webhook/src/oauth/oauth-token-exchange.ts`).
  - `linkGithubAccount(db, { userId, githubUserId, accessToken }): Promise<void>` — upserts `Account` on `@@unique([provider, providerAccountId])` with `provider: 'github'`, `providerAccountId: String(githubUserId)`, `githubAccessTokenEncrypted: encryptCredentials({ accessToken })`. **Must set `userId` on create but must NOT overwrite `userId` on update to a different value** — if this GitHub account is already linked to a *different* dashboard user, this is a conflict (see Step 3 test) and must not silently reassign ownership.

- [ ] **Step 1: Write failing tests** — `buildGithubLinkAuthorizeUrl` embeds a verifiable state; `exchangeGithubLinkCode` returns `null` on a non-OK token response or missing `access_token` (use a fake `fetch`); `linkGithubAccount` creates a new Account row when none exists for that `providerAccountId`, and on a second call with the SAME `userId` updates the token in place (test via a fake db object, same style as `installations.test.ts`'s `fakeDb`).
- [ ] **Step 2:** `pnpm test -- github-link` → FAIL.
- [ ] **Step 3: Implement.** GitHub's classic OAuth token endpoint (`https://github.com/login/oauth/access_token`) returns JSON when sent `Accept: application/json`; identify the user via `GET https://api.github.com/user` with the new token (same header shape `fetchAuthorizedGithubLogins` in `lib/github.ts` already uses — `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`).

```ts
export function buildGithubLinkAuthorizeUrl(userId: string): string {
  const clientId = process.env.GITHUB_LINK_CLIENT_ID;
  if (!clientId) throw new Error('Configuration error: GITHUB_LINK_CLIENT_ID is required');
  const state = signGithubLinkState(userId);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', githubLinkRedirectUri());
  url.searchParams.set('scope', 'read:org read:user');
  url.searchParams.set('state', state);
  return url.toString();
}
```

  (`read:org` is required for `/user/memberships/orgs` — the same scope `fetchAuthorizedGithubLogins` needs; `redirect_uri` must point at the Task B5 callback route.)

- [ ] **Step 4:** `pnpm test -- github-link` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/github-link.ts packages/dashboard/src/lib/github-link.test.ts
git commit -m "feat(dashboard): GitHub account-link authorize URL, token exchange, Account upsert"
```

---

### Task B5: Callback route + "Connect GitHub" server action

**Files:**
- Create: `packages/dashboard/src/app/api/github-link/callback/route.ts`
- Create: `packages/dashboard/src/app/(dashboard)/settings/github-link-actions.ts` (server action `connectGithub()`)
- Modify: `packages/dashboard/src/app/(dashboard)/settings/page.tsx` (add the "Connect GitHub" affordance — coordinate exact placement with Phase UI, but the action must exist for Phase UI to wire a button to)

**Interfaces:**
- Consumes: `auth()` (existing `lib/auth.ts`), `verifyGithubLinkState`/`buildGithubLinkAuthorizeUrl`/`exchangeGithubLinkCode`/`linkGithubAccount` (Tasks B3/B4).

- [ ] **Step 1: `connectGithub()` server action** — reads `session.user.id` via `auth()` (redirect to `/login` if absent, same guard as `connectStripeApiKey` in `connections/[id]/actions.ts`), then `redirect(buildGithubLinkAuthorizeUrl(session.user.id))`.
- [ ] **Step 2: Callback route handler** (`GET /api/github-link/callback`):
  1. Read `code`/`state` from `req.nextUrl.searchParams`; 400 if either missing.
  2. `verifyGithubLinkState(state)` → 400 "Invalid or expired state" if `null`.
  3. **Defense in depth:** also call `auth()` and confirm `session.user.id === verified.userId` — reject (400) on mismatch. (The signed state already proves intent; this second check guards against a stale/replayed callback URL being opened in a different browser session.)
  4. `exchangeGithubLinkCode(code)` → on `null`, redirect to `/settings?error=github_link_failed`.
  5. `linkGithubAccount(db, { userId: verified.userId, githubUserId, accessToken })`.
  6. Redirect to `/settings?connected=github`.
- [ ] **Step 3:** Manual smoke only for this task (real GitHub OAuth round-trip needs a registered OAuth App + real browser — defer full verification to Phase TESTS' unit coverage of the pieces, plus a note in the PR that end-to-end needs manual QA with real `GITHUB_LINK_CLIENT_ID/SECRET`).
- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app/api/github-link/callback/route.ts packages/dashboard/src/app/(dashboard)/settings/github-link-actions.ts packages/dashboard/src/app/(dashboard)/settings/page.tsx
git commit -m "feat(dashboard): Connect-GitHub callback route and server action"
```

---

### Task B6: Wire `auth.ts`'s `jwt`/`session` callbacks to real installations (replaces the stub)

**Files:**
- Modify: `packages/dashboard/src/lib/auth.ts` (the stub is at line 38: `session.installations = [];`)
- Modify: `packages/dashboard/src/types/next-auth.d.ts` (re-add the `JWT` augmentation dropped in `77c6e2e`)

**Interfaces:**
- Consumes: `fetchAuthorizedGithubLogins` (`lib/github.ts`, unchanged), `getAuthorizedInstallations`/`AuthorizedInstallation` (`lib/installations.ts`, unchanged), `shouldRefreshInstallations` (`lib/installation-cache.ts`, unchanged), `decryptGithubToken` (Task B2), `db.account.findFirst` (Task B1's new column).
- Produces: `session.installations: AuthorizedInstallation[]` — real data, sourced from the caller's linked GitHub account if one exists, `[]` otherwise.

- [ ] **Step 1: Re-add the JWT type augmentation** in `types/next-auth.d.ts` (removed in `77c6e2e` step 6): `installations?: AuthorizedInstallation[]`, `installationsFetchedAt?: number` on `next-auth`'s `JWT` — **and** on `@auth/core/jwt`'s `JWT` too (the comment in the original `f47db0b` file explains why both are needed: this beta's `export * from "@auth/core/jwt"` re-export chain means augmenting only `next-auth/jwt` doesn't merge into the interface the `jwt` callback's `token` param actually type-checks against).
- [ ] **Step 2: Rewrite the `jwt` callback** in `auth.ts`:

```ts
async jwt({ token, user }) {
  if (user?.id) token.sub = user.id;

  const now = Date.now();
  if (token.sub && shouldRefreshInstallations(token.installationsFetchedAt, now)) {
    try {
      const link = await db.account.findFirst({
        where: { userId: token.sub, provider: 'github' },
        select: { githubAccessTokenEncrypted: true },
      });
      if (link?.githubAccessTokenEncrypted) {
        const accessToken = decryptGithubToken(link.githubAccessTokenEncrypted);
        const logins = await fetchAuthorizedGithubLogins(accessToken);
        token.installations = await getAuthorizedInstallations(db, logins);
      } else {
        token.installations = [];
      }
      token.installationsFetchedAt = now;
    } catch (error) {
      // Transient GitHub API failure or a revoked/expired token: keep serving
      // the last-known-good mapping (or [] on first attempt) rather than
      // failing the whole session — never fail open to "show everything."
      console.error('[auth] failed to refresh authorized installations', error);
      token.installations = token.installations ?? [];
      token.installationsFetchedAt = token.installationsFetchedAt ?? now;
    }
  }

  return token;
},
```

- [ ] **Step 3: Update the `session` callback** — replace the stub line:

```ts
async session({ session, token }) {
  if (session.user && token.sub) session.user.id = token.sub;
  session.installations = token.installations ?? [];
  return session;
},
```

- [ ] **Step 4: Typecheck + run the full existing suite** — `pnpm exec tsc --noEmit` and `pnpm --filter @arete/dashboard test` (from repo root) must both stay green; this touches a file every existing query/page test's fake-session shape may reference.
- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/auth.ts packages/dashboard/src/types/next-auth.d.ts
git commit -m "feat(dashboard): wire session.installations to real GitHub App installations"
```

---

## PHASE UI

Owns: surfacing real installations where behavior actually changes now that they're real, not stubbed. Most consumers (`InstallationSwitcher.tsx`, `EmptyState.tsx`, `DashboardShell`/`Sidebar`, `settings/page.tsx`'s billing card) **already handle the real-data shape correctly** — they were built in `f47db0b` against the real `AuthorizedInstallation[]` type and never changed when the stub landed. Confirm this rather than assume rework is needed.

### Task U1: Verify existing installation-aware UI needs no changes

**Files (read/verify only, no edits expected):**
- `packages/dashboard/src/components/InstallationSwitcher.tsx`
- `packages/dashboard/src/components/EmptyState.tsx`
- `packages/dashboard/src/app/(dashboard)/layout.tsx`
- `packages/dashboard/src/components/dashboard/dashboard-shell.tsx`, `sidebar.tsx`

- [ ] **Step 1:** With Phase BACKEND merged, manually sign in as a test user with zero linked GitHub account → confirm `EmptyState` renders (not broken/blank metrics) and its "Install the Areté GitHub App" CTA still makes sense (it does — the CTA is about installing the App, which is still a real prerequisite regardless of whether GitHub is linked).
- [ ] **Step 2:** Sign in as a user linked to a GitHub account authorized for 2+ installations → confirm `InstallationSwitcher` (rendered via `Sidebar`) lists them by `owner` and the `?installation=` query param round-trips through `resolveSelectedInstallationIds`.
- [ ] **Step 3:** No commit expected unless a real bug is found (e.g., a page missed the `installations ?? []` guard) — if so, fix minimally and commit with a description of exactly what broke.

### Task U2: Add the "Connect GitHub" affordance to Settings

**Files:**
- Modify: `packages/dashboard/src/app/(dashboard)/settings/page.tsx` (Task B5 already stubs the server action import; this task is the actual card/button UI)

**Interfaces:**
- Consumes: `connectGithub()` server action (Task B5), `session.user` fields already read in this page.

- [ ] **Step 1:** Add a card (matching the existing `Card`/`CardHeader`/`CardTitle` pattern already used for "Account" and "Billing" in this file) titled e.g. "GitHub" with:
  - If no linked GitHub account: a "Connect GitHub" button (`<form action={connectGithub}>`) with copy explaining this determines which installations/orgs you can see.
  - If linked (need a query — Phase BACKEND's `db.account.findFirst` shape, or add a small `getLinkedGithubLogin(db, userId)` helper in `lib/github-link.ts` if not already covering this): show the connected state, no destructive "disconnect" action required for v1 unless trivial to add.
- [ ] **Step 2:** Respect the `?connected=github` / `?error=github_link_failed` query params Task B5's callback route sets — a small inline success/error banner, matching how `connectStripeApiKey`'s `redirect('/connections?connected=stripe')` is presumably surfaced on that page today (check `connections/[id]/page.tsx` for the existing convention and mirror it).
- [ ] **Step 3:** Manual smoke: full connect round-trip with real (or sandboxed) GitHub OAuth App credentials.
- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app/(dashboard)/settings/page.tsx
git commit -m "feat(dashboard): Connect GitHub affordance on Settings page"
```

---

## PHASE TESTS

Owns: proving the tenancy/security invariants hold, on top of the unit tests Phase BACKEND already writes inline (B2–B4). This phase's job is the **integration-shaped** proof: a real signed-in session ends up with the right `session.installations`, and cross-tenant leakage is structurally impossible.

### Task T1: `auth.ts` jwt-callback unit coverage (linked vs. unlinked vs. failure)

**Files:**
- Create or extend: `packages/dashboard/src/lib/auth.test.ts` (may not exist yet — check first; if `auth.ts` is hard to unit-test directly because it constructs the live `NextAuth()` instance, extract the callback bodies into small standalone functions first, OR test via the same `fakeDb` + a manually-invoked copy of the callback logic pattern `installations.test.ts` already uses — prefer testing the smallest already-exported pieces (`getAuthorizedInstallations`, `shouldRefreshInstallations`, `decryptGithubToken`) plus one true end-to-end case through the real `jwt`/`session` callbacks if `auth.ts` exposes them for testing, matching however `proxy.test.ts` already drives the real `auth.config.ts`).

**Required cases:**
- [ ] A user with a linked GitHub account whose login matches an `Installation.owner` gets that installation in `session.installations`.
- [ ] A user with a linked GitHub account whose login matches **no** `Installation.owner` gets `session.installations = []` (not an error).
- [ ] A user with **no** linked GitHub account (`db.account.findFirst` returns `null`) gets `session.installations = []` without calling `fetchAuthorizedGithubLogins` at all (assert the fake `fetch`/GitHub call was never made — mirrors `installations.test.ts`'s "returns an empty array without querying the db when logins is empty" pattern).
- [ ] A GitHub API failure (simulated 401/500 from `/user`) during a stale-cache refresh falls back to the **previously cached** `installations`/`installationsFetchedAt`, not to `[]` and not to "all installations."
- [ ] A GitHub API failure on the **first-ever** refresh (no prior cache) falls back to `[]`, not undefined/throw.

### Task T2: Tenancy isolation — no cross-account leakage

**Files:**
- Create: `packages/dashboard/src/lib/installations-tenancy.test.ts` (or extend `installations.test.ts` if a single new `describe` block reads more naturally there — match whichever the codebase's own convention favors by the time this task starts)

**Required cases (this is the property the whole plan exists to guarantee):**
- [ ] Given two `Installation` rows with different `owner`s (`acme`, `globex`) and a user whose GitHub logins resolve to `['acme']` only, `getAuthorizedInstallations` + `resolveSelectedInstallationIds` + `getDashboardViewModel` together never surface `globex`'s repos/reviews/comments — even when both installations' data coexists in the same fake-db fixture. This should closely mirror the existing fixture style in `queries.test.ts` (which already proves this for `getDashboardViewModel` given an `installationIds` list) — the NEW piece to test here is that the **session-derived** `installationIds` (via the real login-matching pipeline) is what feeds that list, not a hand-picked id.
- [ ] A malicious/mistaken `?installation=<globex-id>` query param from an `acme`-only user is rejected by `resolveSelectedInstallationIds` (already covered indirectly by existing tests — confirm and, if needed, add an explicit case naming this as a security property, not just a UX default).
- [ ] Two users linked to the same personal GitHub login... N/A (logins are 1:1 with a GitHub account); instead cover: two users who are each admins of *different* orgs, both those orgs happen to have installations, confirm neither sees the other's.

### Task T3: Full-suite regression gate

- [ ] `pnpm --filter @arete/dashboard test` — all green, including every pre-existing suite (`queries.test.ts`, `proxy.test.ts`, `installation-cache.test.ts`, `installations.test.ts`, `EmptyState.test.tsx`, `users.test.ts`, plus every new file above).
- [ ] `pnpm --filter @arete/db build` — green.
- [ ] `pnpm --filter @arete/dashboard exec tsc --noEmit` — no errors in any changed file.
- [ ] Report final green output as evidence before declaring the refactor complete (per `superpowers:verification-before-completion`).

---

## Appendix: Key Findings for the BACKEND agent

1. **The stub is one line.** `packages/dashboard/src/lib/auth.ts:38`: `session.installations = [];` (with comment `// GitHub→account linking is a later spec; no installations yet.`). Everything downstream already expects the real `AuthorizedInstallation[]` shape — this is the entire blocker.
2. **The hard part is already solved and untouched.** `packages/dashboard/src/lib/installations.ts` (`getAuthorizedInstallations`, owner-matching, case-insensitive), `packages/dashboard/src/lib/installation-cache.ts` (`shouldRefreshInstallations`, 5-min TTL), and `packages/dashboard/src/lib/github.ts` (`fetchAuthorizedGithubLogins`, calls `/user` + `/user/memberships/orgs?state=active` filtering `role === 'admin'`) are fully written and fully unit-tested from the original `f47db0b` commit. **Do not rewrite these.**
3. **The actual gap:** how a Google/Credentials-authenticated user's GitHub identity gets captured, now that GitHub is not a login provider (deliberately, per `docs/superpowers/plans/2026-07-12-arete-account-auth.md` and `.env.example:120-123`). This plan's answer: a dedicated non-NextAuth "Connect GitHub" OAuth flow (Tasks B3–B5), storing an encrypted access token on a new `Account.githubAccessTokenEncrypted` column (Task B1), read back by `auth.ts`'s `jwt` callback on the existing TTL (Task B6).
4. **SINGLE-OWNER migration:** Task B1 (`packages/db/prisma/schema.prisma` + new migration under `packages/db/prisma/migrations/`). `packages/db` is shared by `@arete/webhook` and `@arete/dashboard` — coordinate before running `prisma migrate dev`, per the file's own "Single source of truth... Do NOT copy this schema elsewhere" header comment. Prior art for this exact kind of change: migration `20260712200511_add_user_account` (added `User`/`Account` themselves) and its driving plan `docs/superpowers/plans/2026-07-12-arete-account-auth.md`.
5. **External/webhook dependency, NOT fixed by this plan:** `Installation` rows are created lazily, only inside `packages/webhook/src/persistence.ts`'s `persistReview()` (an upsert on `provider_externalId`), the first time a PR review completes. `packages/webhook/src/server.ts` registers webhook handlers only for `pull_request` and `pull_request_review_comment` — there is no `installation` / `installation_repositories` GitHub App webhook handler. A brand-new install with zero reviewed PRs yet will have no matching `Installation` row even after this plan's GitHub-link flow succeeds, and will still see the `EmptyState`. This is a `packages/webhook`-side gap outside the dashboard package boundary — call it out in the PR, do not attempt to fix it in this plan.
6. **A cleaner long-term alternative exists but is out of scope:** if the Areté GitHub App has its own OAuth ("user-to-server") client credentials configured, a user-to-server token could call `/user/installations` directly for exact installation IDs instead of the owner-login-matching heuristic. That would eventually let `installations.ts`/`github.ts` be simplified/replaced, but depends on GitHub App configuration outside this plan's control and is a larger rearchitecture — noted for a future spec, not attempted here.

## Self-Review

- **Spec coverage:** stub replaced with real data (Task B6) ✓; explicit choice not to revive GitHub-as-login, with rationale (Architecture section) ✓; single-owner migration flagged (Task B1, Global Constraints) ✓; external webhook dependency flagged (Global Constraints item 5, Appendix item 5) ✓; tenancy/security invariants stated (Global Constraints) and tested (Task T2) ✓; UI changes scoped to only what actually changes (Task U1 verifies most needs no edits; Task U2 is the one genuinely new surface) ✓.
- **Reuse discipline:** `installations.ts`, `installation-cache.ts`, `github.ts`, and every `lib/queries.ts` function are explicitly marked "do not change" — the plan adds new files (`github-link*.ts`, `github-credentials.ts`) rather than modifying tested, working code.
- **Known risk called out for reviewers:** the Connect-GitHub flow is new infrastructure (not a revival of deleted code) — its OAuth App registration, redirect URI, and env vars need real values before Task B5's callback can be smoke-tested end-to-end; Task T1's fake-based tests are the backstop that doesn't require live GitHub credentials.
