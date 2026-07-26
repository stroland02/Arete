import assert from "node:assert/strict";
import { test } from "node:test";
import { route, HUB_ROLES, type Envelope } from "./messages.js";
import { SPECIALTIES } from "./specialty.js";

function env(over: Partial<Envelope>): Envelope {
  return {
    id: "m",
    traceId: "tr",
    from: { role: "orchestrator", id: "pm" },
    to: { role: "worker", id: "w1" },
    kind: "dispatch",
    body: "",
    ...over,
  };
}

test("hub -> worker is allowed", () => {
  assert.deepEqual(route(env({})), { ok: true });
});

test("worker -> hub is allowed", () => {
  const r = route(env({
    from: { role: "worker", id: "w1" },
    to: { role: "orchestrator", id: "pm" },
    kind: "status",
    phase: "progress",
  }));
  assert.deepEqual(r, { ok: true });
});

test("worker -> worker is rejected (star invariant)", () => {
  const r = route(env({
    from: { role: "worker", id: "w1" },
    to: { role: "worker", id: "w2" },
    kind: "status",
  }));
  assert.equal(r.ok, false);
});

test("hub roles are orchestrator and integrator", () => {
  assert.deepEqual([...HUB_ROLES].sort(), ["integrator", "orchestrator"]);
});

test("handoff and qa-result are routable message kinds carrying a specialty", () => {
  const handoff = env({ kind: "handoff", specialty: "fix-author", body: "author the fix" });
  assert.ok(SPECIALTIES.includes(handoff.specialty!));
  assert.deepEqual(route(handoff), { ok: true });

  const qa = env({
    from: { role: "worker", id: "qa" },
    to: { role: "orchestrator", id: "pm" },
    kind: "qa-result",
    specialty: "qa",
    body: "pass",
  });
  assert.deepEqual(route(qa), { ok: true });
});
