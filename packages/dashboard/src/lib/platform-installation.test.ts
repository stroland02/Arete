import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  assertSelfTelemetryTenancyConsistent,
  authorizedPlatformInstallationId,
  isPlatformInstallation,
  resetPlatformInstallationDiagnostics,
  resolvePlatformInstallationId,
} from './platform-installation';

const PLATFORM = 'inst-platform';
const CUSTOMER = 'inst-customer';

/** Structural fake of the one delegate this module reads (the lib/ convention
 *  — see installations.ts / incidents.ts — so no Prisma client is needed). */
function fakeDb(opts: { flagged?: string[]; throws?: Error } = {}) {
  const findMany = vi.fn(async (_args: unknown) => {
    if (opts.throws) throw opts.throws;
    return (opts.flagged ?? []).map((id) => ({ id }));
  });
  return { db: { installation: { findMany } } as never, findMany };
}

const originalPlatformEnv = process.env.ARETE_PLATFORM_INSTALLATION_ID;
const originalSelfProjectEnv = process.env.ARETE_SELF_PROJECT_ID;

function restoreEnv(name: string, original: string | undefined) {
  if (original === undefined) delete process.env[name];
  else process.env[name] = original;
}

beforeEach(() => {
  resetPlatformInstallationDiagnostics();
  delete process.env.ARETE_PLATFORM_INSTALLATION_ID;
  delete process.env.ARETE_SELF_PROJECT_ID;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  restoreEnv('ARETE_PLATFORM_INSTALLATION_ID', originalPlatformEnv);
  restoreEnv('ARETE_SELF_PROJECT_ID', originalSelfProjectEnv);
  vi.restoreAllMocks();
});

describe('resolvePlatformInstallationId — the DB flag is the source of truth', () => {
  it('returns the id of the single row flagged isPlatform', async () => {
    const { db, findMany } = fakeDb({ flagged: [PLATFORM] });
    expect(await resolvePlatformInstallationId(db)).toBe(PLATFORM);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isPlatform: true } }),
    );
  });

  it('reads at most two rows — one is the answer, two is proof of ambiguity', async () => {
    const { db, findMany } = fakeDb({ flagged: [PLATFORM] });
    await resolvePlatformInstallationId(db);
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 2 });
  });

  it('returns null and logs an explicit error when TWO rows are flagged, never picking one', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM, 'inst-other'] });
    expect(await resolvePlatformInstallationId(db)).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('AMBIGUOUS platform installation'),
    );
  });

  it('prefers the flag over a disagreeing env var — the env var is a fallback, not an override', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = CUSTOMER;
    const { db } = fakeDb({ flagged: [PLATFORM] });
    expect(await resolvePlatformInstallationId(db)).toBe(PLATFORM);
  });

  it('ignores the env var entirely when the flag is ambiguous — an ambiguous flag fails closed', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM;
    const { db } = fakeDb({ flagged: [PLATFORM, 'inst-other'] });
    expect(await resolvePlatformInstallationId(db)).toBeNull();
  });

  it('fails CLOSED when the database read throws, instead of throwing into the page', async () => {
    const { db } = fakeDb({ throws: new Error('connection refused') });
    expect(await resolvePlatformInstallationId(db)).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('failing closed'));
  });
});

