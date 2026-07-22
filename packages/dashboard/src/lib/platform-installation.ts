// WHO IS THE PLATFORM INSTALLATION — the one place that decides it.
//
// THE DEFECT THIS MODULE CLOSES
// -----------------------------
// Kuma's OWN self-telemetry is visible on two dashboard surfaces (the Errors
// surface built from `superlog.otel_traces`/`otel_logs`, and the self-telemetry
// reads filtered by `superlog.project_id`). Which installation may see it used
// to be decided by TWO independent environment variables that nothing
// reconciled:
//
//   * `ARETE_PLATFORM_INSTALLATION_ID` — gated `lib/errors.ts` and picked the
//     tenant for alert-born incidents in
//     `packages/webhook/src/alerting/receiver.ts`.
//   * `ARETE_SELF_PROJECT_ID` — stamped as `superlog.project_id` on Kuma's own
//     spans (`src/instrumentation.ts`, `@arete/telemetry`'s resource.ts,
//     `arete_agents/observability.py`); `lib/telemetry-queries.ts` and
//     `queries.ts:getAgentEventsPerMinute` filter reads by it.
//
// They agree only BY COINCIDENCE: `scripts/dev/dev-all.mjs` copies the former's
// value into the latter in dev. If they ever diverge and either one points at a
// customer installation, that customer sees Kuma's internals. Both env docs say
// "NEVER a customer's" — and `receiver.ts` says outright "There is no 'platform'
// flag on the Installation model to enforce this" — but nothing enforced it.
//
// So the platform installation is now a DATABASE FACT: `Installation.isPlatform`
// (see packages/db/prisma/schema.prisma). One flagged row, resolved here, used
// by every self-observability gate. A string in an env file can be mistyped into
// a customer's id; a flagged row is a deliberate, auditable, single act.
//
// FAIL CLOSED, ALWAYS
// -------------------
// No flagged row and no env fallback => nobody is the platform installation and
// the surface is inert. MORE than one flagged row => a misconfiguration nobody
// should resolve by guessing, so it also yields nobody (plus a loud error).
// Losing access to Kuma's internal error list is recoverable; showing it to a
// customer is not.
//
// TRANSITION (read before deleting the env fallback)
// -------------------------------------------------
// `ARETE_PLATFORM_INSTALLATION_ID` still works, but ONLY while no row carries
// the flag, and it logs once telling the operator to migrate. That keeps
// already-deployed installations (and local dev envs) working across this
// change instead of silently blanking the surface. Once every deployment has a
// flagged row, delete `envFallbackPlatformInstallationId` and the env var.

import type { PrismaClient } from '@arete/db';

/** Prisma delegate slice this module actually uses — structural, so tests
 *  inject a fake and callers pass the real client (the lib/ convention; see
 *  installations.ts and incidents.ts). */
export type PlatformInstallationDb = {
  installation: { findMany(args: unknown): Promise<unknown[]> };
};

/** Whether `ARETE_SELF_PROJECT_ID` and the resolved platform installation name
 *  the same tenant.
 *
 *  - `agree`    — both known and identical. The only safe state.
 *  - `disagree` — both known and DIFFERENT. This is the leak: Kuma's own spans
 *                 are stamped with one tenant's id while the gate authorizes
 *                 another, so Kuma's internals land in someone else's Signals
 *                 panel.
 *  - `unset`    — one or both are unknown, so there is nothing to compare. Not
 *                 an error: self-telemetry stamping is opt-in and off by
 *                 default. */
export type SelfTelemetryTenancyStatus = 'agree' | 'disagree' | 'unset';

export interface SelfTelemetryTenancyCheck {
  status: SelfTelemetryTenancyStatus;
  /** The resolved platform installation id, trimmed; null when unknown. */
  platformInstallationId: string | null;
  /** `ARETE_SELF_PROJECT_ID` as passed, trimmed; null when unset/blank. */
  selfProjectId: string | null;
  /** Why, in one line. Never empty — `agree` explains itself too, so a caller
   *  can log the result verbatim without branching. */
  detail: string;
}

