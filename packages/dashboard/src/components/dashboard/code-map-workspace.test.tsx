import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeMapWorkspace } from './code-map-workspace';

const topology = {
  nodes: [
    { id: 'fA', kind: 'File', label: 'a.ts', provider: 'code', meta: { path: 'src/auth/a.ts' } },
    { id: 'fC', kind: 'File', label: 'c.ts', provider: 'code', meta: { path: 'src/billing/c.ts' } },
  ],
  edges: [],
  groups: [],
} as any;

describe('CodeMapWorkspace', () => {
  it('renders search, filter chips, and the map', () => {
    const html = renderToStaticMarkup(
      <CodeMapWorkspace topology={topology} sensors={{}} findings={[]} initialSelection={null} />,
    );
    expect(html).toContain('Search files'); // search box placeholder
    expect(html).toContain('Findings');     // filter chip
    expect(html).toContain('Active');       // filter chip
    expect(html).toContain('a.ts');         // map rendered
  });

  it('opens the drawer for an initial deep-link selection', () => {
    const html = renderToStaticMarkup(
      <CodeMapWorkspace
        topology={topology}
        sensors={{}}
        findings={[{ path: 'src/auth/a.ts', line: 3, severity: 'error', category: 'security', body: 'bad thing' }]}
        initialSelection={{ kind: 'file', id: 'fA' }}
      />,
    );
    expect(html).toContain('src/auth/a.ts'); // drawer subtitle
    expect(html).toContain('bad thing');     // drawer health row
  });

  it('ignores an unknown deep-link id (no crash, no drawer)', () => {
    const html = renderToStaticMarkup(
      <CodeMapWorkspace topology={topology} sensors={{}} findings={[]} initialSelection={{ kind: 'file', id: 'nope' }} />,
    );
    expect(html).not.toContain('No open findings');
  });
});
