import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardsWorkspace } from './dashboards-workspace';
import { disconnectedState, type AccountState } from '@/lib/account-state';

type Model = Parameters<typeof DashboardsWorkspace>[0]['model'];

const base = {
  hasAccess: true as const, criticalBugs: 0, recentReviews: 0, weeklyDelta: 0,
  byCategory: [], bySeverity: [], byRisk: [], byRepo: [], telemetry: [], connectedProviders: [],
  repos: ['acme/api'], modelConnected: false,
};

const connectedWithData: Model = {
  ...base, totalPrs: 4, reviewDates: [new Date(), new Date()],
  latestReviews: [{ id: 'v1', prNumber: 1, riskLevel: 'high', createdAt: new Date(), repositoryFullName: 'acme/api' }],
};
const connectedEmpty: Model = { ...base, totalPrs: 0, reviewDates: [], latestReviews: [] };

// The three Account-State stages this surface must render correctly. Banner +
// skeleton now derive from the resolver, not from model.hasAccess/totalPrs.
const idle: AccountState = {
  repoConnected: true, repoCount: 1, modelConnected: false, hasReviews: false, reviewCount: 0, stage: 'connected_idle',
};
const active: AccountState = {
  repoConnected: true, repoCount: 1, modelConnected: true, hasReviews: true, reviewCount: 4, stage: 'active',
};

describe('DashboardsWorkspace — Account-State three-state matrix', () => {
  it('active → time-range control + all preset tabs, no connect/awaiting banner', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={connectedWithData} accountState={active} />);
    expect(html).toContain('7d');
    expect(html).toContain('30d');
    expect(html).toContain('90d');
    expect(html).toContain('Review Activity');
    expect(html).toContain('Findings');
    expect(html).toContain('Telemetry');
    expect(html).not.toContain('Waiting for your first review');
  });

  it('disconnected → connect banner once + skeletons, no range control', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={{ hasAccess: false }} accountState={disconnectedState()} />);
    const count = (html.match(/Connect a repository/g) || []).length;
    expect(count).toBe(1);
    expect(html).toContain('chart preview');
    expect(html).not.toContain('7d');
  });

  it('connected_idle → awaiting-review banner + skeletons, NEVER "Connect a repository", no range control', () => {
    const html = renderToStaticMarkup(<DashboardsWorkspace model={connectedEmpty} accountState={idle} />);
    expect(html).toContain('Waiting for your first review');
    expect(html).not.toContain('Connect a repository');
    expect(html).toContain('chart preview');
    expect(html).not.toContain('7d');
  });
});