/** Set once we have told the operator to migrate off the env var, so the notice
 *  does not repeat on every page read. Keyed by the value so a changed env var
 *  is announced again. */
let fallbackNoticeLoggedFor: string | null = null;

/** Test-only: clear the "logged once" memo so each test observes the notice
 *  deterministically rather than depending on which test ran first. */
export function resetPlatformInstallationDiagnostics(): void {
  fallbackNoticeLoggedFor = null;
}

function trimmedNonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The `ARETE_PLATFORM_INSTALLATION_ID` fallback, used ONLY when no row carries
 * `isPlatform`. Logs once per distinct value so an operator running an
 * un-migrated deployment finds out, without spamming a line per page read.
 */
function envFallbackPlatformInstallationId(): string | null {
  const configured = trimmedNonEmpty(process.env.ARETE_PLATFORM_INSTALLATION_ID);
  if (configured === null) return null;
  if (fallbackNoticeLoggedFor !== configured) {
    fallbackNoticeLoggedFor = configured;
    console.warn(
      '[platform-installation] no Installation row has isPlatform=true; falling back to ' +
        'ARETE_PLATFORM_INSTALLATION_ID. Migrate this deployment: set isPlatform on the ' +
        'platform-owned Installation row, then drop the env var. The env var cannot be ' +
        'reconciled with ARETE_SELF_PROJECT_ID and is how Kuma internals leak into a tenant.',
    );
  }
  return configured;
}

/**
 * The id of the ONE installation flagged `isPlatform`, or null.
 *
 * Reads at most two rows: one is the answer, two is proof of ambiguity. An
 * ambiguous flag is a misconfiguration — picking one arbitrarily would make the
 * self-observability surface visible to whichever row sorted first, which is
 * exactly the accident this whole module exists to prevent — so it returns null
 * and says so loudly.
 *
 * Falls back to `ARETE_PLATFORM_INSTALLATION_ID` only when NO row is flagged
 * (see the transition note in the header). The fallback value is NOT verified to
 * name a real Installation here: `isPlatformInstallation` only ever compares it
 * against ids the caller is already authorized for, so a stale or mistyped value
 * matches nobody and the gate stays closed.
 *
 * A database failure fails CLOSED (null) rather than throwing into the page —
 * the same posture as errors.ts's soft-failing ClickHouse reads, except that
 * here "degraded" must mean "show nothing", never "show everyone".
 */
