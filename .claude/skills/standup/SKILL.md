---
name: standup
description: Use at the start of a session, after a compaction, or when asked what everyone is working on — one board showing each lane's queue, what landed on main recently, and the highest-importance work nobody has claimed.
---

# Standup

```bash
node scripts/lanes.mjs board
```

Four sections, in the order that changes what you do next:

1. **The north star**, read from the tracker's own mission — not restated here,
   because a second copy drifts.
2. **Each lane** — role, claimed files, queue with each item's importance and
   state, and when it last checked in. `▶` marks this checkout.
3. **Unclaimed work**, highest importance first. This is where you pick from.
4. **What landed on main in the last 24h** — the fastest way to notice another
   lane has already done what you were about to start.

## Reading it honestly

- A lane whose **last seen is `never` or hours old** may be holding claims on
  files nobody is working on. Say so rather than waiting on it.
- An item in a queue but **not in the tracker** is a typo, or a task invented
  outside the record. Both need fixing before work starts.
- **Shipped counts come from the record, not from the code.** An item reads
  `shipped` because someone wrote that down. If it matters, open the file and
  check — and set `verifiedAt` once you have.
- Everything on the board comes from two files:
  `packages/dashboard/data/build-tracker.json` and `.claude/lanes.json`. If the
  board looks wrong, one of those is wrong. Fix it there.

## Then

Take the top unclaimed item that fits your lane, add its id to your lane's
`queue`, and run `node scripts/lanes.mjs check` before writing any code — it
rejects an item another lane has already queued or shipped.
