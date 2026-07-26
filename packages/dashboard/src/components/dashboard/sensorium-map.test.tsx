import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SensoriumMap } from './sensorium-map';

const topology = {
  nodes: [
    { id: 'n1', kind: 'File', label: 'a.ts', provider: 'code', status: 'unknown', meta: { path: 'src/a.ts' } },
    { id: 'n2', kind: 'File', label: 'b.ts', provider: 'code', status: 'unknown', meta: { path: 'src/b.ts', dead: true } },
  ],
  edges: [{ id: 'n1->n2', from: 'n1', to: 'n2', kind: 'CONTAINS', source: 'code' }],
  groups: [],
} as any;

describe('SensoriumMap', () => {
  it('renders node labels and a pain badge when a node has pain', () => {
    const html = renderToStaticMarkup(
      <SensoriumMap
        topology={topology}
        sensors={{ n1: { pain: { count: 3, maxSeverity: 'error' } }, n2: { dead: true } }}
      />,
    );
    expect(html).toContain('a.ts');
    expect(html).toContain('b.ts');
    expect(html).toContain('>3</span>'); // the pain count badge
  });

  it('renders an honest empty state when the topology has no nodes', () => {
    const html = renderToStaticMarkup(
      <SensoriumMap topology={{ nodes: [], edges: [], groups: [] } as any} sensors={{}} />,
    );
    expect(html).toMatch(/no code map/i);
  });
});
