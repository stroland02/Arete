// Public surface of @arete/db: the generated Prisma client for the shared
// Areté schema (packages/db/prisma/schema.prisma).
export * from './generated/prisma/client'

// …plus the one hand-written module that answers a question ABOUT a row of that
// schema and that BOTH services must answer identically: which Installation is
// the platform's own (`Installation.isPlatform`). See platform-installation.ts's
// header and docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md §2
// ("one resolver, one truth") for why it lives here rather than being mirrored
// into @arete/dashboard and @arete/webhook separately.
export * from './platform-installation'
