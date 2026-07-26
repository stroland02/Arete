import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeMap } from './code-map';

const topology = {
  nodes: [
    { id: 'fA', kind: 'File', label: 'a.ts', provider: 'code', meta: { path: 'src/auth/a.ts' } },
    { id: 'fB', kind: 'File', label: 'b.ts', provider: 'code', meta: { path: 'src/auth/b.ts' } },
    { id: 'fC', kind: 'File', label: 'c.ts', provider: 'code', meta: { path: 'src/billing/c.ts' } },
  ],
  edges: [{ id: 'e1', from: 'fA', to: 'fC', kind: 'CALLS', source: 'code' }],
  groups: [],
} as any;

describe('CodeMap', () => {
  it('renders folder region headers and file chips', () => {
    const html = renderToStaticMarkup(<CodeMap topology={topology} sensors={{}} />);
    expect(html).toContain('src/auth');
    expect(html).toContain('src/billing');
    expect(html).toContain('a.ts');
    expect(html).toContain('c.ts');
  });

  it('renders the pain count in a bare span (legacy badge contract)', () => {
    const html = renderToStaticMarkup(
      <CodeMap topology={topology} sensors={{ fA: { pain: { count: 3, maxSeverity: 'error' } } }} />,
    );
    expect(html).toContain('>3</span>');
  });

  it('links chips via hrefFor (router-free navigation)', () => {
    const html = renderToStaticMarkup(
      <CodeMap
        topology={topology}
        sensors={{}}
        hrefFor={(sel) => (sel.kind === 'file' ? `/map?node=${sel.id}` : `/map?folder=${sel.id}`)}
      />,
    );
    expect(html).toContain('href="/map?node=fA"');
    expect(html).toContain('href="/map?folder=src/auth"');
  });

  it('dims nodes filtered out by the findings filter', () => {
    const html = renderToStaticMarkup(
      <CodeMap
        topology={topology}
        sensors={{ fA: { pain: { count: 1, maxSeverity: 'info' } } }}
        filter="findings"
      />,
    );
    expect(html).toContain('data-dimmed="true"'); // fB/fC dimmed
    expect(html).toContain('data-dimmed="false"'); // fA visible
  });

  it('dims non-matching nodes for a search query', () => {
    const html = renderToStaticMarkup(
      <CodeMap topology={topology} sensors={{}} search="billing" />,
    );
    expect(html).toContain('data-dimmed="true"');
  });

  it('marks the selected chip', () => {
    const html = renderToStaticMarkup(
      <CodeMap topology={topology} sensors={{}} selected={{ kind: 'file', id: 'fA' }} />,
    );
    expect(html).toContain('data-selected="true"');
  });

  it('renders the honest empty state for an empty topology', () => {
    const html = renderToStaticMarkup(
      <CodeMap topology={{ nodes: [], edges: [], groups: [] } as any} sensors={{}} />,
    );
    expect(html).toMatch(/no code map/i);
  });
});
