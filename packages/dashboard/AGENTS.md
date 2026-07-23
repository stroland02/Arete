<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# NEVER run `next build` into the dev server's directory

`next dev` and `next build` both default to `.next`. Building while the dev
server is running overwrites the manifests that server is reading, and the
browser starts serving **stale chunks** — the app looks like it reverted to an
older version, as if the work had been lost. It has not; the dev output was
simply clobbered. (This happened on 2026-07-23 and cost real confusion.)

Verification builds therefore go somewhere else:

```bash
NEXT_DIST_DIR=.next-verify pnpm --filter @arete/dashboard exec next build
```

`next.config.ts` reads `NEXT_DIST_DIR` and falls back to `.next`, so CI and the
Docker image are unaffected. If you do clobber it, restart the dev server — it
recompiles from source and nothing is lost.

**This worktree serves :3002. `:3000` belongs to another worktree and must never
be stopped.** Confirm who owns the port before touching anything:

```powershell
Get-NetTCPConnection -LocalPort 3002 -State Listen | Select-Object OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId = <pid>" | Select-Object CommandLine
```
