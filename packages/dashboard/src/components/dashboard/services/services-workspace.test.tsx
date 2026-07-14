import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServicesWorkspace } from './services-workspace';

describe('ServicesWorkspace', () => {
  it('offers a Connect a repository CTA in the center pane when nothing is connected', () => {
    // Fresh authenticated account: no services/issues. The center Synthesizer
    // pane should guide the user to connect, matching the Agents page.
    const html = renderToStaticMarkup(<ServicesWorkspace />);

    expect(html).toContain('The Synthesizer verifies every issue');
    expect(html).toContain('Connect a repository');
    expect(html).toContain('/connections');
  });
});
