import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewStatTile } from './overview-stat-tile';

describe('OverviewStatTile', () => {
  it('renders label, value, and a gradient sparkline with a bronze end dot when a trend exists', () => {
    const html = renderToStaticMarkup(<OverviewStatTile label="Reviews" value={12} trend={[1, 3, 2, 5]} />);
    expect(html).toContain('Reviews');
    expect(html).toContain('12');
    expect(html).toContain('<svg');
    expect(html).toContain('linearGradient');
    expect(html).toContain('var(--color-accent-secondary)'); // bronze end dot
  });

  it('renders a bronze hairline — never a fabricated chart — when no trend is provided', () => {
    const html = renderToStaticMarkup(<OverviewStatTile label="Repositories" value={0} />);
    expect(html).toContain('Repositories');
    expect(html).not.toContain('<svg');
    expect(html).toContain('bg-accent-secondary');
  });
});
