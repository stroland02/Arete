export type TriageStatus = "awaiting" | "in_flight" | "blocked" | "clear";
export interface TriageCounts { awaiting: number; inFlight: number; blocked: number }

/**
 * A work item's triage status, decided by its CONTAINER's real state wherever
 * that is known — deliberately the same rule `WorkItemPanel` uses to choose
 * which human gate to offer, so the counter can never contradict the buttons
 * on the same screen. An unknown container state counts as in-flight, never as
 * awaiting: claiming a decision is waiting when no control can act on it is
 * the same fabrication as rendering the control itself.
 */
export function workItemTriageStatus(item: {
  state: string;
  containerId?: string | null;
  containerState?: string | null;
}): TriageStatus {
  if (item.state === "staged") return item.containerId ? "awaiting" : "clear";
  if (item.state !== "fixing") return "clear";
  if (item.containerState === "ready") return "awaiting";
  if (item.containerState === "fix_failed") return "blocked";
  return "in_flight";
}

/** Pure tally of what needs the human. `clear` items contribute to none. */
export function deriveTriage(items: Array<{ status: TriageStatus }>): TriageCounts {
  const counts: TriageCounts = { awaiting: 0, inFlight: 0, blocked: 0 };
  for (const { status } of items) {
    if (status === "awaiting") counts.awaiting++;
    else if (status === "in_flight") counts.inFlight++;
    else if (status === "blocked") counts.blocked++;
  }
  return counts;
}
