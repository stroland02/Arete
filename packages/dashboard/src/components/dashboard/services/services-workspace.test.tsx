import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServicesWorkspace } from './services-workspace';

describe('ServicesWorkspace', () => {
  it('hosts the Synthesizer in the center with a connect CTA when nothing is connected', () => {
    // The authenticated (embedded) center is now the Synthesizer's home —
    // its professional introduction, plus a Connect-a-repository CTA.
    const html = renderToStaticMarkup(<ServicesWorkspace />);

    expect(html).toContain('Kuma');
    expect(html).toContain('How a review runs');
    expect(html).toContain('Connect a repository');
    expect(html).toContain('/connections');
  });

  it('introduces Kuma without loading/waiting talk when a repository is connected', () => {
    const html = renderToStaticMarkup(<ServicesWorkspace connected />);

    expect(html).toContain('Kuma');
    expect(html).toContain('How a review runs');
    // No buffering language on an idle engineer, and no connect prompt when connected.
    expect(html).not.toContain('awaiting your first pull request');
    expect(html).not.toContain('Connect a repository to put me to work');
  });

  it('lists a connected repository in the rail as awaiting its first PR (never an empty rail)', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace connected reviewGroups={[]} repositories={['acme/api']} />,
    );

    expect(html).toContain('acme/api');
    expect(html).toContain('Awaiting its first pull request');
    expect(html).toContain('Add connections');
    expect(html).not.toContain('No reviews yet.');
  });
});
