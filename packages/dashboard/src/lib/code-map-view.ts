import type { NodeSensors } from './sensors';

export type CodeMapFilter = 'all' | 'findings' | 'active';

/** Which nodes render at full opacity under the map's filter chips. */
export function nodeVisible(sensors: NodeSensors | undefined, filter: CodeMapFilter): boolean {
  if (filter === 'findings') return Boolean(sensors?.pain);
  if (filter === 'active') return Boolean(sensors?.activity);
  return true;
}

/** Case-insensitive label/path match for the jump-to-file search. */
export function matchesSearch(label: string, path: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q) || (path ?? '').toLowerCase().includes(q);
}
