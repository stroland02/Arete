import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServicesWorkspace, WorkItemPanel } from './services-workspace';
import type { Issue, Service } from './services-workspace';
import type { InboxView } from '@/lib/work-items';
import type { ServiceReviewGroup } from '@/lib/queries';

function inboxWith(items: InboxView['items'], lastScan: InboxView['lastScan']): InboxView {
  return { items, lastScan };
}

function item(overrides: Partial<InboxView['items'][number]> = {}): InboxView['items'][number] {
  return {
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
    ...overrides,
  };
}

// ── Characterization fixtures for the panels that had no coverage ───────────
// Deliberately NOT the marketing SAMPLE_* data: these are local to the test so
// the assertions below pin the panels' rendering, not a fixture's contents.
const CHAR_SERVICES: Service[] = [
  { id: 'billing-api', open: 1, worst: 'critical' },
  { id: 'quiet-service', open: 0, worst: 'clear' },
];

const CHAR_ISSUES: Issue[] = [
  {
    id: 'x1',
    serviceId: 'billing-api',
    source: 'Sentry',
    severity: 'critical',
    status: 'Fix proposed',
    agent: 'Business Logic',
    title: 'Null balance crashes the charge path',
    occurrences: '12 events',
    lastSeen: '2m ago',
    where: 'src/billing/charge.ts:23',
    summary: 'The charge path assumes a number and throws before the request completes.',
    evidence: { file: 'evidence-file-header', rows: [['user.tier', 'free']] },
    fix: {
      file: 'src/billing/charge.ts',
      rows: [
        { kind: 'context', text: 'function charge(order, user) {' },
        { kind: 'remove', text: 'const amount = order.total * user.balance' },
        { kind: 'add', text: 'const bal = user.balance ?? 0' },
      ],
    },
    timeline: [
      { tone: 'critical', text: 'Error detected', when: 'Sentry · 2m ago' },
      { tone: 'accent', text: 'Business Logic agent picked it up', when: '1m ago' },
      { tone: 'good', text: 'Fix proposed — awaiting your approval', when: 'just now' },
    ],
  },
];

const CHAR_REVIEW_GROUPS: ServiceReviewGroup[] = [
  {
    repositoryFullName: 'acme/api',
    worstRisk: 'high',
    reviews: [
      { id: 'rev-1', prNumber: 42, riskLevel: 'high', createdAt: '2026-07-17T12:00:00.000Z', findingCount: 3 },
    ],
  },
];

/**
 * Characterization coverage for the three panels that ServicesWorkspace owns
 * but never exported — IssueSynthesizerConsole, IssuePanel and ReviewPanel —
 * plus the collapsible PanelSection they all share. Every one of them is
 * driven THROUGH the public ServicesWorkspace props, never by reaching into a
 * module-private function, so these assertions keep holding no matter which
 * file the panels physically live in.
 */
describe('ServicesWorkspace — issue panels (sample/framed mode)', () => {
  it('renders the scripted issue Synthesizer console for the initially selected issue', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace services={CHAR_SERVICES} issues={CHAR_ISSUES} variant="framed" />,
    );

    // Header: live dot + the honest "Preview" chip + the focused-issue caption.
    expect(html).toContain('Synthesizer');
    expect(html).toContain('Preview');
    expect(html).toContain('focused on Null balance crashes the charge path');

    // The transcript is labelled as a scripted replay, not a live model.
    expect(html).toContain('Scripted replay of this issue');
    expect(html).toContain('not a live model');

    // Every timeline entry renders with its text and its `when`.
    expect(html).toContain('Error detected');
    expect(html).toContain('Sentry · 2m ago');
    expect(html).toContain('Business Logic agent picked it up');
    expect(html).toContain('Fix proposed — awaiting your approval');
    expect(html).toContain('just now');

    // Pinned, deliberately disabled input strip.
    expect(html).toContain('Ask the Synthesizer');
    expect(html).toContain('Live chat coming soon');
    expect(html).toContain('preview shell · live chat coming soon · focused on billing-api');
  });

  it('renders the issue pull-request panel with the repo target, PR body and diff', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace services={CHAR_SERVICES} issues={CHAR_ISSUES} variant="framed" />,
    );

    // Severity pill in the header (not replaying on first render).
    expect(html).toContain('Pull request');
    expect(html).toContain('Critical');

    // Repository target block.
    expect(html).toContain('acme-corp/billing-api');
    expect(html).toContain('main ← arete/fix-x1');
    expect(html).toContain('Manage connected repositories');

    // PanelSection: the formatted pull request.
    expect(html).toContain('Fix: Null balance crashes the charge path');
    expect(html).toContain('The charge path assumes a number and throws before the request completes.');

    // PanelSection: the review comment — location + the DiffView rows.
    expect(html).toContain('Review comment');
    expect(html).toContain('src/billing/charge.ts:23');
    expect(html).toContain('const bal = user.balance ?? 0');
    expect(html).toContain('const amount = order.total * user.balance');

    // Send gate: no real container backs sample data, so the honest disabled shell.
    expect(html).toContain('Open a reviewed issue backed by a real container to post its pull request');
    expect(html).toContain('Post pull request');
    expect(html).toContain('Request changes');
    expect(html).toContain('Copy patch');
    expect(html).toContain('the solution is approved on the Agents page first');
  });

  it('renders both panels in their empty state when no issue is selected', () => {
    const html = renderToStaticMarkup(<ServicesWorkspace services={[]} issues={[]} variant="framed" />);

    // Console onboarding state + its connect CTA.
    expect(html).toContain('The Synthesizer verifies every issue');
    expect(html).toContain('Connect a repository');
    expect(html).toContain('/connections');

    // Issue panel's unselected shell — the three placeholder PanelSections.
    expect(html).toContain('Select an issue to load its pull request');
    expect(html).toContain('Repository');
    expect(html).toContain('Review comments');
    expect(html).toContain('The formatted PR — title and description — assembled from the verified findings.');
  });
});

