import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('./clickhouse', () => ({
  clickhouse: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
  getIncidentErrorSpans,
  getIncidentLogs,
  getIncidentExceptions,
  getIncidentSignals,
  incidentSignalWindow,
  type SignalWindow,
} from './telemetry-queries';

type QueryCall = { query: string; query_params: Record<string, unknown> };

const WINDOW: SignalWindow = {
  start: new Date('2026-07-22T10:00:00.000Z'),
  end: new Date('2026-07-22T10:30:00.000Z'),
};

function lastCall(): QueryCall {
  return queryMock.mock.calls.at(-1)![0] as QueryCall;
}

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

  it('returns [] without querying when no installations are authorized', async () => {
    expect(await getIncidentErrorSpans([], WINDOW)).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('always binds the tenant filter, never interpolating caller data', async () => {
    const hostile = "x') OR 1=1 --";
    await getIncidentErrorSpans([hostile, 'inst_2'], WINDOW);

    const call = lastCall();
    expect(call.query).toContain(
      "ResourceAttributes['superlog.project_id'] IN ({installationIds: Array(String)})"
    );
    expect(call.query).toContain('StatusCode = ' + "'STATUS_CODE_ERROR'");
    expect(call.query).toContain('fromUnixTimestamp64Milli({startMs: Int64})');
    expect(call.query).not.toContain(hostile);
    expect(call.query_params.installationIds).toEqual([hostile, 'inst_2']);
    expect(call.query_params.startMs).toBe(WINDOW.start.getTime());
    expect(call.query_params.endMs).toBe(WINDOW.end.getTime());
  });

  it('omits the service clause and param when no service is given', async () => {
    await getIncidentErrorSpans(['inst_1'], WINDOW);
    const call = lastCall();
    expect(call.query).not.toContain('ServiceName = {service: String}');
    expect(call.query_params).not.toHaveProperty('service');
  });

  it('adds a bound service clause when a service is given', async () => {
    await getIncidentErrorSpans(['inst_1'], WINDOW, 'arete-worker');
    const call = lastCall();
    expect(call.query).toContain('AND ServiceName = {service: String}');
    expect(call.query_params.service).toBe('arete-worker');
  });

  it('maps rows, converting Duration ns to ms', async () => {
    const rows = await getIncidentErrorSpans(['inst_1'], WINDOW);
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

  it('returns [] without querying when no installations are authorized', async () => {
    expect(await getIncidentLogs([], WINDOW)).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('binds the tenant filter and a default ERROR+ severity floor', async () => {
    await getIncidentLogs(['inst_1'], WINDOW);
    const call = lastCall();
    expect(call.query).toContain(
      "ResourceAttributes['superlog.project_id'] IN ({installationIds: Array(String)})"
    );
    expect(call.query).toContain('SeverityNumber >= {minSeverity: UInt8}');
    expect(call.query_params.minSeverity).toBe(17);
  });

  it('clamps a caller-supplied severity into the UInt8 range', async () => {
    await getIncidentLogs(['inst_1'], WINDOW, undefined, 999);
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

  it('returns [] without querying when no installations are authorized', async () => {
    expect(await getIncidentExceptions([], WINDOW)).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('filters on the projection project_id column and groups by type/message/service', async () => {
    await getIncidentExceptions(['inst_1'], WINDOW);
    const call = lastCall();
    expect(call.query).toContain('project_id IN ({installationIds: Array(String)})');
    expect(call.query).toContain('FROM superlog.otel_exceptions');
    expect(call.query).toContain('GROUP BY exceptionType, exceptionMessage, service');
  });

  it('maps occurrences to a number and lastSeen to a Date', async () => {
    const rows = await getIncidentExceptions(['inst_1'], WINDOW);
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

  it('short-circuits an empty tenant set as available-but-empty (no query)', async () => {
    const signals = await getIncidentSignals([], WINDOW);
    expect(signals).toEqual({ spans: [], logs: [], exceptions: [], unavailable: false });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('runs all three reads for an authorized tenant', async () => {
    await getIncidentSignals(['inst_1'], WINDOW);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('fails soft: a ClickHouse outage yields empty lists + unavailable=true, never throws', async () => {
    queryMock.mockRejectedValue(new Error('clickhouse unreachable'));
    const signals = await getIncidentSignals(['inst_1'], WINDOW);
    expect(signals).toEqual({ spans: [], logs: [], exceptions: [], unavailable: true });
  });

  it('is partially resilient: one failing read does not drop the others', async () => {
    // spans (call 1) rejects; logs + exceptions (calls 2-3) succeed.
    queryMock
      .mockRejectedValueOnce(new Error('spans failed'))
      .mockResolvedValue({ json: async () => [] });
    const signals = await getIncidentSignals(['inst_1'], WINDOW);
    expect(signals.unavailable).toBe(true);
    expect(signals.spans).toEqual([]);
    expect(signals.logs).toEqual([]);
    expect(signals.exceptions).toEqual([]);
  });
});
