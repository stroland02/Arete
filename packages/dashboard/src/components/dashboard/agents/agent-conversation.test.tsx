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
  it('renders the agent header, model tier, and real finding rows', () => {
    const html = renderToStaticMarkup(
      <AgentConversation agent={security} findings={[finding()]} hasReviews onConfigure={noop} />,
    );
    expect(html).toContain('Security');
    expect(html).toContain('Opus'); // security tier
    expect(html).toContain('src/auth/session.ts:42');
    expect(html).toContain('Refresh token written to localStorage');
    expect(html).toContain('PR #7');
    // A configure control exists (decoupled from selection).
    expect(html).toContain('Configure the Security agent');
    // A real composer input, not a fabricated reply.
    expect(html).toContain('Ask Security about its findings');
  });

  it('shows an honest empty state when the agent has no findings', () => {
    const html = renderToStaticMarkup(
      <AgentConversation agent={security} findings={[]} hasReviews onConfigure={noop} />,
    );
    expect(html).toContain("hasn&#x27;t flagged anything yet");
    // Never invents a finding.
    expect(html).not.toContain('localStorage');
  });
});
