import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardStatusBanner } from './dashboard-connect-banner';

describe('DashboardStatusBanner', () => {
  it('awaiting-review states the waiting message and has no connect CTA', () => {
    const html = renderToStaticMarkup(<DashboardStatusBanner variant="awaiting-review" />);
    expect(html).toContain('Waiting for your first review');
    expect(html).not.toContain('Connect a');
  });
});
