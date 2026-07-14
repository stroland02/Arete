import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentRail } from './agent-rail';

const noop = () => {};

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
});
