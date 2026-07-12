import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommentsByCategory } from './comments-by-category';

// Renders the real overview analytics panel via react-dom/server (the
// project's test pattern). Bars and counts must come 1:1 from the real
// commentsByCategory aggregation; [] must yield an honest empty state.

describe('CommentsByCategory', () => {
  it('renders a bar and a count for every category, widest for the max', () => {
    const html = renderToStaticMarkup(
      <CommentsByCategory
        categories={[
          { category: 'security', count: 8 },
          { category: 'test_coverage', count: 4 },
          { category: 'performance', count: 1 },
        ]}
      />
    );

    expect(html).toContain('Comments by Category');
    expect(html).toContain('Security');
    expect(html).toContain('Test Coverage');
    expect(html).toContain('Performance');
    // One bar per category…
    expect(html.match(/data-bar/g)).toHaveLength(3);
    // …scaled to the max (8 → 100%, 4 → 50%).
    expect(html).toContain('width:100%');
    expect(html).toContain('width:50%');
    // Direct count labels.
    expect(html).toContain('>8<');
    expect(html).toContain('>4<');
    expect(html).toContain('>1<');
  });

  it('renders the empty state on [] instead of fabricating bars', () => {
    const html = renderToStaticMarkup(<CommentsByCategory categories={[]} />);

    expect(html).toContain('No findings yet');
    expect(html).not.toContain('data-bar');
  });
});
