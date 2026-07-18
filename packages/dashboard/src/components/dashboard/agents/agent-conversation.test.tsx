import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentConversation } from './agent-conversation';
import { AGENTS } from './agent-catalog';
import type { AgentActivityFinding } from '@/lib/queries';

const security = AGENTS.find((a) => a.id === 'security')!;
const noop = () => {};

function finding(over: Partial<AgentActivityFinding> = {}): AgentActivityFinding {
  return {
    reviewId: 'r1', prNumber: 7, repositoryFullName: 'acme/api', createdAt: new Date('2026-07-13T00:00:00Z'),
    category: 'security', path: 'src/auth/session.ts', line: 42, body: 'Refresh token written to localStorage', severity: 'error',
    ...over,
  };
}

describe('AgentConversation', () => {
  it('renders the agent header, connected model, and real finding rows', () => {
    const html = renderToStaticMarkup(
      <AgentConversation
        agent={security}
        findings={[finding()]}
        findingCount={1}
        hasReviews
        activeModel={{ provider: 'ollama', model: 'qwen2.5-coder' }}
        onConfigure={noop}
      />,
    );
    expect(html).toContain('Security');
    expect(html).toContain('qwen2.5-coder'); // dynamic connected model, not a hardcoded tier
    expect(html).toContain('src/auth/session.ts:42');
    expect(html).toContain('Refresh token written to localStorage');
    expect(html).toContain('PR #7');
    // A configure control exists (decoupled from selection).
    expect(html).toContain('Configure the Security agent');
    // A real composer input, not a fabricated reply.
    expect(html).toContain('Ask Security about its findings');
  });

  it('previews the agent from real catalog data (not a finding) when it has none, with a connect CTA', () => {
    const html = renderToStaticMarkup(
      <AgentConversation agent={security} findings={[]} findingCount={0} hasReviews onConfigure={noop} />,
    );
    // Real catalog metadata — the "preview each agent" experience, no repo needed.
    expect(html).toContain('AuthN / AuthZ changes'); // a real inspects item
    expect(html).toContain('Connect a repository');
    // Never invents a finding.
    expect(html).not.toContain('localStorage');
  });

  it('shows an honest window note above the profile when findings exist on record but none in the recent window', () => {
    const html = renderToStaticMarkup(
      <AgentConversation agent={security} findings={[]} findingCount={3} hasReviews onConfigure={noop} />,
    );
    expect(html).toContain('3 findings on record');
    expect(html).toContain('AuthN / AuthZ changes'); // profile still shown
    expect(html).toContain('Connect a repository');
  });

  it('shows the findings transcript (not the profile/CTA) when the agent has findings in view', () => {
    const html = renderToStaticMarkup(
      <AgentConversation agent={security} findings={[finding()]} findingCount={1} hasReviews onConfigure={noop} />,
    );
    expect(html).toContain('src/auth/session.ts:42');
    expect(html).not.toContain('Connect a repository');
  });
});
