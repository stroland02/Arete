// The PM-distributor's output: an initial analysis + typed assignments. Each
// assignment becomes a `ready` TaskEntry in the existing ledger, so lane-conflict
// detection and claimable() apply unchanged (design §2.3).

import type { Lane, TaskEntry } from "./ledger.js";
import type { Specialty } from "./specialty.js";

export interface Assignment {
  specialty: Specialty;
  taskId: string;
  title: string;
  owner: string; // worker id
  dependsOn: string[]; // task ids
  lane: Lane;
}

export interface DispatchPlan {
  problemId: string;
  analysis: string;
  assignments: Assignment[];
}

export function planToTasks(plan: DispatchPlan): TaskEntry[] {
  return plan.assignments.map((a) => ({
    id: a.taskId,
    title: a.title,
    owner: a.owner,
    lane: a.lane,
    state: "ready",
    phase: null,
    dependsOn: a.dependsOn,
  }));
}
