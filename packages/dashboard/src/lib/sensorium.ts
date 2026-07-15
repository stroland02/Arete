import { codeGraphProvider, type Topology } from '@arete/topology';
import type { PrismaClient } from '@arete/db';
import { fetchCodeGraph } from './context-map-client';
import { joinSensors, type NodeSensors } from './sensors';
import {
  getFindingsByPath,
  getAgentActivity,
  getAgentEventsPerMinute,
  type AgentEventData,
} from './queries';

export type SensoriumViewModel =
  | { hasAccess: false }
  | {
      hasAccess: true;
      available: boolean;
      reason?: string;
      topology?: Topology;
      sensors?: Record<string, NodeSensors>;
      pulse: AgentEventData[];
    };

/**
 * Turn a category (the specialist agent that produced a finding) into that
 * agent's display name — mirrors the label mapping the Agents workspace /
 * agent-run-explorer already use ("security" -> "Security Agent"). Keeps the
 * *activity* sensor honestly grounded in real ReviewComment categories.
 */
function agentLabel(category: string): string {
  return (
    category
      .split('_')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ') + ' Agent'
  );
}

/**
 * Assemble the /overview Sensorium view-model for the caller's authorized
 * installations. v1 maps the FIRST authorized installation (one code graph per
 * view). Returns the *un-laid-out* Topology on purpose: layout (layoutTopology)
 * produces a positions Map that doesn't serialize across the RSC→client
 * boundary, so SensoriumMap lays it out client-side, exactly as
 * agent-run-explorer.tsx does.
 *
 * Every branch is honest: no authorized installation => no access; nothing
 * indexed / fetch failed => available:false with a reason (never a fake graph);
 * ClickHouse pulse and DB findings/activity each fail soft to empty so a single
 * degraded source never blanks the whole map.
 */
export async function getSensoriumViewModel(
  db: PrismaClient,
  installationIds: string[],
  deps: { fetchGraph?: typeof fetchCodeGraph } = {},
): Promise<SensoriumViewModel> {
  if (installationIds.length === 0) return { hasAccess: false };
  const fetchGraph = deps.fetchGraph ?? fetchCodeGraph;

  const graph = await fetchGraph(Number(installationIds[0]));
  const pulse = await getAgentEventsPerMinute(installationIds).catch(
    () => [] as AgentEventData[],
  );

  if (!graph) {
    return {
      hasAccess: true,
      available: false,
      reason: 'Your code map builds after your first review.',
      pulse,
    };
  }

  const topology = codeGraphProvider(graph);
  const [findings, activity] = await Promise.all([
    getFindingsByPath(db, installationIds),
    getAgentActivity(db, installationIds).catch(() => []),
  ]);
  const sensors = joinSensors(topology, {
    findings,
    activity: activity.map((a) => ({ path: a.path, agentName: agentLabel(a.category) })),
  });

  return { hasAccess: true, available: true, topology, sensors, pulse };
}
