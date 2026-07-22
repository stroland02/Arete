# Phase 3 Retrospective — Credential Integrity, Frontend Consumption, Harness Efficiency

**Branch:** `stroland02/obs-phase-3` (off `integration-preview@04ca7a0`)
**Date:** 2026-07-21 · **Process:** subagent-driven, independent review on security-critical chunks only, executed with a wide parallel agent pipeline
**Predecessor:** [`2026-07-21-phase-2-retrospective.md`](2026-07-21-phase-2-retrospective.md)

---

## The headline: CI caught what every local review — including the whole-branch review — could not

Twelve tasks were implemented and individually reviewed with mutation tests. The final whole-branch
review, on the most capable model, ran the Python security suite **74/74 green** and declared the
branch **SOUND — safe to merge**. Then CI failed one test:

> `test_verify_returns_unknown_kid_when_the_kid_was_revoked` — a **revoked** signing key was
> **accepted** (`ok=True, kid='k1'`) instead of rejected.

The bug was real and it was in the security-critical path: `load_keyset()` read the keyset through
the `@lru_cache`d `get_settings()`. In the local sandbox there is no `ANTHROPIC_API_KEY`, so
`Settings()` construction raises and the code falls through to a **live** `os.environ` read — the
test's key-removal is honoured, the test passes. In CI (and in production) a provider key **is**
present, so `Settings()` succeeds and freezes the original keyset for the process; a later env change
(revocation) is masked by the cache, and the revoked key keeps working.

**Every local reviewer exercised the env-fallback path; only CI exercised the Settings-cached path
that production actually uses.** This is Phase 2's action 2 — *reviewers probe the running system* —
recurring one layer deeper: the "running system" now includes the CI/prod **environment**, not just
the installed code. A green suite in a sandbox that differs from prod by one env var said nothing
about the path prod takes.

**Actions:**
1. **A CI job must run in the environment that reveals the code path prod uses.** The keyless sandbox
   masked a whole branch. Security-critical env-dependent behaviour (cache warmth, provider keys)
   needs a test that pins the prod-condition path — the hotfix added exactly that: a regression test
   that verifies revocation *under a warm `Settings` cache*.
2. **The signing/verification path must not read secrets through a cached accessor.** Fixed
   structurally: `load_keyset()` now reads `os.environ` first (per-call, cache-immune), mirroring how
   the TS side reads `process.env` per request. Revocation and rotation take effect without relying on
   a process restart to clear a cache.

---

## A finding dismissed as "out of scope" was the blocker

The Task 4 fix agent flagged the `get_settings()` lru_cache staleness and labelled it "a separate
pre-existing gap, out of scope." It was not separate and not out of scope — it was the exact defect
that broke revocation in CI. **A latent issue flagged in a security-critical path deserves a decision,
not a default deferral.** The cost of dismissing it was one red CI run and a hotfix cycle; the cost of
shipping it would have been a revocation mechanism that silently doesn't revoke.

**Action:** when an agent flags "pre-existing / out of scope" on a security-critical file, the
controller adjudicates it explicitly before merge rather than trusting the label — the same rule
Phase 2 set for implementer security *claims*, extended to implementer *deferrals*.

---

## What the whole-branch review did that per-task review could not — and what it still couldn't

The per-task reviews each verified one task. Only the whole-branch review checked the **cross-cutting**
property that is the actual point of the phase: that the signed-token *triangle* interoperates —
dashboard→webhook, agents→webhook, webhook→agents all authenticating off one shared keyset with one
wire format, verify deliberately issuer-agnostic so no hop is locked out. That is real value a
per-task gate structurally cannot provide, and it confirmed it with evidence (same env pair, same
fixture, byte-for-byte).

But the whole-branch review shared the sandbox's blind spot: it ran in the same keyless environment,
so it too missed the cached-`Settings` path. **"Whole-branch review" is not "CI," and neither replaces
the other.** The review found interop correctness a test matrix wouldn't assert; CI found an
environment-dependent defect the review couldn't reach. Both were necessary; shipping on either alone
would have shipped a bug.

---

## What worked

- **Wide parallel execution held without a single cross-agent collision.** Up to five agents ran
  concurrently — three implementers on disjoint packages (agents / dashboard / webhook) plus
  overlapping read-only reviews — and roughly halved wall-clock. Phase 2's hard-won conflict rules
  were the enabling constraint: **disjoint file sets** (never two implementers in the same file/
  directory), **explicit file-list commits** (never `git add .`), and **review packages keyed to each
  agent's reported commit SHA** rather than `HEAD` (interleaved commits make HEAD-relative bases
  wrong). Not one of Phase 2's collision failure modes recurred.
