import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeSourceView } from './code-source-panel';

const noop = () => {};

describe('CodeSourceView', () => {
  it('renders the path header and code lines with numbers', () => {
    const html = renderToStaticMarkup(
      <CodeSourceView
        path="src/auth/a.ts"
        state={{
          kind: 'ok',
          truncated: false,
          lines: [
            { n: 1, text: "import { db } from '../db'" },
            { n: 2, text: 'export const x = 1' },
          ],
        }}
        onClose={noop}
      />,
    );
    expect(html).toContain('src/auth/a.ts');
    expect(html).toContain('import { db }');
    expect(html).toContain('>1<'); // gutter number
    expect(html).toContain('>2<');
  });

  it('marks finding lines with their severity and note', () => {
    const html = renderToStaticMarkup(
      <CodeSourceView
        path="a.ts"
        state={{
          kind: 'ok',
          truncated: false,
          lines: [{ n: 1, text: 'bad()', severity: 'error', note: 'missing auth check' }],
        }}
        onClose={noop}
      />,
    );
    expect(html).toContain('data-severity="error"');
    expect(html).toContain('missing auth check');
  });

  it('shows the truncation notice when flagged', () => {
    const html = renderToStaticMarkup(
      <CodeSourceView
        path="big.txt"
        state={{ kind: 'ok', truncated: true, lines: [{ n: 1, text: 'a' }] }}
        onClose={noop}
      />,
    );
    expect(html).toMatch(/showing the first part/i);
  });

  it('renders honest copy for each non-code state', () => {
    const states = [
      { kind: 'loading' as const, match: /loading/i },
      { kind: 'binary' as const, match: /binary file/i },
      { kind: 'too_large' as const, match: /too large/i },
      { kind: 'not_found' as const, match: /not found/i },
      { kind: 'unavailable' as const, match: /unavailable/i },
    ];
    for (const s of states) {
      const html = renderToStaticMarkup(
        <CodeSourceView path="a.ts" state={{ kind: s.kind }} onClose={noop} />,
      );
      expect(html).toMatch(s.match);
    }
  });
});
