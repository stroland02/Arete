import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ClickHouse is mocked at the module boundary (the queries.clickhouse.test.ts
// pattern) — these tests must never reach a live ClickHouse.
const queryMock = vi.fn();
vi.mock('./clickhouse', () => ({
  clickhouse: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
  getErrorGroups,
  getIncidentErrorGroups,
  setErrorGroupStatus,
  attachErrorGroupToIncident,
  resolveIncidentWithErrors,
  isPlatformInstallation,
  ERROR_STATUSES,
} from './errors';
import { fingerprintError } from './error-fingerprint';
import { resetPlatformInstallationDiagnostics } from './platform-installation';

const PLATFORM = 'inst-platform';
const CUSTOMER = 'inst-customer';

/** ISO-8601 UTC, exactly the shape the SQL's formatDateTime('%FT%TZ') emits. */
function isoDaysAgo(days: number, hour = 12): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function spanRow(over: Partial<Record<string, string>> = {}) {
  return {
    ts: isoDaysAgo(0),
    traceId: 'trace-a',
    service: 'arete-worker',
    spanName: 'review.run',
    statusMessage: '',
    excType: '',
    excMessage: '',
    ...over,
  };
}

function logRow(over: Partial<Record<string, string>> = {}) {
  return {
    ts: isoDaysAgo(0),
    traceId: 'trace-log',
    service: 'arete-agents',
    body: 'something exploded',
    excType: '',
    ...over,
  };
}

/**
 * The two ClickHouse calls getErrorGroups makes, in order: error spans, then
 * error logs. Answering by call index keeps the fake honest about that.
 */
function mockClickhouse(spans: unknown[], logs: unknown[] = []) {
  queryMock.mockReset();
  queryMock.mockImplementation((arg: { query: string }) => {
    const rows = arg.query.includes('otel_logs') ? logs : spans;
    return Promise.resolve({ json: async () => rows });
  });
}

function fakeDb(opts: {
  errorGroups?: unknown[];
  incidents?: unknown[];
  incident?: unknown;
  upsertResult?: unknown;
  errorUpdateCount?: number;
  incidentUpdateCount?: number;
  /** Installation ids carrying `isPlatform: true`. The tenancy gate is now a
   *  database fact (lib/platform-installation.ts), not an env-var string, so
   *  every fake must be able to answer "who is the platform installation?".
   *  Defaults to the one flagged PLATFORM row — the correctly-configured
   *  deployment — so the tests below exercise the surface, not the setup. */
  platformFlagged?: string[];
} = {}) {
  const errorGroupFindMany = vi.fn().mockResolvedValue(opts.errorGroups ?? []);
  const errorGroupUpsert = vi.fn().mockResolvedValue(opts.upsertResult ?? {});
  const errorGroupUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: opts.errorUpdateCount ?? 0 });
  const incidentFindMany = vi.fn().mockResolvedValue(opts.incidents ?? []);
  const incidentFindFirst = vi.fn().mockResolvedValue(opts.incident ?? null);
  const incidentUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: opts.incidentUpdateCount ?? 0 });
  const installationFindMany = vi
    .fn()
    .mockImplementation(async () =>
      (opts.platformFlagged ?? [PLATFORM]).map((id) => ({ id })),
    );

  const db = {
    errorGroup: {
      findMany: errorGroupFindMany,
      upsert: errorGroupUpsert,
      updateMany: errorGroupUpdateMany,
    },
    incident: {
      findMany: incidentFindMany,
      findFirst: incidentFindFirst,
      updateMany: incidentUpdateMany,
    },
    installation: {
      findMany: installationFindMany,
    },
  };

  return {
    db: db as never,
    errorGroupFindMany,
    errorGroupUpsert,
    errorGroupUpdateMany,
    incidentFindMany,
    incidentFindFirst,
    incidentUpdateMany,
    installationFindMany,
  };
}

const originalPlatformEnv = process.env.ARETE_PLATFORM_INSTALLATION_ID;

beforeEach(() => {
  // The gate reads `Installation.isPlatform` now. The env var is deleted here
  // so these tests prove the DATABASE flag drives the surface — a passing suite
  // can never be an artifact of a leftover env var. Its fallback behaviour is
  // covered explicitly below and in platform-installation.test.ts.
  delete process.env.ARETE_PLATFORM_INSTALLATION_ID;
  resetPlatformInstallationDiagnostics();
  mockClickhouse([]);
});

