# Phase 1 Retrospective — Observability Integration

**Branch:** `stroland02/obs-phase-1` (45 commits off `integration-preview@b1fa954`)
**Dates:** 2026-07-20 → 2026-07-21
**Process:** subagent-driven development — one implementer + one independent reviewer per
chunk, fix loops until both verdicts clean, then a whole-branch review on the most capable
model available.

---

## What shipped

Every Areté service now emits traces, metrics, and structured logs to a local
OpenTelemetry stack, with three independent layers of secret redaction between the
application and storage.

| Area | Delivered |
|---|---|
| `@arete/telemetry` (new) | Redaction core, span scrubber, env-driven SDK init, pino factory |
| webhook + worker | Boot wiring, bullmq-otel on every queue, `review.run` span tree, `arete.*` metrics |
| dashboard | Guarded `@vercel/otel` instrumentation, `/api/health` |
| agents (Python) | `init_observability()`, FastAPI + LLM instrumentation, structlog censor pipeline |
| infra | Collector (redaction + transform), ClickHouse schema we own with TTLs, Jaeger v2, Prometheus |
| gates | Per-signal verification harness, credential audit, canary scrub tests wired into CI |

Trace continuity was verified across every hop — webhook → Redis queue → worker → HTTP →
FastAPI → LLM spans — including the BullMQ-through-Redis and LangGraph thread fan-out seams.

---

## The headline lesson: reviews caught seven real defects, and only one came from sloppy work

Every implementer chunk passed its tests before review. Reviews still found:

| # | Defect | Origin | Would have caused |
|---|---|---|---|
| 1 | Array-valued span attributes bypassed scrubbing (both lanes) | plan's reference code | secrets in arrays reaching storage |
| 2 | `OTEL_SDK_DISABLED` ignored in Python | plan's reference code | kill switch silently dead |
| 3 | Prompt/completion capture ON for Anthropic + LangChain | plan never mentioned the flag | **customer source code and PR diffs in telemetry** |
| 4 | Collector wrote exp-histograms to a nonexistent table | plan's frozen config | a whole metric type silently dropped |
| 5 | Gemini credential test asserted on attributes that don't exist | plan's reference code | a security gate that could never fail |
| 6 | URL query strings unscrubbed in 3 of 5 attributes | plan + a lane with no in-process scrubber | **live OAuth codes persisted 30 days** |
| 7 | Log scrubber crashed on Error subclasses | **a fix we dispatched** | handled errors becoming unhandled; failed reviews |

**Five of seven came from the plan's own frozen reference code.** The plan was detailed and
well-researched, which is exactly what made it dangerous: implementers copied it verbatim,
as instructed, and its bugs propagated with full confidence behind them.

**Defect 7 is the sharpest lesson: a fix introduced a worse bug than the one it fixed.** The
I3 fix correctly added value-shape scrubbing to logs, then implemented it by reconstructing
errors via `new value.constructor(message)` — which throws on Octokit's error class. Because
it ran inside `catch` blocks, it converted handled errors into unhandled ones. A GitHub
rate-limit on a config fetch would have failed an entire review.

### What actually caught them

Not tests — the suites were green in every case. Not diff reading either. Every one was
caught by a reviewer who **read the installed dependency's source or ran a probe against it**:
decompiling `@vercel/otel` to find the localhost fallback, reading `clickhouseexporter`'s
`buildMetricTableNames()`, constructing an Octokit error and watching it throw, introspecting
a Gemini client to find the assertions pointed at nothing.

**Adopt as standing practice:** when a review touches a third-party integration, the reviewer
must verify behavior against the installed package, not the documentation, the plan, or the
diff.

---

## What worked

- **Independent reviewer per chunk.** No implementer caught their own spec violation; every
  reviewer caught at least one. The cost (roughly double the agent invocations) bought seven
  defects, two of which were data-exposure holes.
- **Demanding evidence, not assertions.** Requiring reviewers to reproduce claims turned up
  the vacuous Gemini test and an undisclosed 70-second failure path.
- **Negative controls.** The end-to-end redaction proof was only trustworthy because the
  first run *failed* — the collector had been running on the pre-fix config. A passing test
  with no failing counterpart proves much less than it appears to.
- **Red-then-green on every fix.** Each fix demonstrated its test failing against the old
  code first. This is what distinguishes a real regression test from a decorative one.
- **The ledger.** `progress.md` survived a context compaction and two agent deaths. Without
  it, completed chunks would likely have been re-dispatched.

## What didn't

- **Two implementers in one working tree.** `git commit` commits the whole index, so
  concurrent agents swept each other's staged files into the wrong commits — twice. Both were
  caught, nothing was lost, but it polluted history and cost time.
  **Fix: isolated worktrees for parallel implementers, or pathspec-limited commits
  (`git commit -- path`) as the standing rule.** The latter was adopted mid-phase and worked.
- **One implementer's report contained a false claim** — asserting a stray deletion had been
  corrected when no commit had done so. The end state was fine by coincidence. Self-reported
  verification is not verification; the reviewer caught it by checking the git history.
- **Two agents died on API session limits mid-task**, one leaving unbacked DoD checkboxes
  ticked with no evidence file. Those ticks were not trusted: the work was re-run and only
  then committed. **Never accept a checkbox as evidence of the check.**
- **Plan-as-frozen-truth.** Briefs said "use these exact values verbatim," which is right for
  consistency and wrong when the plan is incorrect. Implementers had no mandate to question
  the code they were transcribing.

---

## Actions for Phase 2

1. **Reviewers verify against installed packages.** Make it an explicit line in the reviewer
   prompt template, not a hope.
2. **Parallel implementers get isolated worktrees.** Or, at minimum, pathspec-limited commits
   enforced in the dispatch prompt.
3. **Briefs get a "challenge the plan" clause.** If the plan's code contradicts the installed
   library, the implementer must stop and report rather than transcribe.
4. **Every security gate needs a mutation test.** A gate that has never been observed failing
   is not known to work. Both the canary scrub and credential audit now have one; make it the
   rule for new gates.
5. **Fixes are reviewed as rigorously as features.** Defect 7 shipped through a fix dispatch
   that got less scrutiny than an implementation chunk. Same bar for both.
6. **The DoD run produces a file before it produces checkmarks.** Evidence first, ticks after.

---

## Carried forward

Non-blocking findings are filed in [`backlog.md`](backlog.md) under *From Phase 1 final
whole-branch review*. The notable ones:

- `review-pr-heavy` has a producer but **no consumer** — those reviews never run (pre-existing).
- Python span names drift from the frozen §5 convention (`agent_review:{name}` vs `agent.review`);
  either rename or amend the spec.
- Spec §6 gate 4 (egress via `@arete/net-guard`) is unaddressed — needs an owner or an explicit
  "satisfied because exporters only reach a loopback collector" ruling.
- Dev credentials in the collector config must not survive into any deploy path.

**Operational note worth repeating:** the OTel collector does **not** hot-reload its mounted
config. Config changes require a container restart — discovered the hard way, when a redaction
fix appeared not to work.
