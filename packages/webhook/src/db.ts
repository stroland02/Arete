import { PrismaClient } from '@arete/db'
import { PrismaPg } from '@prisma/adapter-pg'

// Single shared Prisma client for the webhook service. Import this instead of
// constructing new PrismaClient instances per module.
//
// Prisma 7 requires a driver adapter; the connection pool is created lazily,
// so nothing connects until the first query. The fallback URL matches the
// local infra/docker-compose.yml Postgres (same default as
// packages/db/prisma.config.ts).
const adapter = new PrismaPg(
  process.env.DATABASE_URL ?? 'postgresql://arete:arete@localhost:5432/arete'
)

export const prisma = new PrismaClient({ adapter })
