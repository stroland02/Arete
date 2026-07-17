// Task ledger + proactive lane-conflict detection — our differentiator. No
// inspected tool (Conductor, vibe-kanban, claude-squad, uzi, Orca) detects lane
// overlap before work starts; they rely on worktree isolation + git surfacing
// conflicts at merge time. Here we flag overlapping declared lanes among
// *concurrently active* tasks up front. Kanban states follow ECC's
// team-agent-orchestration vocabulary.

import type { StatusPhase } from "./status.js";

export type KanbanState =
  | "backlog"
  | "ready"
  | "running"
  | "review"
  | "blocked"
  | "merged"
  | "archived";

export interface Lane {
  /** package roots this task owns, e.g. "packages/dashboard" */
  packages: string[];
  /** file globs this task owns, e.g. "packages/agents/src/**" */
  globs: string[];
}

export interface TaskEntry {
  id: string;
  title: string;
  owner: string; // worker id
  lane: Lane;
  state: KanbanState;
  phase: StatusPhase | null;
  dependsOn: string[]; // task ids
  evidence?: string;
}

export interface LaneConflict {
  a: string;
  b: string;
  overlap: { packages: string[]; globs: string[] };
}

const ACTIVE_STATES: KanbanState[] = ["running", "review", "blocked"];

export function activeTasks(entries: TaskEntry[]): TaskEntry[] {
  return entries.filter((t) => ACTIVE_STATES.includes(t.state));
}

/** Strip trailing wildcard/slash to get the directory prefix a glob owns. */
function globPrefix(glob: string): string {
  return glob.replace(/\*+$/, "").replace(/\/+$/, "");
}

function globsOverlap(a: string, b: string): boolean {
  const pa = globPrefix(a);
  const pb = globPrefix(b);
  if (pa === "" || pb === "") return true; // a root glob owns everything
  if (pa === pb) return true;
  return pa.startsWith(pb + "/") || pb.startsWith(pa + "/");
}

export function detectLaneConflicts(entries: TaskEntry[]): LaneConflict[] {
  const active = activeTasks(entries);
  const conflicts: LaneConflict[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const packages = a.lane.packages.filter((p) => b.lane.packages.includes(p));
      const globs: string[] = [];
      for (const ga of a.lane.globs) {
        for (const gb of b.lane.globs) {
          if (globsOverlap(ga, gb)) globs.push(ga === gb ? ga : `${ga} ∩ ${gb}`);
        }
      }
      if (packages.length > 0 || globs.length > 0) {
        conflicts.push({ a: a.id, b: b.id, overlap: { packages, globs } });
      }
    }
  }
  return conflicts;
}

/** A task can be claimed only when it is `ready` and every dependency is `merged`. */
export function claimable(entries: TaskEntry[], id: string): boolean {
  const byId = new Map(entries.map((t) => [t.id, t]));
  const task = byId.get(id);
  if (!task || task.state !== "ready") return false;
  return task.dependsOn.every((d) => byId.get(d)?.state === "merged");
}
