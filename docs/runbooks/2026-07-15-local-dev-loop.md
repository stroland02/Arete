# Runbook — Local Dev Loop (Areté localhost)

**Date:** 2026-07-15 · Applies to: `integration` / `feat/glass-box-cockpit` and later.
Companion design: `docs/superpowers/specs/2026-07-15-glass-box-cockpit-design.md`.

The single source of truth for running Areté locally so you can sign in, use the app, and
dogfood fixes with the Glass Box live cockpit.

---

## TL;DR — one command

```bash
pnpm dev:all        # auto-starts Docker Desktop if down, infra up, DB sync,
                    # dashboard + Glass Box sidecar, auto-opens localhost:3000
```

Then sign in at http://localhost:3000/login with the seeded dev login
(`dev@arete.local` / `devpassword`) or create your own at `/signup`.

> `/overview` shows honest **empty states** until a GitHub installation is linked (Connections
> page). That is correct, not a bug — a Credentials/Google login has no installations until it
> links a GitHub account with real installations. Never seed fake tenants.

---

## First-time / manual setup

```bash
# 1. Env — GITIGNORED. Copy the reference and fill the local minimum.
cp .env.example .env
# Ensure these (already the local defaults):
#   DATABASE_URL=postgresql://arete:arete@localhost:5432/arete
#   REDIS_URL=redis://localhost:6379
#   AUTH_SECRET=<openssl rand -base64 33>
# Next.js loads env from packages/dashboard, so the dashboard's required vars
# ALSO live in packages/dashboard/.env.local (DATABASE_URL, AUTH_SECRET, and
# NEXT_PUBLIC_GLASSBOX_URL to activate the cockpit).

# 2. Infra (Postgres/Redis/ClickHouse)
pnpm infra:up

# 3. Sync the DB schema  (see "Migration note" below re: db push vs migrate)
pnpm --filter @arete/db exec prisma db push --accept-data-loss

# 4. Seed a real dev login (optional; or use /signup)
pnpm dev:seed

# 5. Run the dashboard (single server, port 3000)
pnpm dev:dashboard
#   optional cockpit backend (in another shell):
pnpm dev:glassbox
```

### Scripts
| Command | Does |
|---|---|
| `pnpm dev:all` | full auto bootstrap (Docker→infra→DB→servers→open tab) |
| `pnpm dev:dashboard` | just the Next.js dashboard on :3000 |
| `pnpm dev:glassbox` | Glass Box sidecar (SSE at :4517, git + queue events) |
| `pnpm dev:seed` | create the `dev@arete.local` login |
| `pnpm db:migrate` | `prisma migrate deploy` (blocked until the migration defect is fixed) |
| `pnpm infra:up` / `infra:down` | start / stop the docker services |

---

## Migration note (known defect, being fixed by the @arete/db owner)

`prisma migrate deploy` currently **fails** on `integration`: the schema has models
`ApprovalPrompt` and `AgentMemory`, and a migration `ALTER`s `ApprovalPrompt` to add
`executedAt`, but **no migration creates those tables** (only the ALTER exists). Until a proper
create-migration is authored, use **`prisma db push`** locally — it syncs the DB directly to
`schema.prisma` and creates all tables. It touches no committed files.

---

## The stale-worktree footgun (do not repeat Wave-1's junk-card bug)

- **Serve localhost from ONE checkout only.** Do not run `next dev` from a feature-branch
  worktree while expecting to see `main`/`integration` — a stale server silently shadows :3000.
- If a dev server started **before** `.env`/`.env.local` existed, it won't have the env —
  **restart it** (kill the old PID, `rm -rf packages/dashboard/.next` if pages look stale, then
  `pnpm dev:dashboard`).
- The **Glass Box provenance banner** (bottom-right dock) prints the branch + sha actually being
  served — use it to confirm you're looking at the checkout you think you are.
- One canonical port (**3000**). A second server collides loudly (`Port 3000 is in use`) instead
  of shadowing — do not let it fall back to another port for "the app".

---

## Dogfooding with Glass Box

With `dev:glassbox` running and `NEXT_PUBLIC_GLASSBOX_URL` set (it is, in `.env.local`), the
cockpit dock appears bottom-right on authenticated pages. When a commit/branch update lands in
the serving checkout, the dock narrates it and the current page auto-refreshes (`router.refresh`)
so `/overview` + Sensorium re-render against fresh data. If the sidecar isn't running the dock
shows an honest "offline" — never fabricated activity.

---

## Research grounding (why this loop is shaped this way)

- **Infra in Docker, apps native** keeps each runtime's own hot reload at full speed (Next Fast
  Refresh, `tsx watch`, `uvicorn --reload`); Docker Compose Watch is the parity-testing
  alternative, not the daily loop. ([DEV: Compose Watch + Turborepo + pnpm](https://dev.to/moofoo/typescript-monorepo-development-using-docker-compose-watch-turborepo-and-pnpm-3hep))
- **SSE (not WebSockets)** for the one-way activity feed — plain long-lived HTTP, auto-reconnect,
  proxy/devtools-friendly. ([WebSocket.org](https://websocket.org/comparisons/sse/), [freeCodeCamp](https://www.freecodecamp.org/news/server-sent-events-vs-websockets/))
- **BullMQ `QueueEvents`** is Redis-streams-backed (reliable delivery) — the sidecar bridges it
  read-only. ([BullMQ docs](https://docs.bullmq.io/guide/events))
