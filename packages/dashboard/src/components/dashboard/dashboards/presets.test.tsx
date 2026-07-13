import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewActivityPreset } from './presets/review-activity';
import { FindingsPreset } from './presets/findings';
import { TelemetryPreset } from './presets/telemetry';

type Model = Parameters<typeof ReviewActivityPreset>[0]['model'];

const emptyModel: Model = {
  hasAccess: true, totalPrs: 0, criticalBugs: 0, recentReviews: 0, weeklyDelta: 0,
  reviewDates: [], byCategory: [], bySeverity: [], byRisk: [], byRepo: [], latestReviews: [], telemetry: [],
};

const fullModel: Model = {
  ...emptyModel,
  totalPrs: 5, criticalBugs: 2, recentReviews: 3, weeklyDelta: 1,
  reviewDates: [new Date(), new Date()],
  byCategory: [{ category: 'security', count: 4 }],
  bySeverity: [{ category: 'error', count: 2 }, { category: 'warning', count: 1 }],
  byRisk: [{ category: 'high', count: 3 }],
  byRepo: [{ fullName: 'acme/api', count: 5 }],
  latestReviews: [{ id: 'v1', prNumber: 1, riskLevel: 'high', createdAt: new Date(), repositoryFullName: 'acme/api' }],
};

describe('ReviewActivityPreset', () => {
  it('renders real metrics with data (skeleton=false)', () => {
    const html = renderToStaticMarkup(<ReviewActivityPreset model={fullModel} days={30} skeleton={false} />);
    expect(html).toContain('acme/api');
    expect(html).toContain('Pull requests reviewed');
  });
  it('renders the skeleton layout when skeleton=true (titles present, no connect text)', () => {
    const html = renderToStaticMarkup(<ReviewActivityPreset model={emptyModel} days={30} skeleton />);
    expect(html).toContain('Reviews over time');
    expect(html).toContain('chart preview');
    expect(html).not.toContain('Connect a repository');
  });
});

describe('FindingsPreset', () => {
  it('renders breakdowns with data (skeleton=false)', () => {
    const html = renderToStaticMarkup(<FindingsPreset model={fullModel} days={30} skeleton={false} />);
    expect(html).toContain('security');
    expect(html.toLowerCase()).toContain('error');
  });
  it('renders the skeleton layout when skeleton=true', () => {
    const html = renderToStaticMarkup(<FindingsPreset model={emptyModel} days={30} skeleton />);
    expect(html).toContain('Findings by severity');
    expect(html).toContain('breakdown preview');
  });
});

describe('TelemetryPreset', () => {
  it('renders skeleton cards when skeleton=true', () => {
    const html = renderToStaticMarkup(<TelemetryPreset model={emptyModel} days={30} skeleton />);
    expect(html).not.toContain('as of last review');
  });
  it('renders one panel per connected provider when skeleton=false', () => {
    const html = renderToStaticMarkup(
      <TelemetryPreset model={{ ...emptyModel, telemetry: [{ provider: 'sentry', sourceRef: 'acme/api', summaryText: '', metrics: { error_rate: 2 }, links: [], fetchedAt: new Date() }] }} days={30} skeleton={false} />
    );
    expect(html).toContain('sentry');
    expect(html.toLowerCase()).toContain('as of last review');
  });
});
