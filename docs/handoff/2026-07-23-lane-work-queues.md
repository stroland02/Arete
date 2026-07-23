# Lane work queues — run these unattended

**Date:** 2026-07-23 · **From:** Lane B (pyrosome) · **Source:** `data/build-tracker.json`

Every id below is a real row in the tracker. Work them top-down; the ordering is
`importance` then `rank`, straight out of the file.

---

## Read this before starting: "all items complete" is not reachable

The tracker has **77 open items**. Of those:

- **65 are actionable now.**
- **12 cannot be completed by effort at all**, tonight or ever, until something
  outside the repository changes. Listed in full below so nobody burns a night on
  them.
- **16 are blocked on another tracked item**, so order matters — do the blocker.

Anyone reporting "all build-status items complete" would be reporting something
that cannot be true. Report what closed, and name what did not.

### The 12 that are externally blocked

| Item | What it actually waits on |
|---|---|
| `parked-anthropic-zero-balance` | the Anthropic account is at $0 — add credit or run on Ollama |
| `parked-haiku-fix-authoring-adequacy` | a funded key **and** a regression corpus to measure against |
| `parked-review-concurrency-tuning` | a real large PR plus a funded key |
| `parked-review-job-double-retry` | a genuinely induced transient provider failure mid-review |
| `parked-signals-visibly-render` | a real Alertmanager alert — **synthetic seeds are forbidden** |
| `parked-error-severity-log` | an ERROR-severity row that does not yet exist |
| `parked-clickhouse-ttl-verification` | real aged data; every row here is hours old |
| `parked-review-comment-indexes` | `EXPLAIN ANALYZE` at scale before adding any index |
| `parked-code-map-browser-qa` | a human browser pass a unit suite cannot stand in for |
| `parked-mcp-rfc8414-discovery` | speculative until a real MCP server needs it |
| `connect-sentry` | Sentry's own integration approval — not on us |
| `google-oauth-client-missing` | the OAuth client was deleted upstream in Google Cloud Console |

Three of those need **money**, and one needs **someone else's company** to act.
No amount of overnight work moves them.

---

## Lane A — the view (39 actionable)

You own `build-status/page.tsx`, `build-status-editor.tsx`,
`api/build-status/route.ts`, and the dashboard UI generally.

**Start here — the page now renders `data/build-tracker.json` (Lane B, `141cff8`),
so it shows 85 rows instead of 24.** Pull that before touching anything, or you
will conflict with a swap that is already done.

1. `security-assessor-fabricates` — **critical, and verified still true on main.**
   `skills/security.py` returns "simulated results" from a docstring-documented
   stub. It is the last live fabrication in the agents package and must never
   reach the UI as-is. A fix exists on an unmerged branch (`4789bdb`) — take it
   or write your own, but do not leave it rendering.
2. `surface-agents`, `surface-overview`, `surface-services` — the three partial
   product surfaces, highest user-visible value.
3. `agent-config-persistence` — every agent control is local-only and never
   saved. Right now it is a form that forgets.
4. `outbound-webhook-management-ui` — the API is built and behind session auth;
   nothing renders it. **The `whsec_` secret is returned exactly once on create
   and no route can read it back — the UI must show it once and say so.**
5. `agent-memory-ui`, `live-throughput-metrics` — built, unreachable.
6. `fix-dismiss-no-full-reload`, `scan-completion-signal` — `window.location.reload()`
   and a `setTimeout` unconnected to completion. `router.refresh()` already
   exists here as the better-behaved sibling.

Then: `retire-agents-nav`, `adopt-account-state-agents-map`, `surface-connections`,
`surface-incident-detail`, `surface-settings`, `manual-investigation-start-fix`,
and the remaining 17 medium/low UI rows in the file.

## Lane B — the engine (19 actionable) *(this lane)*

1. `collector-plaintext-credentials` — **critical.** `otel-collector-config.yaml`
   commits ClickHouse credentials in the clear.
2. `sse-endpoint-unauthenticated` — **critical.** No auth, no tenant scoping,
   `CORS *`. Harmless while everything is loopback; a live hole the day it is not.
3. `mcp-token-plaintext-and-simulated-oauth` — narrowed today to what is actually
   true: cleartext at rest. Encryption exists on an unmerged branch (`63f1ad3`).
4. `checks-update-double-retry` — an unguarded second `checks.update` inside the
   publish-failure catch on **both** worker paths re-throws and makes BullMQ
   retry the whole pipeline, at full LLM cost.
5. `python-fingerprint-decision` — needs a ruling, not code: a shared service, a
   generated port with golden vectors, or an explicit spec amendment.

Then `agent-memory-cap-and-archive`, `password-reset-and-email-verification`,
`relays-slack-linear-pagerduty`, `self-serve-upgrade-billing`, and the low rows.

## Lane C — the data (7 actionable)

1. `prose-credentials-reach-sinks` — **critical.** `password: hunter2` as prose
   matches no secret shape and no blocklisted key. Fixing it means amending a
   **frozen** pattern set with real false-positive risk ("the password field is
   required" would be mangled), so it needs a written amendment, not a patch.
2. `delete-synth-ledger` — exported, imported by nothing.
3. `send-route-work-item-posted`, `review-scope-filters`,
   `review-pr-url-and-reason-codes`, `public-api-and-keys`,
   `topbar-search-and-notifications`.

Also yours, and worth doing first because it is cheap: **reconcile the two
records.** `docs/roadmap/master-build-status.json` and `data/build-tracker.json`
are both on main. Two records drift. Pick one canonical, make the other derived
or delete it.

---

## Standing rules for unattended work

- **Rebase onto fresh `origin/main` before every push.** Main moved three times
  in one evening (`a21f956` -> `af9f34f` -> `c8e4d57`).
- **Never `prisma db push --accept-data-loss`.** All worktrees share one Postgres
  and this has already destroyed other checkouts' columns three times.
- **Do not take another lane's port.** 3002 ridley, 3005 nautilus, 3009
  Project-Manager. `AUTH_URL` is pinned to :3000, so serving elsewhere misroutes
  login into another worktree's build.
- **Do not edit `pnpm-lock.yaml` from two worktrees at once.** If you need to
  relink, `pnpm install --frozen-lockfile` fails rather than writes.
- **Resolve `.claude/ade-coordination.md` as a union, never an overwrite.** It
  has forked: after line 341 each checkout holds only its own lane's claims.
- **`feature-readiness.ts` is now orphaned** — nothing imports it since the page
  swap. Deleting it is fine *once you have confirmed that in your own tree*; it
  is 505 lines that still read as authoritative and it holds at least two claims
  already proven false.
- **Correct a stale row, never silently rewrite it.** Say in `provenance.note`
  what was wrong and what you checked. Three rows were corrected this way today.
- **`verifiedAt` absent means nobody checked.** Do not stamp it unless you
  actually read the code.
