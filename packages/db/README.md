# @arete/db

Single source of truth for Areté's data model. Owns the Prisma schema
(`prisma/schema.prisma`), the migration history (`prisma/migrations/`), and the
generated Prisma client, which it compiles and exports for both
`@arete/webhook` and `@arete/dashboard`.

```ts
import { PrismaClient, ScmProvider } from '@arete/db'
```

Do **not** add a `prisma/schema.prisma` to any other package.

## Key invariants

- `Installation` and `Repository` rows are identified by
  `@@unique([provider, externalId])` — external IDs (GitHub installation ids,
  GitLab project ids) are only unique *within* a provider. Every lookup must be
  scoped by `provider`, never by the bare external id.
- Primary keys are Prisma-generated UUIDs. Never write external IDs into `id`.
- `Review` is idempotent on `@@unique([repositoryId, prNumber, headSha])`.

## Building the client

`pnpm install` triggers the `prepare` script, which runs `prisma generate` and
compiles the client to `dist/`. To rebuild manually:

```sh
pnpm --filter @arete/db build
```

## Migrations (never `db push`)

The connection string comes from `DATABASE_URL` (see `prisma.config.ts`; it
falls back to the local `infra/docker-compose.yml` Postgres:
`postgresql://arete:arete@localhost:5432/arete`).

Start the local database:

```sh
docker compose -f infra/docker-compose.yml up -d postgres
```

Create a new migration after editing `prisma/schema.prisma`:

```sh
pnpm --filter @arete/db exec prisma migrate dev --name <describe_the_change>
```

Apply pending migrations (CI/production, and before `next build` of the
dashboard, which prerenders against the database):

```sh
pnpm --filter @arete/db migrate:deploy
```

The `0_init` baseline migration captures the full current schema. Databases
created under the old `db push` workflow can be baselined with:

```sh
pnpm --filter @arete/db exec prisma migrate resolve --applied 0_init
```
