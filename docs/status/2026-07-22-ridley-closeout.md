# Close-out — ridley worktree (2026-07-22)

Branch `stroland02/overview-revamp`, merged to `main` at `2ab45fc`. Format per
`docs/runbooks/2026-07-22-agent-closeout.md` Part A step 5: what shipped, what is open, what
contradicts the plan, what was deliberately abandoned.

## Shipped

| Work | Evidence |
|---|---|
| Overview revamp — 4-step honest setup card (model → codebase → verify → extend), Agents-at-Work + duplicate connect banner + three redundant bottom sections removed | `de9f51c`, `8eaafd7` |
| Model-before-repo — pending `ModelConnection` (userId-scoped) adopted by the first installation; the "Install the GitHub App first" 403 is gone | `0f7ecce`, migration `20260722150000_make_model_connection_pending_capable` |
| Elevated Marble & Ink charts — serif numerals, ink-line timeseries with cobalt wash, bronze accents, hover tooltips, sparkline stat tiles; shimmer on every loading card | `de9f51c`, `bf70ea0` |
| Errors view — individual error groups from ClickHouse, grouped into incidents that resolve together; attach/detach with time-window correlation | `793900e`, migration `20260722180000_add_error_group` |
| Telemetry-tenancy contract + enforceable platform gate + Jaeger trace deep-links | `2ab45fc`, migration `20260722210000_add_installation_is_platform` |

Final gate: **617 tests / 91 files green**, `tsc --noEmit` clean, lint 0 errors, `next build` green.

Security property proven live, not asserted: flagging a *different* installation as platform made the
Errors surface return the honest "not available" panel with zero error data and zero trace links, while
`.env.local` still named the old one — the stale env var could not open the surface.

## Closed after the first close-out (contract §7 fully adopted)

Items 1–3 below were open when this document was first written; all three landed in `a6afc14`.

- **`receiver.ts` now resolves the platform installation from the flag.** Its drop-the-batch contract on
  unresolvable/ambiguous is preserved exactly — an alert filed against an arbitrary tenant is worse than an
  alert lost. Its false "There is no `platform` flag" comment is corrected.
- **`lib/telemetry-queries.ts` gates on `isPlatformInstallation` before any query**, its raw SQL bodies are
  private so the gate is structural, and access-denied is a state distinct from backend-unavailable.
- **`.env.example`** documents the flag as authoritative and both env vars as transitional/partitioning.
- **The resolver lives in `@arete/db`, not the dashboard** — both packages must obey one fail-closed
  security rule, and two copies would be two places to drift.

## Second wave — the PM-assigned feature queue, now complete

| Work | Evidence |
|---|---|
| `services-workspace.tsx` decomposed 1,346 → 459 lines, behavior-preserving (8 new files). Guarded by 5 characterization tests written first and confirmed green against the untouched file; `git diff -U0` shows every added line is an import, re-export, or comment | `8166fbe` |
| Fabricated `SAMPLE_*` "Sentry" fixtures moved out of the production component into `marketing/services-preview-fixtures.ts`, their only consumer. They could not reach the authed page before; now they structurally cannot | `8166fbe` |
| Agents rail surfaces the live work inbox — what the agents are working on — reusing the extracted `WorkItemInboxSection`; selecting an item hands off to `/services?container=` | `73e2040` |
| Settings shows a real Connections summary (repos, AI model, services) and links out; Workspace's duplicate Connections/AI-model nav rows folded into it | `9fd33be` |

Final gate: **648 tests / 93 files**, `tsc --noEmit` clean, lint 0 errors, `next build` green, and each change driven in the running app.

## Open (not started, not claimed by me)

1. **Emit-time `superlog.issue_fingerprint` stamping** — unclaimed; would light up `otel_exceptions` and
   move grouping to ingest. Must reuse `error-fingerprint.ts` (contract §5) or groups will split.
2. **Error-log path is implemented but not fully exercised.** Its SQL shape, timestamp format and column
   projection are verified against real `otel_logs` rows (queried at a lowered severity threshold, which
   also exercises the empty-`exception.type` fallback), and the parsing is unit-tested — but `otel_logs`
   has 0 rows at ERROR+, so no genuine ERROR-severity record has flowed end to end. A data-availability
   gap, not a known code gap; it lights up on the first real error-level log.
3. **`packages/db` has no test runner.** The shared resolver is covered from both consumers (dashboard
   `platform-installation.test.ts`, webhook `receiver.test.ts`) rather than by a unit suite in its own
   package. Adding vitest there means a lockfile change; deferred deliberately.

## Contradicts the plan / discovered mid-flight

- **`superlog.project_id` is not tenant data.** It is `ARETE_SELF_PROJECT_ID`, a self-dogfooding tag. Any
  design treating it as tenant isolation is wrong until Phase 3 ingest lands. This reframed the whole
  workstream; the contract exists because of it.
- **`otel_exceptions` is empty but not broken** — its MVs filter on `project_id`, not on the fingerprint,
  and MVs do not backfill. An earlier claim that it was permanently broken was wrong.
- **Shared-Postgres drift is real and bit twice.** Another worktree's `db push` dropped `ErrorGroup` and
  `ModelConnection.userId` mid-session. Re-applying migration SQL out-of-band then left
  `20260722180000_add_error_group` recorded *failed* in `_prisma_migrations`, blocking `migrate deploy`
  until it was verified byte-equivalent and `migrate resolve --applied`. Prefer `migrate deploy`;
  `dev-all.mjs` on `main` now does.

## Deliberately abandoned

- **Reverting local verification artifacts.** The `InstallationAccess` grant for `dev@arete.local`, the
  manual test investigation (backdated to exercise correlation), and one resolved `ErrorGroup` row remain
  in the **local dev DB only**. Removing them would empty the very surfaces built this session. Nothing is
  committed; no product code depends on them.
- **Branch retirement.** Part B of the closeout runbook — destructive, owned by the coordinator session,
  awaiting the product owner's approval there. Nothing in this worktree depends on it.
- **Backlog corrections.** `docs/roadmap/backlog.md` still lists internal-token expiry and the
  `review-pr-heavy` consumer as open though the 07-22 handoff records them closed. Left to the owning
  session rather than editing a high-traffic file another worktree is actively changing.

## Local dev notes

This worktree serves on **:3002** (`AUTH_URL` and `PORT` pinned); **:3000 belongs to another worktree** and
was never stopped. `Installation.isPlatform` is set on the dev installation locally.
