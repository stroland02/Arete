import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardsWorkspace } from './dashboards-workspace';

type Model = Parameters<typeof DashboardsWorkspace>[0]['model'];

const base = {
  hasAccess: true as const, criticalBugs: 0, recentReviews: 0, weeklyDelta: 0,
  byCategory: [], bySeverity: [], byRisk: [], byRepo: [], telemetry: [],
};

const connectedWithData: Model = {
  ...base, totalPrs: 4, reviewDates: [new Date(), new Date()],
  latestReviews: [{ id: 'v1', prNumber: 1, riskLevel: 'high', createdAt: new Date(), repositoryFullName: 'acme/api' }],
};
const connectedEmpty: Model = { ...base, totalPrs: 0, reviewDates: [], latestReviews: [] };

describe('DashboardsWorkspace', () => {
  it('shows the time-range control on the activity tab when there is data', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={connectedWithData} />);
    expect(html).toContain('7d');
    expect(html).toContain('30d');
    expect(html).toContain('90d');
  });

  it('renders all three preset tabs', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={connectedWithData} />);
    expect(html).toContain('Review Activity');
    expect(html).toContain('Findings');
    expect(html).toContain('Telemetry');
  });

  it('not connected → connect banner once + skeletons, no range control', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={{ hasAccess: false }} />);
    const count = (html.match(/Connect a repository/g) || []).length;
    expect(count).toBe(1);
    expect(html).toContain('chart preview');
    expect(html).not.toContain('7d');
  });

  it('connected but no reviews → awaiting-review banner + skeletons, no connect CTA, no range control', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={connectedEmpty} />);
    expect(html).toContain('Waiting for your first review');
    expect(html).not.toContain('Connect a repository');
    expect(html).toContain('chart preview');
    expect(html).not.toContain('7d');
  });
});
