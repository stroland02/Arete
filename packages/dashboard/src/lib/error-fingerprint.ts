// Deterministic grouping key for observed errors — a THIN RE-EXPORT.
//
// The implementation moved to `packages/telemetry/src/fingerprint.ts` and this
// module now forwards to it, unchanged in name, signature and output. It is no
// longer a copy of anything.
//
// WHY IT MOVED. This file used to carry a "MIRRORS packages/webhook/src/
// fingerprint.ts … KEEP THE TWO RULE LISTS IN SYNC" header, and its own
// closing note said: "If a shared `@arete/core` ever lands, both should move
// there and this duplicate should be deleted." That day arrived for a concrete
// reason: `superlog.issue_fingerprint` is now stamped at EMIT time by the
// emitters (`@arete/telemetry` recordExceptionWithFingerprint) and read by the
// `superlog.otel_exceptions` / `superlog.issue_activity_daily` projections,
// while this surface still computes the same key at READ time (lib/errors.ts).
// Under a hand-synced copy those two are one careless edit away from splitting
// a single error into two groups — precisely what
// docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md §5
// ("One fingerprint, one normalizer") forbids.
//
// WHY `@arete/telemetry` AND NOT A NEW PACKAGE. The party that must stamp is
// the emitter, and `@arete/telemetry` is the package every TypeScript emitter
// already depends on. The old header's objection — that importing across
// packages would drag a service's Prisma client and OpenTelemetry bootstrap
// into the Next.js bundle — applied to `@arete/webhook` (a deployable). It does
// not apply here: `@arete/telemetry/fingerprint` is a dedicated subpath export
// whose module imports `node:crypto` and nothing else, so none of the SDK
// reaches this app. This mirrors the platform-installation resolver moving into
// `@arete/db` (contract §2) — a rule two packages must both obey belongs in the
// package they both depend on.

export { normalizeErrorMessage, fingerprintError } from '@arete/telemetry/fingerprint';
