<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# The master build-status list

`data/build-tracker.json` is the single hand-authored record of what is built, half-wired,
or unbuilt — surfaced in the product at `/build-status`. Read it through the typed
selectors in `src/lib/build-tracker.ts`; never re-derive its rules in a component.

- `importance` is how much it matters; `level` is how finished it is. They are independent.
- `lane` splits the record in two: `inventory` is what exists (24 rows), `idea` is what is
  worth building (61). **Readiness counts cover the inventory lane only** — counting ideas
  would take "not wired up" from 9 to ~60 and present a working product as a broken one.
- **No `verifiedAt` means never verified.** The seed transcribed audits rather than
  re-confirming each claim against code, so absence must never render as a tick. Set it
  only when you have actually checked, and cite the evidence.
- `programmes` is an array — four numbering systems run at once, and one is flagged stale.
  Render them as separate rails; a blended percentage across them is meaningless.
- Every claim carries `file:line` evidence so a reader can falsify it. Keep that up.
- In development, `/build-status` can add and remove entries; it writes back to this file,
  so the change arrives as a reviewable git diff.

`src/lib/feature-readiness.ts` is the retired predecessor — nothing imports it. Do not add
to it, and do not treat it as current.
<!-- END:nextjs-agent-rules -->
