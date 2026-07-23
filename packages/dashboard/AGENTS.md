<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Master build tracker — read before planning work

`packages/dashboard/data/build-tracker.json` is the single source of truth for
what is built, what is ranked next, and every catalogued idea not yet started.
It is rendered at `/build-status` and edited by the user from that page.

- For the state cheaply, run `node scripts/build-tracker-brief.mjs` — it prints
  the focus list, the four programme rails, and the counts. To act on a specific
  row, read the JSON and cite the item `id` in your plan and commit message.
- The pure logic lives in `src/lib/build-tracker/` (`schema`, `parse`, `mutate`,
  `select`). Adding an item requires `provenance` unless it is user-added —
  `parseTracker` rejects an uncited non-user item, on purpose.
- There are four separate phase numbering systems (product 1.1–1.6, SuperLog
  P1–P5, observability 0–4, orchestration A–C). They are NOT one sequence; the
  SuperLog roadmap is marked `stale`. Do not merge them.
- Do not hand-edit the JSON while the dev server is up unless you reload the
  page after: writes from the UI are hash-guarded and will refuse a stale write.
