import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServicesWorkspace } from './services-workspace';

describe('ServicesWorkspace', () => {
  it('hosts the Synthesizer in the center with a connect CTA when nothing is connected', () => {
    // The authenticated (embedded) center is now the Synthesizer's home —
    // its onboarding state, plus a Connect-a-repository CTA.
    const html = renderToStaticMarkup(<ServicesWorkspace />);

    expect(html).toContain('The Synthesizer coordinates every review');
    expect(html).toContain('Connect a repository');
    expect(html).toContain('/connections');
  });

  it('shows the connected onboarding state when a repository is connected', () => {
    const html = renderToStaticMarkup(<ServicesWorkspace connected />);

    expect(html).toContain('The Synthesizer coordinates every review');
    expect(html).toContain('awaiting your first pull request');
  });
});
