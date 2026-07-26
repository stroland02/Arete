# Phase 2 Retrospective — Alerting + Healing-Run Safety

**Branch:** `stroland02/obs-phase-2` (off `integration-preview@b491e60`)
**Date:** 2026-07-21 · **Process:** subagent-driven, independent review on security-critical chunks only
**Predecessor:** [`2026-07-21-phase-1-retrospective.md`](2026-07-21-phase-1-retrospective.md)

---

## The headline: Phase 1's defects were only discoverable by consuming Phase 1

Phase 1 shipped with all nine CI checks green, a reviewer verdict of "ready to merge," and a
documented DoD with captured evidence. Phase 2 then tried to *use* what it built, and found this
within hours:

| What Phase 2 found | Why Phase 1 could not have caught it |
|---|---|
| Every Areté metric was exposed as `arete_arete_review_runs_total` — the collector prepended `namespace: arete` onto instruments already named `arete.*`. It also mangled the semconv metrics into `arete_http_client_…`, defeating §4's "dashboards built on stable names." | Nothing consumed the Prometheus names. The metrics were correct, exported, and stored — and misnamed in a way no test asserted on. |
| `scrubLogValue` was never re-exported from `packages/telemetry`'s public `index.ts` — the package did not expose its own canonical scrubber. | Nothing outside the package had tried to import it. |
| The healing path had **zero** span or metric instrumentation, despite spec §5 freezing `fix.run` in the span tree. | Phase 1's exit criteria named a traced *review*, not a traced fix run. |
| The agents service had **no authentication on any route**, despite spec §6 gate 4 mandating "internal endpoints keep the fail-closed bearer-token pattern." | No Phase 1 work called those endpoints from a new trust boundary. |

**The pattern is not carelessness — it is structural.** Each of these is a property of an *interface*,
and an interface has no observable behaviour until something consumes it. Green tests on the
producer say nothing.

**Action:** a phase's exit criteria must include a real consumer exercising what it built, not only
its own tests passing. "One real PR review traced end-to-end" was the right *kind* of criterion;
there was no equivalent for metric names, package exports, or internal endpoints.

---

## Reviews found two Criticals, both real, both cross-tenant

The rigor decision for this phase was **independent review on security-critical chunks only** —
roughly half of Phase 1's review spend. Both chunks selected came back **NOT READY**.

**C1 — the alert receiver took its tenant id from an attacker-controlled field.** `labels.installationId`
was used verbatim as the tenancy authority, while `docker-compose.yml` published Alertmanager's
`9093` on the host with an unauthenticated `/api/v2/alerts`. A spoofed label could file an incident
into any customer's dashboard with attacker-chosen text — and because Task 4 routes critical
incidents into the fix pipeline, **could open a fix run against that customer's repository**.

Both contributing tasks were individually correct. Task 1 rightly kept tenant ids off metric
dimensions (the hard cardinality rule). Task 3 rightly required a tenant scope before writing to a
tenant-scoped table. **The defect lived in the seam between them** — which is exactly where per-task
tests do not look.

**B4 — the agents service had no authentication at all.** `POST /review` accepted `installationId`
and `repo` in the same caller-supplied context. Anyone with network reach could name a victim, induce
an `add_project_memory` call through injected patch content, and write into the victim's repo using
the agents process's own internal token — landing in that tenant's **future review prompts**. Durable
cross-tenant prompt injection. Spec §6 had required the fix since before Phase 1.

A later sweep found the read-side twin: two `GET /context-map/{installation_id}` routes returning any
tenant's code graph to anyone who asked.

**Both Criticals were fixed structurally rather than by validation.** The receiver no longer reads
tenant identity from the payload at all; the memory tool never accepts a repo from the model. A field
you never read cannot be spoofed.

---

## What caught them: probes, not diffs

Every finding of consequence this phase came from **running something against the real code**:

- Storing `ghp_1234567890abcdef` in a memory row and observing which columns kept it verbatim while
  the adjacent column showed `[REDACTED]`
- Standing up a server that returns `200 text/html` and watching the tool report "Successfully saved"
  with nothing persisted — the original defect, surviving its own fix
- POSTing malformed and 200 KB bodies to learn that `express.json()` returns 400/413 *before* the
  handler's try/catch, and that Alertmanager treats 4xx as permanent loss
- Enumerating the FastAPI route table **from the live app object rather than the decorators**
- Driving the receiver with `installationId` spoofed six different ways at once

Phase 1's retrospective made "verify against the installed package" a standing rule. This phase shows
the stronger form: **verify against the running system.** Reading installed source found Phase 1's
defects; only executing found Phase 2's.

**Two implementer reports asserted security properties that were false** — one claimed spoofing
required compromising Alertmanager's config, contradicted by reading the compose file; one claimed it
had verified no concurrent files were staged, contradicted by `git show`. Neither was dishonest; both
were confident and unverified. **Reviewers must treat implementer security claims as hypotheses.**

---

## What worked

- **Scoping reviews to security-critical chunks was correct.** Both reviewed chunks had real
  cross-tenant defects; none of the spot-checked chunks produced a comparable finding. The cheaper
  policy bought the same protection where it mattered.
