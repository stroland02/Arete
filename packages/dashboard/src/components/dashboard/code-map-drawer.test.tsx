import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeMapDrawer } from './code-map-drawer';
import type { SidebarModel } from '@/lib/code-map-sidebar';

const model: SidebarModel = {
  kind: 'file',
  title: 'a.ts',
  subtitle: 'src/auth/a.ts',
  health: {
    count: 2,
    maxSeverity: 'error',
    rows: [
      { path: 'src/auth/a.ts', line: 10, severity: 'warning', category: 'security', body: 'token in localStorage' },
      { path: 'src/auth/a.ts', line: 22, severity: 'error', category: 'security', body: 'missing auth check' },
    ],
  },
  contents: [{ id: 'fnA', label: 'doA', kind: 'Function', findingCount: 0 }],
  dependencies: {
    imports: [{ id: 'fC', label: 'c.ts', path: 'src/billing/c.ts' }],
    importedBy: [],
  },
  activity: ['Security Agent'],
};

describe('CodeMapDrawer', () => {
  it('renders nothing when model is null', () => {
    expect(renderToStaticMarkup(<CodeMapDrawer model={null} onClose={() => {}} />)).toBe('');
  });

  it('renders title, subtitle, and all four sections', () => {
    const html = renderToStaticMarkup(<CodeMapDrawer model={model} onClose={() => {}} />);
    expect(html).toContain('a.ts');
    expect(html).toContain('src/auth/a.ts');
    expect(html).toContain('missing auth check');   // health row
    expect(html).toContain('doA');                  // contents
    expect(html).toContain('c.ts');                 // dependency
    expect(html).toContain('Security Agent');       // activity
  });

  it('renders honest empty states for a bare model', () => {
    const bare: SidebarModel = {
      kind: 'file',
      title: 'b.ts',
      subtitle: 'src/auth/b.ts',
      health: { count: 0, rows: [] },
      contents: [],
      dependencies: { imports: [], importedBy: [] },
      activity: [],
    };
    const html = renderToStaticMarkup(<CodeMapDrawer model={bare} onClose={() => {}} />);
    expect(html).toContain('No open findings');
    expect(html).toContain('No recent agent activity');
  });
});
