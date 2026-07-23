# Build the product — briefs for four PMs, 2026-07-23

**Why this replaces the previous briefs:** in the last 12 hours we landed 87 commits on main and
**50 of them touched zero product code**. The four most-edited files were the coordination ledger,
the tracker JSON, the lane registry, and the backlog. Four agents got very good at describing work.
A person opening localhost after a full night saw one new nav item.

Lane ownership did its job — it stopped us building the same thing twice — but it has started
costing more than it prevents. Empty queues produced status documents instead of software.

**So: lanes are advisory now, not gates.** Take the work in your brief. If your brief is done, take
the next unclaimed item. Only one rule survives from the lane system, because it is the one that
actually prevented duplicate work — see §2.

---

## 1. What counts as a finished session

Ship a **user-visible change**, landed on `main`, verified in a browser.

- A session that produced only docs, tracker edits, or ledger entries is a **no-op**. Say so plainly
  and stop; do not fill the time.
- "Verified" means you drove the real flow on your localhost and asserted on **rendered content**.
  A 200 that renders an empty state is a failure, not a pass. That distinction is exactly how this
  app looked healthy for hours while every data surface was empty.
- Land it the same session. Work that sits on a branch is invisible and gets rebuilt by someone
  else — that has already happened here twice.

## 2. The one anti-duplication rule

**Before you write code: `git fetch && git log origin/main --oneline -30`, and grep for the thing you
are about to build.** A capability already on main, or already implemented on someone's branch, is
the single most expensive mistake this team makes.

Then claim it: set that item's `state` to `running` in `packages/dashboard/data/build-tracker.json`
and push that one-line change **before** you start. That is the whole protocol. No lane declaration,
no brief, no ledger entry.

If you find someone has already built it: **do not rebuild it — land theirs.**

## 3. Standing rules that still bind

- `prisma migrate deploy`, never `db push` — every worktree shares one Postgres.
- Never issue an unscoped `DELETE` against tenant data. Remove verification rows by explicit id.
- Pin your dev port (`next dev -p <yours>`), or a browser tab silently shows another agent's branch.
- Honesty: a control that cannot act is `disabled`, never a live-looking button; `null` (unavailable)
  is never `[]` (none); never fabricate a passing result.
- Escalate only genuine **intent** decisions (product policy, a schema change others depend on).
  Mechanical findings — formatting, a stale doc line the code disproves — just fix.

---

## 4. The four briefs

Non-overlapping by construction. Each is real product work with a visible outcome.

### PM-1 · Product UI
**Goal: the Agents page stops being a second place to look.**
1. `agents-layer-inside-services` — roadmap Stage 2.2. Agents become a layer *inside* Services:
   select a working agent → its conversation and its parameter controls, in place. Characterization
   tests on both workspaces **first** (they are large and untested), then the move. A refactor commit
   changes no behaviour; a fix commit moves no code.
2. Then `revert-or-subsume-agents-rail-inbox` — already decided: **subsume, do not revert**
   (`73e2040` duplicates no code and already hands off in the right direction). 2.2 absorbs it.
3. Small and destructive, from the build-status brief: `api/build-status/route.ts` **hard-deletes**
   any catalogued idea with no `dropped` state, no restore, no confirm — and its read-modify-write
   has **no concurrency guard** while four loops edit that file. These are the only two open gaps
   that *destroy work*. Fix them.

### PM-2 · Engine — unblock the data
**Goal: a scan can finish, so the dashboards have something to show.**
1. **The M1 blocker.** `packages/webhook/src/scan/trigger.ts:221-233` — `fetchScan` is a bare
   `fetch`, and undici's default `headersTimeout` is 300 s. The agents `/scan` endpoint only sends
   headers when the whole scan finishes, so **against any model slower than five minutes a scan can
   never succeed, ever.** Observed: failure at 307 s while the agents service kept working for
   another seven minutes and completed six model calls into a closed socket. Full analysis in
   `docs/handoff/2026-07-23-m1-scan-timeout-plan.md`.
   Prefer the enqueue/ack shape `/fix/trigger` already uses, so a slow run is *slow*, not *failed*.
   A raised timeout is acceptable as a stopgap **only** if it also stops discarding completed work.
2. `agent-config-persistence` — there is no `AgentConfig` model; the drawer's Save is honestly
   disabled today. Model + migration + wire-up. Announce the migration before running it.

### PM-3 · Integration — land what is already built
**Goal: stop paying for work nobody can see.**
1. `stroland02/setup-live-website-dev` is **20 commits** ahead of main and contains finished,
   tested work: outbound webhook management behind real auth, the MCP cleartext-credential fix,
   `SecurityAssessor` no longer fabricating verdicts, memory FIFO archive, telemetry-fed healing.
   Landing it closes `outbound-webhook-management-ui` and `mcp-token-plaintext-and-simulated-oauth`
   outright.
2. `stroland02/build-status-rows` — 10 commits.
3. Resolve conflicts by intent, not by merge order. Where two lanes built the same thing, keep the
   better implementation and delete the other — do not keep both.
4. Afterwards, re-check the tracker: several rows will be closed by the merge and should say so.

### PM-4 · Security & onboarding
**Goal: close the one critical, and give a locked-out user a way back in.**
1. `prose-credentials-reach-sinks` — **the only `critical` item open.** `password: hunter2` in prose
   still reaches sinks: there is no secret *shape* detection and the blocklist binds to object keys,
   not words in a string. Needs an amendment to the frozen §5 pattern set, with real
   false-positive risk on ordinary prose — so land it behind tests that prove the false-positive rate.
2. `password-reset-and-email-verification` — `User.emailVerified` exists and is never written; a
   locked-out user has no recovery path. Needs email sending plus a single-use, expiring,
   revocable-on-change token.
3. `account-state-signals-for-new-steps` — the onboarding card shows "2 of 4" with steps whose
   completion is not derived from real DB facts. Derive them from `getAccountState`.

---

## 5. If your brief is finished

Take the highest-importance unclaimed `next` item from the tracker, claim it per §2, and build it.
If there is genuinely nothing, say that in one line and stop — an idle agent is cheaper than an
agent generating documents.
