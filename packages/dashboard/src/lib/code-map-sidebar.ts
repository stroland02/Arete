// Pure view-model for the code map's detail sidebar (Health / Contents /
// Dependencies / Activity). All joins happen here so the drawer component is
// a dumb renderer and every rule is unit-testable. Spec:
// docs/superpowers/specs/2026-07-17-code-map-v2-design.md
import type { Topology } from '@arete/topology';
import { buildFileAdjacency, folderOfPath } from '@arete/topology';
import type { FindingLike, NodeSensors } from './sensors';

export type CodeMapSelection = { kind: 'file' | 'folder'; id: string };

export interface DepRow {
  id: string;
  label: string;
  path?: string;
}

export interface SidebarModel {
  kind: 'file' | 'folder';
  title: string;
  subtitle?: string;
  health: { count: number; maxSeverity?: 'error' | 'warning' | 'info'; rows: FindingLike[] };
  contents: Array<{ id: string; label: string; kind: string; findingCount: number }>;
  dependencies: { imports: DepRow[]; importedBy: DepRow[] };
  activity: string[];
}

const SEV_RANK = { error: 3, warning: 2, info: 1 } as const;
type Sev = keyof typeof SEV_RANK;

function maxSeverity(rows: FindingLike[]): Sev | undefined {
  let max: Sev | undefined;
  for (const r of rows) {
    const sev = (r.severity in SEV_RANK ? r.severity : 'info') as Sev;
    if (!max || SEV_RANK[sev] > SEV_RANK[max]) max = sev;
  }
  return max;
}

/** `{ count, rows }` with maxSeverity only when there ARE findings (tests use toEqual). */
function toHealth(rows: FindingLike[]): SidebarModel['health'] {
  const max = maxSeverity(rows);
  return { count: rows.length, ...(max ? { maxSeverity: max } : {}), rows };
}

function toDepRows(ids: string[], topology: Topology): DepRow[] {
  const byId = new Map(topology.nodes.map((n) => [n.id, n]));
  return ids
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => n != null)
    .map((n) => ({ id: n.id, label: n.label, path: n.meta?.path as string | undefined }));
}

export function buildSidebarModel(
  topology: Topology,
  sensors: Record<string, NodeSensors>,
  findings: FindingLike[],
  selection: CodeMapSelection,
): SidebarModel | null {
  const adjacency = buildFileAdjacency(topology);

  if (selection.kind === 'file') {
    const node = topology.nodes.find((n) => n.id === selection.id && n.kind === 'File');
    if (!node) return null;
    const path = node.meta?.path as string | undefined;

    const rows = path ? findings.filter((f) => f.path === path) : [];
    const children = topology.nodes.filter(
      (n) => n.id !== node.id && n.kind !== 'File' && (n.meta?.path as string | undefined) === path,
    );
    const adj = adjacency.get(node.id) ?? { imports: [], importedBy: [] };
    const agent = sensors[node.id]?.activity?.agent;

    return {
      kind: 'file',
      title: node.label,
      subtitle: path,
      health: toHealth(rows),
      contents: children.map((c) => ({ id: c.id, label: c.label, kind: String(c.kind), findingCount: 0 })),
      dependencies: { imports: toDepRows(adj.imports, topology), importedBy: toDepRows(adj.importedBy, topology) },
      activity: agent ? [agent] : [],
    };
  }

  // Folder selection: roll up across member files.
  const members = topology.nodes.filter(
    (n) =>
      n.kind === 'File' &&
      typeof n.meta?.path === 'string' &&
      folderOfPath(n.meta.path as string) === selection.id,
  );
  if (members.length === 0) return null;
  const memberIds = new Set(members.map((m) => m.id));

  const rows = findings.filter((f) => folderOfPath(f.path) === selection.id);
  const perFileCount = (path: string | undefined) =>
    path ? findings.filter((f) => f.path === path).length : 0;

  const imports = new Set<string>();
  const importedBy = new Set<string>();
  for (const m of members) {
    const adj = adjacency.get(m.id);
    for (const id of adj?.imports ?? []) if (!memberIds.has(id)) imports.add(id);
    for (const id of adj?.importedBy ?? []) if (!memberIds.has(id)) importedBy.add(id);
  }

  const activity = [
    ...new Set(members.map((m) => sensors[m.id]?.activity?.agent).filter((a): a is string => Boolean(a))),
  ];

  return {
    kind: 'folder',
    title: selection.id,
    subtitle: `${members.length} file${members.length === 1 ? '' : 's'}`,
    health: toHealth(rows),
    contents: [...members]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((m) => ({
        id: m.id,
        label: m.label,
        kind: 'File',
        findingCount: perFileCount(m.meta?.path as string | undefined),
      })),
    dependencies: {
      imports: toDepRows([...imports].sort(), topology),
      importedBy: toDepRows([...importedBy].sort(), topology),
    },
    activity,
  };
}
