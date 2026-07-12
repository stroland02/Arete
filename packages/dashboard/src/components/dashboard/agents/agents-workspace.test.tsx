import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENTS } from './agent-catalog';
import { AgentRail } from './agent-rail';
import { SynthesizerConsole } from './synthesizer-console';
import { PrPanel } from './pr-panel';
import { AgentsWorkspace } from './agents-workspace';

// Renders the real /agents workspace panes via react-dom/server (the
// project's test pattern — no React Testing Library) across the honest data
// states: fresh-account zero states and real per-agent counts.

const SIX_LABELS = [
  'Security',
  'Performance',
  'Quality',
  'Test Coverage',
  'Deployment Safety',
  'Business Logic',
];

describe('AgentRail', () => {
  it('renders all six agent names, tier badges, and a real status line', () => {
    const html = renderToStaticMarkup(
      <AgentRail
        findingCountById={{ security: 5, performance: 2 }}
        hasReviews={true}
        selectedAgentId="security"
        onSelect={() => {}}
        onConfigure={() => {}}
      />
    );

    for (const label of SIX_LABELS) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Opus');
    expect(html).toContain('Sonnet');
    expect(html).toContain('Analyzed · 5 findings');
    expect(html).toContain('Analyzed · 0 findings');
    // Selected row is marked for assistive tech.
    expect(html).toContain('aria-current="true"');
  });

  it('shows an honest Idle status on a fresh account', () => {
    const html = renderToStaticMarkup(
      <AgentRail
        findingCountById={{}}
        hasReviews={false}
        selectedAgentId={AGENTS[0].id}
        onSelect={() => {}}
        onConfigure={() => {}}
      />
    );

    expect(html).toContain('Idle');
    expect(html).not.toContain('Analyzed');
  });
});

describe('SynthesizerConsole', () => {
  it('renders the disabled input bar and the scripted narration when there are reviews', () => {
    const html = renderToStaticMarkup(
      <SynthesizerConsole
        hasReviews={true}
        totalFindings={7}
        selectedAgentLabel="Security"
        selectedAgentFindings={5}
      />
    );

    expect(html).toContain('Ask the Synthesizer…');
    expect(html).toContain('Preview');
    expect(html).toContain('Security reported 5 findings');
    expect(html).toContain('7 verified findings posted to the PR');
    // Honesty: the transcript is explicitly labeled as non-live.
    expect(html).toContain('not a live model');
    expect(html).toContain('live chat coming soon');
  });

  it('renders the idle empty state (and still the input bar) with no reviews', () => {
    const html = renderToStaticMarkup(
      <SynthesizerConsole
        hasReviews={false}
        totalFindings={0}
        selectedAgentLabel="Security"
        selectedAgentFindings={0}
      />
    );

    // Idle state now explains what the Synthesizer does and routes the user
    // to the next step instead of a bare "no active review".
    expect(html).toContain('coordinates every review');
    expect(html).toContain('Connect a repository');
    expect(html).toContain('/connections');
    expect(html).toContain('Ask the Synthesizer…');
    expect(html).not.toContain('posted to the PR');
  });
});

describe('PrPanel', () => {
  it('renders the section headers and the real PR comparison line', () => {
    const html = renderToStaticMarkup(
      <PrPanel
        hasReviews={true}
        latestReview={{ repoFullName: 'acme/api', prNumber: 42, riskLevel: 'medium' }}
        totalFindings={7}
      />
    );

    expect(html).toContain('Findings');
    expect(html).toContain('Files changed');
    expect(html).toContain('Commits');
    expect(html).toContain('acme/api');
    expect(html).toContain('PR #42');
    expect(html).toContain('vs main');
    expect(html).toContain('https://github.com/acme/api/pull/42');
  });

  it('says "No pull request yet" when there is none', () => {
    const html = renderToStaticMarkup(
      <PrPanel hasReviews={false} latestReview={null} totalFindings={0} />
    );

    expect(html).toContain('No pull request yet');
    expect(html).toContain('Findings');
    expect(html).toContain('Files changed');
    expect(html).toContain('Commits');
    expect(html).not.toContain('github.com');
    // Repo selector + human-verification controls (honest shells).
    expect(html).toContain('No repository connected');
    expect(html).toContain('Human verification');
    expect(html).toContain('Approve');
    expect(html).toContain('Request changes');
    expect(html).toContain('Post to PR');
  });
});

describe('AgentsWorkspace', () => {
  it('composes all three panes with the first agent selected by default', () => {
    const html = renderToStaticMarkup(
      <AgentsWorkspace
        findingCountById={{ security: 3 }}
        totalFindings={3}
        hasReviews={true}
        latestReview={{ repoFullName: 'acme/api', prNumber: 8, riskLevel: 'low' }}
      />
    );

    expect(html).toContain('Agents');
    expect(html).toContain('Synthesizer');
    expect(html).toContain('Pull Request');
    // Default selection = first catalog agent, driving the console focus.
    expect(html).toContain(`focused on ${AGENTS[0].label}`);
  });
});