- **Mutation tests on every security gate earned their keep.** The expiry gate — *unmet* in Phase 2
  because expiry was inexpressible — is now genuinely enforced: a past-`exp` token → 401 on both the
  TS and Python verifiers, each proven by a mutation that turns the check off and watches the test go
  red. Revocation, rotation, and the byte-for-byte cross-language pin are all mutation-backed.
- **Structural fixes over validation, continued.** The Alertmanager hop kept a *separate* static
  credential rather than bending one scheme to cover a party that can't sign; the keyset read moved to
  env-first rather than papering the cache with a test-only reset; the MCP flow *fails closed* rather
  than validating a fabricated token. A property you enforce by construction can't be regressed by a
  missed check.
- **Honest deferrals, backlogged with evidence.** The un-tuned concurrency N, the haiku-authoring
  question, MCP refresh/discovery, and the `processGitHubCheckRun` twin of the retry fix were all
  filed with file:line evidence rather than silently dropped or guessed at.
- **An agent adapted correctly when the plan was wrong.** Task 8's brief named `lib/issue-pipeline/*`;
  the Services view-model actually lives in `lib/work-items.ts` + `WorkItemPanel`. The implementer
  found the real structure, implemented against it, and said so — rather than forcing the plan's
  stale path.

## What didn't

- **The new package shipped without its own CI gate.** `@arete/internal-token` — the security
  primitive at the centre of the phase — was not in the CI matrix; its own vitest (the vector pin, the
  verify mutations) ran only under reviewers and transitively via consumer builds. This is Phase 2's
  action 1 recurring verbatim: *an interface a phase produces needs something outside it exercising it
  before the phase closes*, and CI is that something. Added to the matrix this phase, but it should
  have been added with the package, not after a reviewer noticed the gap.
- **Pre-existing keyless test failures masked signal.** Nine agents-suite tests fail without
  `ANTHROPIC_API_KEY`; every agent had to re-derive (via `git stash`) that these were environmental,
  not their regression. A suite that is red-by-default in the sandbox makes every real failure harder
  to see — the revocation failure was one red line among ten, and only visible because CI ran green
  elsewhere. Phase 0's flaky-test debt is still taxing every phase downstream.
- **A stale plan path and a loose inherited comment** both rode a brief's wording into
  implementation. Neither caused a defect (the agent corrected the path; the comment is harmless), but
  both trace to plan text the controller wrote — a reminder that the plan is an input to review, not
  above it.
- **Cost ran high.** Wide parallelism and the security fix-and-re-verify rounds pushed spend well past
  the phase target. The parallelism bought wall-clock, not tokens; the fix rounds bought two real
  defects closed (the expiry-boundary parity and the revocation cache bug). Worth it, but the wide
  pipeline should be a deliberate choice per phase, not a default.

---

## Actions for Phase 4

1. **Every new package/interface enters the CI matrix in the same commit that creates it** — not after
   a reviewer catches the omission.
2. **Security-critical env-dependent paths need a test pinned to the prod condition** (warm cache,
   provider key present), because the default sandbox exercises the other branch.
3. **Adjudicate "pre-existing / out of scope" flags on security-critical files explicitly** before
   merge — treat a deferral like a claim.
4. **Finally pay down Phase 0's keyless/flaky test debt** — it has now taxed three consecutive phases
   and actively masks real failures.
5. **Keep the disjoint-file-set + explicit-file-list + SHA-keyed-review discipline** for parallel
   execution — it is what made five concurrent agents safe.

---

## Carried forward

Filed in [`backlog.md`](backlog.md) with evidence. The ones that matter most:

- **`@arete/internal-token` CI job** — added this phase; verify it stays in the matrix.
- **MCP `token_url` has no CLI setter** (`cli.py`) — until it does, every real MCP auth hits the
  (honest) fail-closed path; the real exchange is exercised only by unit tests.
- **Review concurrency N=8 is un-tuned** and **haiku-authored fixes are unvalidated** — both need a
  real large PR + Anthropic key.
- **`processGitHubCheckRun` retry duplication** — the CI-diagnosis twin of the review double-retry
  fixed in Task 10, still unaddressed (no test harness).
- **Phase 0 flaky/keyless test debt** — nine agents tests red without a provider key; still not
  quarantined two phases after it was first noted.
