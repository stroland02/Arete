# Areté / Kuma — scope review and recommendations

**Date:** 2026-07-23 · **Author:** A-view (Opus 4.8) · **Requested by:** the user, on switching to the
stronger model, for "a full overview... and any recommendations or changes that it would like to make
to improve it."

This is a candid engineering assessment from inside a long multi-agent build session, not a status
report. Where I think something is wrong or risky, I say so plainly.

---

## 1. What Kuma is, in one paragraph

Kuma is an AI code-review product that **reviews its own work** — six specialist agents (security,
performance, quality, test-coverage, deployment-safety, business-logic) examine a change, a
critic/synthesizer verifies each finding against the actual diff, and a human holds two gates
(approve the solution, then post the PR). Its differentiator is the **HITL moat** plus an
anti-fabrication stance enforced structurally: a finding without resolvable `{path, line}` evidence
is dropped, an empty result is an honest `no_findings`, and no control that cannot act is ever shown
as if it can. The nine-package monorepo (dashboard, webhook, agents, db, telemetry, topology,
orchestration, internal-token, net-guard) is coherent and the boundaries are real.

## 2. What is genuinely solid

- **The honesty discipline is the best thing here and it is load-bearing.** `null ≠ []`, disabled ≠
  hidden, no fabricated status. It is enforced in code, in tests, and in the review culture. Most
  products claim this; this one actually does it. Keep it non-negotiable.
- **The core loop works, verified live today.** A scan ran 33 minutes against the slow local model
  and completed — the first time ever — producing 10 real findings now rendering on Services. The
  path scan→findings→inbox→UI is proven end to end.
- **Tenancy is a real security boundary,** scoped through one resolver (`getAccountState`,
  `installationId IN (...)`), not re-derived per surface. The internal-token JWT (120s, kid-keyset,
  fail-closed 503) is properly done.
- **Test coverage is strong where it counts** — 770 dashboard tests, characterization-first on
  untested surfaces before refactors. The discipline of "write the pin test first, watch it fail for
  the right reason" caught two of my own wrong assumptions this session.

## 3. The real problems, ranked by leverage

### 3.1 The tracker keeps lying, and it is the same failure every time
Roughly 1 in 5 catalogue claims were wrong when checked, and the two most damaging were rows marked
**shipped for work that never merged** (silence-control, and my own 2.1). A row wrongly open costs
minutes; a row wrongly shipped means **nobody looks again** and the product advertises a capability
it lacks. Root cause: close-out notes get written from a worktree describing work that never reached
`main`, and `verifiedAt` does not decay. **Recommendation:** treat `verifiedAt` as expiring (hours,
not weeks, at four lanes' velocity), and never let a row go `shipped` from a state check — only from a
`git merge-base --is-ancestor` proof that the implementing commit is actually on main. This is the
single highest-leverage process fix.

### 3.2 Coordination is eating the fleet's output
In one 12-hour window, **50 of 87 commits touched zero product code** — ledger, tracker, lane
registry, backlog. Four agents got very good at *describing* work. The "docs-only tick is a no-op"
rule helps, but the ratio says the coordination substrate is too heavy. **Recommendation:** collapse
the three overlapping coordination files (ade-coordination.md, lanes.json, build-tracker.json) toward
one machine-checkable source. Every human-prose ledger entry is a place two lanes will fork.

### 3.3 The Reviews path is unexercised — and it is half the product
Scans now work. **PR reviews do not run locally at all** — Overview's headline tiles (PRs reviewed,
critical issues, reviews this week) are structurally blank because there are 0 `Review` rows, and a
Review needs a real GitHub PR webhook we cannot fire here. So the product's *named* feature —
reviewing pull requests — has never been dogfooded end to end in this environment.
**Recommendation:** build a dev-only "review this local diff" path that exercises `/review` the way
the scan retest exercised `/scan`, or the review half stays unverified indefinitely.

### 3.4 One browser profile blocks the verify stage for three of four lanes
Only one lane can drive the authenticated app at a time (single Chrome MCP profile, no seeded
session). D-verify marked 34 rows `verifiedAt` from **reading code, never rendering a page** — and
said so honestly, which is to their credit, but it means the workflow's drive-it stage is a
single-threaded bottleneck. **Recommendation:** per-lane `--isolated` browser profiles + a seeded dev
session, so "verify" is not owned by whichever lane grabbed the profile.

### 3.5 The scan fix is a survival hack, not a root cause
The ~300s ceiling was real (three reproductions) but never identified — a counter-test disagreed, and
the ack-and-poll rework *works around* the unknown killer rather than naming it. That is the right
call under time pressure, but an unidentified network limit that severs long connections will bite
something else eventually. **Recommendation:** the one experiment that settles it — a server writing
zero bytes for 310s — is still worth running once.

## 4. Recommendations I would act on first, in order

1. **Make `shipped` provable, not assertable** (3.1). Cheapest, highest trust-return.
2. **Build the dev-review path** (3.3) so the product's headline feature can be dogfooded.
3. **Seed a dev session + per-lane browser profiles** (3.4) to unblock verification.
4. **Thin the coordination substrate** (3.2) toward one checked source.
5. Close the two remaining `critical` items: prose-shaped-credential leak, and the parked $0
   Anthropic balance (a business, not engineering, blocker).

## 5. One thing I would NOT change

The instinct to slow down and gate — characterization tests, the fact-forcing prompts, the "verify by
driving the real flow" rule, the refusal to seed fake data even when asked. It is expensive and
occasionally maddening, and it is exactly why the product can honestly claim it checks its own work.
Do not trade it for velocity; the whole value proposition rests on it.