afterEach(() => {
  if (originalPlatformEnv === undefined) delete process.env.ARETE_PLATFORM_INSTALLATION_ID;
  else process.env.ARETE_PLATFORM_INSTALLATION_ID = originalPlatformEnv;
  vi.restoreAllMocks();
});

describe('isPlatformInstallation', () => {
  it('is true only when the FLAGGED installation is among the caller installations', async () => {
    const { db } = fakeDb({ platformFlagged: [PLATFORM] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(true);
    expect(await isPlatformInstallation(db, [CUSTOMER, PLATFORM])).toBe(true);
    expect(await isPlatformInstallation(db, [CUSTOMER])).toBe(false);
    expect(await isPlatformInstallation(db, [])).toBe(false);
  });

  it('is false for everyone when no row is flagged and no env fallback is set', async () => {
    const { db } = fakeDb({ platformFlagged: [] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(false);
  });

  it('still honours ARETE_PLATFORM_INSTALLATION_ID while no row is flagged (transition)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM;
    const { db } = fakeDb({ platformFlagged: [] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(true);
    expect(await isPlatformInstallation(db, [CUSTOMER])).toBe(false);
  });

  it('is false for everyone when the flag is ambiguous — two flagged rows fail closed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({ platformFlagged: [PLATFORM, 'inst-second'] });
    expect(await isPlatformInstallation(db, [PLATFORM])).toBe(false);
  });
});

describe('tenancy gate on the reads', () => {
  it('getErrorGroups returns null (not []) for a non-platform installation, and queries nothing', async () => {
    const { db, errorGroupFindMany } = fakeDb();
    expect(await getErrorGroups(db, [CUSTOMER])).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
    expect(errorGroupFindMany).not.toHaveBeenCalled();
  });

  it('getIncidentErrorGroups returns null for a non-platform installation', async () => {
    const { db, incidentFindFirst } = fakeDb();
    expect(await getIncidentErrorGroups(db, [CUSTOMER], 'inc-1')).toBeNull();
    expect(incidentFindFirst).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns null for an empty installation list', async () => {
    const { db } = fakeDb();
    expect(await getErrorGroups(db, [])).toBeNull();
    expect(await getIncidentErrorGroups(db, [], 'inc-1')).toBeNull();
  });

  it('returns null when no installation is flagged as the platform at all', async () => {
    const { db } = fakeDb({ platformFlagged: [] });
    expect(await getErrorGroups(db, [PLATFORM])).toBeNull();
    expect(await getIncidentErrorGroups(db, [PLATFORM], 'inc-1')).toBeNull();
  });

  it('returns null when the platform flag is ambiguous — never picks one arbitrarily', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({ platformFlagged: [PLATFORM, 'inst-second'] });
    expect(await getErrorGroups(db, [PLATFORM])).toBeNull();
  });

  it('gates on the FLAGGED row, not on the env var — a stale env var cannot open the surface', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Env still names the customer (the exact misconfiguration this change
    // exists to defuse); the flag names the platform. The flag wins, so the
    // customer caller is still refused.
    process.env.ARETE_PLATFORM_INSTALLATION_ID = CUSTOMER;
    const { db } = fakeDb({ platformFlagged: [PLATFORM] });
    expect(await getErrorGroups(db, [CUSTOMER])).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('getErrorGroups grouping', () => {
  it('collapses repeated occurrences into one group and counts them', async () => {
    mockClickhouse([
      spanRow({ ts: isoDaysAgo(0), statusMessage: 'no fix produced', traceId: 't3' }),
      spanRow({ ts: isoDaysAgo(1), statusMessage: 'no fix produced', traceId: 't2' }),
      spanRow({ ts: isoDaysAgo(2), statusMessage: 'no fix produced', traceId: 't1' }),
    ]);
    const { db } = fakeDb();

    const groups = await getErrorGroups(db, [PLATFORM]);

    expect(groups).toHaveLength(1);
    expect(groups![0]).toMatchObject({
      service: 'arete-worker',
      title: 'review.run',
      message: 'no fix produced',
      eventCount: 3,
      kind: 'exception',
      sampleTraceId: 't3', // the most recent occurrence
    });
    expect(groups![0].firstSeen).toBe(new Date(isoDaysAgo(2)).toISOString());
    expect(groups![0].lastSeen).toBe(new Date(isoDaysAgo(0)).toISOString());
  });

  it('groups across dynamic parts of the message but splits genuinely different errors', async () => {
    mockClickhouse([
      spanRow({
        statusMessage: 'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed after 3 tries',
      }),
      spanRow({
        statusMessage: 'checkout 550e8400-e29b-41d4-a716-446655440000 failed after 91 tries',
      }),
      spanRow({ statusMessage: 'authentication failed' }),
    ]);
    const { db } = fakeDb();

    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups).toHaveLength(2);
    expect(groups!.find((g) => g.eventCount === 2)).toBeTruthy();
    expect(groups!.find((g) => g.message === 'authentication failed')!.eventCount).toBe(1);
  });

  it('keeps messageless spans apart by span name instead of fusing them', async () => {
    mockClickhouse([
      spanRow({ spanName: 'tcp.connect' }),
      spanRow({ spanName: 'tcp.connect' }),
      spanRow({ spanName: 'POST' }),
    ]);
    const { db } = fakeDb();

    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups).toHaveLength(2);
    const tcp = groups!.find((g) => g.title === 'tcp.connect')!;
    expect(tcp.eventCount).toBe(2);
    // No message existed, so none is invented.
    expect(tcp.message).toBe('');
  });

  it('prefers the exception event over StatusMessage, and StatusMessage over nothing', async () => {
    mockClickhouse([
      spanRow({ excType: 'HttpError', excMessage: 'Not Found', statusMessage: 'ignored' }),
      spanRow({ spanName: 'fix.author', statusMessage: 'no fix produced' }),
      spanRow({ spanName: 'tcp.connect' }),
    ]);
    const { db } = fakeDb();

    const groups = await getErrorGroups(db, [PLATFORM]);
    const byTitle = new Map(groups!.map((g) => [g.title, g]));
    expect(byTitle.get('HttpError')!.message).toBe('Not Found');
    expect(byTitle.get('fix.author')!.message).toBe('no fix produced');
    expect(byTitle.get('tcp.connect')!.message).toBe('');
  });

  it('truncates a long message to 500 characters', async () => {
    mockClickhouse([spanRow({ statusMessage: 'x'.repeat(900) })]);
    const { db } = fakeDb();
    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups![0].message).toHaveLength(500);
  });

  it('reads error logs as a separate kind alongside spans', async () => {
    mockClickhouse(
      [spanRow({ statusMessage: 'span boom' })],
      [logRow({ body: 'log boom\nsecond line' })],
    );
    const { db } = fakeDb();

    const groups = await getErrorGroups(db, [PLATFORM]);
    const log = groups!.find((g) => g.kind === 'log')!;
    expect(log).toMatchObject({
      service: 'arete-agents',
      title: 'log boom', // first line of Body, not a synthesized summary
      message: 'log boom\nsecond line',
    });
    expect(groups!.some((g) => g.kind === 'exception')).toBe(true);
  });

  it('returns [] honestly when there are no error events at all', async () => {
    mockClickhouse([], []);
    const { db, errorGroupFindMany } = fakeDb();
    expect(await getErrorGroups(db, [PLATFORM])).toEqual([]);
    expect(errorGroupFindMany).not.toHaveBeenCalled();
  });

  it('fails SOFT when ClickHouse throws, instead of blowing up the page', async () => {
    queryMock.mockReset();
    queryMock.mockRejectedValue(new Error('connection refused'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb();
    expect(await getErrorGroups(db, [PLATFORM])).toEqual([]);
  });

  it('sorts by lastSeen descending', async () => {
    mockClickhouse([
      spanRow({ ts: isoDaysAgo(5), statusMessage: 'older' }),
      spanRow({ ts: isoDaysAgo(1), statusMessage: 'newer' }),
    ]);
    const { db } = fakeDb();
    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups!.map((g) => g.message)).toEqual(['newer', 'older']);
  });
});

describe('getErrorGroups dailyCounts', () => {
  it('buckets per day oldest -> newest with length === days', async () => {
    mockClickhouse([
      spanRow({ ts: isoDaysAgo(0), statusMessage: 'boom' }),
      spanRow({ ts: isoDaysAgo(0), statusMessage: 'boom' }),
      spanRow({ ts: isoDaysAgo(2), statusMessage: 'boom' }),
    ]);
    const { db } = fakeDb();

    const groups = await getErrorGroups(db, [PLATFORM], { days: 5 });
    const counts = groups![0].dailyCounts;
    expect(counts).toHaveLength(5);
    expect(counts[4]).toBe(2); // today, newest bucket last
    expect(counts[2]).toBe(1); // two days ago
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('defaults to a 14-day window', async () => {
    mockClickhouse([spanRow({ statusMessage: 'boom' })]);
    const { db } = fakeDb();
    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups![0].dailyCounts).toHaveLength(14);
    expect(queryMock.mock.calls[0][0].query_params).toMatchObject({ days: 14 });
  });

  it('caps the window at the 30-day ClickHouse TTL', async () => {
    mockClickhouse([spanRow({ statusMessage: 'boom' })]);
    const { db } = fakeDb();
    const groups = await getErrorGroups(db, [PLATFORM], { days: 365 });
    expect(groups![0].dailyCounts).toHaveLength(30);
    expect(queryMock.mock.calls[0][0].query_params).toMatchObject({ days: 30 });
  });
});

describe('getErrorGroups triage join', () => {
  it('defaults status to "open" when no ErrorGroup row exists', async () => {
    mockClickhouse([spanRow({ statusMessage: 'boom' })]);
    const { db } = fakeDb({ errorGroups: [] });

    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups![0]).toMatchObject({ status: 'open', incidentId: null, incidentAlertName: null });
  });

  it('scopes the ErrorGroup lookup to the caller installations', async () => {
    mockClickhouse([spanRow({ statusMessage: 'boom' })]);
    const { db, errorGroupFindMany } = fakeDb();

    await getErrorGroups(db, [PLATFORM]);

    expect(errorGroupFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ installationId: { in: [PLATFORM] } }),
      }),
    );
  });

  it('surfaces the attached incident alert name', async () => {
    mockClickhouse([spanRow({ statusMessage: 'boom' })]);
    const fp = fingerprintError('arete-worker', 'boom');
    const { db, incidentFindMany } = fakeDb({
      errorGroups: [{ fingerprint: fp, status: 'observing', incidentId: 'inc-9' }],
      incidents: [{ id: 'inc-9', alertName: 'HighErrorRate' }],
    });

    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups![0]).toMatchObject({
      status: 'observing',
      incidentId: 'inc-9',
      incidentAlertName: 'HighErrorRate',
    });
    expect(incidentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ installationId: { in: [PLATFORM] } }),
      }),
    );
  });

  it('does not leak an alert name when the linked incident is outside the caller scope', async () => {
    mockClickhouse([spanRow({ statusMessage: 'boom' })]);
    const fp = fingerprintError('arete-worker', 'boom');
    const { db } = fakeDb({
      errorGroups: [{ fingerprint: fp, status: 'open', incidentId: 'inc-foreign' }],
      incidents: [], // scoped query matched nothing
    });

    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups![0].incidentAlertName).toBeNull();
  });

  it('falls back to "open" for an unrecognized status string in the row', async () => {
    mockClickhouse([spanRow({ statusMessage: 'boom' })]);
    const fp = fingerprintError('arete-worker', 'boom');
    const { db } = fakeDb({
      errorGroups: [{ fingerprint: fp, status: 'bogus', incidentId: null }],
    });
    const groups = await getErrorGroups(db, [PLATFORM]);
    expect(groups![0].status).toBe('open');
  });
});

