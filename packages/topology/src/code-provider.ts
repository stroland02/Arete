import {
  type Topology,
  type TopologyNode,
  type TopologyEdge,
  emptyTopology,
  edgeId,
} from './topology.js'

// TS mirror of the agents-side GraphExport JSON (see
// packages/agents/.../context_map/graph_export.py and the /context-map/graph
// endpoint). Node `source`/`target` on edges are NODE IDS (not provenance).
export interface CodeGraphNode {
  id: string
  kind: string
  name: string
  path?: string | null
  qualifiedName?: string | null
  degree?: number
  untested?: boolean
  dead?: boolean
}
export interface CodeGraphEdge {
  source: string // source node id
  target: string // target node id
  kind: string
}
export interface CodeGraphExport {
  project: string
  generatedAt: string
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
}

/**
 * Translate a codebase-memory-mcp GraphExport into a domain-agnostic Topology.
 * Pure: same input → same output, never throws (an empty/garbage export yields
 * an empty topology). Structure only — sensor overlays (pain/activity/…) are
 * applied later on the dashboard via joinSensors, NOT here. Every node's
 * `status` is left 'unknown'; the dashboard derives visual status from sensors.
 *
 * Note on field names: the code-graph edge carries node ids in `source`/`target`,
 * but a TopologyEdge links nodes via `from`/`to` and reserves `source` for
 * PROVENANCE (EdgeSource). We therefore map ids → from/to and stamp
 * `source: 'code'` on every edge.
 */
export function codeGraphProvider(exp: CodeGraphExport): Topology {
  const t = emptyTopology()

  t.nodes = (exp?.nodes ?? []).map<TopologyNode>((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.name,
    provider: 'code',
    status: 'unknown',
    meta: {
      path: n.path ?? undefined,
      qualifiedName: n.qualifiedName ?? undefined,
      degree: n.degree ?? 0,
      untested: n.untested ?? false,
      dead: n.dead ?? false,
    },
  }))

  const ids = new Set(t.nodes.map((n) => n.id))
  t.edges = (exp?.edges ?? [])
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map<TopologyEdge>((e) => ({
      id: edgeId(e.source, e.target, e.kind),
      from: e.source,
      to: e.target,
      kind: e.kind,
      source: 'code',
    }))

  return t
}
