import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardsWorkspace } from './dashboards-workspace';

type Model = Parameters<typeof DashboardsWorkspace>[0]['model'];

const emptyModel: Model = {
  hasAccess: true, totalPrs: 0, criticalBugs: 0, recentReviews: 0, weeklyDelta: 0,
  reviewDates: [], byCategory: [], bySeverity: [], byRisk: [], byRepo: [], latestReviews: [], telemetry: [],
};

describe('DashboardsWorkspace', () => {
  // renderToStaticMarkup renders the initial useState state only (no
  // interaction), so we can only assert the default tab ("activity") here.
  // The Findings/Telemetry hidden-state would require simulating a click,
  // which is out of scope for this repo's static-markup test convention.
  it('shows the time-range control on the default (activity) tab', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={emptyModel} />);
    expect(html).toContain('7d');
    expect(html).toContain('30d');
    expect(html).toContain('90d');
  });

  it('renders all three preset tabs', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={emptyModel} />);
    expect(html).toContain('Review Activity');
    expect(html).toContain('Findings');
    expect(html).toContain('Telemetry');
  });
});
