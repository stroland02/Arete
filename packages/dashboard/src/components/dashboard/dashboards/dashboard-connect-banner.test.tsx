import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardConnectBanner } from './dashboard-connect-banner';

describe('DashboardConnectBanner', () => {
  it('shows the repository CTA for kind=repository', () => {
    const html = renderToStaticMarkup(<DashboardConnectBanner kind="repository" />);
    expect(html).toContain('Connect a repository');
    expect(html).not.toContain('Connect a service');
  });
  it('shows the service CTA for kind=service', () => {
    const html = renderToStaticMarkup(<DashboardConnectBanner kind="service" />);
    expect(html).toContain('Connect a service');
  });
});
