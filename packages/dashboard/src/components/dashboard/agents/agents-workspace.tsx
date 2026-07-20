"use client";

import { useState } from "react";
import { AGENTS } from "./agent-catalog";
import { AgentRail } from "./agent-rail";
import { AgentConversation } from "./agent-conversation";
import { PrPanel } from "./pr-panel";
import { AgentConfigDrawer } from "./agent-config-drawer";
import type { AgentActivityFinding } from "@/lib/queries";
import type { ActiveModelConnection } from "@/lib/model-connections-map";

export interface AgentsWorkspaceProps {
  findingCountById: Record<string, number>;
  totalFindings: number;
  hasReviews: boolean;
  /** Recent findings across all agents; the workspace slices per selected agent.
      Optional (defaults to none) so the marketing preview can render without it. */
  activity?: AgentActivityFinding[];
  latestReview?: {
    repoFullName: string;
    prNumber: number;
    riskLevel: string;
  } | null;
  /**
   * Focused container from the Services→Agents deep-link (?container=). Retained
   * in the contract so the deep-link keeps type-checking; the center pane is now
   * the selected agent's own conversation, and the account-level Synthesizer
   * transcript lives on /services.
   */
  containerId?: string | null;
  /** Whether a repository is connected (installations present). */
  connected?: boolean;
  /** Whether an AI model is connected — the agents' real dependency. */
  modelConnected?: boolean;
  /** The connected model every agent runs on (dynamic; replaces the old
      hardcoded Opus/Sonnet tier). Null when no model is connected. */
  activeModel?: ActiveModelConnection | null;
}

/**
 * The Orca-style 3-pane workspace behind /agents: agents rail (left), the
 * selected agent's own conversation (center), pull-request panel (right).
 * Selecting an agent in the rail drives the center pane; the rail gear opens
 * its config drawer. The account-level Synthesizer now lives on /services.
 */
export function AgentsWorkspace({
  findingCountById,
  totalFindings,
  hasReviews,
  activity = [],
  latestReview = null,
  containerId = null,
  connected = false,
  modelConnected = false,
  activeModel = null,
}: AgentsWorkspaceProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENTS[0].id);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);

  const selectedAgent = AGENTS.find((a) => a.id === selectedAgentId) ?? AGENTS[0];
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
          activeModel={activeModel}
        />
        <AgentConversation
          key={`${selectedAgent.id}:${containerId ?? "general"}`}
          agent={selectedAgent}
          findings={selectedAgentFindings}
          findingCount={findingCountById[selectedAgent.id] ?? 0}
          hasReviews={hasReviews}
          repoConnected={connected}
          modelConnected={modelConnected}
          activeModel={activeModel}
          containerId={containerId}
          onConfigure={setConfigAgentId}
        />
        <PrPanel
          hasReviews={hasReviews}
          latestReview={latestReview}
          totalFindings={totalFindings}
          containerId={containerId}
        />
      </div>

      <AgentConfigDrawer
        agent={configAgent}
        findingCount={configAgent ? (findingCountById[configAgent.id] ?? 0) : 0}
        activeModel={activeModel}
        onClose={() => setConfigAgentId(null)}
      />
    </>
  );
}
