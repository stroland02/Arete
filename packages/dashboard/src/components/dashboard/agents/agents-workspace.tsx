"use client";

import { useState } from "react";
import { AGENTS } from "./agent-catalog";
import { AgentRail } from "./agent-rail";
import { SynthesizerConsole } from "./synthesizer-console";
import { PrPanel } from "./pr-panel";
import { AgentConfigDrawer } from "./agent-config-drawer";

export interface AgentsWorkspaceProps {
  findingCountById: Record<string, number>;
  totalFindings: number;
  hasReviews: boolean;
  latestReview?: {
    repoFullName: string;
    prNumber: number;
    riskLevel: string;
  } | null;
}

/**
 * The Orca-style 3-pane workspace behind /agents: agents rail (left),
 * Synthesizer console shell (center), pull-request panel (right). One glass
 * panel, thin internal separators, each pane independently scrollable.
 * Owns which agent is selected (drives the console's focus) and which
 * agent's config drawer is open (reuses the existing AgentConfigDrawer).
 */
export function AgentsWorkspace({
  findingCountById,
  totalFindings,
  hasReviews,
  latestReview = null,
}: AgentsWorkspaceProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENTS[0].id);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);

  const selectedAgent = AGENTS.find((a) => a.id === selectedAgentId) ?? AGENTS[0];
  const configAgent = AGENTS.find((a) => a.id === configAgentId) ?? null;

  return (
    <>
      <div className="glass-panel flex min-h-[540px] flex-col divide-y divide-border-subtle overflow-hidden lg:grid lg:h-[calc(100vh-8.5rem)] lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:divide-x lg:divide-y-0">
        <AgentRail
          findingCountById={findingCountById}
          hasReviews={hasReviews}
          selectedAgentId={selectedAgentId}
          onSelect={setSelectedAgentId}
          onConfigure={setConfigAgentId}
        />
        <SynthesizerConsole
          hasReviews={hasReviews}
          totalFindings={totalFindings}
          selectedAgentLabel={selectedAgent.label}
          selectedAgentFindings={findingCountById[selectedAgent.id] ?? 0}
        />
        <PrPanel
          hasReviews={hasReviews}
          latestReview={latestReview}
          totalFindings={totalFindings}
        />
      </div>

      <AgentConfigDrawer
        agent={configAgent}
        findingCount={configAgent ? (findingCountById[configAgent.id] ?? 0) : 0}
        onClose={() => setConfigAgentId(null)}
      />
    </>
  );
}
