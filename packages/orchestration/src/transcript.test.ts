import { test } from "node:test";
import assert from "node:assert/strict";
import { toTranscriptEvent } from "./transcript.js";
import type { Envelope, MessageKind } from "./messages.js";

const base = (kind: MessageKind): Envelope => ({
  id: "e",
  traceId: "t",
  from: { role: "worker", id: "w1" },
  to: { role: "orchestrator", id: "pm" },
  kind,
  specialty: "fix-author",
  body: "hello",
});

test("projection carries provenance, specialty, and body", () => {
  const ev = toTranscriptEvent(base("status"));
  assert.equal(ev.kind, "report");
  assert.equal(ev.specialty, "fix-author");
  assert.equal(ev.from, "w1");
  assert.equal(ev.to, "pm");
  assert.equal(ev.text, "hello");
});

test("toTranscriptEvent is total over every MessageKind", () => {
  const kinds: MessageKind[] = [
    "dispatch",
    "status",
    "blocker",
    "gate-request",
    "gate-result",
    "handoff",
    "qa-result",
  ];
  const map = Object.fromEntries(kinds.map((k) => [k, toTranscriptEvent(base(k)).kind]));
  assert.deepEqual(map, {
    dispatch: "dispatch",
    handoff: "dispatch",
    status: "report",
    blocker: "report",
    "gate-request": "verify",
    "gate-result": "verify",
    "qa-result": "qa",
  });
});
