# Status: Healing Loop v1 — Eng4 Lane Complete (2026-07-20)

**Lane:** Engineer-4 (feature lane, work-item inbox → healing loop end-to-end)
**Branch:** `stroland02/Engineer-4` @ `865a354` (base: `integration-preview` @ `5be0779`)
**Spec:** `docs/superpowers/specs/2026-07-19-healing-loop-design.md` (frozen) · **Plan:** `docs/superpowers/plans/2026-07-19-healing-loop-eng4.md` (complete)

## Milestones this cycle

1. **Work-item inbox (2026-07-17/18, merged f481a85):** WorkItem + ScanRun schema, auto-scan trigger + `POST /scan/trigger`, review-findings sync, dashboard `POST /api/scan`, agents `POST /scan` (critic-grounded), Services inbox UI, triage routes + the two authorized lifecycle hooks (approve→staged, send→posted).
2. **Healing loop v1 — Eng4 half (2026-07-19, this branch):**
   - `d06733e` `fix_failed` terminal `ContainerState` — reachable from all four worker stages; never approvable/postable; terminal in stream replay.
   - `dfca833` Schema: `IssueContainer.transcript Json?` (SynthStep[] drive transcript) + `WorkItem.fixError String?` (honest failure reason). Migration `20260719120000_add_container_transcript_work_item_fix_error`.
   - `84af0d6` Fix route births containers at `detecting` (real pipeline initial state; the `'open'` writer is gone) and dispatches the bearer-authenticated webhook `POST /fix/trigger` (`{workItemId}` only); failed dispatch reverts honestly (container `fix_failed`, item `open` + reason, HTTP 502).
   - `6f26eb1` Webhook `/fix/trigger` under the `INTERNAL_API_TOKEN` guard + `fix-workitem` BullMQ queue (isolated from review/approval queues).
   - `7d00333` Fix worker: `runFixJob` calls agents `POST /fix` (frozen §3 contract) and persists REAL transitions incrementally — `fanning_out → verifying → composing` (patch attached) `→ ready`; deterministic grounding double-check (patch non-empty iff `fixed`); 300s timeout → `fix_failed`/`"timeout"`; failure returns the WorkItem to `open` with the reason. Worker never crosses `ready` (HITL moat).
   - `10f45ec` Services panel surfaces "Fix failed: <reason>" on open items; Fix it doubles as retry.
   - `064125c` Stream route resolves PERSISTED containers (real transcript, tenancy-scoped) before the sample fallback. Approve route unchanged — Eng2's stored-row gate already covers fix containers.

## Verification (at 865a354, this worktree)

- Dashboard vitest: **395/395** (71 files). Webhook vitest: **374/374** (63 files). Agents pytest: **349 passed, 1 skipped**. Webhook `tsc --noEmit`: clean. Working tree clean; all commits pushed.
- Shared dev DB: `prisma migrate status` clean after applying the lane migration via `db execute` + `migrate resolve --applied` (an out-of-band `20260720020814_add_agent_chat_turn` from another lane blocked `migrate dev`; no reset was performed).

## Open dependencies (integration gate)

| # | Item | Owner |
|---|------|-------|
| 1 | `prisma migrate deploy` + client regeneration on preview/serving trees | PM |
| 2 | Commit the `add_agent_chat_turn` migration file (in DB, absent from tree) | owning lane |
| 3 | Ack `ContainerState` + `fix_failed` and the `transcript` read path (spec §8) | Eng2 |
| 4 | Worker restart — `pnpm worker` now also consumes `fix-workitem` | PM/ops |
| 5 | Agents `POST /fix` per frozen §3 — live e2e blocked until it lands | Eng3 |
| 6 | One-off cleanup (spec §5): delete `state='open'` containers, reset their WorkItems `fixing → open` | PM |
| 7 | `POST /api/approvals/:id/execute` still outside the bearer guard (ruled 2026-07-19, spec §6) | Eng1 |

## Next steps

- Preview-tree e2e once Eng3's `/fix` lands: Connect repo + Ollama → scan → Fix it → real transitions in the console → Approve → Send PR → **PR contains the actual diff**; a deliberately unfixable item lands back at `open` with its reason (spec §9 acceptance).
- Eng4 next feature (per memory): Connect Workspace — awaiting user data/PM brief.
