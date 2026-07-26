// Typed roles for the star-topology work floor. Grounded in Factory's
// orchestrator/worker/validator split and our PM/Integrator model: the product
// may separate the Integrator from the Orchestrator even though a single human
// PM currently plays both, so all three are first-class.

export type Role = "orchestrator" | "worker" | "integrator";

export interface RoleCapabilities {
  /** assign tasks to workers */
  canDispatch: boolean;
  /** emit status reports */
  canReport: boolean;
  /** approve/verify at the integration gate */
  canGate: boolean;
}

export const ROLE_CAPABILITIES: Record<Role, RoleCapabilities> = {
  orchestrator: { canDispatch: true, canReport: false, canGate: true },
  worker: { canDispatch: false, canReport: true, canGate: false },
  integrator: { canDispatch: false, canReport: true, canGate: true },
};

export function can(role: Role, capability: keyof RoleCapabilities): boolean {
  return ROLE_CAPABILITIES[role][capability];
}
