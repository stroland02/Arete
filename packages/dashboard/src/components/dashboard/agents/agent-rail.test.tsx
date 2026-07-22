import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentRail } from './agent-rail';
import type { InboxView } from '@/lib/work-items';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const noop = () => {};

const inboxWith = (items: InboxView['items']): InboxView => ({
  items,
  lastScan: { status: 'complete', finishedAt: '2026-07-17T12:00:00.000Z', error: null },
});

const workItem = (o: Partial<InboxView['items'][number]> = {}): InboxView['items'][number] => ({
  id: 'wi-1',
  kind: 'issue',
  title: 'SQL built from raw request input',
  detail: 'reports() passes q straight into db.raw.',
  evidence: [{ path: 'app/api/reports.ts', line: 3 }],
  dimension: 'security',
  confidence: 0.8,
  state: 'open',
  containerId: null,
  fixCooldown: { allowed: true },
  ...o,
});

describe('AgentRail', () => {
  it('renders a separate select control and configure control per agent', () => {
    const html = renderToStaticMarkup(
      <AgentRail
        findingCountById={{}}
        hasReviews={false}
        selectedAgentId="security"
        onSelect={noop}
        onConfigure={noop}
      />,
    );
    // Row selection and configuration are now distinct affordances.
    expect(html).toContain('View the Security agent');
    expect(html).toContain('Configure the Security agent');
  });

  it('surfaces the work-item inbox when one is supplied — what the agents are working on', () => {
    const html = renderToStaticMarkup(
      <AgentRail
        findingCountById={{}}
        hasReviews
        selectedAgentId="security"
        onSelect={noop}
        onConfigure={noop}
        inbox={inboxWith([
          workItem(),
          workItem({ id: 'wi-2', title: 'Staged token fix', state: 'staged', containerId: 'cont-7' }),
        ])}
      />,
    );
    expect(html).toContain('Work items');
    expect(html).toContain('SQL built from raw request input');
    // in-flight state surfaces on the row, so "what they're working on" is visible
    expect(html).toContain('staged');
  });

  it('renders no work-items section when no inbox is supplied (fresh/unconnected account)', () => {
    const html = renderToStaticMarkup(
      <AgentRail
        findingCountById={{}}
        hasReviews={false}
        selectedAgentId="security"
        onSelect={noop}
        onConfigure={noop}
      />,
    );
    expect(html).not.toContain('Work items');
  });
});
