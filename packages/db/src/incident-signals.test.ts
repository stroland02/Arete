import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
// `jsonEachRow` is mocked with the real implementation's behaviour (await the
// result set's `.json()`), not stubbed out: it is a pure type-narrowing helper
// over a `JSONEachRow` response, so a mock that dropped it would make the
// module under test fail for a reason the production path never has.
vi.mock('./clickhouse', () => ({
  clickhouse: { query: (...args: unknown[]) => queryMock(...args) },
  jsonEachRow: async (result: { json(): Promise<unknown> }) => result.json(),
}));

import {
  getIncidentErrorSpans,
  getIncidentLogs,
  getIncidentExceptions,
  getIncidentSignals,
  incidentSignalWindow,
  type SignalWindow,
} from './incident-signals';
import { resetPlatformInstallationDiagnostics } from './platform-installation';

type QueryCall = { query: string; query_params: Record<string, unknown> };

const WINDOW: SignalWindow = {
  start: new Date('2026-07-22T10:00:00.000Z'),
  end: new Date('2026-07-22T10:30:00.000Z'),
};

const PLATFORM = 'inst-platform';
const CUSTOMER = 'inst-customer';

/**
 * The access decision is a DATABASE fact now (`Installation.isPlatform`, via
 * lib/platform-installation.ts), not the `superlog.project_id` filter — see the
 * telemetry-queries.ts header and the telemetry-tenancy contract §3. So every
 * read takes a Prisma-shaped `db`, and the fake's only job is answering "which
 * installations carry the flag?". Defaults to the correctly-configured
 * deployment (one flagged PLATFORM row) so the SQL tests exercise the SQL.
 */
function fakeDb(platformFlagged: string[] = [PLATFORM]) {
  const installationFindMany = vi
    .fn()
    .mockImplementation(async () => platformFlagged.map((id) => ({ id })));
  return {
    db: { installation: { findMany: installationFindMany } } as never,
    installationFindMany,
  };
}

/** Shorthand for the overwhelmingly common case: the platform caller. */
function platformDb() {
  return fakeDb().db;
}

function lastCall(): QueryCall {
  return queryMock.mock.calls.at(-1)![0] as QueryCall;
}

const originalPlatformEnv = process.env.ARETE_PLATFORM_INSTALLATION_ID;

beforeEach(() => {
  // Deleted so a passing suite can never be an artifact of a leftover env var:
  // these tests must prove the DATABASE flag drives the gate. The env fallback
  // is covered explicitly in platform-installation.test.ts and errors.test.ts.
  delete process.env.ARETE_PLATFORM_INSTALLATION_ID;
  resetPlatformInstallationDiagnostics();
});

afterEach(() => {
  if (originalPlatformEnv === undefined) delete process.env.ARETE_PLATFORM_INSTALLATION_ID;
  else process.env.ARETE_PLATFORM_INSTALLATION_ID = originalPlatformEnv;
  vi.restoreAllMocks();
});

describe('incidentSignalWindow', () => {
  it('brackets a firing incident 15 min before to 15 min after start', () => {
    const w = incidentSignalWindow('2026-07-22T12:00:00.000Z', null);
    expect(w.start).toEqual(new Date('2026-07-22T11:45:00.000Z'));
    expect(w.end).toEqual(new Date('2026-07-22T12:15:00.000Z'));
  });

  it('ends at resolution when resolved', () => {
    const w = incidentSignalWindow('2026-07-22T12:00:00.000Z', '2026-07-22T12:05:00.000Z');
    expect(w.start).toEqual(new Date('2026-07-22T11:45:00.000Z'));
    expect(w.end).toEqual(new Date('2026-07-22T12:05:00.000Z'));
  });

  it('caps the window at 24h for a long-lived incident', () => {
    const w = incidentSignalWindow('2026-07-22T12:00:00.000Z', '2026-08-01T00:00:00.000Z');
    // start is 11:45; cap = start + 24h = next day 11:45.
    expect(w.end).toEqual(new Date('2026-07-23T11:45:00.000Z'));
  });
});

/**
 * THE GATE BITES — the point of the telemetry-tenancy contract (§3).
 *
 * `superlog.project_id` is a self-dogfooding tag, not tenant data, so filtering
 * on it is partitioning and NOT an access control. The access decision is
 * `isPlatformInstallation` and it is taken BEFORE any SQL. Each assertion below
 * therefore checks two things: the honest return value, AND that ClickHouse was
 * never asked — a gate that returns the right value after leaking the query is
 * not a gate.
 */