describe('getIncidentErrorGroups', () => {
  const incidentId = 'inc-1';

  function incidentRow(over: Record<string, unknown> = {}) {
    return {
      id: incidentId,
      startsAt: new Date(isoDaysAgo(3)),
      resolvedAt: new Date(isoDaysAgo(2)),
      ...over,
    };
  }

  it('splits attached from correlated, and never double-counts', async () => {
    // attached: 'attached boom'. correlated: 'inside window'. excluded: 'way outside'.
    mockClickhouse([
      spanRow({ ts: isoDaysAgo(3), statusMessage: 'attached boom' }),
      spanRow({ ts: isoDaysAgo(2, 6), statusMessage: 'inside window' }),
      spanRow({ ts: isoDaysAgo(0), statusMessage: 'way outside' }),
    ]);
    const attachedFp = fingerprintError('arete-worker', 'attached boom');
    const { db } = fakeDb({
      incident: incidentRow(),
      errorGroups: [{ fingerprint: attachedFp, status: 'open', incidentId }],
      incidents: [{ id: incidentId, alertName: 'HighErrorRate' }],
    });

    const result = await getIncidentErrorGroups(db, [PLATFORM], incidentId);

    expect(result!.attached.map((g) => g.message)).toEqual(['attached boom']);
    expect(result!.correlated.map((g) => g.message)).toEqual(['inside window']);
    // The attached group is not repeated in correlated even though it also
    // falls inside the window.
    expect(result!.correlated.some((g) => g.fingerprint === attachedFp)).toBe(false);
  });

  it('treats an unresolved incident as still open — the window runs to now', async () => {
    mockClickhouse([spanRow({ ts: isoDaysAgo(0), statusMessage: 'happening now' })]);
    const { db } = fakeDb({ incident: incidentRow({ resolvedAt: null }) });

    const result = await getIncidentErrorGroups(db, [PLATFORM], incidentId);
    expect(result!.correlated.map((g) => g.message)).toEqual(['happening now']);
  });

  it('scopes the incident lookup to the caller installations', async () => {
    const { db, incidentFindFirst } = fakeDb({ incident: incidentRow() });
    await getIncidentErrorGroups(db, [PLATFORM], incidentId);
    expect(incidentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: incidentId, installationId: { in: [PLATFORM] } }),
      }),
    );
  });

  it('returns empty lists for a missing or foreign incident, indistinguishably', async () => {
    const { db } = fakeDb({ incident: null });
    expect(await getIncidentErrorGroups(db, [PLATFORM], 'inc-nope')).toEqual({
      attached: [],
      correlated: [],
    });
  });
});

