// Direct unit coverage of the fail-closed resolver that decides WHICH
// installation may see Kuma's own internal telemetry.
//
// WHY THIS EXISTS ALONGSIDE THE TWO CONSUMER SUITES
// ------------------------------------------------
// `packages/dashboard/src/lib/platform-installation.test.ts` and
// `packages/webhook/src/alerting/receiver.test.ts` already exercise this module
// — but from the OUTSIDE, through a re-export and through alert attribution
// respectively. That pairing is the "one truth, two consequences" check of the
// telemetry-tenancy contract (docs/superpowers/specs/
// 2026-07-22-telemetry-tenancy-contract.md §2) and it stays exactly as it is.
// What it does NOT give is a safety net for a change made INSIDE `@arete/db`:
// until this file, editing the resolver and running `@arete/db`'s own checks
// proved nothing, because the package had no test runner at all. These tests
// therefore assert the same matrix against the shared implementation directly,
// so a regression is caught in the package that owns the rule rather than only
// downstream of it.
//
// Two deliberate differences from the consumer suites:
//   * the fake database is injected through `PlatformInstallationDb` — the
//     structural delegate slice the module already types its argument as — so
//     no Prisma client, no database, and no generated-client import is needed;
//   * diagnostics are captured through `PlatformInstallationLogSink`, the
//     module's own injection point, instead of spying on a global `console`.
//     `@arete/db` compiles without `@types/node` (see the module header), so
//     there is no typed global `console` here to spy on anyway — and asserting
//     through the sink is what the webhook consumer does in production.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertSelfTelemetryTenancyConsistent,
  authorizedPlatformInstallationId,
  isPlatformInstallation,
  resetPlatformInstallationDiagnostics,
  resolvePlatformInstallationId,
  type PlatformInstallationDb,
  type PlatformInstallationLogSink,
} from './platform-installation'

// Same reason the module under test declares these: this package has no
// `@types/node` and adding one to the package both services build from is a
// worse trade than declaring the one global these tests touch. Module-scoped,
// so it shadows nothing.
declare const process: { env: Record<string, string | undefined> }

const PLATFORM = 'inst-platform'
const OTHER_PLATFORM = 'inst-platform-duplicate'
const CUSTOMER = 'inst-customer'

/** The delegate slice the resolver actually reads. Typed as
 *  `PlatformInstallationDb` rather than cast, so a change to the query shape
 *  breaks this file loudly instead of silently passing an `any`. */
function fakeDb(opts: { flagged?: string[]; throws?: Error } = {}) {
  const findMany = vi.fn(async (_args: unknown): Promise<unknown[]> => {
    if (opts.throws) throw opts.throws
    return (opts.flagged ?? []).map((id) => ({ id }))
  })
  const db: PlatformInstallationDb = { installation: { findMany } }
  return { db, findMany }
}

/** Captures diagnostics through the module's injection point. Also proves, by
 *  construction, that nothing leaks to a global console: every assertion below
 *  reads these arrays. */
function recordingSink() {
  const warnings: string[] = []
  const errors: string[] = []
  const log: PlatformInstallationLogSink = {
    warn: (message) => void warnings.push(message),
    error: (message) => void errors.push(message),
  }
  return { log, warnings, errors }
}

const originalPlatformEnv = process.env.ARETE_PLATFORM_INSTALLATION_ID
const originalSelfProjectEnv = process.env.ARETE_SELF_PROJECT_ID

function restoreEnv(name: string, original: string | undefined) {
  if (original === undefined) delete process.env[name]
  else process.env[name] = original
}

beforeEach(() => {
  // The fallback notice is memoised at module scope so it does not repeat per
  // page read; without this, whichever test ran first would swallow it for
  // every later test. The module exports this reset for exactly that.
  resetPlatformInstallationDiagnostics()
  delete process.env.ARETE_PLATFORM_INSTALLATION_ID
  delete process.env.ARETE_SELF_PROJECT_ID
})

afterEach(() => {
  restoreEnv('ARETE_PLATFORM_INSTALLATION_ID', originalPlatformEnv)
  restoreEnv('ARETE_SELF_PROJECT_ID', originalSelfProjectEnv)
})

