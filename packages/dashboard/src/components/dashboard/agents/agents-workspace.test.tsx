/**
 * CHARACTERIZATION — pins what /agents renders TODAY, before Stage 2.2 moves the
 * agents surface inside Services.
 *
 * These assertions are deliberately about observable output through the public
 * props API, not internals: after the move, the same agent selection, the same
 * conversation pane and the same config drawer must still be reachable, even
 * though they will be mounted somewhere else. A test that pinned internals would
 * have to be rewritten by the move and would prove nothing about it.
 *
 * Written BEFORE the move and confirmed green against the untouched component —
 * that is the whole point (safety rule 1). If any of these change during the
 * move, the move changed behaviour and is no longer a refactor.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The rail and the conversation both reach for router/fetch; a static render
// needs neither to do anything real.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import { AgentsWorkspace } from './agents-workspace';
import { AGENTS } from './agent-catalog';
import type { InboxView } from '@/lib/work-items';

const FINDING_COUNTS = { security: 3, performance: 1 };

function render(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <AgentsWorkspace
      findingCountById={FINDING_COUNTS}
      totalFindings={4}
      hasReviews
      {...overrides}
    />,
  );
}

function inboxWith(items: InboxView['items']): InboxView {
  return { items, lastScan: { status: 'complete', finishedAt: '2026-07-20T09:00:00.000Z' } };
}

describe('AgentsWorkspace — characterization before the Services absorption', () => {
  it('renders every catalogued agent in the rail', () => {
    const html = render();

    for (const agent of AGENTS) {
      expect(html).toContain(agent.label);
    }
  });

  it('selects the first catalogued agent by default', () => {
    // The center pane is the SELECTED agent's conversation, so the first
    // agent's label appearing more than once (rail + conversation) is the
    // observable signal that it is selected. Pinned because the move must not
    // silently change which agent a fresh visit lands on.
    const html = render();
    const first = AGENTS[0].label;

    expect(html.split(first).length - 1).toBeGreaterThan(1);
  });

  it('surfaces the finding count it was given, and does not invent one', () => {
    const html = render();

    expect(html).toContain('3');
    // Agents with no entry must not render a number pulled from nowhere.
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('omits the work inbox entirely when there is none, rather than showing it empty', () => {
    // Honesty rule: null (no connected repo, nothing to scan) is not [].
    const html = render({ inbox: null });

    expect(html).not.toContain('Work items');
  });

  it('does NOT render the work inbox any more — Services owns it (Stage 2.1)', () => {
    // This assertion was inverted deliberately. It originally pinned the
    // duplicate inbox that /agents rendered alongside Services. Stage 2.1
    // resolved that duplication as SUBSUMED: Services owns the inbox and can
    // act on an item, while this copy could only hand off. A characterization
    // test that still demanded the duplicate would be defending the bug.
    const html = render({
      inbox: inboxWith([
        {
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
        },
      ]),
    });

    expect(html).not.toContain('Work items');
    expect(html).not.toContain('SQL built from raw request input');
  });

  it('renders no config drawer until an agent is configured', () => {
    // The drawer is driven by local state that starts null. After the move it
    // must still start closed — a drawer that opens on mount would be a
    // behaviour change disguised as a relocation.
    const html = render();

    expect(html).not.toContain('Save');
  });

  it('renders the honest empty state when no review has run', () => {
    const html = render({ hasReviews: false, totalFindings: 0, findingCountById: {} });

    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('undefined');
  });
});
