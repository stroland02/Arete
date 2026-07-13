import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardsWorkspace } from './dashboards-workspace';

type Model = Parameters<typeof DashboardsWorkspace>[0]['model'];

const emptyConnected: Model = {
  hasAccess: true, totalPrs: 0, criticalBugs: 0, recentReviews: 0, weeklyDelta: 0,
  reviewDates: [], byCategory: [], bySeverity: [], byRisk: [], byRepo: [], latestReviews: [], telemetry: [],
};

describe('DashboardsWorkspace', () => {
  // renderToStaticMarkup renders the initial useState state only (no
  // interaction), so we assert the default tab ("activity") here.
  it('shows the time-range control on the default (activity) tab when connected', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={emptyConnected} />);
    expect(html).toContain('7d');
    expect(html).toContain('30d');
    expect(html).toContain('90d');
  });

  it('renders all three preset tabs', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={emptyConnected} />);
    expect(html).toContain('Review Activity');
    expect(html).toContain('Findings');
    expect(html).toContain('Telemetry');
  });

  it('renders the not-connected preview (tabs + connect prompt, no data wall, range control hidden)', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={{ hasAccess: false }} />);
    expect(html).toContain('Review Activity');
    expect(html).toContain('Connect a repository');
    expect(html).toContain('Reviews over time');
    expect(html).not.toContain('7d');
  });
});