describe('ServicesWorkspace — review panel (real mode)', () => {
  it('renders the selected review with its real PR number, risk tier and finding count', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace
        connected
        reviewGroups={CHAR_REVIEW_GROUPS}
        repositories={['acme/api']}
        containerId="rev-1"
      />,
    );

    expect(html).toContain('Pull request');
    expect(html).toContain('PR #42');
    expect(html).toContain('reviewed ');
    expect(html).toContain('high');

    // Verified findings section — the count comes straight off the review row.
    expect(html).toContain('Verified findings');
    expect(html).toContain('>3<');
    expect(html).toContain('verified');

    // Proposed fix is honestly teased, and the CTA is disabled.
    expect(html).toContain('Proposed fix');
    expect(html).toContain('The Fix workflow lands in the next release');
    expect(html).toContain('open PR');
    expect(html).toContain('Today Kuma posts its verified findings');
  });

  it('renders the review panel prompt when no review is selected', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace connected reviewGroups={CHAR_REVIEW_GROUPS} repositories={['acme/api']} />,
    );

    expect(html).toContain('Select a pull request on the left to see its review');
    // No review selected → none of the panel's PR facts. (The rail still lists
    // "PR #42" as a selectable row, so that string alone proves nothing.)
    expect(html).not.toContain('reviewed ');
    expect(html).not.toContain('Verified findings');
  });
});

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