describe('resolvePlatformInstallationId — ARETE_PLATFORM_INSTALLATION_ID transition fallback', () => {
  it('falls back to the env var when no row is flagged yet', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM;
    const { db } = fakeDb({ flagged: [] });
    expect(await resolvePlatformInstallationId(db)).toBe(PLATFORM);
  });

  it('logs a migrate-to-the-flag notice when the fallback is used', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM;
    const { db } = fakeDb({ flagged: [] });
    await resolvePlatformInstallationId(db);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('isPlatform'));
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('ARETE_PLATFORM_INSTALLATION_ID'),
    );
  });

  it('logs that notice ONCE per value, not once per read', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM;
    const { db } = fakeDb({ flagged: [] });
    await resolvePlatformInstallationId(db);
    await resolvePlatformInstallationId(db);
    await resolvePlatformInstallationId(db);
    expect((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('returns null when no row is flagged and the env var is unset or blank', async () => {
    const { db } = fakeDb({ flagged: [] });
    expect(await resolvePlatformInstallationId(db)).toBeNull();
    process.env.ARETE_PLATFORM_INSTALLATION_ID = '   ';
    expect(await resolvePlatformInstallationId(db)).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('isPlatformInstallation — the gate', () => {
  it('is true when the flagged installation is in the caller authorized set', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(true);
    expect(await isPlatformInstallation(db, [CUSTOMER, PLATFORM])).toBe(true);
  });

  it('is false when the flagged installation is NOT in the caller authorized set', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM] });
    expect(await isPlatformInstallation(db, [CUSTOMER])).toBe(false);
  });

  it('is false for an empty caller set, without asking the database', async () => {
    const { db, findMany } = fakeDb({ flagged: [PLATFORM] });
    expect(await isPlatformInstallation(db, [])).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('is true via the env fallback when no row is flagged and the env matches', async () => {
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM;
    const { db } = fakeDb({ flagged: [] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('ARETE_PLATFORM_INSTALLATION_ID'),
    );
  });

  it('is false for EVERYONE when no row is flagged and no env var is set', async () => {
    const { db } = fakeDb({ flagged: [] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(false);
    expect(await isPlatformInstallation(db, [CUSTOMER, PLATFORM])).toBe(false);
  });

  it('is false for everyone when TWO rows are flagged', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM, 'inst-other'] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('AMBIGUOUS platform installation'),
    );
  });
});

describe('authorizedPlatformInstallationId', () => {
  it('yields the platform id only for a caller authorized for it', async () => {
    const { db } = fakeDb({ flagged: [PLATFORM] });
    expect(await authorizedPlatformInstallationId(db, [CUSTOMER, PLATFORM])).toBe(PLATFORM);
    expect(await authorizedPlatformInstallationId(db, [CUSTOMER])).toBeNull();
  });
});

describe('assertSelfTelemetryTenancyConsistent', () => {
  it('agrees when ARETE_SELF_PROJECT_ID equals the platform installation id', () => {
    const result = assertSelfTelemetryTenancyConsistent({
      platformInstallationId: PLATFORM,
      selfProjectId: PLATFORM,
    });
    expect(result.status).toBe('agree');
    expect(result.detail).not.toBe('');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('DISAGREES loudly when they differ — the divergence that leaks Kuma internals', () => {
    const result = assertSelfTelemetryTenancyConsistent({
      platformInstallationId: PLATFORM,
      selfProjectId: CUSTOMER,
    });
    expect(result).toMatchObject({
      status: 'disagree',
      platformInstallationId: PLATFORM,
      selfProjectId: CUSTOMER,
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('SELF-TELEMETRY TENANCY MISMATCH'),
    );
  });

  it('is "unset" — not a failure — when either half is missing or blank', () => {
    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: PLATFORM,
        selfProjectId: undefined,
      }).status,
    ).toBe('unset');
    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: null,
        selfProjectId: PLATFORM,
      }).status,
    ).toBe('unset');
    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: PLATFORM,
        selfProjectId: '   ',
      }).status,
    ).toBe('unset');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('compares trimmed values, so whitespace alone is not a mismatch', () => {
    expect(
      assertSelfTelemetryTenancyConsistent({
        platformInstallationId: ` ${PLATFORM} `,
        selfProjectId: PLATFORM,
      }).status,
    ).toBe('agree');
  });

  it('is called from the resolver path, so a divergent env is detected on a real read', async () => {
    process.env.ARETE_SELF_PROJECT_ID = CUSTOMER;
    const { db } = fakeDb({ flagged: [PLATFORM] });
    await resolvePlatformInstallationId(db);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('SELF-TELEMETRY TENANCY MISMATCH'),
    );
  });

  it('stays quiet on the resolver path when the two agree', async () => {
    process.env.ARETE_SELF_PROJECT_ID = PLATFORM;
    const { db } = fakeDb({ flagged: [PLATFORM] });
    await resolvePlatformInstallationId(db);
    expect(console.error).not.toHaveBeenCalled();
  });
});
