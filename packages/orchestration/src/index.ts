// @arete/orchestration — pure, framework-agnostic model of Kuma's star-topology
// work floor: typed roles, the status contract as a state machine, a task ledger
// with lane-conflict detection, the integration-gate model, and a star-topology
// message contract, plus a pluggable driver seam. Types + pure functions only;
// no runtime/IO. See docs/superpowers/specs/2026-07-15-orchestration-substrate-design.md.

export * from "./roles.js";
export * from "./status.js";
export * from "./ledger.js";
export * from "./gate.js";
export * from "./messages.js";
export * from "./driver.js";
