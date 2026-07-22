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

## Open (not started, not claimed by me)

1. **`packages/webhook/src/alerting/receiver.ts` still reads `ARETE_PLATFORM_INSTALLATION_ID`.** It is the
   other half of the tenancy defect and should adopt `Installation.isPlatform`. Its comment "There is no
   'platform' flag on the Installation model to enforce this" is now out of date.
2. **`lib/telemetry-queries.ts` does not yet gate on `isPlatformInstallation`** before its `project_id`
   filter, and its header still describes that filter as tenant isolation. Engineer B's file — needs a
   ledger declaration first. Contract §7.
3. **`.env.example` still documents only the env var** — should say the flag is authoritative and the var
   is a transition fallback. It was being edited concurrently by another track.
4. **Emit-time `superlog.issue_fingerprint` stamping** — unclaimed; would light up `otel_exceptions` and
   move grouping to ingest. Must reuse `error-fingerprint.ts` (contract §5) or groups will split.
5. **Error-log path is implemented but unexercised** — `otel_logs` has 0 rows at ERROR+, so `logToEvent`
   has never run on real data. It will light up on the first real error-level log.

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