describe('platform gate (contract §3) — non-platform callers never reach ClickHouse', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ json: async () => [] });
  });

  it('getIncidentSignals denies a non-platform caller and issues ZERO queries', async () => {
    const signals = await getIncidentSignals(platformDb(), [CUSTOMER], WINDOW);

    expect(signals.access).toBe('denied');
    expect(queryMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it('denied is NOT the backend-unavailable state (contract §4)', async () => {
    const signals = await getIncidentSignals(platformDb(), [CUSTOMER], WINDOW);

    // `unavailable` means "the telemetry backend could not be reached". Nothing
    // was reached for, so asserting it here would be a fabricated outage — and
    // the UI would print the wrong sentence.
    expect(signals).toEqual({
      access: 'denied',
      spans: [],
      logs: [],
      exceptions: [],
      unavailable: false,
    });
  });

  it('denies an empty installation set — nobody is authorized for anything', async () => {
    const signals = await getIncidentSignals(platformDb(), [], WINDOW);
    expect(signals.access).toBe('denied');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('denies everyone when NO row carries isPlatform and no env fallback is set', async () => {
    const signals = await getIncidentSignals(fakeDb([]).db, [PLATFORM], WINDOW);
    expect(signals.access).toBe('denied');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('denies everyone when the flag is ambiguous — never picks one arbitrarily', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = await getIncidentSignals(
      fakeDb([PLATFORM, 'inst-second']).db,
      [PLATFORM],
      WINDOW,
    );
    expect(signals.access).toBe('denied');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('gates on the FLAGGED row, not the env var — a stale env var cannot open the surface', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Env names the customer (the exact misconfiguration the contract exists to
    // defuse); the flag names the platform. The flag wins.
    process.env.ARETE_PLATFORM_INSTALLATION_ID = CUSTOMER;

    const signals = await getIncidentSignals(fakeDb([PLATFORM]).db, [CUSTOMER], WINDOW);
    expect(signals.access).toBe('denied');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('the per-signal reads return null (never []) for a non-platform caller, querying nothing', async () => {
    // `[]` would say "you have zero error spans", which is a comforting lie:
    // we never looked. Contract §4, same shape lib/errors.ts returns.
    expect(await getIncidentErrorSpans(platformDb(), [CUSTOMER], WINDOW)).toBeNull();
    expect(await getIncidentLogs(platformDb(), [CUSTOMER], WINDOW)).toBeNull();
    expect(await getIncidentExceptions(platformDb(), [CUSTOMER], WINDOW)).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('resolves the platform installation BEFORE querying, not alongside it', async () => {
    const { db, installationFindMany } = fakeDb();
    await getIncidentSignals(db, [PLATFORM], WINDOW);

    expect(installationFindMany).toHaveBeenCalledTimes(1);
    expect(installationFindMany.mock.invocationCallOrder[0]).toBeLessThan(
      queryMock.mock.invocationCallOrder[0]!,
    );
  });
});

describe('getIncidentErrorSpans', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      json: async () => [
        {
          timestamp: '2026-07-22 10:15:00',
          service: 'arete-worker',
          spanName: 'review.run',
          traceId: 'abc123',
          statusMessage: 'boom',
          durationNs: '2500000',
        },
      ],
    });
  });

  it('returns null without querying when no installations are authorized', async () => {
    expect(await getIncidentErrorSpans(platformDb(), [], WINDOW)).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('always binds the partitioning filter, never interpolating caller data', async () => {
    const hostile = "x') OR 1=1 --";
    await getIncidentErrorSpans(platformDb(), [hostile, PLATFORM], WINDOW);

    const call = lastCall();
    expect(call.query).toContain(
      "ResourceAttributes['superlog.project_id'] IN ({installationIds: Array(String)})"
    );
    expect(call.query).toContain("StatusCode IN ('Error', 'STATUS_CODE_ERROR')");
    expect(call.query).toContain('fromUnixTimestamp64Milli({startMs: Int64})');
    expect(call.query).not.toContain(hostile);
    expect(call.query_params.installationIds).toEqual([hostile, PLATFORM]);
    expect(call.query_params.startMs).toBe(WINDOW.start.getTime());
    expect(call.query_params.endMs).toBe(WINDOW.end.getTime());
  });

  it('omits the service clause and param when no service is given', async () => {
    await getIncidentErrorSpans(platformDb(), [PLATFORM], WINDOW);
    const call = lastCall();
    expect(call.query).not.toContain('ServiceName = {service: String}');
    expect(call.query_params).not.toHaveProperty('service');
  });

  it('adds a bound service clause when a service is given', async () => {
    await getIncidentErrorSpans(platformDb(), [PLATFORM], WINDOW, 'arete-worker');
    const call = lastCall();
    expect(call.query).toContain('AND ServiceName = {service: String}');
    expect(call.query_params.service).toBe('arete-worker');
  });

  it('maps rows, converting Duration ns to ms', async () => {
    const rows = await getIncidentErrorSpans(platformDb(), [PLATFORM], WINDOW);
    expect(rows).toEqual([
      {
        timestamp: new Date('2026-07-22 10:15:00'),
        service: 'arete-worker',
        spanName: 'review.run',
        traceId: 'abc123',
        statusMessage: 'boom',
        durationMs: 2.5,
      },
    ]);
  });
});

describe('getIncidentLogs', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      json: async () => [
        {
          timestamp: '2026-07-22 10:15:00',
          service: 'arete-webhook',
          severity: 'ERROR',
          body: 'request failed',
          traceId: 'abc123',
        },
      ],
    });
  });

  it('returns null without querying when no installations are authorized', async () => {
    expect(await getIncidentLogs(platformDb(), [], WINDOW)).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('binds the partitioning filter and a default ERROR+ severity floor', async () => {
    await getIncidentLogs(platformDb(), [PLATFORM], WINDOW);
    const call = lastCall();
    expect(call.query).toContain(
      "ResourceAttributes['superlog.project_id'] IN ({installationIds: Array(String)})"
    );
    expect(call.query).toContain('SeverityNumber >= {minSeverity: UInt8}');
    expect(call.query_params.minSeverity).toBe(17);
  });

  it('clamps a caller-supplied severity into the UInt8 range', async () => {
    await getIncidentLogs(platformDb(), [PLATFORM], WINDOW, undefined, 999);
    expect(lastCall().query_params.minSeverity).toBe(255);
  });
});

describe('getIncidentExceptions', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      json: async () => [
        {
          exceptionType: 'ValueError',
          exceptionMessage: 'bad input',
          service: 'arete-agents',
          occurrences: '3',
          lastSeen: '2026-07-22 10:20:00',
        },
      ],
    });
  });

  it('returns null without querying when no installations are authorized', async () => {
    expect(await getIncidentExceptions(platformDb(), [], WINDOW)).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('filters on the projection project_id column and groups by type/message/service', async () => {
    await getIncidentExceptions(platformDb(), [PLATFORM], WINDOW);
    const call = lastCall();
    expect(call.query).toContain('project_id IN ({installationIds: Array(String)})');
    expect(call.query).toContain('FROM superlog.otel_exceptions');
    expect(call.query).toContain('GROUP BY exceptionType, exceptionMessage, service');
  });

  it('maps occurrences to a number and lastSeen to a Date', async () => {
    const rows = await getIncidentExceptions(platformDb(), [PLATFORM], WINDOW);
    expect(rows).toEqual([
      {
        exceptionType: 'ValueError',
        exceptionMessage: 'bad input',
        service: 'arete-agents',
        occurrences: 3,
        lastSeen: new Date('2026-07-22 10:20:00'),
      },
    ]);
  });
});

describe('getIncidentSignals', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ json: async () => [] });
  });

  it('runs all three reads for the platform installation, exactly as before', async () => {
    const signals = await getIncidentSignals(platformDb(), [PLATFORM], WINDOW);
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(signals.access).toBe('granted');
    expect(signals.unavailable).toBe(false);
  });

  it('grants access when the flagged platform is one of several caller installations', async () => {
    const signals = await getIncidentSignals(platformDb(), [CUSTOMER, PLATFORM], WINDOW);
    expect(signals.access).toBe('granted');
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('fails soft: a ClickHouse outage yields empty lists + unavailable=true, never throws', async () => {
    queryMock.mockRejectedValue(new Error('clickhouse unreachable'));
    const signals = await getIncidentSignals(platformDb(), [PLATFORM], WINDOW);

    // The backend case keeps its exact old behaviour — and stays DISTINCT from
    // the denial above: access was granted, we asked, the backend did not
    // answer. Two different sentences in the UI, two different states here.
    expect(signals).toEqual({
      access: 'granted',
      spans: [],
      logs: [],
      exceptions: [],
      unavailable: true,
    });
  });

  it('is partially resilient: one failing read does not drop the others', async () => {
    // spans (call 1) rejects; logs + exceptions (calls 2-3) succeed.
    queryMock
      .mockRejectedValueOnce(new Error('spans failed'))
      .mockResolvedValue({ json: async () => [] });
    const signals = await getIncidentSignals(platformDb(), [PLATFORM], WINDOW);
    expect(signals.access).toBe('granted');
    expect(signals.unavailable).toBe(true);
    expect(signals.spans).toEqual([]);
    expect(signals.logs).toEqual([]);
    expect(signals.exceptions).toEqual([]);
  });

  it('takes the gate ONCE per aggregate call, not once per read', async () => {
    const { db, installationFindMany } = fakeDb();
    await getIncidentSignals(db, [PLATFORM], WINDOW);
    expect(installationFindMany).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});
