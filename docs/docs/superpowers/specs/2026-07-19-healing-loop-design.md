# Healing Loop v1 — Fix Dispatch, Patch Author, and the Real Drive (Wave B)

**Status:** FROZEN (Eng4's five pre-spec questions answered inline — see §3–§6) · **Owner lanes:** Eng4 (dispatch + state + lifecycle, end-to-end), Eng3 (agents `POST /fix`), Eng2 (sign-off on one pipeline-type extension) · **PM:** integration gate.

## 1. Problem (audited 2026-07-19, confirmed independently by Eng4)

The loop is severed in three places:
1. `api/work-items/[id]/fix/route.ts` births an `IssueContainer` at `state:'open'` — not a `ContainerState` — with `patch: []`, and dispatches nothing. Such a container can never legally reach `ready`; approve 409s forever.
2. The drive engine (`driveContainer`, requires `detecting`; Eng2's `persistDrive`) is fully built and tested — with **zero production callers** (only the `live-drive.ts` sample).
3. **No patch author exists.** `StagedPatchFile[] {path, content}` is what staging commits; every current path leaves it empty — an approved container would post a content-free PR.

## 2. Architecture — dispatch topology ruling (Eng4 Q1)

Webhook-service topology, mirroring review/scan. NOT in-process `persistDrive` from the dashboard route: the patch author needs a tenant checkout + installation token, which live behind the webhook/worker, and fix runs are long (minutes) — they belong on the BullMQ worker, not a Next request. Sequencing is **author-patch-first, then verify against that diff** (Eng4's reading is correct) — both stages live inside agents `POST /fix`; the worker consumes only the finished result.

```
User "Fix it" (Services panel)
  → dashboard POST /api/work-items/[id]/fix        (session + tenancy, exists — corrected)
      creates IssueContainer at `detecting` (real issue payload from the WorkItem), WorkItem → fixing
      → webhook POST /fix/trigger                  (NEW; mounted under the INTERNAL_API_TOKEN guard)
          payload = { workItemId } only; webhook re-reads the row, derives installationId from it
          enqueues BullMQ fix job (same worker process as reviews)
            → worker advances the container per stage, persisting EACH transition
               (PrismaContainerStore.save — Eng2's persistDrive pattern, made incremental)
            → agents POST /fix                     (NEW; Eng3)
               checkout via existing repo-cache (webhook-minted installation token, /scan pattern)
               author patch → verify (auto_resolver core) → transcript
            → `fixed`: attach patch, advance … → `ready`. STOP. (HITL moat unchanged)
            → `fix_failed`: container → `fix_failed` (terminal), WorkItem → open + honest error line
  Human: Approve (existing route: ready → solution_approved, WorkItem → staged)
  Human: Send PR (existing /staging/send: real octokit PR — now WITH content — WorkItem → posted + prUrl)
```

## 3. Wire contract — agents `POST /fix` (FROZEN)

Request (`FixRequest`, pydantic `populate_by_name`, camelCase aliases — same conventions as `/scan`):
```json
{
  "containerId": "cont_abc",
  "installationId": "uuid",
  "repo": { "fullName": "acme/api", "defaultBranch": "main", "token": "<webhook-minted installation token>" },
  "item": {
    "kind": "issue|opportunity",
    "title": "...", "detail": "...", "dimension": "security",
    "confidence": 0.8,
    "evidence": [ { "path": "app/api/reports.ts", "line": 3 } ]
  },
  "llm": { "provider": "ollama", "model": "qwen2.5-coder", "baseUrl": "http://127.0.0.1:11434" }
}
```
Response (`FixResponse`):
```json
{
  "status": "fixed" | "fix_failed",
  "reason": "string, required when fix_failed — honest, user-renderable",
  "patch": [ { "path": "src/x.ts", "content": "<FULL new file content>" } ],
  "transcript": [
    { "agent": "security", "action": "author|verify|compose", "detail": "...",
      "report": { "status": "done|blocked", "confidence": 0.74, "blockers": [] } }
  ],
  "verification": { "verdict": "verified|unverified", "checks": ["..."] }
}
```
**Grounding rules (Eng4 Q5 — yes, the deterministic /scan-style gate):**
- `patch` non-empty **iff** `status:"fixed"`; `content` is the complete post-fix file (exactly `StagedPatchFile` — staging commits it verbatim).
- Every patched `path` MUST exist in the checkout, with a new-file allowance only when the transcript carries an `action:"author"` step stating why the file is new. Enforced deterministically agents-side before returning, like scan's path/line gate.
- Verification (auto_resolver core) must pass before `fixed` is returned; authored-but-unverified → `fix_failed` with the verification failure as `reason`. Never a fabricated or unverified patch.
- Timeout budget: 300s; the worker aborts and records `fix_failed` / `reason:"timeout"`.

## 4. State machine + transcript persistence (Eng4 Q2)

- Fix-born containers start at **`detecting`**; the `'open'` literal is removed from the fix route.
- Worker advances `detecting → fanning_out (authoring) → verifying → composing → ready`, persisting each transition, so the SSE stream route (which already animates non-terminal stored rows) shows real progress. v1 liveness = honest incremental persistence, not push streaming.
- **Transcript lives in a NEW nullable Json column `transcript` on `IssueContainer`** — `StoredContainer` has no such field today and derive-from-state cannot reproduce real steps. Additive migration, Eng4's lane, flagged as schema coordination with Eng1 per the checkpoint-deps rule (list it in the handoff report; `prisma migrate deploy` only). Written on each incremental save; read by the stream route for replay and later by the status board (transcript `report` objects are its data source).
- **NEW terminal state `fix_failed`** joins the `ContainerState` union (pipeline.ts). `canApprove`/`canPost` untouched. Failed containers are preserved (transcript stays viewable); the WorkItem returns to `open` with the failure line in the panel (scan-failure pattern: reason + retry).
- **Escalation ruling (Eng4 Q3):** a drive ending at `verifying` with `escalationReason` maps to the SAME work-item surface as failure — WorkItem → `open`, `escalationReason` rendered as the honest reason line, container preserved at its resting state. **No new work-item state in v1**; your approve→staged / send→posted hooks compose unchanged. (A dedicated "needs attention" triage state is explicitly deferred.)
- HITL moat restated: the worker never advances past `ready`; only the human approve sets `solution_approved`; only the human Send posts.

## 5. Legacy rows ruling (Eng4 Q4)

The shared dev DB's existing `state:'open'` containers are dead ends by construction. At integration time the PM runs a one-off cleanup (not a migration): delete `IssueContainer` rows where `state = 'open'`, and reset their linked WorkItems `fixing → open` so every item can re-enter the real pipeline. Tenant-preserving, additive-safe, executed once with the merge that removes the `'open'` writer.

## 6. Tenancy & security

- Dashboard fix route: session-scoped as today; never trusts client ids.
- `/fix/trigger`: under Eng1's bearer guard; body carries only `workItemId`; installation derived from the DB row.
- Agents receives a short-lived webhook-minted installation token (context-map file-handler pattern); tenant keys ride the `llm` block, decrypted in-memory only, never logged, never persisted agents-side.
- `POST /api/approvals/:id/execute` goes behind the same bearer (Eng1 follow-up, ruled 2026-07-19); the fix worker never calls it.

## 7. WorkItem lifecycle (net of existing hooks)

`open → fixing` (fix route, exists) `→ staged` (approve hook, exists) `→ posted` (send hook, exists). NEW: `fixing → open` on `fix_failed`/escalation, reason surfaced. One PR per work item; staging idempotency (`arete/fix/<id>`) unchanged.

## 8. Task split

- **Eng3 (agents):** `POST /fix` per §3 — author stage on the tenant checkout, auto_resolver verification gate, transcript with per-stage `report`, deterministic patch-grounding gate, honest `fix_failed`. Pytest: fixed path, failed-verification, grounding violation, new-file allowance, timeout.
- **Eng4 (feature lane, everything else):** fix-route correction (detecting + payload + trigger call), webhook `/fix/trigger` + BullMQ fix job + incremental drive persistence, `transcript` column migration, `fix_failed` union member (with Eng2 ack), WorkItem failure/escalation lifecycle + panel surfacing. Vitest at every seam; fixture tests against §3 shapes.
- **Eng2:** ack the `ContainerState` extension + `transcript` column read path; later consumes `transcript[].report` for the real status board (separate brief).

## 9. Acceptance (the drive)

Connect repo + Ollama → scan fills inbox → **Fix it** on a real item → container visibly advances through real transitions (no sample) → `ready` → human Approve → human Send PR → **the GitHub PR contains the actual diff** → WorkItem `posted` with prUrl. A deliberately unfixable item returns `fix_failed` honestly with its reason and the WorkItem back at `open`.
