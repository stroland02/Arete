export type TriageStatus = "awaiting" | "in_flight" | "blocked" | "clear";
export interface TriageCounts { awaiting: number; inFlight: number; blocked: number }

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
