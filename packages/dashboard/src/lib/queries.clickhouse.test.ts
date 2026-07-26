import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
// `jsonEachRow` is mocked with the real implementation's behaviour (await the
// result set's `.json()`), not stubbed out: it is a pure type-narrowing helper
// over a `JSONEachRow` response, so a mock that dropped it would make the
// module under test fail for a reason the production path never has.
vi.mock('./clickhouse', () => ({
  clickhouse: { query: (...args: unknown[]) => queryMock(...args) },
  jsonEachRow: async (result: { json(): Promise<unknown> }) => result.json(),
}));

import { getAgentEventsPerMinute } from './queries';

describe('getAgentEventsPerMinute', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      json: async () => [
        { minute: '2026-07-20 10:01:00', count: '4' },
        { minute: '2026-07-20 10:00:00', count: '2' },
      ],
    });
  });

  it('returns [] without querying when no installations are authorized', async () => {
    expect(await getAgentEventsPerMinute([])).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('binds installation ids via query_params, never string interpolation', async () => {
    const hostile = "x') OR 1=1 --";
    await getAgentEventsPerMinute([hostile, 'inst_2'], 60);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0][0] as {
      query: string;
      query_params: Record<string, unknown>;
    };
    // SQL text carries only bound placeholders — zero caller data.
    expect(call.query).toContain('IN ({installationIds: Array(String)})');
    expect(call.query).toContain('LIMIT {limitMinutes: UInt32}');
    expect(call.query).not.toContain(hostile);
    expect(call.query_params).toEqual({
      installationIds: [hostile, 'inst_2'],
      limitMinutes: 60,
    });
  });

  it('maps rows to chronological AgentEventData', async () => {
    const rows = await getAgentEventsPerMinute(['inst_1']);
    expect(rows).toEqual([
      { minute: new Date('2026-07-20 10:00:00'), count: 2 },
      { minute: new Date('2026-07-20 10:01:00'), count: 4 },
    ]);
  });
});
