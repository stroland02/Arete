import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  adoptPendingModelConnections,
  type ModelConnectionAdoptionDb,
} from './model-connection-adoption';

// Adoption invariant: a model connected BEFORE any installation (pending
// user-scoped row) is claimed by the first installation; on a provider
// conflict the installation's EXISTING row wins and the pending row is
// dropped — never the other way around, and never a throw out of login.

function p2002(): Error & { code: string } {
  const err = new Error('Unique constraint failed') as Error & { code: string };
  err.code = 'P2002';
  return err;
}

function fakeDb(pending: Array<{ id: string; provider: string }>) {
  const update = vi.fn().mockResolvedValue({});
  const del = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue(pending);
  const db: ModelConnectionAdoptionDb = {
    modelConnection: { findMany, update, delete: del },
  };
  return { db, findMany, update, del };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('adoptPendingModelConnections', () => {
  it('adopts every pending row into the installation and returns the count', async () => {
    const { db, findMany, update, del } = fakeDb([
      { id: 'mc-1', provider: 'anthropic' },
      { id: 'mc-2', provider: 'ollama' },
    ]);

    const adopted = await adoptPendingModelConnections(db, 'user-1', 'inst-1');

    expect(adopted).toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', installationId: null },
      select: { id: true, provider: true },
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'mc-1' }, data: { installationId: 'inst-1' } });
    expect(update).toHaveBeenCalledWith({ where: { id: 'mc-2' }, data: { installationId: 'inst-1' } });
    expect(del).not.toHaveBeenCalled();
  });

  it('P2002 conflict → pending row deleted, installation row untouched, others still adopt', async () => {
    const { db, update, del } = fakeDb([
      { id: 'mc-conflict', provider: 'anthropic' },
      { id: 'mc-ok', provider: 'ollama' },
    ]);
    update.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'mc-conflict') throw p2002();
      return {};
    });

    const adopted = await adoptPendingModelConnections(db, 'user-1', 'inst-1');

    expect(adopted).toBe(1);
    // The conflicting PENDING row is dropped — the installation's row wins.
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith({ where: { id: 'mc-conflict' } });
  });

  it('is idempotent when nothing is pending', async () => {
    const { db, update, del } = fakeDb([]);

    const adopted = await adoptPendingModelConnections(db, 'user-1', 'inst-1');

    expect(adopted).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('rethrows non-P2002 failures (caller decides; login wraps in its own try)', async () => {
    const { db, update } = fakeDb([{ id: 'mc-1', provider: 'anthropic' }]);
    update.mockRejectedValue(new Error('db down'));

    await expect(adoptPendingModelConnections(db, 'user-1', 'inst-1')).rejects.toThrow('db down');
  });
});
