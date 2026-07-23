// Thin re-export. The ClickHouse client moved to `@arete/db`
// (`packages/db/src/clickhouse.ts`) on 2026-07-22, alongside the incident-signal
// queries that moved out of `lib/telemetry-queries.ts` — `@arete/db` already
// owns the ClickHouse schema and migrations (`packages/db/clickhouse/`), and
// `@arete/webhook` now reads those same tables on the healing path. One client,
// one place to configure it.
//
// Kept so `lib/errors.ts` and `lib/queries.ts` keep importing `./clickhouse`
// unchanged — both use only `.query`, which the shared facade forwards. The
// shared client is LAZY: constructed on first query rather than at import, so a
// service that never touches telemetry never opens a pool.

export { clickhouse, getClickhouse, resetClickhouse, jsonEachRow } from '@arete/db/telemetry';
