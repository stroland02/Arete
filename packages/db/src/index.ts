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

// The platform-gated reads of Areté's OWN observability store live in this
// package too — same "one resolver, one truth" argument, since they depend on
// the gate above and are consumed by BOTH @arete/dashboard (the Incident detail
// Signals panel) and @arete/webhook (the healing path). But they are NOT
// re-exported here: they pull in @clickhouse/client, and this root is imported
// by nearly every module in every service. Import them from `@arete/db/telemetry`
// instead — see telemetry.ts's header for what that cost actually measured.