describe('resolvePlatformInstallationId — the isPlatform flag is the source of truth', () => {
  it('resolves the id of the single flagged row', async () => {
    const { db, findMany } = fakeDb({ flagged: [PLATFORM] })
    const { log, warnings, errors } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBe(PLATFORM)
    expect(warnings).toEqual([])
    expect(errors).toEqual([])
    expect(findMany).toHaveBeenCalledWith({
      where: { isPlatform: true },
      select: { id: true },
      // One row is the answer, two is proof of ambiguity — the query never
      // needs a third, and widening it would invite an arbitrary pick.
      take: 2,
    })
  })

  it('prefers the flagged row over a disagreeing env var — the env var is a fallback, not an override', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = CUSTOMER
    const { db } = fakeDb({ flagged: [PLATFORM] })
    const { log, warnings } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBe(PLATFORM)
    // No migrate notice either: this deployment has already migrated.
    expect(warnings).toEqual([])
  })

  it('returns null and logs loudly when MORE than one row is flagged, never picking one', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM, OTHER_PLATFORM] })
    const { log, errors } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('AMBIGUOUS platform installation')
    // The operator cannot fix what the log does not name.
    expect(errors[0]).toContain(PLATFORM)
    expect(errors[0]).toContain(OTHER_PLATFORM)
  })

  it('ignores the env var when the flag is ambiguous — ambiguity is not something an env var resolves', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM
    const { db } = fakeDb({ flagged: [PLATFORM, OTHER_PLATFORM] })
    const { log, warnings } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBeNull()
    expect(warnings).toEqual([])
  })

  it('fails CLOSED when the resolving query throws — null, never a throw into the caller', async () => {
    const { db } = fakeDb({ throws: new Error('connection refused') })
    const { log, errors } = recordingSink()

    await expect(resolvePlatformInstallationId(db, { log })).resolves.toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('failing closed')
    expect(errors[0]).toContain('connection refused')
  })

  it('fails closed on a non-Error rejection too', async () => {
    const findMany = vi.fn(async (_args: unknown): Promise<unknown[]> => {
      throw 'pool exhausted'
    })
    const db: PlatformInstallationDb = { installation: { findMany } }
    const { log, errors } = recordingSink()

    await expect(resolvePlatformInstallationId(db, { log })).resolves.toBeNull()
    expect(errors[0]).toContain('pool exhausted')
  })
})

describe('resolvePlatformInstallationId — ARETE_PLATFORM_INSTALLATION_ID transition fallback', () => {
  it('resolves via the env var when zero rows are flagged, and logs the migrate-to-the-flag notice', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM
    const { db } = fakeDb({ flagged: [] })
    const { log, warnings, errors } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBe(PLATFORM)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no Installation row has isPlatform=true')
    expect(warnings[0]).toContain('ARETE_PLATFORM_INSTALLATION_ID')
    // An un-migrated deployment still WORKS — the notice is not an error.
    expect(errors).toEqual([])
  })

  it('logs that notice once per distinct value, not once per read', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM
    const { db } = fakeDb({ flagged: [] })
    const { log, warnings } = recordingSink()

    await resolvePlatformInstallationId(db, { log })
    await resolvePlatformInstallationId(db, { log })
    await resolvePlatformInstallationId(db, { log })
    expect(warnings).toHaveLength(1)

    // A CHANGED env var is a new fact and is announced again.
    process.env.ARETE_PLATFORM_INSTALLATION_ID = CUSTOMER
    await resolvePlatformInstallationId(db, { log })
    expect(warnings).toHaveLength(2)
  })

  it('returns null when zero rows are flagged and no env var is set', async () => {
    const { db } = fakeDb({ flagged: [] })
    const { log, warnings, errors } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBeNull()
    // Nobody is the platform installation, and that is a quiet, valid state.
    expect(warnings).toEqual([])
    expect(errors).toEqual([])
  })

  it('treats a blank env var as unset rather than as an id', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = '   '
    const { db } = fakeDb({ flagged: [] })
    const { log, warnings } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBeNull()
    expect(warnings).toEqual([])
  })
})

describe('isPlatformInstallation — the gate', () => {
  it('is true only when the flagged id is in the caller authorized set', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM] })
    const { log } = recordingSink()

    expect(await isPlatformInstallation(db, [PLATFORM], { log })).toBe(true)
    expect(await isPlatformInstallation(db, [CUSTOMER, PLATFORM], { log })).toBe(true)
    expect(await isPlatformInstallation(db, [CUSTOMER], { log })).toBe(false)
  })

  it('is false for an empty caller set without asking the database', async () => {
    const { db, findMany } = fakeDb({ flagged: [PLATFORM] })
    const { log } = recordingSink()

    expect(await isPlatformInstallation(db, [], { log })).toBe(false)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('is false for EVERYONE when nothing resolves — including the platform own operators', async () => {
    const { db } = fakeDb({ flagged: [] })
    const { log } = recordingSink()

    expect(await isPlatformInstallation(db, [PLATFORM], { log })).toBe(false)
    expect(await isPlatformInstallation(db, [CUSTOMER, PLATFORM], { log })).toBe(false)
  })

  it('is false for everyone when the flag is ambiguous', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM, OTHER_PLATFORM] })
    const { log, errors } = recordingSink()

    expect(await isPlatformInstallation(db, [PLATFORM], { log })).toBe(false)
    expect(errors[0]).toContain('AMBIGUOUS platform installation')
  })

  it('is false for everyone when the resolving query throws', async () => {
    const { db } = fakeDb({ throws: new Error('connection refused') })
    const { log } = recordingSink()

    expect(await isPlatformInstallation(db, [PLATFORM], { log })).toBe(false)
  })

  it('is true through the env fallback when the caller holds the configured id', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM
    const { db } = fakeDb({ flagged: [] })
    const { log } = recordingSink()

    expect(await isPlatformInstallation(db, [PLATFORM], { log })).toBe(true)
    // …and a stale or mistyped fallback value simply matches nobody: the
    // fallback is never verified against a real row, so the gate stays shut.
    expect(await isPlatformInstallation(db, [CUSTOMER], { log })).toBe(false)
  })
})

