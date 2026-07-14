import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './EmptyState';

// Renders the real component (via react-dom/server, already a project
// dependency — no new test-rendering library needed) to prove the "no
// installations" branch produces the install-the-app messaging rather than
// an empty/broken metrics view that would be indistinguishable from "zero
// reviews so far".
describe('EmptyState', () => {
  it('renders the install-the-GitHub-App call to action', () => {
    const html = renderToStaticMarkup(<EmptyState />);

    expect(html).toContain('Install the Kuma GitHub App');
    expect(html).toContain('https://github.com/apps/arete-ai-code-review');
  });

  it('does not render any metrics/numeric dashboard content', () => {
    const html = renderToStaticMarkup(<EmptyState />);

    expect(html).not.toContain('Total PRs Reviewed');
    expect(html).not.toContain('Overview');
  });
});
