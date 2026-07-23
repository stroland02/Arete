/**
 * Stage 1.4 — what the noise control OFFERS in each state.
 *
 * The load-bearing assertion is the negative one: a machine-owned state
 * (UNDER_OBSERVATION / ESCALATED) is rendered as a label plus the ordinary
 * silence affordance, and never as a button that would let a human assert the
 * machine's own verdict. The route refuses those states; this pins that the UI
 * never asks for them either.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The control calls router.refresh() after a successful write; a stub keeps
// this a pure render test.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { FindingNoiseControl } from './finding-noise-control';

const render = (noiseState: string) =>
  renderToStaticMarkup(<FindingNoiseControl findingId="comment-1" noiseState={noiseState} />);

describe('FindingNoiseControl', () => {
  it('offers "Silence" for an open finding', () => {
    const html = render('OPEN');

    expect(html).toContain('Silence');
    expect(html).not.toContain('Restore');
    expect(html).toContain('Silence this finding as noise');
  });

  it('offers "Restore" for a silenced finding — the un-silence half of the loop', () => {
    const html = render('SILENCED');

    expect(html).toContain('Restore');
    expect(html).toContain('Restore this finding');
  });

  it('labels an escalated finding with what the machine decided, and still offers silence', () => {
    const html = render('ESCALATED');

    expect(html).toContain('Escalated');
    // The human answer to "this keeps recurring" is allowed to be "it is noise".
    expect(html).toContain('Silence');
  });

  it('labels an observed finding without offering the observation as a choice', () => {
    const html = render('UNDER_OBSERVATION');

    expect(html).toContain('Watching for recurrence');
    expect(html).not.toContain('Under observation</button>');
  });

  it('renders no machine label for a plain open finding', () => {
    const html = render('OPEN');

    expect(html).not.toContain('Watching for recurrence');
    expect(html).not.toContain('Escalated');
  });
});
