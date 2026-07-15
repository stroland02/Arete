import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryDriver } from "./driver.js";
import type { Envelope } from "./messages.js";
import type { TaskEntry } from "./ledger.js";

function task(): TaskEntry {
  return {
    id: "t1",
    title: "x",
    owner: "w1",
    lane: { packages: ["packages/orchestration"], globs: [] },
    state: "ready",
    phase: null,
    dependsOn: [],
  };
}

function env(over: Partial<Envelope>): Envelope {
  return {
    id: "m",
    traceId: "tr",
    from: { role: "worker", id: "w1" },
    to: { role: "orchestrator", id: "pm" },
    kind: "status",
    body: "",
    ...over,
  };
}

test("dispatch records the task", async () => {
  const d = new InMemoryDriver();
  await d.dispatch(task());
  assert.equal(d.dispatched.length, 1);
  assert.equal(d.dispatched[0].id, "t1");
});

test("send enforces the star invariant (peer-to-peer rejected)", async () => {
  const d = new InMemoryDriver();
  await assert.rejects(() =>
    d.send(env({ from: { role: "worker", id: "w1" }, to: { role: "worker", id: "w2" } })),
  );
});

test("drain returns hub-bound messages then empties", async () => {
  const d = new InMemoryDriver();
  await d.send(env({}));
  const msgs = await d.drain();
  assert.equal(msgs.length, 1);
  assert.equal((await d.drain()).length, 0);
});