describe('mutations are tenant-scoped', () => {
  it('setErrorGroupStatus refuses a non-platform caller and writes nothing', async () => {
    const { db, errorGroupUpsert } = fakeDb();
    expect(await setErrorGroupStatus(db, [CUSTOMER], 'fp-1', 'resolved')).toBe(false);
    expect(errorGroupUpsert).not.toHaveBeenCalled();
  });

  it('attachErrorGroupToIncident refuses a non-platform caller and writes nothing', async () => {
    const { db, errorGroupUpsert, incidentFindFirst } = fakeDb();
    expect(await attachErrorGroupToIncident(db, [CUSTOMER], 'fp-1', 'inc-1')).toBe(false);
    expect(errorGroupUpsert).not.toHaveBeenCalled();
    expect(incidentFindFirst).not.toHaveBeenCalled();
  });

  it('resolveIncidentWithErrors refuses a non-platform caller and writes nothing', async () => {
    const { db, incidentUpdateMany, errorGroupUpdateMany } = fakeDb();
    expect(await resolveIncidentWithErrors(db, [CUSTOMER], 'inc-1')).toBe(0);
    expect(incidentUpdateMany).not.toHaveBeenCalled();
    expect(errorGroupUpdateMany).not.toHaveBeenCalled();
  });

  it('pins the created row to the platform installation, never a caller-supplied one', async () => {
    const { db, errorGroupUpsert } = fakeDb();
    expect(await setErrorGroupStatus(db, [CUSTOMER, PLATFORM], 'fp-1', 'silenced')).toBe(true);

    const args = errorGroupUpsert.mock.calls[0][0] as {
      where: { installationId_fingerprint: { installationId: string; fingerprint: string } };
      create: Record<string, unknown>;
    };
    expect(args.where.installationId_fingerprint).toEqual({
      installationId: PLATFORM,
      fingerprint: 'fp-1',
    });
    expect(args.create).toMatchObject({ installationId: PLATFORM, status: 'silenced' });
  });
});

