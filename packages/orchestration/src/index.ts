// @arete/orchestration — pure, framework-agnostic model of Kuma's star-topology
// work floor: typed roles, the status contract as a state machine, a task ledger
// with lane-conflict detection, the integration-gate model, and a star-topology
// message contract, plus a pluggable driver seam. Types + pure functions only;
// no runtime/IO. See docs/superpowers/specs/2026-07-15-orchestration-substrate-design.md.

export * from "./roles.js";
// status.js also exports a `StatusReport` (the HUMAN fleet's status contract).
// The tiered-comms specialist StatusReport (status-report.js) is the canonical
// barrel `StatusReport`; the fleet one is re-exported as FleetStatusReport to
// avoid the name clash. status.js itself is untouched (its own tests import it
// directly), and nothing consumes the fleet StatusReport through this barrel.
export { transition, TERMINAL_PHASE } from "./status.js";
export type { StatusPhase, Verification, TransitionResult, StatusReport as FleetStatusReport } from "./status.js";
export * from "./ledger.js";
export * from "./gate.js";
export * from "./messages.js";
export * from "./driver.js";
export * from "./specialty.js";
export * from "./dispatch.js";
export * from "./qa.js";
export * from "./transcript.js";
export * from "./status-report.js";
export * from "./escalation.js";
