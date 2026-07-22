// `@arete/db/telemetry` — the ClickHouse half of this package, deliberately
// kept OFF the root export.
//
// `@arete/db`'s root is imported by essentially every module in every service,
// and re-exporting these from it dragged `@clickhouse/client` into all of them.
// That is a real cost, not a theoretical one: it slowed module loading across
// the webhook test suite enough to push unrelated, untouched suites into
// timeouts. Almost nothing needs to read telemetry; the handful of call sites
// that do can say so in their import.
//
// So the split is by dependency weight, not by taste:
//   `@arete/db`            → Prisma client + the platform gate (a DB fact)
//   `@arete/db/telemetry`  → the ClickHouse client + the gated incident reads
//
// The platform gate itself stays on the root, because it answers a question
// about a Prisma row and its callers (lib/errors.ts, the alert receiver) have
// nothing to do with ClickHouse.

export * from './incident-signals'
export * from './clickhouse'
