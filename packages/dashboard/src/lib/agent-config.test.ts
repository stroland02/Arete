import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireScope, fakeDb } = vi.hoisted(() => {
  const requireScope = vi.fn();
  const fakeDb = {
    agentConfig: { findFirst: vi.fn(), upsert: vi.fn() },
  };
  return { requireScope, fakeDb };
});

vi.mock('@/lib/model-connections-api', () => ({
  requireScope: (...args: unknown[]) => requireScope(...args),
}));
vi.mock('@/lib/db', () => ({ db: fakeDb }));

import {
  AgentConfigSaveError,
  DEFAULT_AGENT_CONFIG,
  getAgentConfig,
  parseAgentConfig,
  saveAgentConfig,
} from '@/lib/agent-config';

beforeEach(() => {
  vi.clearAllMocks();
  requireScope.mockResolvedValue({ installationIds: ['inst-1'] });
  fakeDb.agentConfig.findFirst.mockResolvedValue(null);
  fakeDb.agentConfig.upsert.mockResolvedValue({});
});

const valid = {
  enabled: false,
  severityThreshold: 'error' as const,
  guidance: 'Watch the payments module.',
};

describe('parseAgentConfig', () => {
  it('accepts a well-formed payload and trims the guidance', () => {
    const result = parseAgentConfig({ ...valid, guidance: '  spaced  ' });
    expect(result).toEqual({ config: { ...valid, guidance: 'spaced' } });
  });

  it.each([
    ['a non-object', 'not-an-object', /JSON object/],
    ['a missing enabled', { severityThreshold: 'info', guidance: '' }, /enabled/],
    ['a non-boolean enabled', { ...valid, enabled: 'yes' }, /enabled/],
    ['an unknown severity', { ...valid, severityThreshold: 'critical' }, /severityThreshold/],
    ['a non-string guidance', { ...valid, guidance: 42 }, /guidance/],
  ])('rejects %s', (_label, input, pattern) => {
    const result = parseAgentConfig(input);
    expect('error' in result && result.error).toMatch(pattern as RegExp);
  });

  it('rejects guidance long enough to bloat every prompt for this agent', () => {
    const result = parseAgentConfig({ ...valid, guidance: 'x'.repeat(2001) });
    expect('error' in result && result.error).toMatch(/2000 characters/);
  });

  it('rejects rather than silently repairing, so the UI and the row cannot disagree', () => {
    // The tempting alternative is to coerce 'critical' to 'error' and save it.
    // Then the panel shows one value and the database holds another.
    expect(parseAgentConfig({ ...valid, severityThreshold: 'critical' })).not.toHaveProperty(
      'config',
    );
  });
});

describe('getAgentConfig', () => {
  it('returns the saved row', async () => {
    fakeDb.agentConfig.findFirst.mockResolvedValue({
      enabled: false,
      severityThreshold: 'error',
      guidance: 'Be strict.',
    });
    expect(await getAgentConfig('security')).toEqual({
      enabled: false,
      severityThreshold: 'error',
      guidance: 'Be strict.',
    });
  });

  it('returns defaults when nothing is saved — absence is a real state, not an error', async () => {
    expect(await getAgentConfig('security')).toEqual(DEFAULT_AGENT_CONFIG);
  });

  it('scopes the read to the session installations, never to a caller-supplied id', async () => {
    requireScope.mockResolvedValue({ installationIds: ['inst-a', 'inst-b'] });
    await getAgentConfig('security');
    expect(fakeDb.agentConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { installationId: { in: ['inst-a', 'inst-b'] }, agentId: 'security' },
      }),
    );
  });

  it('returns defaults rather than another tenant config when there is no scope', async () => {
    requireScope.mockResolvedValue(null);
    expect(await getAgentConfig('security')).toEqual(DEFAULT_AGENT_CONFIG);
    expect(fakeDb.agentConfig.findFirst).not.toHaveBeenCalled();
  });

  it('degrades to defaults instead of throwing when the read fails', async () => {
    // A database problem must render the drawer as it behaved before this table
    // existed, not blank the panel.
    fakeDb.agentConfig.findFirst.mockRejectedValue(new Error('db down'));
    expect(await getAgentConfig('security')).toEqual(DEFAULT_AGENT_CONFIG);
  });

  it('falls back on a stored severity it does not recognise', async () => {
    fakeDb.agentConfig.findFirst.mockResolvedValue({
      enabled: true,
      severityThreshold: 'renamed-later',
      guidance: '',
    });
    expect((await getAgentConfig('security')).severityThreshold).toBe('info');
  });
});

describe('saveAgentConfig', () => {
  it('upserts on (installationId, agentId) so two rows cannot disagree', async () => {
    await saveAgentConfig('security', valid);
    expect(fakeDb.agentConfig.upsert).toHaveBeenCalledWith({
      where: { installationId_agentId: { installationId: 'inst-1', agentId: 'security' } },
      create: { installationId: 'inst-1', agentId: 'security', ...valid },
      update: { ...valid },
    });
  });

  it('THROWS when there is no installation — a save that cannot happen must not look like one that did', async () => {
    requireScope.mockResolvedValue({ installationIds: [] });
    await expect(saveAgentConfig('security', valid)).rejects.toBeInstanceOf(AgentConfigSaveError);
    expect(fakeDb.agentConfig.upsert).not.toHaveBeenCalled();
  });

  it('lets a database failure propagate rather than reporting success', async () => {
    // The whole reason Save was disabled before this existed was to avoid a
    // fake save. Swallowing this would reintroduce it one layer down.
    fakeDb.agentConfig.upsert.mockRejectedValue(new Error('db down'));
    await expect(saveAgentConfig('security', valid)).rejects.toThrow('db down');
  });

  it('writes against the first scoped installation only', async () => {
    requireScope.mockResolvedValue({ installationIds: ['inst-a', 'inst-b'] });
    await saveAgentConfig('security', valid);
    expect(fakeDb.agentConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { installationId_agentId: { installationId: 'inst-a', agentId: 'security' } },
      }),
    );
  });
});
