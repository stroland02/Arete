# Sandbox Customer — Kuma test bed

**This entire directory is clearly-labeled TEST DATA.** It is a fake customer's world we
own, so Kuma can be exercised end-to-end and the dogfooding dashboard renders real activity
instead of empty states. Nothing here calls a real third-party service.

- **What it is:** a small, realistic multi-service app (`app/`) with intentional defects,
  static telemetry fixtures (`telemetry-fixtures/`), a DB seed (`seed/`), and an E2E driver
  (`driver/`).
- **What it is NOT:** production code, a real integration, or anything wired into Areté's
  packages. It lives at the repo root, isolated from `packages/`.

## The fake customer: "Beancount"

A tiny expense-tracking SaaS — an API + data layer + a minimal web page. It carries four
**intentional, catalogued defects** so Kuma's specialists each have something real to find.
Source is kept realistic (no giveaway comments on the buggy lines); the defects are
catalogued here for graders:

| # | Kind | File:line | Defect |
|---|------|-----------|--------|
| 1 | Real bug | `app/api/expenses.ts` `listExpenses` | Page is 1-indexed but `offset = page * limit`, so page 1 skips the first `limit` rows. |
| 2 | Security | `app/data/db.ts` `rawQuery` + `app/api/expenses.ts` `searchExpenses` | User input concatenated straight into SQL → injection. |
| 3 | Flaky test | `app/api/__tests__/reports.test.ts` | Buckets on `new Date()`; fails across midnight / in non-UTC timezones. |
| 4 | Perf | `app/api/reports.ts` `summarize` | Re-filters the full expense list once per category → O(n²). |

## v1 — local (this is what's built)

Makes localhost show real Kuma activity. No GitHub, no human needed beyond infra.

```bash
# 1. Seed the Kuma DB with the sandbox customer (needs Postgres + DATABASE_URL)
node sandbox-customer/seed/seed-sandbox.mjs

# 2. Drive a review through the real pipeline (needs agents server + ANTHROPIC_API_KEY)
node sandbox-customer/driver/run-review.mjs
```

### What each step needs (honest — not faked if absent)

- **Seed:** a running Postgres and `DATABASE_URL`. Run from the repo root so the `@arete/db`
  Prisma client resolves.
- **Dev-session visibility:** `/overview` only shows an installation whose `owner` matches a
  GitHub login the signed-in dev user is authorized for (see
  `packages/dashboard/src/lib/auth.ts` → `getAuthorizedInstallations`). The seed therefore
  calls Fable's `seedDevUser` when present and stamps `Installation.owner` to the returned
  dev login. If `seedDevUser` is not on-branch yet, the seed falls back to the `SANDBOX_OWNER`
  env var (default `kuma-sandbox`) and prints a warning that `/overview` may gate empty until
  the owner matches the dev session. This is the one integration wire-in for the PM.
- **Driver:** the agents server up at `AGENTS_URL` (default `http://localhost:8000`) and
  `ANTHROPIC_API_KEY` set for a real LLM review. If either is missing, the driver prints the
  exact payload + command and exits non-zero — it never fabricates a result.

## v2 — real GitHub E2E (NOT built; needs a human)

True webhook→review→PR requires: creating a real GitHub sandbox repo (the `app/` code is the
starting point), installing the Areté GitHub App on it, and providing App/webhook secrets.
Flagged for the PM; not stubbed.

## Idempotency

`seed-sandbox.mjs` upserts on natural keys (`Installation[provider,externalId]`,
`Review[repositoryId,prNumber,headSha]`), so re-running never duplicates rows.
