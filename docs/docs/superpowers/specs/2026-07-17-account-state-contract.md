# The Account-State Contract — keeping the UI synchronized with the connected account (2026-07-17)

**The problem this exists to prevent.** After we cleared fabricated review rows, several pages regressed to
"connect a repository" prompts even though a repository was connected. Root cause: each surface re-derived
"are we connected?" its own way, keyed on whether *review activity* existed rather than on what was actually
*connected*. When activity dropped to zero, the UI desynchronized from reality. Losing sight of the user's
real connection state is unacceptable — this contract makes it structurally impossible to regress.

This is our application of the same discipline professional software uses to protect user state:
**a single source of truth** (state-management practice), **explicit lifecycle states** (SDLC), a
**Definition of Done** that includes them (Agile), and an **automated guard in the pipeline** (CI/CD).

---

## 1. The single source of truth

`packages/dashboard/src/lib/account-state.ts` → `getAccountState(db, installationIds): AccountState`.

Every dashboard surface derives its empty-states and CTAs from this resolver. **No page may re-derive
connection facts locally.** One resolver, one truth, every surface consumes it.

```
AccountState {
  repoConnected: boolean     // a repository/installation is connected
  repoCount: number
  modelConnected: boolean    // an AI model is connected (the agents' real dependency)
  hasReviews: boolean        // at least one review actually ran
  reviewCount: number
  stage: "disconnected" | "connected_idle" | "active"   // the canonical lifecycle
}
```

## 2. The three-state rule (the law every surface obeys)

A surface MUST distinguish three stages and MUST NEVER collapse "connected but idle" into "not connected":

| Stage | Condition | What the surface shows | Forbidden |
|---|---|---|---|
| **disconnected** | no repo connected | "Connect a repository" CTA → `/connections` | — |
| **connected_idle** | repo connected, no reviews yet | connected state + next real step: connect a model (`/connections/ai-models`) or open a PR. "Manage repositories", not "Connect a repository". | **Never** "connect a repository" |
| **active** | reviews exist | the real data | fabricated/sample data |

**Corollary — reflect what's connected, at the staging point.** A connected repo with no PRs is a *valid,
populated* state ("connected to `owner/repo`, awaiting first PR"), not an empty one. The overview, services,
agents, and dashboards must all show the connected repo, the connected model, and the awaiting-activity
status — the staging inputs — even before any review has run.

## 3. Anti-fabrication still holds

The three-state rule and anti-fabrication are complementary: show the real *connection* state always, and
show real *activity* data only when it exists. `connected_idle` is honest ("connected, nothing has run yet")
— it is not license to fabricate a review. Never invent activity to fill a connected-but-idle surface.

## 4. Durability — persist the link, don't only derive it

Connection state is currently derived live per request (GitHub token → installation-owner match). When that
derivation hiccups, `installationIds` comes back empty and the whole UI reads "disconnected" though the
Installation row exists. **Eng1's durable account↔installation ownership rows** remove this fragility: the
link is stored at connect time; the live derivation becomes a fallback, not the sole source. This is the
structural half of the fix — the resolver is only as reliable as the `installationIds` it's handed.

## 5. How the roles uphold this

- **Software (architecture):** the resolver (§1) + the rule (§2). Enforced in code, not by convention.
- **Engineers (SDLC):** every new or changed surface reads `getAccountState`. Reviewers reject a page that
  branches its empty-state on anything else. New surfaces cite this contract.
- **PM + Agile (Definition of Done):** a surface is not "done" until it renders correctly for all three
  stages. Ship checklist gains one line: *"disconnected / connected_idle / active all correct?"*
- **CI/CD (the gate):** `account-state.test.ts` encodes the three-state rule as assertions and runs in the
  integration gate. Extend it with a per-surface state-matrix test as surfaces adopt the resolver. A desync
  fails the build — it can no longer reach a user.

## 6. Adoption checklist (rollout)
- [x] Resolver + three-state test guard (`account-state.ts`, `account-state.test.ts`).
- [x] Agents empty-state keys on model connection, not repo.
- [x] Services rail CTA: "Manage repositories" when connected, not "Connect a repository".
- [ ] Overview + dashboards: render the connected repo/model/awaiting-activity staging state from the resolver.
- [ ] Every surface migrated to consume `getAccountState` (retire ad-hoc `hasAccess`/`hasReviews`-only checks).
- [ ] Eng1: durable account↔installation ownership rows (§4) so `installationIds` never wrongly empties.