- **Honest gaps were reported rather than papered over.** Agents said "I could not seed the dashboard
  because a concurrent process kept truncating Postgres," "the BullMQ half was verified separately,
  not in one shot, to conserve cost," and "`password: hunter2` as prose is still stored — that needs a
  spec amendment." Every one of those was more useful than a claimed pass.
- **Agents challenged the plan and were right.** Task 5 found the plan's `new BullMQOtel('arete-webhook')`
  contradicted the installed constructor. Tasks 12/13 found that two "budgets" the brief told them to
  assess never gate the fix pipeline at all. The Task 8 fixer found the compose file named in its
  brief was infra-only, and that the real provisioning file was missing variables for three services.
- **Measure-before-optimize held.** The efficiency task shipped exactly one change — a missing
  `ReviewComment` index — with `EXPLAIN ANALYZE` before/after on 750k seeded rows, forcing the old plan
  for a true comparison. It declined to tune queue concurrency because it measured that the LLM call
  is 78% of a fix run. Two larger findings were filed unfixed *with their reasoning* rather than
  guessed at.
- **Mutation tests on every gate.** Each security gate was observed failing before being trusted —
  including cases where a fix's own test was proven non-vacuous by reverting the fix and watching it
  fail.
- **Fixes that closed a class, not an instance.** The redaction residual fix refactored
  `PINO_REDACT_PATHS` to compose the same shared key constant as the persistence sink, so the two
  cannot drift apart again — rather than adding the missing keys to one side.

## What didn't

- **A fix round and a task were dispatched against the same file.** Task 4 and the C1 fixer both owned
  `receiver.ts`; Task 4 landed first and moved the file under the fixer. Recovered by messaging the
  fixer mid-flight. **Controller error:** conflicts were checked against each task's declared paths,
  forgetting that fix rounds re-enter files tasks have already released.
- **A directory pathspec swept another agent's work into the wrong commit.** Phase 1's rule
  ("pathspec-limited commits") was *followed* and still failed, because `packages/webhook/src` is not
  tight enough when agents share a package. **Sharpened rule: an explicit file list, never a
  directory, whenever concurrent agents are live.**
- **A task was written into the ledger as dispatched before it was dispatched.** Caught and corrected
  in the ledger rather than silently overwritten.
- **A backlog entry asserted a live Critical that had been fixed an hour earlier.** Filed by one
  commit, fixed by the next, never updated. A backlog claiming an open cross-tenant leak that no
  longer exists misstates the security posture of shipped code — the same hazard class as a report
  claiming a hole is closed when it is not.
- **Phase 0's flaky-test criterion was never met.** `pipeline.integration.test.ts` was to be "fixed or
  quarantined"; it is still flaky, confirmed pre-existing via `git stash` against an older tree. A
  phase closed with an exit criterion unmet and nobody noticed until two phases later.
- **Stale infrastructure cost two verification cycles** — a collector that never reloaded its config
  (Phase 1) and a stale `uvicorn` squatting on a port, silently absorbing telemetry (Phase 2). Neither
  was a code defect. **When a verification fails, suspect the environment before the code.**

---

## Actions for Phase 3

1. **Exit criteria need a consumer.** Every interface a phase produces — metric names, package
   exports, internal endpoints — needs something outside it exercising it before the phase closes.
2. **Reviewers probe the running system**, not just installed source. Make it explicit in the
   reviewer template alongside Phase 1's action 1.
3. **Treat implementer security claims as hypotheses.** Two were confidently false this phase.
4. **Explicit file lists in every commit** when concurrent agents are live. Directories are not tight
   enough.
5. **Conflict-check fix rounds, not only tasks.** A fix round re-enters files its task released.
6. **Close the loop on backlog entries** fixed within the same phase, before merge.
7. **Audit prior phases' exit criteria** at each phase start. Phase 0's flake survived two phases.

---

## Carried forward

Filed in [`backlog.md`](backlog.md) with evidence. The ones that matter most:

- **Review fan-out is architecturally unbounded** — one LLM call per file × agent, no
  `max_concurrency`. `REVIEW_QUEUE_CONCURRENCY=5` bounds job slots, not provider calls: five
  concurrent large-PR reviews could mean ~600 simultaneous calls. Established by source reading;
  quantifying it needs a real large PR and an API key. **Highest-value item on the list.**
- Review-job retries duplicate the per-agent retry (`worker.ts` re-throws into BullMQ `attempts: 3`);
  the fix queue deliberately does not.
- Prose credentials (`password: hunter2`) still reach sinks — no secret shape, so catching them needs
  an amendment to the frozen §5 pattern set with real false-positive risk on ordinary prose. (The
  URL-embedded half of this finding was closed; the entry was split so the remainder is scoped
  honestly.)
- Webhook-side fix failures (`no_repo`, `no_model`) never reach Python, so they are invisible in the
  `arete.fix.*` counters.
- The memory row cap is check-then-create with no transaction, and nothing ever sets
  `status='archived'`, so a repo is permanently frozen at 20 memories.