describe('ServicesWorkspace — work-item inbox', () => {
  it('renders mailbox counts, item rows and the Scan button when the inbox has items', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace
        connected
        reviewGroups={[]}
        repositories={['acme/api']}
        inbox={inboxWith(
          [
            item(),
            item({ id: 'wi-2', kind: 'opportunity', title: 'Batch the N+1 orders query', dimension: 'performance', confidence: 0.7 }),
            item({ id: 'wi-3', kind: 'issue', title: 'Staged token fix', state: 'staged' }),
          ],
          { status: 'complete', finishedAt: '2026-07-17T12:00:00.000Z', error: null },
        )}
      />,
    );

    // open items only drive the badge counts (the staged issue is excluded)
    expect(html).toContain('Issues (1)');
    expect(html).toContain('Opportunities (1)');
    expect(html).toContain('SQL built from raw request input');
    expect(html).toContain('Batch the N+1 orders query');
    expect(html).toContain('security');
    expect(html).toContain('Scan');
    expect(html).not.toContain('No reviews yet.');
    // non-open states surface on the row (state matrix: staged renders)
    expect(html).toContain('staged');
  });

  it('shows the honest populated line for a scanned-clean repo — never blank', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace
        connected
        reviewGroups={[]}
        repositories={['acme/api']}
        inbox={inboxWith([], { status: 'no_findings', finishedAt: '2026-07-17T12:00:00.000Z', error: null })}
      />,
    );

    expect(html).toContain('no issues found');
    expect(html).toContain('Scan');
    // three-state rule: connected_idle is populated, the repo row stays
    expect(html).toContain('acme/api');
  });

  it('surfaces a failed scan with its reason and a retry', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace
        connected
        reviewGroups={[]}
        repositories={['acme/api']}
        inbox={inboxWith([], { status: 'failed', finishedAt: null, error: 'agents /scan responded 503' })}
      />,
    );

    expect(html).toContain('Scan failed');
    expect(html).toContain('agents /scan responded 503');
    expect(html).toContain('retry');
  });

  it('state matrix: an open item offers Fix it / Dismiss; an opportunity offers Implement it', () => {
    const openHtml = renderToStaticMarkup(<WorkItemPanel item={item()} />);
    expect(openHtml).toContain('Fix it');
    expect(openHtml).toContain('Dismiss');

    const oppHtml = renderToStaticMarkup(<WorkItemPanel item={item({ kind: 'opportunity' })} />);
    expect(oppHtml).toContain('Implement it');
  });

  it('state matrix: a fixing item renders its live-stream link; a posted item shows the PR link', () => {
    const fixingHtml = renderToStaticMarkup(
      <WorkItemPanel item={item({ state: 'fixing', containerId: 'cont-7' })} />,
    );
    expect(fixingHtml).toContain('/services?container=cont-7');
    expect(fixingHtml).toContain('Open the live stream');
    // past triage — no triage buttons
    expect(fixingHtml).not.toContain('Fix it');

    const postedHtml = renderToStaticMarkup(
      <WorkItemPanel
        item={item({ state: 'posted', containerId: 'cont-7', prUrl: 'https://github.com/acme/shop/pull/12' })}
      />,
    );
    expect(postedHtml).toContain('https://github.com/acme/shop/pull/12');
    expect(postedHtml).not.toContain('Dismiss');
  });

  // ── The two human gates (Stage 1.1 / 1.2) ─────────────────────────────────
  // Before this, a `fixing` item was a dead end: the approve control was only
  // reachable via a /agents?container= URL nothing generated, and the send
  // control rendered only inside a permanently-false branch. These pin that
  // each gate appears exactly when the CONTAINER's stored state allows the
  // server to honour it — and never otherwise.

  it('gate 1: a fixing item whose container is ready offers Approve solution', () => {
    const html = renderToStaticMarkup(
      <WorkItemPanel item={item({ state: 'fixing', containerId: 'cont-7', containerState: 'ready' })} />,
    );
    expect(html).toContain('Approve solution');
    // Approving is gate 1 only — it must not also offer to post.
    expect(html).not.toContain('Post pull request');
  });

  it('gate 1: a fixing item still composing offers NO gate — the approve route would 409', () => {
    for (const containerState of ['detecting', 'fanning_out', 'verifying', 'composing']) {
      const html = renderToStaticMarkup(
        <WorkItemPanel item={item({ state: 'fixing', containerId: 'cont-7', containerState })} />,
      );
      expect(html).not.toContain('Approve solution');
      expect(html).not.toContain('Post pull request');
      // the honest in-progress affordance is still there
      expect(html).toContain('Open the live stream');
    }
  });

  it('gate 1: an unknown container state offers no gate rather than guessing one', () => {
    const html = renderToStaticMarkup(
      <WorkItemPanel item={item({ state: 'fixing', containerId: 'cont-7', containerState: null })} />,
    );
    expect(html).not.toContain('Approve solution');
    expect(html).not.toContain('Post pull request');
  });

  it('a failed fix run says so and offers no gate', () => {
    const html = renderToStaticMarkup(
      <WorkItemPanel item={item({ state: 'fixing', containerId: 'cont-7', containerState: 'fix_failed' })} />,
    );
    expect(html).toContain('finished without a verified patch');
    expect(html).not.toContain('Approve solution');
    expect(html).not.toContain('Post pull request');
  });

  it('gate 2: a staged item offers Post pull request and no longer offers Approve', () => {
    const html = renderToStaticMarkup(
      <WorkItemPanel item={item({ state: 'staged', containerId: 'cont-7', containerState: 'solution_approved' })} />,
    );
    expect(html).toContain('Post pull request');
    expect(html).not.toContain('Approve solution');
  });

  it('gate 2: a staged item with no container offers nothing — the control could not act', () => {
    const html = renderToStaticMarkup(<WorkItemPanel item={item({ state: 'staged', containerId: null })} />);
    expect(html).not.toContain('Post pull request');
  });

  it('fix-run cooldown: a cooling-down item shows a "retry available in Xm" badge and disables Fix it', () => {
    const html = renderToStaticMarkup(
      <WorkItemPanel item={item({ fixCooldown: { allowed: false, retryAfterSeconds: 296 } })} />,
    );

    expect(html).toContain('retry available in 5m');
    // The Fix it button element itself carries the boolean `disabled` attribute
    // (not just a `disabled:` Tailwind variant class, which every Fix it button
    // has regardless of cooldown state).
    const fixButtonMatch = html.match(/<button[^>]*>[\s\S]*?Fix it[\s\S]*?<\/button>/);
    expect(fixButtonMatch).toBeTruthy();
    expect(fixButtonMatch![0]).toMatch(/\sdisabled(=""|\s|>)/);
  });

  it('fix-run cooldown: a ready item shows no badge and an enabled Fix it action', () => {
    const html = renderToStaticMarkup(<WorkItemPanel item={item()} />);

    expect(html).not.toContain('retry available');
    // Fix it's own button element carries no boolean `disabled` attribute
    // (busy=null, cooldown allowed) — only the always-present `disabled:`
    // Tailwind variant class, which is not the same thing.
    const fixButtonMatch = html.match(/<button[^>]*>[\s\S]*?Fix it[\s\S]*?<\/button>/);
    expect(fixButtonMatch).toBeTruthy();
    expect(fixButtonMatch![0]).not.toMatch(/\sdisabled(=""|\s|>)/);
  });

  it('shows Scanning… while a run is in flight', () => {
    const html = renderToStaticMarkup(
      <ServicesWorkspace
        connected
        reviewGroups={[]}
        repositories={['acme/api']}
        inbox={inboxWith([], { status: 'running', finishedAt: null, error: null })}
      />,
    );

    expect(html).toContain('Scanning');
  });
});