describe('setErrorGroupStatus', () => {
  it('accepts every declared status', async () => {
    for (const status of ERROR_STATUSES) {
      const { db } = fakeDb();
      expect(await setErrorGroupStatus(db, [PLATFORM], 'fp-1', status)).toBe(true);
    }
  });

  it('rejects a status outside the union without writing', async () => {
    const { db, errorGroupUpsert } = fakeDb();
    expect(await setErrorGroupStatus(db, [PLATFORM], 'fp-1', 'deleted' as never)).toBe(false);
    expect(errorGroupUpsert).not.toHaveBeenCalled();
  });

  it('stamps resolvedAt only for resolved and silencedAt only for silenced', async () => {
    const resolved = fakeDb();
    await setErrorGroupStatus(resolved.db, [PLATFORM], 'fp-1', 'resolved');
    const rUpdate = resolved.errorGroupUpsert.mock.calls[0][0].update;
    expect(rUpdate.resolvedAt).toBeInstanceOf(Date);
    expect(rUpdate.silencedAt).toBeNull();

    const reopened = fakeDb();
    await setErrorGroupStatus(reopened.db, [PLATFORM], 'fp-1', 'open');
    const oUpdate = reopened.errorGroupUpsert.mock.calls[0][0].update;
    expect(oUpdate.resolvedAt).toBeNull();
    expect(oUpdate.silencedAt).toBeNull();

    const silenced = fakeDb();
    await setErrorGroupStatus(silenced.db, [PLATFORM], 'fp-1', 'silenced');
    const sUpdate = silenced.errorGroupUpsert.mock.calls[0][0].update;
    expect(sUpdate.silencedAt).toBeInstanceOf(Date);
    expect(sUpdate.resolvedAt).toBeNull();
  });
});

