import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentOrchestrationGraph } from './agent-orchestration-graph';

// Renders the real component across the data states it must handle without
// fabricating anything: zero data, real per-agent counts, the CI-diagnostics
// alt path, and connected telemetry sources. Proves each of the 6 real agent
// categories (matching packages/agents/src/arete_agents/agents/*.py's
// agent_name values exactly) render without a runtime error, and that no
// telemetry edge appears when nothing is connected.
describe('AgentOrchestrationGraph', () => {
  it('renders an idle state with no fabricated activity when there is no data yet', () => {
    const html = renderToStaticMarkup(
      <AgentOrchestrationGraph totalPrs={0} commentsByCategory={[]} telemetryProviders={[]} />
    );

    expect(html).toContain('no reviews yet');
    expect(html).toContain('Security');
    expect(html).toContain('Business Logic');
    // The old fabricated nodes must never reappear.
    expect(html).not.toContain('Monitoring');
    expect(html).not.toContain('Analytics');
    expect(html).not.toContain('Human Review Gate');
  });

  it('renders real per-agent counts and the honest "posted to PR" outcome', () => {
    const html = renderToStaticMarkup(
      <AgentOrchestrationGraph
        totalPrs={12}
        commentsByCategory={[
          { category: 'security', count: 5 },
          { category: 'performance', count: 2 },
          { category: 'quality', count: 1 },
          { category: 'test_coverage', count: 1 },
          { category: 'deployment_safety', count: 0 },
          { category: 'business_logic', count: 3 },
        ]}
        telemetryProviders={[]}
      />
    );

    expect(html).toContain('12 recent finding');
    expect(html).toContain('Posted to PR');
    expect(html).not.toContain('ci_diagnostics');
  });

  it('renders the CI Diagnostics node only when the data actually contains it', () => {
    const html = renderToStaticMarkup(
      <AgentOrchestrationGraph
        totalPrs={1}
        commentsByCategory={[{ category: 'ci_diagnostics', count: 2 }]}
        telemetryProviders={[]}
      />
    );

    expect(html).toContain('CI Diagnostics');
  });

  it('renders the telemetry-sources cluster only when a provider is actually connected', () => {
    // TooltipContent is Radix-portaled and never appears in static SSR
    // markup, so this asserts on the always-rendered plug icon instead —
    // the real structural signal that the telemetry cluster mounted at all.
    const withoutTelemetry = renderToStaticMarkup(
      <AgentOrchestrationGraph totalPrs={3} commentsByCategory={[]} telemetryProviders={[]} />
    );
    const withTelemetry = renderToStaticMarkup(
      <AgentOrchestrationGraph totalPrs={3} commentsByCategory={[]} telemetryProviders={['sentry', 'vercel']} />
    );

    expect(withoutTelemetry).not.toContain('tabler-icon-plug-connected');
    expect(withTelemetry).toContain('tabler-icon-plug-connected');
  });
});
