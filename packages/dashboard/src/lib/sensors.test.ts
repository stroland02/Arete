import { describe, it, expect } from 'vitest';
import { joinSensors } from './sensors';
import type { Topology } from '@arete/topology';

const topo: Topology = {
  nodes: [
    { id: 'n1', kind: 'File', label: 'a.ts', provider: 'code', status: 'unknown', meta: { path: 'src/a.ts', untested: true, dead: false } },
    { id: 'n2', kind: 'File', label: 'b.ts', provider: 'code', status: 'unknown', meta: { path: 'src/b.ts', untested: false, dead: true } },
  ],
  edges: [],
  groups: [],
};

describe('joinSensors', () => {
  it('attaches pain from findings by path and carries untested/dead', () => {
    const sensors = joinSensors(topo, {
      findings: [
        { path: 'src/a.ts', line: 1, severity: 'error', category: 'security', body: 'x' },
        { path: 'src/a.ts', line: 9, severity: 'warning', category: 'quality', body: 'y' },
      ],
      activity: [],
    });
    expect(sensors.n1.pain).toEqual({ count: 2, maxSeverity: 'error' });
    expect(sensors.n1.untested).toBe(true);
    expect(sensors.n2.dead).toBe(true);
    expect(sensors.n2.pain).toBeUndefined();
  });

  it('takes the highest severity as maxSeverity regardless of order', () => {
    const sensors = joinSensors(topo, {
      findings: [
        { path: 'src/a.ts', line: 1, severity: 'info', category: 'quality', body: 'x' },
        { path: 'src/a.ts', line: 2, severity: 'error', category: 'security', body: 'y' },
        { path: 'src/a.ts', line: 3, severity: 'warning', category: 'quality', body: 'z' },
      ],
      activity: [],
    });
    expect(sensors.n1.pain).toEqual({ count: 3, maxSeverity: 'error' });
  });

  it('attaches activity by path', () => {
    const sensors = joinSensors(topo, {
      findings: [],
      activity: [{ path: 'src/b.ts', agentName: 'SecurityAgent' }],
    });
    expect(sensors.n2.activity).toEqual({ agent: 'SecurityAgent' });
  });

  it('leaves nodes without a path untouched (no throw)', () => {
    const noPath: Topology = {
      nodes: [{ id: 'p1', kind: 'Package', label: 'pkg', provider: 'code', status: 'unknown', meta: {} }],
      edges: [],
      groups: [],
    };
    const sensors = joinSensors(noPath, { findings: [{ path: 'x', line: 1, severity: 'error', category: 'c', body: 'b' }], activity: [] });
    expect(sensors.p1.pain).toBeUndefined();
  });
});