describe('attachErrorGroupToIncident', () => {
  it('attaches when the incident belongs to the caller', async () => {
    const { db, errorGroupUpsert } = fakeDb({ incident: { id: 'inc-1' } });
    expect(await attachErrorGroupToIncident(db, [PLATFORM], 'fp-1', 'inc-1')).toBe(true);
    const update = errorGroupUpsert.mock.calls[0][0].update;
    expect(update.incidentId).toBe('inc-1');
    expect(update.attachedAt).toBeInstanceOf(Date);
  });

  it('refuses to attach to a foreign or missing incident, and writes nothing', async () => {
    const { db, errorGroupUpsert, incidentFindFirst } = fakeDb({ incident: null });
    expect(await attachErrorGroupToIncident(db, [PLATFORM], 'fp-1', 'inc-foreign')).toBe(false);
    expect(incidentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ installationId: { in: [PLATFORM] } }),
      }),
    );
    expect(errorGroupUpsert).not.toHaveBeenCalled();
  });

  it('detaches without needing an incident lookup', async () => {
    const { db, errorGroupUpsert, incidentFindFirst } = fakeDb();
    expect(await attachErrorGroupToIncident(db, [PLATFORM], 'fp-1', null)).toBe(true);
    expect(incidentFindFirst).not.toHaveBeenCalled();
    const update = errorGroupUpsert.mock.calls[0][0].update;
    expect(update.incidentId).toBeNull();
    expect(update.attachedAt).toBeNull();
  });
});

describe('resolveIncidentWithErrors', () => {
  it('flips the incident AND every error attached to it, returning the error count', async () => {
    const { db, incidentUpdateMany, errorGroupUpdateMany } = fakeDb({
      incidentUpdateCount: 1,
      errorUpdateCount: 4,
    });

    expect(await resolveIncidentWithErrors(db, [PLATFORM], 'inc-1')).toBe(4);

    expect(incidentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'inc-1', installationId: { in: [PLATFORM] } },
      data: expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
    });
    expect(errorGroupUpdateMany).toHaveBeenCalledWith({
      where: { incidentId: 'inc-1', installationId: { in: [PLATFORM] } },
      data: expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
    });
  });

  it('is a silent no-op when the incident id matches nothing in scope', async () => {
    const { db, errorGroupUpdateMany } = fakeDb({ incidentUpdateCount: 0, errorUpdateCount: 9 });
    expect(await resolveIncidentWithErrors(db, [PLATFORM], 'inc-foreign')).toBe(0);
    // Crucially, the error sweep never runs — a foreign id cannot resolve
    // errors it does not own.
    expect(errorGroupUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 0 for an incident with nothing attached', async () => {
    const { db } = fakeDb({ incidentUpdateCount: 1, errorUpdateCount: 0 });
    expect(await resolveIncidentWithErrors(db, [PLATFORM], 'inc-1')).toBe(0);
  });
});
