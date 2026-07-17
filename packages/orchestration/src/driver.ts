// The driver seam. A backend implements `OrchestrationDriver` to actually carry
// dispatch/messages; the model above never changes, only the transport — exactly
// how A2A separates its data model from transport bindings, and how
// @arete/topology separates its model from any renderer.
//
// `InMemoryDriver` is the reference implementation used by tests and local runs.
// DEFERRED (documented, NOT built this round): `ClaudeAgentSdkDriver` (mailbox /
// SendMessage) and `PythonSynthesizerDriver` (HTTP/queue to the LangGraph
// Synthesizer) implement this same interface later.

import { route, type Envelope } from "./messages.js";
import type { TaskEntry } from "./ledger.js";

export interface OrchestrationDriver {
  dispatch(task: TaskEntry): Promise<void>;
  send(env: Envelope): Promise<void>;
  /** messages emitted back toward the hub since the last drain */
  drain(): Promise<Envelope[]>;
}

export class InMemoryDriver implements OrchestrationDriver {
  readonly dispatched: TaskEntry[] = [];
  private outbox: Envelope[] = [];

  async dispatch(task: TaskEntry): Promise<void> {
    this.dispatched.push(task);
  }

  async send(env: Envelope): Promise<void> {
    // The star invariant is enforced at the seam: no driver can carry a
    // peer-to-peer message even if a caller constructs one.
    const r = route(env);
    if (!r.ok) throw new Error(`refused message: ${r.violation}`);
    this.outbox.push(env);
  }

  async drain(): Promise<Envelope[]> {
    const msgs = this.outbox;
    this.outbox = [];
    return msgs;
  }
}