describe('authorizedPlatformInstallationId — the id writes are filed under', () => {
  it('yields the platform id only to a caller authorized for it', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM] })
    const { log } = recordingSink()

    expect(await authorizedPlatformInstallationId(db, [CUSTOMER, PLATFORM], { log })).toBe(PLATFORM)
    expect(await authorizedPlatformInstallationId(db, [CUSTOMER], { log })).toBeNull()
    expect(await authorizedPlatformInstallationId(db, [], { log })).toBeNull()
  })
})

describe('assertSelfTelemetryTenancyConsistent', () => {
  it('agrees when ARETE_SELF_PROJECT_ID names the platform installation', () => {
    const { log, errors } = recordingSink()
    const result = assertSelfTelemetryTenancyConsistent({
      platformInstallationId: PLATFORM,
      selfProjectId: PLATFORM,
      log,
    })

    expect(result.status).toBe('agree')
    // `detail` is never empty, so a caller can log the result verbatim.
    expect(result.detail).not.toBe('')
    expect(errors).toEqual([])
  })

  it('compares trimmed values, so whitespace alone is not a mismatch', () => {
    const { log, errors } = recordingSink()

    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: ` ${PLATFORM} `,
        selfProjectId: PLATFORM,
        log,
      }).status,
    ).toBe('agree')
    expect(errors).toEqual([])
  })

  it('DISAGREES loudly when the two name different tenants — the leak this contract exists to stop', () => {
    const { log, errors } = recordingSink()
    const result = assertSelfTelemetryTenancyConsistent({
      platformInstallationId: PLATFORM,
      selfProjectId: CUSTOMER,
      log,
    })

    expect(result).toMatchObject({
      status: 'disagree',
      platformInstallationId: PLATFORM,
      selfProjectId: CUSTOMER,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('SELF-TELEMETRY TENANCY MISMATCH')
    expect(errors[0]).toContain(result.detail)
  })

  it('does NOT deduplicate the disagree warning — an active divergence is live, not historical', () => {
    const { log, errors } = recordingSink()
    const input = { platformInstallationId: PLATFORM, selfProjectId: CUSTOMER, log }

    assertSelfTelemetryTenancyConsistent(input)
    assertSelfTelemetryTenancyConsistent(input)
    expect(errors).toHaveLength(2)
  })

  it('is "unset" — not a failure — when either half is missing or blank', () => {
    const { log, errors } = recordingSink()

    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: PLATFORM,
        selfProjectId: undefined,
        log,
      }).status,
    ).toBe('unset')
    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: null,
        selfProjectId: PLATFORM,
        log,
      }).status,
    ).toBe('unset')
    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: PLATFORM,
        selfProjectId: '   ',
        log,
      }).status,
    ).toBe('unset')
    expect(errors).toEqual([])
  })

  it('explains WHICH half is unset, so the detail is actionable on its own', () => {
    const { log } = recordingSink()

    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: PLATFORM,
        selfProjectId: null,
        log,
      }).detail,
    ).toContain('ARETE_SELF_PROJECT_ID is unset')
    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: null,
        selfProjectId: PLATFORM,
        log,
      }).detail,
    ).toContain('No platform installation is resolved')
  })

  it('runs on the resolver path, so a divergent env is caught on a real read', async () => {
    process.env.ARETE_SELF_PROJECT_ID = CUSTOMER
    const { db } = fakeDb({ flagged: [PLATFORM] })
    const { log, errors } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBe(PLATFORM)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('SELF-TELEMETRY TENANCY MISMATCH')
  })

  it('stays quiet on the resolver path when the two agree', async () => {
    process.env.ARETE_SELF_PROJECT_ID = PLATFORM
    const { db } = fakeDb({ flagged: [PLATFORM] })
    const { log, errors } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBe(PLATFORM)
    expect(errors).toEqual([])
  })

  it('is not reached when nothing resolves — there is no tenancy to reconcile', async () => {
    process.env.ARETE_SELF_PROJECT_ID = CUSTOMER
    const { db } = fakeDb({ flagged: [] })
    const { log, errors } = recordingSink()

    expect(await resolvePlatformInstallationId(db, { log })).toBeNull()
    expect(errors).toEqual([])
  })
})
