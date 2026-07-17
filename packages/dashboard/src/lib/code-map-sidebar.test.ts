import { describe, it, expect } from 'vitest';
import type { Topology } from '@arete/topology';
import { buildSidebarModel } from './code-map-sidebar';
import type { FindingLike, NodeSensors } from './sensors';

const t: Topology = {
  nodes: [
    { id: 'fA', kind: 'File', label: 'a.ts', provider: 'code', meta: { path: 'src/auth/a.ts' } },
    { id: 'fB', kind: 'File', label: 'b.ts', provider: 'code', meta: { path: 'src/auth/b.ts' } },
    { id: 'fC', kind: 'File', label: 'c.ts', provider: 'code', meta: { path: 'src/billing/c.ts' } },
    { id: 'fnA', kind: 'Function', label: 'doA', provider: 'code', meta: { path: 'src/auth/a.ts' } },
  ],
  edges: [
    { id: 'e0', from: 'fA', to: 'fnA', kind: 'CONTAINS', source: 'code' },
    { id: 'e1', from: 'fA', to: 'fC', kind: 'CALLS', source: 'code' },
    { id: 'e2', from: 'fB', to: 'fA', kind: 'CALLS', source: 'code' },
  ],
  groups: [],
};

const findings: FindingLike[] = [
  { path: 'src/auth/a.ts', line: 10, severity: 'warning', category: 'security', body: 'token in localStorage' },
  { path: 'src/auth/a.ts', line: 22, severity: 'error', category: 'security', body: 'missing auth check' },
  { path: 'src/billing/c.ts', line: 5, severity: 'info', category: 'quality', body: 'naming nit' },
];

const sensors: Record<string, NodeSensors> = {
  fA: { pain: { count: 2, maxSeverity: 'error' }, activity: { agent: 'Security Agent' } },
  fC: { pain: { count: 1, maxSeverity: 'info' } },
};

describe('buildSidebarModel — file selection', () => {
  const m = buildSidebarModel(t, sensors, findings, { kind: 'file', id: 'fA' })!;

  it('titles with the file label and path subtitle', () => {
    expect(m.title).toBe('a.ts');
    expect(m.subtitle).toBe('src/auth/a.ts');
    expect(m.kind).toBe('file');
  });
  it('health: only this file\'s findings, max severity computed', () => {
    expect(m.health.count).toBe(2);
    expect(m.health.maxSeverity).toBe('error');
    expect(m.health.rows.map((r) => r.line)).toEqual([10, 22]);
  });
  it('contents: the file\'s folded-in child nodes', () => {
    expect(m.contents).toEqual([{ id: 'fnA', label: 'doA', kind: 'Function', findingCount: 0 }]);
  });
  it('dependencies: both directions with labels', () => {
    expect(m.dependencies.imports).toEqual([{ id: 'fC', label: 'c.ts', path: 'src/billing/c.ts' }]);
    expect(m.dependencies.importedBy).toEqual([{ id: 'fB', label: 'b.ts', path: 'src/auth/b.ts' }]);
  });
  it('activity: the agent name', () => {
    expect(m.activity).toEqual(['Security Agent']);
  });
});

describe('buildSidebarModel — folder selection', () => {
  const m = buildSidebarModel(t, sensors, findings, { kind: 'folder', id: 'src/auth' })!;

  it('titles with the folder and file-count subtitle', () => {
    expect(m.title).toBe('src/auth');
    expect(m.subtitle).toBe('2 files');
  });
  it('health rolls up member-file findings', () => {
    expect(m.health.count).toBe(2);
    expect(m.health.maxSeverity).toBe('error');
  });
  it('contents lists member files with per-file finding counts', () => {
    expect(m.contents).toEqual([
      { id: 'fA', label: 'a.ts', kind: 'File', findingCount: 2, maxSeverity: 'error' },
      { id: 'fB', label: 'b.ts', kind: 'File', findingCount: 0 },
    ]);
  });
  it('dependencies only cross the folder boundary (internal edges excluded)', () => {
    expect(m.dependencies.imports).toEqual([{ id: 'fC', label: 'c.ts', path: 'src/billing/c.ts' }]);
    expect(m.dependencies.importedBy).toEqual([]);
  });
  it('activity dedupes member agents', () => {
    expect(m.activity).toEqual(['Security Agent']);
  });
});

describe('buildSidebarModel — honest empties and misses', () => {
  it('returns null for an unknown file id', () => {
    expect(buildSidebarModel(t, sensors, findings, { kind: 'file', id: 'nope' })).toBeNull();
  });
  it('returns null for an unknown folder', () => {
    expect(buildSidebarModel(t, sensors, findings, { kind: 'folder', id: 'src/none' })).toBeNull();
  });
  it('a file with no data gets empty sections, never fake ones', () => {
    const m = buildSidebarModel(t, {}, [], { kind: 'file', id: 'fB' })!;
    expect(m.health).toEqual({ count: 0, rows: [] });
    expect(m.contents).toEqual([]);
    expect(m.activity).toEqual([]);
  });
  it('a File node with no path gets empty contents (never other pathless nodes)', () => {
    const t2: Topology = {
      nodes: [
        { id: 'fX', kind: 'File', label: 'x.ts', provider: 'code' },
        { id: 'stray', kind: 'Function', label: 'strayFn', provider: 'code' },
      ],
      edges: [],
      groups: [],
    };
    const m = buildSidebarModel(t2, {}, [], { kind: 'file', id: 'fX' })!;
    expect(m.contents).toEqual([]);
  });
});