export async function resolvePlatformInstallationId(
  db: PlatformInstallationDb | PrismaClient,
): Promise<string | null> {
  let rows: Array<{ id: string }>;
  try {
    rows = (await (db as PlatformInstallationDb).installation.findMany({
      where: { isPlatform: true },
      select: { id: true },
      take: 2,
    })) as Array<{ id: string }>;
  } catch (err) {
    console.error(
      '[platform-installation] failed to resolve the platform installation; failing closed: ' +
        (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }

  if (rows.length > 1) {
    console.error(
      '[platform-installation] AMBIGUOUS platform installation: ' +
        `${rows.length} Installation rows have isPlatform=true (${rows
          .map((r) => r.id)
          .join(', ')}). Exactly one row may carry the flag. Refusing to pick one — ` +
        'self-observability surfaces are disabled until this is corrected.',
    );
    return null;
  }

  const resolved = rows.length === 1 ? trimmedNonEmpty(rows[0]?.id) : null;
  const platformInstallationId = resolved ?? envFallbackPlatformInstallationId();

  // Cheap (pure string comparison) and worth doing on the read path: the
  // divergence it detects is silent by construction, and this is the only code
  // that knows BOTH halves of it at once.
  if (platformInstallationId !== null) {
    assertSelfTelemetryTenancyConsistent({
      platformInstallationId,
      selfProjectId: process.env.ARETE_SELF_PROJECT_ID,
    });
  }

  return platformInstallationId;
}

/**
 * True iff the flagged platform installation is one the caller is authorized
 * for. This is the ONLY gate protecting Kuma's internal telemetry from customer
 * accounts — see lib/errors.ts's module header.
 *
 * No flagged row and no env fallback => false for EVERYONE, including the
 * platform's own operators. That is deliberate and matches the Alertmanager
 * receiver: an unconfigured platform installation makes the feature inert rather
 * than making it leak.
 */
export async function isPlatformInstallation(
  db: PlatformInstallationDb | PrismaClient,
  installationIds: string[],
): Promise<boolean> {
  return (await authorizedPlatformInstallationId(db, installationIds)) !== null;
}

/**
 * The platform installation id, but only when the caller is actually authorized
 * for it. Writes use this as the row's `installationId`, so a row can never be
 * created against an installation the caller lacks.
 *
 * Short-circuits on an empty caller set — nobody is authorized for anything, so
 * there is nothing to ask the database.
 */
export async function authorizedPlatformInstallationId(
  db: PlatformInstallationDb | PrismaClient,
  installationIds: string[],
): Promise<string | null> {
  if (!Array.isArray(installationIds) || installationIds.length === 0) return null;
  const platformId = await resolvePlatformInstallationId(db);
  if (platformId === null) return null;
  return installationIds.includes(platformId) ? platformId : null;
}

/**
 * Do the two halves of self-telemetry tenancy name the same installation?
 *
 * `ARETE_SELF_PROJECT_ID` is stamped as `superlog.project_id` on Kuma's own
 * spans and is what `lib/telemetry-queries.ts` filters self-telemetry reads by;
 * `platformInstallationId` is who the gate authorizes. When they disagree, the
 * spans Kuma emits about ITSELF are attributed to a project id that some OTHER
 * installation's Signals panel reads — the precise divergence that leaks Kuma's
 * internals into a tenant's surface.
 *
 * Pure apart from the warning it logs, so it is safe to call anywhere. It is
 * called from `resolvePlatformInstallationId` (once per gated read), which is
 * the only place that knows both values; it is also suitable for a startup
 * diagnostic if one is ever added — it takes both values as arguments precisely
 * so it does not depend on a server bootstrap existing.
 *
 * The disagree warning is NOT deduplicated: unlike the migrate-off-the-env-var
 * notice, an active divergence is a live data-exposure bug, and a read-scale
 * (page-load-scale, not request-hot) log line is the right volume for it.
 */
export function assertSelfTelemetryTenancyConsistent(input: {
  platformInstallationId: string | null | undefined;
  selfProjectId: string | null | undefined;
}): SelfTelemetryTenancyCheck {
  const platformInstallationId = trimmedNonEmpty(input.platformInstallationId);
  const selfProjectId = trimmedNonEmpty(input.selfProjectId);

  if (platformInstallationId === null || selfProjectId === null) {
    return {
      status: 'unset',
      platformInstallationId,
      selfProjectId,
      detail:
        selfProjectId === null
          ? 'ARETE_SELF_PROJECT_ID is unset — Kuma is not stamping superlog.project_id on its own ' +
            'telemetry, so there is no tenancy to reconcile.'
          : 'No platform installation is resolved, so ARETE_SELF_PROJECT_ID cannot be reconciled ' +
            'against one.',
    };
  }

  if (platformInstallationId === selfProjectId) {
    return {
      status: 'agree',
      platformInstallationId,
      selfProjectId,
      detail: 'ARETE_SELF_PROJECT_ID matches the platform installation.',
    };
  }

  const detail =
    `ARETE_SELF_PROJECT_ID (${selfProjectId}) does NOT match the platform installation ` +
    `(${platformInstallationId}). Kuma's own spans are stamped superlog.project_id=` +
    `${selfProjectId}, so a self-telemetry read scoped to that id serves Kuma's internals to ` +
    'whichever installation owns it. Point both at the same platform-owned installation.';

  console.error(`[platform-installation] SELF-TELEMETRY TENANCY MISMATCH: ${detail}`);

  return { status: 'disagree', platformInstallationId, selfProjectId, detail };
}
