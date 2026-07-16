import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Widget } from './widget';
import { BarBreakdownWidget } from './bar-breakdown-widget';
import { TimeseriesWidget } from './timeseries-widget';
import { TelemetryMetricWidget } from './telemetry-metric-widget';

describe('Widget shell', () => {
  it('renders the honest empty state when isEmpty', () => {
    const html = renderToStaticMarkup(
      <Widget title="Reviews" isEmpty emptyLabel="No reviews yet"><div>should-not-appear</div></Widget>
    );
    expect(html).toContain('No reviews yet');
    expect(html).not.toContain('should-not-appear');
  });
  it('renders children when not empty', () => {
    const html = renderToStaticMarkup(<Widget title="Reviews"><div>body-content</div></Widget>);
    expect(html).toContain('body-content');
  });
});

describe('BarBreakdownWidget', () => {
  it('renders a bar per row with labels and counts', () => {
    const html = renderToStaticMarkup(
      <BarBreakdownWidget title="By category" data={[{ category: 'security', count: 3 }, { category: 'performance', count: 1 }]} />
    );
    expect(html).toContain('security');
    expect(html).toContain('performance');
    expect(html).toContain('3');
  });
  it('shows an empty state for no data', () => {
    const html = renderToStaticMarkup(<BarBreakdownWidget title="By category" data={[]} />);
    expect(html).toContain('Nothing to show yet');
  });
});

describe('TimeseriesWidget', () => {
  it('renders an svg polyline for a non-empty series', () => {
    const html = renderToStaticMarkup(<TimeseriesWidget title="Reviews over time" dates={[new Date(), new Date()]} days={30} />);
    expect(html).toContain('<svg');
    expect(html).toContain('polyline');
  });
  it('shows an empty state when the series is all zero', () => {
    const html = renderToStaticMarkup(<TimeseriesWidget title="Reviews over time" dates={[]} days={30} />);
    expect(html).toContain('No activity in this range');
  });
});

describe('TelemetryMetricWidget', () => {
  const snap = { provider: 'sentry', sourceRef: 'acme/api', summaryText: 'ok', metrics: { error_rate: 2 }, links: [], fetchedAt: new Date('2026-07-10T00:00:00Z') };

  it('captions a CONNECTED provider as live and shows no connect CTA', () => {
    const html = renderToStaticMarkup(
      <TelemetryMetricWidget snapshot={snap} connectedProviders={['sentry']} />
    );
    expect(html.toLowerCase()).toContain('as of last review');
    expect(html).toContain('error_rate');
    expect(html).not.toContain('Connect this service');
    expect(html).not.toContain('Detected · not connected');
  });

  it('badges a DETECTED-but-not-connected provider and offers a connect CTA, not a live caption', () => {
    const html = renderToStaticMarkup(
      <TelemetryMetricWidget snapshot={snap} connectedProviders={[]} />
    );
    expect(html).toContain('Detected · not connected');
    expect(html).toContain('Connect this service');
    expect(html).toContain('/connections');
    expect(html).toContain('error_rate'); // real detected metric still shown
    expect(html.toLowerCase()).not.toContain('as of last review'); // never implies live
  });
});
