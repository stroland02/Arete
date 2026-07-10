import { defineConfig } from 'prisma/config'

// Prisma 7 no longer reads .env automatically or accepts `url` in the schema
// datasource block — the CLI gets its connection string from this file.
// DATABASE_URL always wins; the fallback matches infra/docker-compose.yml so
// local `prisma migrate dev` works out of the box.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://arete:arete@localhost:5432/arete',
  },
})
