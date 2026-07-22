// Thin re-export. The incident-signal query surface MOVED to `@arete/db`
// (`packages/db/src/incident-signals.ts`) on 2026-07-22, together with the
// platform gate it depends on, because it now has two consumers: this
// dashboard's Signals panel and the healing path in `@arete/webhook`, which
// feeds an incident's runtime context to the fix agent. Two copies of a
// security-gated query are two places to drift (tenancy contract §2, "one
// resolver, one truth") — so there is one implementation, in the package that
// already owns both the ClickHouse schema and `isPlatformInstallation`.
//
// This file stays so dashboard callers keep importing `@/lib/telemetry-queries`
// unchanged. EVERY exported name, signature and type is identical to what it
// re-exports; read the moved module's header for the access contract (what
// `superlog.project_id` actually is, and why `denied` ≠ `unavailable` ≠ empty).
// This is the same delegation shape `lib/platform-installation.ts` already uses.

export {
  incidentSignalWindow,
  getIncidentErrorSpans,
  getIncidentLogs,
  getIncidentExceptions,
  getIncidentSignals,
} from '@arete/db';

export type {
  TelemetryQueriesDb,
  SignalWindow,
  ErrorSpan,
  LogLine,
  ExceptionGroup,
  SignalAccess,
  IncidentSignals,
} from '@arete/db';
