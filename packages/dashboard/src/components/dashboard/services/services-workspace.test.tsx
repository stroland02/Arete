import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServicesWorkspace, WorkItemPanel } from './services-workspace';
import type { InboxView } from '@/lib/work-items';

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
    fixError: null,
    ...overrides,
  };
}

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

  it('state matrix: an open item with a failed fix shows the honest reason and still offers Fix it (retry)', () => {
    const html = renderToStaticMarkup(
      <WorkItemPanel item={item({ fixError: 'verification failed: issue still present' })} />,
    );
    expect(html).toContain('Fix failed');
    expect(html).toContain('verification failed: issue still present');
    expect(html).toContain('Fix it');
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
