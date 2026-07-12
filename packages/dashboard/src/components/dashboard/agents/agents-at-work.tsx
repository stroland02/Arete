"use client";

import { useState } from "react";
import { AGENTS, type Agent } from "./agent-catalog";
import { AgentCard } from "./agent-card";
import { AgentConfigDrawer } from "./agent-config-drawer";
import { SynthesizerHourglass } from "./synthesizer-hourglass";
import { PrOutcomePanel } from "./pr-outcome";

export interface AgentsAtWorkProps {
  /**
   * Defaults to the full catalog. Optional (rather than required as in an
   * earlier draft) because icons are component functions and can't cross the
   * server→client boundary — the server page just omits it.
   */
  agents?: Agent[];
  findingCountById: Record<string, number>;
  totalFindings: number;
  hasReviews: boolean;
}

/**
 * The "Agents at work" section: a uniform 2×3 grid of specialist cards →
 * the Synthesizer hourglass (project manager) → the PR outcome panel.
 * Clicking a card opens the right-side config drawer. All status text is
 * derived from real review data; nothing streams and nothing is fabricated.
 */
export function AgentsAtWork({
  agents = AGENTS,
  findingCountById,
  totalFindings,
  hasReviews,
}: AgentsAtWorkProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  return (
    <div>
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)_minmax(0,4fr)]">
        {/* ① The six specialists — uniform cards, symmetric 2×3 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              findingCount={findingCountById[agent.id] ?? 0}
              hasReviews={hasReviews}
              onOpen={setSelectedAgentId}
            />
          ))}
        </div>

        {/* ② The project manager */}
        <SynthesizerHourglass totalFindings={totalFindings} hasReviews={hasReviews} />

        {/* ③ The PR/merge phase */}
        <PrOutcomePanel hasReviews={hasReviews} />
      </div>

      <AgentConfigDrawer
        agent={selectedAgent}
        findingCount={selectedAgent ? (findingCountById[selectedAgent.id] ?? 0) : 0}
        onClose={() => setSelectedAgentId(null)}
      />
    </div>
  );
}
