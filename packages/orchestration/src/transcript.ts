// Pure projection: an inter-agent Envelope -> a transcript event shaped to the
// dashboard's existing SynthStep vocabulary (design §3.1). The dashboard consumes
// this over the EXISTING init->step*->done SSE stream; no second stream. Timestamps
// are the emitter's concern (kept out of this pure, deterministic mapping).

import type { Envelope, MessageKind } from "./messages.js";
import type { Specialty } from "./specialty.js";

export type TranscriptKind = "dispatch" | "report" | "verify" | "qa";

export interface TranscriptEvent {
  kind: TranscriptKind;
  from: string;
  to: string;
  specialty?: Specialty;
  text: string;
}

const KIND: Record<MessageKind, TranscriptKind> = {
  dispatch: "dispatch",
  handoff: "dispatch",
  status: "report",
  blocker: "report",
  "gate-request": "verify",
  "gate-result": "verify",
  "qa-result": "qa",
};

export function toTranscriptEvent(env: Envelope): TranscriptEvent {
  return {
    kind: KIND[env.kind],
    from: env.from.id,
    to: env.to.id,
    specialty: env.specialty,
    text: env.body,
  };
}
