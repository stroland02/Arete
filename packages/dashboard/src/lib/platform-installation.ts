// WHO IS THE PLATFORM INSTALLATION — the dashboard's door onto the one place
// that decides it.
//
// The implementation used to live here. It now lives in
// `packages/db/src/platform-installation.ts` and this file only re-exports it.
//
// WHY IT MOVED
// ------------
// The telemetry-tenancy contract (docs/superpowers/specs/
// 2026-07-22-telemetry-tenancy-contract.md §2) says "No surface may re-derive
// 'is this the platform?' locally. One resolver, one truth." The dashboard is
// only ONE of the surfaces that must obey it: `packages/webhook/src/alerting/
// receiver.ts` files EVERY incoming Alertmanager alert (and, via Task 4 routing,
// opens fix runs) against the platform installation, and it was still trusting
// the `ARETE_PLATFORM_INSTALLATION_ID` string. The webhook cannot import from
// `@arete/dashboard`, so leaving the resolver here would have forced a second
// copy of it into the webhook.
//
// The repo does have a precedent for exactly that — `error-fingerprint.ts`
// mirrors `packages/webhook/src/fingerprint.ts` — and that is a defensible
// trade for a pure hash. It is NOT a defensible trade for a security gate:
// two copies of a fail-closed tenancy rule are two places to drift, and drift
// here means Kuma's internals (or its incidents) landing in a customer's
// account. So the resolver moved DOWN into `@arete/db`, the only workspace
// package both services already depend on, and whose README already calls it
// the owner of the schema it "exports for both @arete/webhook and
// @arete/dashboard". "Which row is the platform's" is a fact about a row.
//
// Every exported name, signature and log string is unchanged, so `errors.ts`,
// `telemetry-queries.ts` and their tests did not move with it. Import from here
// or from `@arete/db` — they are the same module object. `platform-installation.test.ts`
// (next to this file) remains the fail-closed suite for that implementation:
// zero flagged rows, one, more than one, the env fallback, and a throwing
// database. The webhook asserts the same matrix from its own side in
// `packages/webhook/src/alerting/receiver.test.ts`, which is what makes "one
// truth" checkable rather than merely asserted.

export {
  assertSelfTelemetryTenancyConsistent,
  authorizedPlatformInstallationId,
  isPlatformInstallation,
  resetPlatformInstallationDiagnostics,
  resolvePlatformInstallationId,
} from '@arete/db';

export type {
  PlatformInstallationDb,
  PlatformInstallationLogSink,
  PlatformInstallationOptions,
  SelfTelemetryTenancyCheck,
  SelfTelemetryTenancyStatus,
} from '@arete/db';
