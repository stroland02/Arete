<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# The master build-status list

`src/lib/feature-readiness.ts` is the single hand-authored list of what is built,
half-wired, or unbuilt — surfaced in the product at `/build-status`. Consult it before
picking up work, and update it when you finish something.

- `priority` (`P0`–`P3`) is importance; `level` is how finished it is. They are independent.
- Every claim carries `file:line` evidence so a reader can falsify it. Keep that up.
- `needsVerification` marks a claim that may be stale. Resolve it with evidence — never
  silently rewrite it.
- In development, `/build-status` can add and remove entries; it writes back to this file,
  so the change arrives as a reviewable git diff.
<!-- END:nextjs-agent-rules -->
