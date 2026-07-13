"use client";

import { useState } from "react";
import { AGENTS } from "./agent-catalog";
import { AgentRail } from "./agent-rail";
import { AgentConversation } from "./agent-conversation";
import type { AgentActivityFinding } from "@/lib/queries";
import { PrPanel } from "./pr-panel";
import { AgentConfigDrawer } from "./agent-config-drawer";

export interface AgentsWorkspaceProps {
  findingCountById: Record<string, number>;
  totalFindings: number;
  hasReviews: boolean;
  activity: AgentActivityFinding[];
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
  activity,
  latestReview = null,
}: AgentsWorkspaceProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENTS[0].id);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);

  const configAgent = AGENTS.find((a) => a.id === configAgentId) ?? null;
  const selectedAgentFindings = activity.filter((f) => f.category === selectedAgent.id);

  return (
    <>
      {/* Full-bleed: cancel the shell's p-8 and drop the card framing so this
          reads as the actual interface built into the page, not a floating
          card. A top border separates it from the Topbar; panes divide with
          thin internal separators. */}
      <div className="-m-8 flex min-h-[540px] flex-col divide-y divide-border-subtle border-t border-border-subtle bg-surface-1/20 overflow-hidden lg:grid lg:h-[calc(100vh-4.5rem)] lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:divide-x lg:divide-y-0">
        <AgentRail
          findingCountById={findingCountById}
          hasReviews={hasReviews}
          selectedAgentId={selectedAgentId}
          onSelect={setSelectedAgentId}
          onConfigure={setConfigAgentId}
        />
        {/* Center pane streams the focused container's Synthesizer transcript.
            No deep-link param yet → null shows the onboarding + sample opt-in. */}
        <SynthesizerConsole containerId={null} />
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
