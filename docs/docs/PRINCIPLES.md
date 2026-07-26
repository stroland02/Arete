# Kuma — Principles

**Last reviewed:** 2026-07-23

The rules that decide what we build and what we refuse to build. They were scattered across
`docs/handoff/2026-07-22-orchestration-briefs.md` §0, the safety section of
`docs/superpowers/plans/2026-07-23-reachability-and-consolidation-roadmap.md` §1, and the
account-state and telemetry-tenancy specs. This is their one address.

Read this before starting work. The companion is
[`packages/dashboard/data/build-tracker.json`](../packages/dashboard/data/build-tracker.json) —
*what* to build. This file is *how*, and *what never to do*.

---

## 1. Mission

**Kuma — your AI Software Healing Engineer.**

Six specialist agents review every pull request, verify each finding against the real diff, and
propose fixes a human approves. The long-term shape is a system that notices, diagnoses and heals
software the way a living organism does — detect, isolate, repair, remember.

**The wedge is the review product, and it is live.** The platform ambitions — tenant telemetry
ingestion, proactive improvement, the public API — are deliberately deferred, not forgotten. They
are recorded in the build status with a reason, so deferral stays a decision rather than a drift.

---

## 2. Honesty is the product

This is the differentiator, not a nicety. An AI tool that quietly invents a plausible answer is
worse than no tool, because it costs the user their ability to trust anything it says. Every rule
below exists because we would rather show less than claim more.

- **Never fabricate data, status, or a passing result.** No invented findings, no invented diffs,
  no invented "done".
- **Empty states say what is actually true.** "No reviews yet" and "couldn't reach the backend" are
  different sentences, and the user is entitled to know which one applies.
- **`null` (unavailable) is never `[]` (none).** Collapsing them is a lie about whether we looked.
- **A control that cannot act is `disabled`, with the reason** — never a live-looking button with no
  handler, and never hidden. Hiding it teaches the user the feature doesn't exist; a dead button
  teaches them the product is broken. A disabled control with a reason teaches them the truth.
- **A badge is a promise.** `partial` or `soon` next to a control means it will not surprise you.
  A readiness badge on a live-looking button is worse than no badge at all.
- **If you cannot verify something, say so.** "Tests pass" without output is not evidence.
- **Never claim a fix is verified when it was not driven.** A green suite is not a driven flow.

Corollary for reports and docs: an entry asserting a live problem that no longer exists misstates
shipped reality just as badly as a claim that a hole is closed when it is not. Strike it through
with the evidence; don't silently delete it.

---

## 3. The human-in-the-loop moat

Nothing merges, posts, or ships autonomously. Ever.

- The fix driver never advances past `ready`. Only a **human** approve sets `solution_approved`;
  only a **human** Send posts the pull request.
- `automerge: immediately` is never adopted. Apply runs only off an already-`EXECUTED` approval.
- "No" must be an answer a human can actually give — a refusal branch nothing can trigger is dead
  code pretending to be a safeguard.
- Confirm before anything hard to reverse or outward-facing. Approval in one context does not carry
  to the next.

This is the feature we would demo. When it is built but unreachable, it is worth nothing.

---

## 4. Tenancy is a security boundary

- **Every query is scoped by `installationId`.** Session-authenticated routes scope to
  `session.installations` — never trust a client-supplied `installationId`.
- **Derive connection state from `getAccountState`**, never re-derive it locally, and never collapse
  connected-but-idle into not-connected
  (`docs/superpowers/specs/2026-07-17-account-state-contract.md`).
- **Gate every self-telemetry read on `isPlatformInstallation`** before issuing SQL
  (`docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md`). An access decision must never
  masquerade as a data outcome: "you may not see this" and "the backend is down" are different states.
- **One resolver, one truth.** A security gate must have exactly one implementation. Two copies are
  two places to drift, and drift here is a tenant leak. (A pure hash may be mirrored; a gate may not.)
- **Never issue an unscoped `DELETE` against tenant data**, and never clear state someone is actively
  inspecting — even when an earlier instruction appears to authorise it. An unscoped
  `DELETE FROM "ErrorGroup"` destroyed a live investigation's groupings on 2026-07-22.
- **Losing a platform alert is recoverable; filing it against an arbitrary customer is not.** When
  the tenant cannot be resolved, drop the work.

---

## 5. Bring your own model

Every tenant action rides the tenant's own key and their own bill.

- Keys are **encrypted at rest** (AES-256-GCM, `TELEMETRY_ENCRYPTION_KEY`), **never logged**,
  **never returned by an API**, decrypted in memory only.
- A key is **never destroyed as a side effect**. Providers do not re-issue them. Re-connecting
  without re-entering a key preserves the stored one; removing a key is an explicit, confirmed act.
- A provider error is **surfaced, not swallowed**. "Your credit balance is too low" is the user's
  answer; a generic 503 is not.
- Local Ollama is a real, free default — described as free, never as unlimited or infinite.

---

## 6. Working rules

- **`prisma migrate deploy`, never `prisma db push`.** All worktrees share one Postgres; `db push`
  syncs it *down* to your schema and silently drops other people's columns. It has done so three
  times.
- **Characterization tests first** on any untested surface you are about to change: pin today's
  behaviour through the public API — never by exporting internals — and confirm it passes against
  the untouched file.
- **Separate moving from fixing.** A refactor commit changes no behaviour; a fix commit moves no
  code. Mixing them makes both unreviewable. Find a bug mid-move? Write it down and leave it.
- **Verify by driving the real flow in the running app**, not only a green suite. Paste evidence.
- **Declare cross-lane edits in `.claude/ade-coordination.md` BEFORE editing.** Claim one package.
- **Report what contradicts the plan.** It is the most valuable thing you can surface, and it is
  never unwelcome.
- **Definition of done:** tests pass and you ran them; `tsc --noEmit` clean; you drove the real flow;
  no fabricated data; one small honest commit.

---

## 7. How this connects to the build status

[`packages/dashboard/data/build-tracker.json`](../packages/dashboard/data/build-tracker.json) is the
**single** source of truth for what remains, and `/build-status` renders it. Its contract lives in
`packages/dashboard/src/lib/build-tracker/schema.ts`.

There was briefly a second record (`docs/roadmap/master-build-status.json`) while three lanes built
this in parallel. It is **retired** — two records drift, and the drift always wins. Its curated
themes survive as `tags` on the items themselves (`honesty-security`, `onboarding-install`, `sdlc`,
`product-commercial`, `surface`, `parked`).

Four conventions keep the list honest:

- **Every item carries `provenance`** — the doc, commit or session it came from — and the parser
  *enforces* it for anything whose `origin` is not `user`. No claim on the page is unfalsifiable.
- **`verifiedAt` absent means never verified, and the page must say so.** Absence must never render
  as a tick. The seed transcribed the audits it cites; it did not re-confirm each against the code.
- **`programmes` is an array of refs, not one value.** Four numbering systems run here at once, and
  merging them would invent a progression that does not exist. An item outside all four carries no
  programme rather than a fabricated one.
- **Parked work keeps its reason.** Anything needing a funded key, production volume, aged data or
  someone else's approval is blocked with an `ext:` blocker naming why — never quietly dropped, and
  never dressed up as a plan.

The `honesty-security` items exist because of §2 and §4: while any of them is open, the product is
asserting something about itself that is not true. Those come first.
