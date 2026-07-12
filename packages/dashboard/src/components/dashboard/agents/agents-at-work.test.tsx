import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENTS } from './agent-catalog';
import { AgentCard } from './agent-card';
import { AgentConfigDrawer } from './agent-config-drawer';
import { AgentsAtWork } from './agents-at-work';

// Renders the real components (react-dom/server, matching the project's
// existing test pattern — no React Testing Library) across the honest data
// states: idle zero-state, real per-agent counts, and the deliberately
// non-persisted config drawer.

const security = AGENTS[0];

describe('agent-catalog', () => {
  it('contains exactly the six main-grid specialists with config.py tiers', () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      'security',
      'performance',
      'quality',
      'test_coverage',
      'deployment_safety',
      'business_logic',
    ]);
    // ci_diagnostics is not a grid card; the Synthesizer is the hourglass.
    expect(AGENTS.find((a) => a.id === 'ci_diagnostics')).toBeUndefined();
    expect(AGENTS.find((a) => a.id === 'security')?.tier).toBe('opus');
    expect(AGENTS.find((a) => a.id === 'performance')?.tier).toBe('sonnet');
    expect(AGENTS.find((a) => a.id === 'business_logic')?.tier).toBe('opus');
  });
});

describe('AgentCard', () => {
  it('renders name, tier badge, and a real derived status with counts', () => {
    const html = renderToStaticMarkup(
      <AgentCard agent={security} findingCount={3} hasReviews={true} onOpen={() => {}} />
    );

    expect(html).toContain('Security');
    expect(html).toContain('Opus');
    expect(html).toContain('Analyzed · 3 findings');
  });

  it('renders an honest Idle status in the zero-state, fabricating nothing', () => {
    const html = renderToStaticMarkup(
      <AgentCard agent={security} findingCount={0} hasReviews={false} onOpen={() => {}} />
    );

    expect(html).toContain('Idle');
    expect(html).not.toContain('Analyzed');
  });
});

describe('AgentsAtWork', () => {
  it('renders all six agent labels, the Synthesizer, and the PR outcome steps', () => {
    const html = renderToStaticMarkup(
      <AgentsAtWork
        findingCountById={{ security: 5, performance: 2 }}
        totalFindings={7}
        hasReviews={true}
      />
    );

    for (const label of [
      'Security',
      'Performance',
      'Quality',
      'Test Coverage',
      'Deployment Safety',
      'Business Logic',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Synthesizer');
    expect(html).toContain('7 verified findings posted');
    expect(html).toContain('Your merge decision');
  });

  it('renders the idle captions when there are no reviews yet', () => {
    const html = renderToStaticMarkup(
      <AgentsAtWork findingCountById={{}} totalFindings={0} hasReviews={false} />
    );

    expect(html).toContain('Idle');
    expect(html).toContain('Waiting for your first review');
    expect(html).not.toContain('verified findings posted');
  });
});

describe('AgentConfigDrawer', () => {
  it('renders the config controls and the honest "not saved yet" note', () => {
    const html = renderToStaticMarkup(
      <AgentConfigDrawer agent={security} findingCount={2} onClose={() => {}} />
    );

    expect(html).toContain('Severity threshold');
    expect(html).toContain('Custom guidance');
    expect(html).toContain('role="switch"');
    expect(html).toContain('Save changes');
    expect(html).toContain('aren&#x27;t saved yet — per-repository configuration is coming soon');
    // Real informational content, not placeholders.
    expect(html).toContain(security.longDescription.slice(0, 40));
  });

  it('renders nothing when no agent is selected', () => {
    const html = renderToStaticMarkup(
      <AgentConfigDrawer agent={null} findingCount={0} onClose={() => {}} />
    );

    expect(html).not.toContain('Severity threshold');
  });

  it('states "No recent findings" instead of inventing activity', () => {
    const html = renderToStaticMarkup(
      <AgentConfigDrawer agent={security} findingCount={0} onClose={() => {}} />
    );

    expect(html).toContain('No recent findings from this agent.');
  });
});
