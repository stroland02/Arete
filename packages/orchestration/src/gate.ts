// Integration-gate model. Deterministic transitions mirror merge-queue mechanics
// (test a batch, then either merge or block/evict). The load-bearing rule, from
// both MAST category 3 and the team-workflow "human merges" policy: only a HUMAN
// approval can move verified → merged. No agent message is consent.

import type { Role } from "./roles.js";

export type GateState = "pending" | "verifying" | "verified" | "blocked" | "merged";

export interface GateBatch {
  taskIds: string[];
  state: GateState;
}

export interface Approval {
  by: string;
  role: Role;
  human: boolean;
}

export function beginVerify(batch: GateBatch): GateBatch {
  return { ...batch, state: "verifying" };
}

export function recordResult(batch: GateBatch, allGreen: boolean): GateBatch {
  return { ...batch, state: allGreen ? "verified" : "blocked" };
}

export function merge(
  batch: GateBatch,
  approval: Approval,
): GateBatch | { ok: false; reason: string } {
  if (batch.state !== "verified") {
    return { ok: false, reason: `cannot merge from "${batch.state}"; must be "verified"` };
  }
  if (!approval.human) {
    return { ok: false, reason: "no agent message is consent — only a human approval merges" };
  }
  return { ...batch, state: "merged" };
}
