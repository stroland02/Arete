// The ClickHouse client for Areté's OWN SUPERLOG observability store — the
// `superlog.otel_traces` / `otel_logs` / `otel_exceptions` tables whose schema
// and migrations this package already owns (`packages/db/clickhouse/`).
//
// It lives here, rather than in one service's `lib/`, because both
// `@arete/dashboard` (the Incident detail Signals panel) and `@arete/webhook`
// (the healing path, which feeds an incident's runtime context to the fix
// agent) read those tables through the same platform-gated queries in
// `incident-signals.ts`. See .claude/ade-coordination.md's pyrosome claim for
// why one implementation rather than two.
//
// LAZY ON PURPOSE. `@arete/db` is imported by every service, including ones
// with no ClickHouse configured and no reason to talk to it. Constructing the
// client at module load would open a connection pool in all of them as a side
// effect of importing Prisma. `getClickhouse()` builds it on first real use and
// memoizes it, so a service that never queries telemetry never creates one.

import { createClient, type ClickHouseClient } from '@clickhouse/client';

let client: ClickHouseClient | undefined;

/** The shared client, constructed on first use. Env is read at that moment
 *  rather than at import, so a process that configures ClickHouse after
 *  loading `@arete/db` still gets the right connection. */
export function getClickhouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'superlog',
      password: process.env.CLICKHOUSE_PASSWORD || 'superlog',
      database: process.env.CLICKHOUSE_DB || 'superlog',
    });
  }
  return client;
}

/** Drops the memoized client so the next `getClickhouse()` rebuilds it from
 *  current env. For tests and for a process that rotates credentials; not part
 *  of the normal request path. */
export function resetClickhouse(): void {
  client = undefined;
}

/**
 * Back-compat facade for the call sites written against a module-level
 * `clickhouse` object (`clickhouse.query({...})`). Forwards to the lazily
 * constructed client so those call sites keep working verbatim while still
 * paying nothing at import time.
 */
export const clickhouse = {
  query: (...args: Parameters<ClickHouseClient['query']>) => getClickhouse().query(...args),
};

/**
 * Narrows a `JSONEachRow` result set to the array of rows it always is.
 *
 * `ResultSet.json()` is typed as a union across every format the client
 * supports (`T[] | Record<string, T> | ResponseJSON<T>`), because `JSON` and
 * `JSONObjectEachRow` return objects rather than arrays. Callers that request
 * `format: 'JSONEachRow'` always get the array arm — so the narrowing lives
 * here once, with the reason attached, rather than as a bare cast at each call
 * site where the `format` argument has scrolled out of sight.
 *
 * Only sound for `JSONEachRow`. A caller using another format must not use it.
 */
export async function jsonEachRow<T>(result: { json(): Promise<unknown> }): Promise<T[]> {
  return (await result.json()) as T[];
}
