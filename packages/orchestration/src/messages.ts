// Star-topology message contract. A typed envelope + a `route` function that
// enforces the star invariant: every message has a hub (orchestrator/integrator)
// on at least one end. Worker↔worker (peer-to-peer) is rejected — the primitive
// that keeps the fleet auditable and shrinks the MAST "inter-agent misalignment"
// surface. The envelope carries traceId/phase/laneClaims/cost so any transport
// (human relay, Claude Agent SDK mailbox, or a queue) can carry the same shape.

import type { Role } from "./roles.js";
import type { StatusPhase } from "./status.js";
import type { Lane } from "./ledger.js";
import type { Specialty } from "./specialty.js";

export interface Party {
  role: Role;
  id: string;
}

export type MessageKind =
  | "dispatch"
  | "status"
  | "blocker"
  | "gate-request"
  | "gate-result"
  | "handoff"
  | "qa-result";

export interface Envelope {
  id: string;
  traceId: string;
  from: Party;
  to: Party;
  kind: MessageKind;
  phase?: StatusPhase;
  laneClaims?: Lane;
  /** the sender's discipline, when it is a specialist worker (design §3.1) */
  specialty?: Specialty;
  cost?: { tokens: number };
  body: string;
}

export type RouteResult = { ok: true } | { ok: false; violation: string };

export const HUB_ROLES: readonly Role[] = ["orchestrator", "integrator"];

function isHub(role: Role): boolean {
  return HUB_ROLES.includes(role);
}

export function route(env: Envelope): RouteResult {
  if (!isHub(env.from.role) && !isHub(env.to.role)) {
    return {
      ok: false,
      violation: `star invariant: ${env.from.role} -> ${env.to.role} is peer-to-peer`,
    };
  }
  return { ok: true };
}
