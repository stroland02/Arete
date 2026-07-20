import { describe, it, expect, vi } from 'vitest';
import { getStoredContainer } from './stored-container';

const ROW = {
  id: 'cont-1',
  installationId: 'inst-1',
  state: 'verifying',
  gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
  target: { owner: 'acme', repo: 'api' },
  pr: { base: 'main', branch: 'kuma/issue-wi1', title: 'Fix SQL injection', body: 'details' },
  patch: [],
  findings: [],
  transcript: [{ kind: 'dispatch', text: 'Fix author dispatched', at: '2026-07-19T00:00:00.000Z' }],
  createdAt: new Date('2026-07-19T00:00:00.000Z'),
  updatedAt: new Date('2026-07-19T00:01:00.000Z'),
};

function dbWith(row: unknown) {
  return { issueContainer: { findFirst: vi.fn(async () => row as never) } };
}

describe('getStoredContainer', () => {
  it('projects a stored fix container with its REAL transcript and state', async () => {
    const c = await getStoredContainer(dbWith(ROW), ['inst-1'], 'cont-1');
    expect(c?.state).toBe('verifying');
    expect(c?.transcript).toEqual(ROW.transcript);
    expect(c?.pr?.title).toBe('Fix SQL injection');
    expect(c?.serviceId).toBe('acme/api');
    // nothing fabricated: no findings invented from the row
    expect(c?.findings).toEqual([]);
  });

  it('always scopes by installation — an empty scope never queries', async () => {
    const db = dbWith(ROW);
    expect(await getStoredContainer(db, [], 'cont-1')).toBeNull();
    expect(db.issueContainer.findFirst).not.toHaveBeenCalled();
  });

  it('returns null for a miss or a row whose state is not a pipeline state', async () => {
    expect(await getStoredContainer(dbWith(null), ['inst-1'], 'x')).toBeNull();
    // legacy pre-healing-loop rows (state 'open') fall through to other sources
    expect(await getStoredContainer(dbWith({ ...ROW, state: 'open' }), ['inst-1'], 'cont-1')).toBeNull();
  });
});
