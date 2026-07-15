import type { Topology } from '@arete/topology';

// Sensor overlays are joined onto the (structure-only) code Topology here, on
// the dashboard — never inside codeGraphProvider. Findings/activity are matched
// to nodes by file path (the code graph's File nodes carry meta.path); untested
// and dead ride along from the graph export where available.

const SEV_RANK = { error: 3, warning: 2, info: 1 } as const;
type Sev = keyof typeof SEV_RANK;

export interface FindingLike {
  path: string;
  line: number;
  severity: string;
  category: string;
  body: string;
}
export interface ActivityLike {
  path?: string;
  agentName?: string;
}
export interface NodeSensors {
  pain?: { count: number; maxSeverity: Sev };
  activity?: { agent: string };
  untested?: boolean;
  dead?: boolean;
}

export function joinSensors(
  topology: Topology,
  sources: { findings: FindingLike[]; activity: ActivityLike[] },
): Record<string, NodeSensors> {
  // path -> node ids (a path can back more than one node, e.g. File + its funcs)
  const byPath = new Map<string, string[]>();
  for (const n of topology.nodes) {
    const p = n.meta?.path as string | undefined;
    if (!p) continue;
    byPath.set(p, [...(byPath.get(p) ?? []), n.id]);
  }

  const out: Record<string, NodeSensors> = {};
  for (const n of topology.nodes) {
    out[n.id] = {
      untested: (n.meta?.untested as boolean) || undefined,
      dead: (n.meta?.dead as boolean) || undefined,
    };
  }

  for (const f of sources.findings) {
    for (const id of byPath.get(f.path) ?? []) {
      const sev = (f.severity in SEV_RANK ? f.severity : 'info') as Sev;
      const cur = out[id].pain;
      out[id].pain = cur
        ? { count: cur.count + 1, maxSeverity: SEV_RANK[sev] > SEV_RANK[cur.maxSeverity] ? sev : cur.maxSeverity }
        : { count: 1, maxSeverity: sev };
    }
  }

  for (const a of sources.activity) {
    if (!a.path || !a.agentName) continue;
    for (const id of byPath.get(a.path) ?? []) out[id].activity = { agent: a.agentName };
  }

  return out;
}
